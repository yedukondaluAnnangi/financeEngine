/**
 * PdfText.gs — getting text out of a PDF, and the shared helpers.
 *
 * Apps Script has no PDF library. The only route is to let Drive convert the
 * PDF into a Google Doc and read that.
 *
 * ── The thing that matters about that converter ────────────────────────────
 * It does NOT preserve line breaks. A statement's transaction table comes
 * back as one long paragraph per page, with every row run together. Any
 * parser that assumes one transaction per line will therefore swallow a
 * whole page into a single row.
 *
 * Two answers to that, and the parsers use both:
 *
 *   Card statements re-break the text before each date token, which restores
 *   one transaction per line well enough to parse.
 *
 *   Chequing and savings statements ignore line breaks entirely and use the
 *   running balance to find record boundaries instead. See scanByBalance.
 */

function pdfToText(fileId) {
  var blob = DriveApp.getFileById(fileId).getBlob();
  var tmpId = null, text = '';

  try {
    if (typeof Drive === 'undefined' || !Drive.Files) {
      throw new Error('Enable the Drive advanced service: Editor > Services > Drive API.');
    }

    if (Drive.Files.insert) {                      // Advanced Drive Service v2
      tmpId = Drive.Files.insert(
        { title: 'tmp-convert-' + Date.now(), mimeType: MimeType.GOOGLE_DOCS },
        blob, { ocr: true, ocrLanguage: 'en' }).id;
    } else if (Drive.Files.create) {               // Advanced Drive Service v3
      try {
        tmpId = Drive.Files.create(
          { name: 'tmp-convert-' + Date.now(), mimeType: MimeType.GOOGLE_DOCS }, blob).id;
      } catch (e1) {
        // v3 occasionally rejects a conversion on first attempt. One retry.
        Utilities.sleep(2000);
        tmpId = Drive.Files.create(
          { name: 'tmp-convert-' + Date.now(), mimeType: MimeType.GOOGLE_DOCS }, blob).id;
      }
    } else {
      throw new Error('Drive service present but neither insert nor create is available.');
    }

    text = DocumentApp.openById(tmpId).getBody().getText();

  } finally {
    if (tmpId) { try { DriveApp.getFileById(tmpId).setTrashed(true); } catch (e) {} }
  }

  if (!text || text.length < 200) {
    throw new Error('Converted to fewer than 200 characters — probably a scanned PDF with no text layer.');
  }
  return text;
}


/* ---------------------------------------------------------------------------
   Text helpers
   --------------------------------------------------------------------------- */

/** Everything on one line, single-spaced. This is the form the scanners use. */
function flatten(text) {
  return text.split(/[\r\n]+/)
             .map(function (l) { return l.trim(); })
             .filter(function (l) { return l.length > 0; })
             .join(' ');
}

function toLines(text) {
  return text.split(/[\r\n]+/).map(function (l) { return l.trim(); })
             .filter(function (l) { return l.length > 0; });
}

function squash(s) { return String(s).replace(/\s+/g, ' ').trim(); }
function deSpace(s) { return String(s).replace(/\s+/g, ''); }

/** Remove repeating page furniture before parsing. */
function stripBoilerplate(text, patterns) {
  var t = text;
  (patterns || []).forEach(function (p) { t = t.replace(p, ' '); });
  return t;
}

/** Insert a line break before every date token, undoing the converter's flattening. */
function resplitOnDates(text, dateSource) {
  return text.replace(new RegExp('(?!^)(?=' + dateSource + ')', 'g'), '\n');
}

function num(s) {
  if (s === null || s === undefined) return null;
  var t = String(s).trim();
  var neg = /^\(.*\)$/.test(t) || /^-/.test(t);
  t = t.replace(/[(),$]/g, '').replace(/^-/, '').replace(/\s/g, '');
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  var v = parseFloat(t);
  return neg ? -v : v;
}

/** Money tokens in a string, in order. */
function trailingAmounts(line) {
  var out = [], re = /-?\(?\$?\d{1,3}(?:,\d{3})*(?:\.\d{2})\)?/g, m;
  while ((m = re.exec(line)) !== null) out.push({ raw: m[0], val: num(m[0]), idx: m.index });
  return out;
}

/** Unsigned money tokens with positions. Used by scanByBalance. */
function moneyTokens(text) {
  var out = [], re = /\d{1,3}(?:,\d{3})*\.\d{2}/g, m;
  while ((m = re.exec(text)) !== null) {
    out.push({ raw: m[0], val: parseFloat(m[0].replace(/,/g, '')), start: m.index, end: re.lastIndex });
  }
  return out;
}


/* ===========================================================================
   scanByBalance — find transactions without relying on line breaks at all.

   A bank statement carries its own error-checking: every row states the
   balance after it. So instead of guessing where one row ends and the next
   begins, walk the money figures in order and look for a pair where the
   second figure continues the running balance by exactly the first figure.
   That pair is a transaction, and the text before it is its description.

   This is why it survives the converter's flattening: it never asks where
   the lines are. It also settles the direction of every row for free, since
   the balance moving down is money out. No guessing from wording.

   On the August HDFC statement it labelled a 153.00 row as money IN, where
   reading the narration would have called it money out. The bank's own
   summary confirms two credits totalling 78,703, which is the 78,550 tax
   refund plus exactly that 153.
   =========================================================================== */

/**
 * @param text       the flattened statement text
 * @param opening    the statement's opening balance (required)
 * @param dateSource regex source matching this bank's date format
 * @param boiler     array of regexes for page furniture to remove first
 * @returns [{ dateText, desc, amount, balance, warn }]
 */
function scanByBalance(text, opening, dateSource, boiler) {
  var t = stripBoilerplate(text, boiler);
  var dateRe = new RegExp(dateSource, 'gi');

  var toks = moneyTokens(t);
  var dates = [], m;
  while ((m = dateRe.exec(t)) !== null) {
    dates.push({ raw: m[0], start: m.index, end: dateRe.lastIndex });
    if (m.index === dateRe.lastIndex) dateRe.lastIndex++;
  }

  var stripDates = new RegExp(dateSource, 'gi');
  var recs = [], prev = opening, i = 0;

  while (i < toks.length - 1) {
    var a = toks[i], b = toks[i + 1];
    var delta = round2(b.val - prev);

    if (!(Math.abs(Math.abs(delta) - a.val) <= 0.02 && Math.abs(delta) > 0)) { i++; continue; }

    // Everything before this amount, back to the nearest date marker.
    // The nearest one is sometimes a value date sitting right against the
    // figure, which would leave nothing, so step back until there is text.
    var before = [];
    for (var k = 0; k < dates.length; k++) if (dates[k].start < a.start) before.push(dates[k]);

    var desc = '';
    for (var back = 1; back <= 3 && back <= before.length; back++) {
      desc = squash(t.substring(before[before.length - back].end, a.start).replace(stripDates, ' '));
      if (desc) break;
    }

    recs.push({
      dateText: before.length ? before[before.length - 1].raw : null,
      desc: desc || '(no description)',
      amount: delta,
      balance: b.val,
      warn: null
    });

    prev = b.val;
    i += 2;
  }

  return recs;
}


/* ---------------------------------------------------------------------------
   Dates
   --------------------------------------------------------------------------- */

function iso(d) { return Utilities.formatDate(d, 'UTC', 'yyyy-MM-dd'); }
function ym(d)  { return Utilities.formatDate(d, 'UTC', 'yyyy-MM'); }

function dateInPeriod(day, monIdx, period) {
  var best = null;
  for (var y = period.startYear - 1; y <= period.endYear + 1; y++) {
    var d = new Date(Date.UTC(y, monIdx, day));
    if (d >= period.start && d <= period.end && !best) best = d;
  }
  if (best) return best;
  return new Date(Date.UTC(period.startYear, monIdx, day));
}

/** "10Aug", "Aug 10", "01/08/26" -> a Date inside the statement period. */
function parseDateText(txt, period) {
  if (!txt) return null;
  var s = squash(txt);

  var m = s.match(/^(\d{2})\/(\d{2})\/(\d{2,4})$/);
  if (m) {
    var yr = +m[3]; if (yr < 100) yr += 2000;
    return new Date(Date.UTC(yr, (+m[2]) - 1, +m[1]));
  }

  m = s.match(/^(\d{1,2})\s*([A-Za-z]{3})/);
  if (m) return dateInPeriod(+m[1], CFG.MONTHS[m[2].toUpperCase()], period);

  m = s.match(/^([A-Za-z]{3})[a-z]*\s*(\d{1,2})$/);
  if (m) return dateInPeriod(+m[2], CFG.MONTHS[m[1].toUpperCase()], period);

  return null;
}

function findPeriod(text) {
  var t = squash(text), d = deSpace(text);
  var mw = '(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*';

  var m = t.match(new RegExp(mw + '\\s*(\\d{1,2}),?\\s*(\\d{4})\\s*(?:to|-|–|—)\\s*' +
                             mw + '\\s*(\\d{1,2}),?\\s*(\\d{4})', 'i'));
  if (m) return mkPeriod(m[2], m[1], m[3], m[5], m[4], m[6]);

  m = d.match(new RegExp(mw + '(\\d{1,2}),?(\\d{4})(?:to|-)' + mw + '(\\d{1,2}),?(\\d{4})', 'i'));
  if (m) return mkPeriod(m[2], m[1], m[3], m[5], m[4], m[6]);

  m = d.match(/From:?(\d{2})\/(\d{2})\/(\d{4})To:?(\d{2})\/(\d{2})\/(\d{4})/i);
  if (m) return {
    start: new Date(Date.UTC(+m[3], +m[2] - 1, +m[1])),
    end:   new Date(Date.UTC(+m[6], +m[5] - 1, +m[4])),
    startYear: +m[3], endYear: +m[6]
  };

  m = t.match(new RegExp('For\\s*' + mw + '\\s*(\\d{1,2})\\s*to\\s*' + mw + '\\s*(\\d{1,2}),?\\s*(\\d{4})', 'i'));
  if (m) return mkPeriod(m[2], m[1], m[5], m[4], m[3], m[5]);

  var now = new Date();
  return {
    start: new Date(Date.UTC(now.getFullYear(), now.getMonth() - 2, 1)),
    end:   new Date(Date.UTC(now.getFullYear(), now.getMonth() + 1, 0)),
    startYear: now.getFullYear(), endYear: now.getFullYear()
  };
}

function mkPeriod(d1, mon1, y1, d2, mon2, y2) {
  return {
    start: new Date(Date.UTC(+y1, CFG.MONTHS[String(mon1).slice(0, 3).toUpperCase()], +d1)),
    end:   new Date(Date.UTC(+y2, CFG.MONTHS[String(mon2).slice(0, 3).toUpperCase()], +d2)),
    startYear: +y1, endYear: +y2
  };
}

/**
 * A rule with `file` (a regex) is matched against the file name only, and is
 * skipped when there is no file name (a PDF). A rule with `test` is matched
 * against the text, which for a spreadsheet includes the file name.
 */
function detectAccount(text, fileName) {
  var s = squash(text), g = deSpace(text);
  for (var i = 0; i < CFG.ACCOUNTS.length; i++) {
    var a = CFG.ACCOUNTS[i];
    if (a.file) {
      if (fileName && a.file.test(fileName)) return a;
      continue;
    }
    if (s.indexOf(a.test) !== -1 || g.indexOf(deSpace(a.test)) !== -1) return a;
  }
  return null;
}

/* ===========================================================================
   Spreadsheets and CSV

   Far better input than a PDF when the bank offers it. Drive converts a real
   spreadsheet into a real spreadsheet, so nothing is flattened, nothing has
   to be inferred from a running balance, and withdrawal and deposit arrive
   already in their own columns.

   It is also the way round HDFC's password. HDFC encrypts the PDF but not
   the Excel or Delimited download, and Drive refuses to convert an encrypted
   file at all.
   =========================================================================== */

/** Read a spreadsheet or CSV file as a 2D array of cell values. */
function fileToRows(file) {
  var name = file.getName(), mime = file.getMimeType();

  if (/\.csv$/i.test(name) || /\.txt$/i.test(name) || mime === MimeType.CSV || mime === MimeType.PLAIN_TEXT) {
    return csvBlobToRows(file.getBlob());
  }

  if (typeof Drive === 'undefined' || !Drive.Files) {
    throw new Error('Enable the Drive advanced service: Editor > Services > Drive API.');
  }

  var tmpId = null;
  try {
    var blob = file.getBlob();
    if (Drive.Files.insert) {
      tmpId = Drive.Files.insert({ title: 'tmp-sheet-' + Date.now(), mimeType: MimeType.GOOGLE_SHEETS }, blob).id;
    } else {
      tmpId = Drive.Files.create({ name: 'tmp-sheet-' + Date.now(), mimeType: MimeType.GOOGLE_SHEETS }, blob).id;
    }
    return SpreadsheetApp.openById(tmpId).getSheets()[0].getDataRange().getValues();
  } finally {
    if (tmpId) { try { DriveApp.getFileById(tmpId).setTrashed(true); } catch (e) {} }
  }
}

/** A CSV or tab-separated blob as a 2D array of strings. */
function csvBlobToRows(blob) {
  // Strip a UTF-8 byte-order mark, or the first header cell never matches.
  var txt = blob.getDataAsString().replace(/^﻿/, '');
  // HDFC's "Delimited" export is comma separated; a tab export is possible too.
  if (txt.indexOf('\t') !== -1 && txt.indexOf(',') === -1) {
    return txt.split(/[\r\n]+/).map(function (l) { return l.split('\t'); });
  }
  return Utilities.parseCsv(txt);
}

/** Is this file a zip archive (a bulk download of monthly CSVs)? */
function isZipFile(file) {
  var n = file.getName(), m = file.getMimeType();
  return /\.zip$/i.test(n) || m === MimeType.ZIP || m === 'application/x-zip-compressed';
}

/** The CSV entries inside a zip, as blobs. macOS resource forks are skipped. */
function zipEntries(file) {
  var blob = file.getBlob().setContentType(MimeType.ZIP);
  return Utilities.unzip(blob).filter(function (b) {
    var n = b.getName();
    return /\.csv$/i.test(n) && !/(^|\/)__MACOSX\//.test(n) && !/(^|\/)\._/.test(n);
  });
}

/** Flatten rows into text, only so the account fingerprints can be matched. */
function rowsToText(rows) {
  return rows.map(function (r) {
    return r.map(function (c) { return c === null || c === undefined ? '' : String(c); }).join(' ');
  }).join('\n');
}

/** Is this file a spreadsheet or CSV rather than a PDF? */
function isRowFile(file) {
  var n = file.getName(), m = file.getMimeType();
  return /\.(xls|xlsx|csv|txt)$/i.test(n)
      || m === MimeType.CSV
      || m === MimeType.PLAIN_TEXT
      || m === MimeType.MICROSOFT_EXCEL
      || m === MimeType.MICROSOFT_EXCEL_LEGACY
      || m === MimeType.GOOGLE_SHEETS
      || /excel|spreadsheet/i.test(m);
}

/** A cell that may arrive as a Date, a number, or a string. */
function cellDate(v, period) {
  if (v instanceof Date) return new Date(Date.UTC(v.getFullYear(), v.getMonth(), v.getDate()));
  return parseDateText(String(v || '').trim(), period);
}

/** A cell that may arrive as a number or as "1,234.56". */
function cellNum(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return v;
  return num(String(v));
}
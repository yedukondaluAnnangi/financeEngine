/**
 * Parsers.gs — one function per statement format.
 *
 * Every parser returns:
 *   { date: Date, desc: String, amount: Number, balance: Number|null, warn: String|null }
 *
 * Sign convention, everywhere:
 *   negative = money left the account
 *   positive = money arrived
 * On a credit card that makes purchases negative and payments positive, so
 * every account in the sheet reads the same way and the totals add up.
 *
 * ── Two strategies, because banks print two kinds of statement ─────────────
 *
 * Chequing and savings statements carry a running balance. Those are read by
 * scanByBalance, which ignores line breaks entirely and lets the balance
 * chain mark where one transaction ends and the next begins. That makes them
 * immune to the Drive converter flattening each page into one paragraph, and
 * it settles the direction of every row from arithmetic rather than wording.
 *
 * Card statements have no balance column, so there is nothing to chain. Those
 * re-break the text before each date token and read the printed sign.
 *
 * All five were checked against the August and September statements and
 * reproduce the banks' own stated figures.
 */

var MONTH_RE = '(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)';

function round2(n) { return Math.round(n * 100) / 100; }

/** Turn scanByBalance output into parser output. */
function datedRecords(recs, period) {
  var out = [], last = null;
  recs.forEach(function (r) {
    var d = parseDateText(r.dateText, period) || last;
    if (!d) return;
    last = d;
    out.push({ date: d, desc: r.desc, amount: round2(r.amount), balance: r.balance, warn: r.warn });
  });
  return out;
}


/* ===========================================================================
   RBC chequing
   Verified: 9 rows, closing 13.06 — the statement's own figure.
   Includes the 31 August rent sent, cancelled and re-sent as three separate
   rows, which is what the statement shows and what a merged reading loses.
   =========================================================================== */

function parseRbc(text, period) {
  var flat = flatten(text);

  var m = deSpace(text).match(/OpeningBalance([\d,]+\.\d{2})/i);
  if (!m) throw new Error('RBC: could not find the opening balance.');
  var opening = num(m[1]);

  var recs = scanByBalance(flat, opening, '\\d{1,2}\\s*' + MONTH_RE + '[a-z]*\\b', [
    /Youropeningbalance[^$]*\$[\d,]+\.\d{2}/gi,
    /Your\s*opening\s*balance[^$]*\$[\d,]+\.\d{2}/gi,
    /Total\s*deposits[^+]*\+\s*[\d,]+\.\d{2}/gi,
    /Total\s*withdrawals[^\d]*[\d,]+\.\d{2}/gi,
    /Your\s*closing\s*balance[^$]*\$[\d,]+\.\d{2}/gi,
    /Yourclosingbalance[^$]*\$[\d,]+\.\d{2}/gi
  ]);

  return datedRecords(recs, period);
}


/* ===========================================================================
   CIBC chequing
   Verified: 5 rows, closing 973.75 — the statement's own figure.
   The undated SERVICE CHARGE is picked up as its own row, which a
   line-based reading merges into the preauthorised debit above it.
   =========================================================================== */

function parseCibc(text, period) {
  var flat = flatten(text);

  var m = flat.match(/Opening\s*balance[^\d]*([\d,]+\.\d{2})/i);
  if (!m) throw new Error('CIBC: could not find the opening balance.');
  var opening = num(m[1]);

  var recs = scanByBalance(flat, opening, MONTH_RE + '[a-z]*\\s+\\d{1,2}\\b', [
    /Opening\s*balance\s*on\s*[A-Za-z]+\s*\d{1,2},\s*\d{4}\s*\$?[\d,]+\.\d{2}/gi,
    /Closing\s*balance\s*on\s*[A-Za-z]+\s*\d{1,2},\s*\d{4}\s*=?\s*\$?[\d,]+\.\d{2}/gi,
    /Withdrawals\s*-\s*[\d,]+\.\d{2}/gi,
    /Deposits\s*\+\s*[\d,]+\.\d{2}/gi,
    /CAPPED\s*MONTHLY\s*FEE\s*\$?[\d,]+\.\d{2}/gi
  ]);

  return datedRecords(recs, period);
}


/* ===========================================================================
   HDFC savings
   Verified: 38 rows, 36 out and 2 in, closing 47,195.58 — matching the
   statement's own summary line exactly.
   The opening balance is not printed at the top of this layout; it sits in
   the summary block at the very end.
   =========================================================================== */

function parseHdfcSavings(text, period) {
  var flat = flatten(text);

  var m = deSpace(text).match(/OpeningBalanceDrCountCrCountDebitsCreditsClosingBal([\d,]+\.\d{2})/i);
  if (!m) m = deSpace(text).match(/OpeningBalance[^\d]{0,80}?([\d,]+\.\d{2})/i);
  if (!m) throw new Error('HDFC savings: could not find the opening balance in the summary block.');
  var opening = num(m[1]);

  var recs = scanByBalance(flat, opening, '\\d{2}/\\d{2}/\\d{2}', [
    /OpeningBalance\s*DrCount[\s\S]{0,120}?ClosingBal/gi,
    /Opening\s*Balance\s*Dr\s*Count[\s\S]{0,120}?Closing\s*Bal/gi
  ]);

  return datedRecords(recs, period);
}


/* ===========================================================================
   Neo Mastercard
     Sep 2 Sep 3 LCBO/RAO #753 OSHAWA CAN -7.90
   No balance column, so the printed sign is read directly. The text is
   re-broken before each pair of dates first, because the converter returns a
   whole page as one paragraph.
   Verified: 171 rows, spend -2,795.22, credits +2,943.68 — both exact.
   =========================================================================== */

function parseNeo(text, period) {
  var pairSrc = MONTH_RE + '[a-z]*\\s*\\d{1,2}\\s+' + MONTH_RE + '[a-z]*\\s*\\d{1,2}\\s';
  var prepared = resplitOnDates(flatten(text), pairSrc);

  // First money figure after the description, but never one closed by a
  // bracket: a foreign charge prints as "ROAMLESS ... (USD -5.51) -7.64"
  // and the bracketed figure is the foreign amount, not what you were billed.
  var re = new RegExp('^' + MONTH_RE + '\\s*(\\d{1,2})\\s+' + MONTH_RE +
                      '\\s*(\\d{1,2})\\s+(.+?)\\s+(-?\\$?[\\d,]+\\.\\d{2})(?!\\s*\\))', 'i');
  var monRe = new RegExp('^(' + MONTH_RE + ')', 'i');

  var out = [];
  toLines(prepared).forEach(function (line) {
    var s = squash(line);
    var m = s.match(re);
    if (!m) return;

    var mon = s.match(monRe);
    var amt = num(m[4]);
    var desc = squash(m[3]);
    if (!mon || amt === null || !desc) return;

    out.push({
      date: dateInPeriod(+m[1], CFG.MONTHS[mon[1].toUpperCase()], period),
      desc: desc,
      amount: amt,
      balance: null,
      warn: null
    });
  });

  return out;
}


/* ===========================================================================
   HDFC Regalia credit card
     27/08/2026| 18:57 EMI KEERTHI MEDICAL STORESONGOLE + 39 C 2,668.00 l
   The currency symbol extracts as a stray letter (a mangled rupee sign).
   A "+" immediately before it marks a credit; a "+ 39" earlier in the line
   is reward points. Confusing the two turns a 2,668 spend into a 2,668
   refund, so they are matched separately.
   Descriptions often sit on the line ABOVE the date, so each row falls back
   to the text preceding it.
   Verified: 12 rows, purchases -8,798.68, credits +12,509.00 — both exact.
   =========================================================================== */

var HDFC_CARD_TAIL = /\s*(?:●|Eligible\s+for\s+EMI|CONVERT\s+TO\s+EMI|Rewards\s+Program|GST\s+Summary|Points\s+Summary)/i;

function parseHdfcCard(text, period) {
  var prepared = resplitOnDates(flatten(text), '\\d{2}/\\d{2}/\\d{4}');
  var lines = toLines(prepared);
  var out = [], carry = [];

  var skip = /^(DATE\s*&|Page \d|DUPLICATE|HDFC Bank|Domestic Trans|International|Rewards Program|GST Summary|TRANSACTIONS TOTAL|Eligible for EMI|SR NO|Total|\*GST|offers on|YEDUKONDALU)/i;

  function clean(s) {
    return squash(String(s)
      .replace(/\s*[A-Za-z\u20b9\u20a8]\s*$/, '')
      .replace(/\+\s*$/, '')
      .replace(/[+-]\s*\d+\s*$/, '')
      .replace(/\(Ref#\s*$/i, ''));
  }

  lines.forEach(function (line) {
    var s = squash(line);
    if (skip.test(s)) { carry = []; return; }

    var m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})\s*\|?\s*\d{0,2}:?\d{0,2}\s*(.*)$/);
    if (!m) { carry.push(s); return; }

    // The last row before the summary block runs straight into it
    // ("… + C 1,539.00 ● Eligible for EMI … GST C93.05"), and the summary's
    // figures would be read as the amount. Cut the line at the first marker.
    var rest = m[4].split(HDFC_CARD_TAIL)[0], amts = trailingAmounts(rest);
    if (!amts.length) { carry.push(s); return; }

    var last = amts[amts.length - 1];
    if (last.val === null || !last.val) return;

    var before   = rest.slice(0, last.idx);
    var isCredit = /\+\s*[A-Za-z\u20b9\u20a8]?\s*$/.test(before);

    var desc = clean(before);
    if (!desc && carry.length) desc = clean(carry[carry.length - 1]);

    out.push({
      date: new Date(Date.UTC(+m[3], (+m[2]) - 1, +m[1])),
      desc: desc || '(no description)',
      amount: isCredit ? Math.abs(last.val) : -Math.abs(last.val),
      balance: null,
      warn: null
    });
    carry = [];
  });

  return out;
}

/* ===========================================================================
   HDFC savings — the Excel or Delimited download

   Columns, in order:
     Date | Narration | Chq./Ref.No. | Value Dt | Withdrawal Amt. | Deposit Amt. | Closing Balance

   This is the preferred way to read this account. The bank has already
   separated withdrawals from deposits, so the direction of every row is
   stated rather than deduced, and there is no PDF text to flatten.

   It also sidesteps the password. HDFC encrypts the PDF download but not the
   Excel or Delimited one, and Drive will not convert an encrypted file.
   =========================================================================== */

function parseHdfcSavingsRows(rows, period) {
  var out = [];

  // Find the header row rather than assuming a fixed offset — HDFC pads the
  // top of the sheet with a variable number of address lines.
  var firstCol = 0, narrCol = 1, refCol = 2, wdCol = 4, depCol = 5, balCol = 6;
  for (var h = 0; h < Math.min(rows.length, 40); h++) {
    var joined = rows[h].join('|').toLowerCase();
    if (joined.indexOf('withdrawal') !== -1 && joined.indexOf('deposit') !== -1) {
      rows[h].forEach(function (c, idx) {
        var t = String(c || '').toLowerCase();
        if (t.indexOf('date') === 0) firstCol = idx;
        else if (t.indexOf('narration') !== -1) narrCol = idx;
        else if (t.indexOf('ref') !== -1) refCol = idx;
        else if (t.indexOf('withdrawal') !== -1) wdCol = idx;
        else if (t.indexOf('deposit') !== -1) depCol = idx;
        else if (t.indexOf('closing') !== -1) balCol = idx;
      });
      break;
    }
  }

  rows.forEach(function (r) {
    var d = cellDate(r[firstCol], period);
    if (!d) return;

    var wd  = cellNum(r[wdCol]);
    var dep = cellNum(r[depCol]);
    var bal = cellNum(r[balCol]);
    if (wd === null && dep === null) return;

    var amount = round2((dep || 0) - (wd || 0));
    if (!amount) return;

    var desc = squash([r[narrCol], r[refCol]].map(function (c) {
      return c === null || c === undefined ? '' : String(c);
    }).join(' '));

    out.push({
      date: d,
      desc: desc || '(no description)',
      amount: amount,
      balance: bal,
      warn: null
    });
  });

  return out;
}

/* ========================================================================
   TD chequing - CSV download ("accountactivity.csv")
   Columns, no header:  Date (MM/DD/YYYY) | Description | Debit | Credit | Balance
   Dates are month-first, so they are parsed here rather than by
   parseDateText, which reads nn/nn/nnnn as day-first.
   ======================================================================== */

/* ========================================================================
   CIBC chequing - CSV download
   Columns, no header:  Date (YYYY-MM-DD) | Description | Debit | Credit
   A card account adds a fifth column (card number); it is ignored.
   No balance column, so there is no chain to check.
   ======================================================================== */

function parseCibcRows(rows, period) {
  var out = [];
  rows.forEach(function (r) {
    if (!r || r.length < 4) return;
    var m = String(r[0] || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return;
    var debit = cellNum(r[2]), credit = cellNum(r[3]);
    if (debit === null && credit === null) return;
    var amount = round2((credit || 0) - (debit || 0));
    if (!amount) return;
    out.push({
      date: new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])),
      desc: squash(r[1]) || '(no description)',
      amount: amount,
      balance: null,
      warn: null
    });
  });
  return out;
}

/* ========================================================================
   RBC chequing - CSV download ("download-transactions.csv")
   Header: Account Type | Account Number | Transaction Date | Cheque Number |
           Description 1 | Description 2 | CAD$ | USD$
   Amounts are already signed. Dates are M/D/YYYY. Columns are found by
   header name, so a reordered export still reads correctly.
   ======================================================================== */

function parseRbcRows(rows, period) {
  var col = { date: 2, d1: 4, d2: 5, cad: 6, usd: 7 };
  for (var h = 0; h < Math.min(rows.length, 5); h++) {
    var hdr = rows[h].map(function (c) { return String(c || '').trim().toLowerCase(); });
    if (hdr.indexOf('transaction date') === -1) continue;
    col = { date: hdr.indexOf('transaction date'), d1: hdr.indexOf('description 1'),
            d2: hdr.indexOf('description 2'), cad: hdr.indexOf('cad$'), usd: hdr.indexOf('usd$') };
    break;
  }

  var out = [];
  rows.forEach(function (r) {
    var raw = r[col.date], d = null;
    if (raw instanceof Date) {
      d = new Date(Date.UTC(raw.getFullYear(), raw.getMonth(), raw.getDate()));
    } else {
      var m = String(raw || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (m) d = new Date(Date.UTC(+m[3], +m[1] - 1, +m[2]));
    }
    if (!d) return;                                   // header or blank line

    var cad = cellNum(r[col.cad]);
    var usd = col.usd >= 0 ? cellNum(r[col.usd]) : null;
    var amount = cad !== null ? cad : usd;
    if (!amount) return;

    out.push({
      date: d,
      desc: squash([r[col.d1], col.d2 >= 0 ? r[col.d2] : ''].join(' ')) || '(no description)',
      amount: round2(amount),
      currency: cad !== null ? 'CAD' : 'USD',
      balance: null,
      warn: null
    });
  });
  return out;
}

/* ========================================================================
   Neo Mastercard - CSV download
   Header: Transaction Date | Posted Date | Status | Description | Amount
   Amounts are signed the way the sheet wants (purchases negative). Pending
   rows are skipped: their amount and text can still change before posting,
   and the next download picks them up once posted.
   The transaction date is used, as the PDF parser does, and descriptions
   squash to the same text as the PDF's, so a CSV row lands on the same
   Transaction ID as the PDF row for the same purchase.
   ======================================================================== */

function parseNeoRows(rows, period) {
  var col = { date: 0, status: 2, desc: 3, amt: 4 };
  for (var h = 0; h < Math.min(rows.length, 5); h++) {
    var hdr = rows[h].map(function (c) { return String(c || '').trim().toLowerCase(); });
    if (hdr.indexOf('transaction date') === -1) continue;
    col = { date: hdr.indexOf('transaction date'), status: hdr.indexOf('status'),
            desc: hdr.indexOf('description'), amt: hdr.indexOf('amount') };
    break;
  }

  var out = [];
  rows.forEach(function (r) {
    var m = String(r[col.date] || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return;                                   // header or blank line
    if (col.status >= 0 && /pending/i.test(String(r[col.status] || ''))) return;
    var amount = cellNum(r[col.amt]);
    if (!amount) return;
    out.push({
      date: new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])),
      desc: squash(r[col.desc]) || '(no description)',
      amount: round2(amount),
      balance: null,
      warn: null
    });
  });
  return out;
}

function parseTdRows(rows, period) {
  var out = [];
  rows.forEach(function (r) {
    if (!r || r.length < 5) return;
    var m = String(r[0] || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!m) return;                                   // header or blank line
    var debit = cellNum(r[2]), credit = cellNum(r[3]);
    if (debit === null && credit === null) return;
    var amount = round2((credit || 0) - (debit || 0));
    if (!amount) return;
    out.push({
      date: new Date(Date.UTC(+m[3], +m[1] - 1, +m[2])),
      desc: squash(r[1]) || '(no description)',
      amount: amount,
      balance: cellNum(r[4]),
      warn: null
    });
  });
  return out;
}
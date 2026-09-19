/**
 * Main.gs — what you actually run.
 *
 *   ingestInbox()      read every new PDF in the inbox folder
 *   relabelAll()       re-label past rows after adding patterns (Ledger.gs)
 *   testOneFile()      parse a single file and log the result, writing nothing
 *   listTabs()         show every tab name, brackets included, to spot stray spaces
 *   setUpSheets()      create the housekeeping tabs
 *   installTrigger()   run it automatically every Friday evening
 */


/**
 * Find a tab by name, ignoring capitalisation and stray spaces.
 * getSheetByName is exact-match, so a tab called "Transactions " with a
 * trailing space is a different tab as far as it is concerned. This is
 * the single most common reason a working script suddenly cannot find
 * anything, and it is invisible on screen.
 */
function getTab(ss, wanted) {
  var want = String(wanted).trim().toLowerCase();
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    if (sheets[i].getName().trim().toLowerCase() === want) return sheets[i];
  }
  return null;
}

function tabNames(ss) {
  return ss.getSheets().map(function (s) { return '[' + s.getName() + ']'; }).join(' ');
}

/** Run this if a tab cannot be found. Brackets make a stray space visible. */
function listTabs() {
  var ss = SpreadsheetApp.openById(CFG.SHEET_ID);
  Logger.log('Spreadsheet: ' + ss.getName());
  Logger.log('Tabs: ' + tabNames(ss));
  Logger.log('Looking for: [' + CFG.TAB_TX + '] and [' + CFG.TAB_PAYEES + ']');
  Logger.log('Transactions found: ' + (getTab(ss, CFG.TAB_TX) ? 'yes' : 'NO'));
  Logger.log('Payees found: '       + (getTab(ss, CFG.TAB_PAYEES) ? 'yes' : 'NO'));
}


function ingestInbox() {
  var ss = SpreadsheetApp.openById(CFG.SHEET_ID);
  setUpSheets();

  var tx     = getTab(ss, CFG.TAB_TX);
  var runs   = getTab(ss, CFG.TAB_RUNS);
  var issues = getTab(ss, CFG.TAB_ISSUES);

  if (!tx) {
    throw new Error('No tab named "' + CFG.TAB_TX + '". Tabs found: ' + tabNames(ss) +
                    '  — rename the tab, or set CFG.TAB_TX to match.');
  }

  var payees   = readPayees(ss);
  var existing = existingIdSet(tx);
  var doneHash = runHashSet(runs);

  var inbox = DriveApp.getFolderById(CFG.INBOX_ID);
  var files = inbox.getFiles();          // PDFs, spreadsheets and CSVs alike

  var allRows = [], allIssues = [], report = [];

  while (files.hasNext()) {
    var file = files.next();
    var name = file.getName();
    var fid  = file.getId();

    try {
      if (!isRowFile(file) && file.getMimeType() !== MimeType.PDF) continue;

      var checksum = shortHash(fid + '|' + file.getSize() + '|' + file.getLastUpdated().getTime());
      if (doneHash[checksum]) { report.push('· ' + name + ' — already ingested, skipped'); continue; }

      // A spreadsheet or CSV is read as rows; a PDF is read as text.
      // Rows are better whenever the bank offers them: the columns survive,
      // so nothing has to be inferred.
      var rows = null, text, acct, recs;

      if (isRowFile(file)) {
        rows = fileToRows(file);
        if (!rows || !rows.length) throw new Error('The spreadsheet came back empty.');
        text = rowsToText(rows);
        acct = detectAccount(text);
        if (!acct) throw new Error('Could not tell which account this is. Add a fingerprint to CFG.ACCOUNTS.');
        if (!acct.rowParser) {
          throw new Error(acct.name + ' has no spreadsheet parser — supply the PDF, or add a rowParser.');
        }
        recs = this[acct.rowParser](rows, findPeriod(text));
      } else {
        text = pdfToText(fid);
        acct = detectAccount(text);
        if (!acct) throw new Error('Could not tell which account this is. Add a fingerprint to CFG.ACCOUNTS.');
        if (!acct.parser) {
          throw new Error(acct.name + ' has no PDF parser — download it as Excel or Delimited instead.');
        }
        recs = this[acct.parser](text, findPeriod(text));
      }

      if (!recs.length) throw new Error('Parsed zero transactions — the layout has probably changed.');

      var built = buildRows(recs, acct, payees, existing, allIssues, name);

      // Sanity check: do the parsed amounts agree with the statement's own
      // closing balance? Only meaningful where a balance column exists.
      var chainNote = checkChain(recs);
      if (chainNote) allIssues.push([new Date(), name, '', '', '', chainNote]);
      if (chainNote && CFG.STRICT_BALANCE) throw new Error(chainNote);

      allRows = allRows.concat(built.rows);

      report.push('✓ ' + name + ' — ' + acct.name + ', ' +
                  recs.length + ' parsed, ' + built.rows.length + ' new, ' +
                  built.skipped + ' already there');

      if (!CFG.DRY_RUN) {
        runs.appendRow([new Date(), name, fid, checksum, acct.name,
                        recs.length, built.rows.length, built.skipped, 'OK']);
        doneHash[checksum] = true;
        if (CFG.MOVE_WHEN_DONE) moveTo(file, inbox, CFG.DONE_NAME);
      }

    } catch (err) {
      report.push('✗ ' + name + ' — ' + err.message);
      if (!CFG.DRY_RUN) {
        runs.appendRow([new Date(), name, fid, '', '', 0, 0, 0, 'FAILED: ' + err.message]);
      }
      // Deliberately NOT moved. A failure is usually about the environment
      // (a service not switched on, a quota, a network blip) rather than the
      // file, so the file stays in the inbox and retries on the next run.
      // Moving it would mean fixing the cause and then wondering why nothing
      // happens, because the inbox is empty.
    }
  }

  if (allRows.length && !CFG.DRY_RUN) {
    allRows.sort(function (a, b) { return a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0; });
    tx.getRange(tx.getLastRow() + 1, 1, allRows.length, CFG.COLS.length).setValues(allRows);
  }

  if (allIssues.length && !CFG.DRY_RUN) {
    issues.getRange(issues.getLastRow() + 1, 1, allIssues.length, 6).setValues(allIssues);
  }

  var flagged = (allRows.length && !CFG.DRY_RUN) ? flagReversals(tx) : 0;

  var summary = report.join('\n') +
                '\n\n' + allRows.length + ' row(s) added' +
                (flagged ? ', ' + flagged + ' reversal leg(s) flagged' : '') +
                (allIssues.length ? ', ' + allIssues.length + ' note(s) in ' + CFG.TAB_ISSUES : '') +
                (CFG.DRY_RUN ? '\n\n(DRY RUN — nothing was written.)' : '');

  Logger.log(summary);
  return summary;
}


/** Closing balance implied by the parsed rows vs the last stated balance. */
function checkChain(recs) {
  var withBal = recs.filter(function (r) { return r.balance !== null; });
  if (withBal.length < 2) return null;

  var first = withBal[0], last = withBal[withBal.length - 1];
  var moved = 0;
  for (var i = 1; i < withBal.length; i++) moved += withBal[i].amount;
  var implied = round2(first.balance + moved);

  if (Math.abs(implied - last.balance) > 0.02) {
    return 'Balance chain is off: rows imply ' + implied +
           ' but the statement closes at ' + last.balance +
           ' (difference ' + round2(implied - last.balance) + ').';
  }
  return null;
}


function runHashSet(runs) {
  var set = {};
  if (!runs) return set;
  var last = runs.getLastRow();
  if (last < 2) return set;
  var v = runs.getRange(2, 4, last - 1, 6).getValues();   // checksum .. status
  v.forEach(function (r) {
    var sum = String(r[0] || '').trim();
    var status = String(r[5] || '');
    if (sum && status.indexOf('OK') === 0) set[sum] = true;   // failures may retry
  });
  return set;
}


function moveTo(file, parent, subName) {
  var it = parent.getFoldersByName(subName);
  var dest = it.hasNext() ? it.next() : parent.createFolder(subName);
  dest.addFile(file);
  parent.removeFile(file);
}


function setUpSheets() {
  var ss = SpreadsheetApp.openById(CFG.SHEET_ID);

  if (!getTab(ss, CFG.TAB_RUNS)) {
    var r = ss.insertSheet(CFG.TAB_RUNS);
    r.appendRow(['When','File','File ID','Checksum','Account','Parsed','Added','Skipped','Status']);
    r.setFrozenRows(1);
  }
  if (!getTab(ss, CFG.TAB_ISSUES)) {
    var i = ss.insertSheet(CFG.TAB_ISSUES);
    i.appendRow(['When','File','Date','Description','Amount','Note']);
    i.setFrozenRows(1);
  }
  var tx = getTab(ss, CFG.TAB_TX);
  if (tx && tx.getLastRow() === 0) {
    tx.appendRow(CFG.COLS);
    tx.setFrozenRows(1);
  }
}


/** Parse one file and log what would happen. Writes nothing. */
function testOneFile() {
  var inbox = DriveApp.getFolderById(CFG.INBOX_ID);
  var files = inbox.getFiles();
  var file = null;

  while (files.hasNext()) {
    var f = files.next();
    if (isRowFile(f) || f.getMimeType() === MimeType.PDF) { file = f; break; }
  }
  if (!file) { Logger.log('Inbox has no statement files.'); return; }

  var rows = null, text, acct, recs, period;

  if (isRowFile(file)) {
    rows = fileToRows(file);
    text = rowsToText(rows);
    Logger.log('File: ' + file.getName() + '  (spreadsheet, ' + rows.length + ' rows)');
  } else {
    text = pdfToText(file.getId());
    Logger.log('File: ' + file.getName() + '  (PDF)');
  }

  acct = detectAccount(text);
  Logger.log('Account: ' + (acct ? acct.name : 'NOT RECOGNISED'));
  if (!acct) { Logger.log(text.substring(0, 1500)); return; }

  period = findPeriod(text);
  Logger.log('Period: ' + iso(period.start) + ' to ' + iso(period.end));

  recs = rows ? this[acct.rowParser](rows, period) : this[acct.parser](text, period);

  Logger.log('Parsed ' + recs.length + ' transactions. First 15:');
  recs.slice(0, 15).forEach(function (r) {
    Logger.log('  ' + iso(r.date) + '  ' + r.amount.toFixed(2) +
               '  ' + r.desc.substring(0, 60) + (r.warn ? '   [' + r.warn + ']' : ''));
  });

  var into = 0, outof = 0;
  recs.forEach(function (r) { if (r.amount > 0) into += r.amount; else outof += r.amount; });
  Logger.log('In ' + round2(into).toFixed(2) + ', out ' + round2(outof).toFixed(2));

  var note = checkChain(recs);
  Logger.log(note ? 'CHAIN: ' + note : 'Balance chain agrees with the statement.');
}


/** Friday 6pm weekly run. */
function installTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'ingestInbox') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('ingestInbox')
    .timeBased().onWeekDay(ScriptApp.WeekDay.FRIDAY).atHour(18).create();
  return 'Weekly trigger installed: Fridays around 6pm.';
}


function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Finance')
    .addItem('Ingest new statements', 'ingestInbox')
    .addItem('Re-label unlabelled rows', 'relabelAll')
    .addSeparator()
    .addItem('Test parse one file (no writing)', 'testOneFile')
    .addItem('List tab names', 'listTabs')
    .addItem('Reset and start over', 'resetIngest')
    .addItem('Install weekly trigger', 'installTrigger')
    .addToUi();
}
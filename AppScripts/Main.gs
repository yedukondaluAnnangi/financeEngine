/**
 * Main.gs — what you actually run.
 *
 * Day to day nothing: upload statements to the Inbox and Pipeline.gs does the
 * rest (see installTriggers). From the editor's function dropdown:
 *
 *   installTriggers()    once: 5-minute Inbox poll + Friday-morning reminder email
 *   processInboxNow()    run the pipeline on the Inbox immediately
 *   dryRunInbox()        check the Inbox and email the result, writing nothing
 *   sendUploadReminder() send the reminder email now
 *   relabelEverything()  re-apply the Payees tab to every row (Ledger.gs)
 *   testOneFile()        parse one Inbox file and log it, writing nothing
 *   listTabs()           show every tab name, brackets included, to spot stray spaces
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


/** Kept for muscle memory: same as processInboxNow(). */
function ingestInbox() {
  return processInboxNow();
}


/** Rows from a spreadsheet or CSV -> { acct, recs }. The file name takes part in detection. */
function parseRows(rows, fileName) {
  if (!rows || !rows.length) throw new Error('The spreadsheet came back empty.');
  var text = fileName + '\n' + rowsToText(rows);
  var acct = detectAccount(text, fileName);
  if (!acct) throw new Error('Could not tell which account this is. Add a fingerprint to CFG.ACCOUNTS.');
  if (!acct.rowParser) {
    throw new Error(acct.name + ' has no spreadsheet parser — supply the PDF, or add a rowParser.');
  }
  // Some banks (Wealthsimple) put several accounts in one download and only
  // the file name says which; a resolver turns the generic match into the
  // specific account.
  if (acct.resolver) acct = globalThis[acct.resolver](fileName, acct);
  return { acct: acct, recs: globalThis[acct.rowParser](rows, findPeriod(text)) };
}

/** PDF -> { acct, recs }. */
function parsePdf(fileId) {
  var text = pdfToText(fileId);
  var acct = detectAccount(text);
  if (!acct) throw new Error('Could not tell which account this is. Add a fingerprint to CFG.ACCOUNTS.');
  if (!acct.parser) {
    throw new Error(acct.name + ' has no PDF parser — download it as Excel or Delimited instead.');
  }
  return { acct: acct, recs: globalThis[acct.parser](text, findPeriod(text)) };
}


/**
 * Closing balance implied by the parsed rows vs the last stated balance.
 * Checked per currency: a Wealthsimple account keeps a separate CAD and USD
 * balance in the same file.
 */
function checkChain(recs) {
  var groups = {}, order = [];
  recs.forEach(function (r) {
    if (r.balance === null || r.balance === undefined) return;
    var c = r.currency || '';
    if (!groups[c]) { groups[c] = []; order.push(c); }
    groups[c].push(r);
  });

  // Every step, not just first-to-last: an edited or misread row in the
  // middle cancels out of the end-to-end sum but not out of its own step.
  var notes = [];
  order.forEach(function (c) {
    var withBal = groups[c];
    for (var i = 1; i < withBal.length; i++) {
      var prev = withBal[i - 1], cur = withBal[i];
      var implied = round2(prev.balance + cur.amount);
      if (Math.abs(implied - cur.balance) > 0.02) {
        notes.push('Balance chain is off' + (c ? ' (' + c + ')' : '') + ' at ' + iso(cur.date) + ' "' +
                   String(cur.desc).substring(0, 40) + '": ' + prev.balance + ' ' + (cur.amount < 0 ? '− ' : '+ ') +
                   Math.abs(cur.amount) + ' should be ' + implied + ', statement says ' + cur.balance + '.');
        break;
      }
    }
  });
  return notes.length ? notes.join(' ') : null;
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
  if (!getTab(ss, CFG.TAB_BALANCES)) {
    var b = ss.insertSheet(CFG.TAB_BALANCES);
    b.appendRow(['When','Account key','Account','Date','Closing balance','File']);
    b.setFrozenRows(1);
  }
  var tx = getTab(ss, CFG.TAB_TX);
  if (tx && tx.getLastRow() === 0) {
    tx.appendRow(CFG.COLS);
    tx.setFrozenRows(1);
  }
  if (tx) idColumnAsText(tx);
}


/** Parse the first statement in the inbox and log what would happen. Writes nothing. */
function testOneFile() {
  var inbox = DriveApp.getFolderById(CFG.INBOX_ID);
  var files = inbox.getFiles();
  var file = null;

  while (files.hasNext()) {
    var f = files.next();
    if (isZipFile(f) || isRowFile(f) || f.getMimeType() === MimeType.PDF) { file = f; break; }
  }
  if (!file) { Logger.log('Inbox has no statement files.'); return; }

  if (isZipFile(file)) {
    var entries = zipEntries(file);
    Logger.log('Zip: ' + file.getName() + '  (' + entries.length + ' CSV files)');
    entries.forEach(function (blob) {
      try {
        logParsed(blob.getName(), parseRows(csvBlobToRows(blob), blob.getName()), 5);
      } catch (e) {
        Logger.log('✗ ' + blob.getName() + ' — ' + e.message);
      }
    });
    return;
  }

  var got;
  if (isRowFile(file)) {
    Logger.log('File: ' + file.getName() + '  (spreadsheet)');
    got = parseRows(fileToRows(file), file.getName());
  } else {
    Logger.log('File: ' + file.getName() + '  (PDF)');
    got = parsePdf(file.getId());
  }
  logParsed(file.getName(), got, 15);
}

function logParsed(label, got, show) {
  var recs = got.recs;
  Logger.log('— ' + label + '\n  Account: ' + got.acct.name + ', ' + recs.length + ' transactions');
  recs.slice(0, show).forEach(function (r) {
    Logger.log('  ' + iso(r.date) + '  ' + r.amount.toFixed(2) + ' ' + (r.currency || got.acct.currency) +
               '  ' + r.desc.substring(0, 60) + (r.warn ? '   [' + r.warn + ']' : ''));
  });
  var into = 0, outof = 0;
  recs.forEach(function (r) { if (r.amount > 0) into += r.amount; else outof += r.amount; });
  Logger.log('  In ' + round2(into).toFixed(2) + ', out ' + round2(outof).toFixed(2));
  var note = checkChain(recs);
  Logger.log(note ? '  CHAIN: ' + note : '  Balance chain agrees with the statement.');
}


/**
 * Install the two triggers, replacing any this script set before (including
 * the old Friday-evening ingestInbox one). Run once; re-running is harmless.
 */
function installTriggers() {
  var mine = ['ingestInbox', 'pollInbox', 'sendUploadReminder'];
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (mine.indexOf(t.getHandlerFunction()) !== -1) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('pollInbox').timeBased().everyMinutes(CFG.POLL_MINUTES).create();
  ScriptApp.newTrigger('sendUploadReminder').timeBased()
    .onWeekDay(ScriptApp.WeekDay[CFG.REMINDER.weekday]).atHour(CFG.REMINDER.hour).create();
  setUpSheets();
  return 'Installed: Inbox poll every ' + CFG.POLL_MINUTES + ' min, reminder ' + CFG.REMINDER.weekday + ' ~' + CFG.REMINDER.hour + ':00.';
}


function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Finance')
    .addItem('Process the Inbox now', 'processInboxNow')
    .addItem('Check the Inbox (dry run, email only)', 'dryRunInbox')
    .addItem('Re-label unlabelled rows', 'relabelAll')
    .addItem('Re-label everything from Payees tab', 'relabelEverything')
    .addSeparator()
    .addItem('Send the upload reminder now', 'sendUploadReminder')
    .addItem('Test parse one file (no writing)', 'testOneFile')
    .addItem('List tab names', 'listTabs')
    .addItem('Install triggers', 'installTriggers')
    .addToUi();
}

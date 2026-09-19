/**
 * Pipeline.gs — upload to the Inbox, and the rest happens on its own.
 *
 *   Inbox ──poll──► Outbox › Staging › <batch> ──check every file──►
 *       all pass → one write (Transactions, _Runs, _Balances) → Outbox › Processed + summary email
 *       any fail → nothing written → Outbox › Failed › <batch> + failure email
 *
 * All or nothing, per upload: one bad file holds back every file uploaded
 * with it, so the sheet never holds half a batch.
 *
 * Quiet by design: while the Inbox is empty, or a file landed less than
 * CFG.SETTLE_MINUTES ago, a poll does nothing and sends nothing.
 *
 * Errors on Google's side (a Drive conversion timing out, a quota blip) are
 * not the file's fault: the batch stays in Staging and is retried on the next
 * poll, up to CFG.MAX_RETRIES times, before it is failed.
 */


/** Time-driven trigger, every CFG.POLL_MINUTES. */
function pollInbox() {
  if (CFG.DRY_RUN) return;                       // dry runs are manual: dryRunInbox()
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;               // a previous poll is still working
  try {
    var staging = subfolder(DriveApp.getFolderById(CFG.OUTBOX_ID), CFG.STAGING_NAME);

    // A batch left in Staging by a transient error goes first.
    var waiting = staging.getFolders();
    if (waiting.hasNext()) { runBatch(waiting.next()); return; }

    var inbox = DriveApp.getFolderById(CFG.INBOX_ID);
    var files = listFiles(inbox);
    if (!files.length) return;

    var newest = Math.max.apply(null, files.map(function (f) {
      return Math.max(f.getDateCreated().getTime(), f.getLastUpdated().getTime());
    }));
    if (Date.now() - newest < CFG.SETTLE_MINUTES * 60000) return;   // still uploading

    runBatch(claimBatch(inbox, staging, files));
  } finally {
    lock.releaseLock();
  }
}

/** Run the pipeline on the Inbox right now, without waiting for it to settle. */
function processInboxNow() {
  if (CFG.DRY_RUN) return dryRunInbox();
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var inbox = DriveApp.getFolderById(CFG.INBOX_ID);
    var files = listFiles(inbox);
    if (!files.length) return 'Inbox is empty.';
    var staging = subfolder(DriveApp.getFolderById(CFG.OUTBOX_ID), CFG.STAGING_NAME);
    return runBatch(claimBatch(inbox, staging, files));
  } finally {
    lock.releaseLock();
  }
}

/** Check the Inbox and email the result. Writes nothing, moves nothing. */
function dryRunInbox() {
  var files = listFiles(DriveApp.getFolderById(CFG.INBOX_ID));
  if (!files.length) return 'Inbox is empty.';
  var result = checkBatch(files, 'dry-run');
  result.dryRun = true;
  sendBatchEmail(result);
  Logger.log(batchText(result));
  return batchText(result);
}


function claimBatch(inbox, staging, files) {
  var batch = staging.createFolder(Utilities.formatDate(new Date(), CFG_TZ(), 'yyyy-MM-dd HHmm'));
  files.forEach(function (f) { f.moveTo(batch); });
  return batch;
}

function runBatch(batchFolder) {
  var outbox = DriveApp.getFolderById(CFG.OUTBOX_ID);
  var props = PropertiesService.getScriptProperties();
  var retryKey = 'retry_' + batchFolder.getId();
  var files = listFiles(batchFolder);
  var result;

  try {
    result = checkBatch(files, batchFolder.getName(), outbox);
  } catch (err) {
    var tries = Number(props.getProperty(retryKey) || 0) + 1;
    if (isTransient(err) && tries < CFG.MAX_RETRIES) {
      props.setProperty(retryKey, String(tries));
      return 'Transient error, will retry: ' + err.message;
    }
    // Anything else (or Google failing repeatedly) fails the batch with an
    // email, rather than leaving it in Staging to throw on every poll.
    result = { batch: batchFolder.getName(), items: [], warnings: [],
               errors: [(isTransient(err) ? 'Google kept failing after ' + tries + ' tries: ' : 'The check itself crashed: ') + err.message] };
  }
  props.deleteProperty(retryKey);

  if (!result.errors.length && !result.items.some(function (it) { return it.check && it.check.errors.length; })) {
    try {
      commitBatch(result);
    } catch (err) {
      result.errors.push('Writing to the sheet failed and was rolled back: ' + err.message);
    }
  }
  result.ok = !result.errors.length && !result.items.some(function (it) { return it.check && it.check.errors.length; });

  logRuns(result);
  if (result.ok) {
    var done = subfolder(outbox, CFG.DONE_NAME);
    listFiles(batchFolder).forEach(function (f) { f.moveTo(done); });
    batchFolder.setTrashed(true);                 // the empty batch folder this script created
  } else {
    batchFolder.moveTo(subfolder(outbox, CFG.FAIL_NAME));
  }
  sendBatchEmail(result);
  Logger.log(batchText(result));
  return batchText(result);
}


/**
 * Parse and check every file in the batch. Writes nothing.
 * Returns { batch, items[], errors[], warnings[] }; each item carries its
 * parsed records, account and check result.
 */
function checkBatch(files, batchName, outbox) {
  var ss = SpreadsheetApp.openById(CFG.SHEET_ID);
  setUpSheets();
  var tx = getTab(ss, CFG.TAB_TX);
  var last = tx.getLastRow();
  var snap = sheetSnapshot(last > 1 ? tx.getRange(2, 1, last - 1, CFG.COLS.length).getValues() : []);
  var balances = readBalances(ss);
  var doneHash = runHashSet(getTab(ss, CFG.TAB_RUNS));
  var todayIso = Utilities.formatDate(new Date(), CFG_TZ(), 'yyyy-MM-dd');

  var result = { batch: batchName, items: [], errors: [], warnings: [] };

  files.forEach(function (file) {
    var name = file.getName();
    if (CFG.IGNORE.some(function (re) { return re.test(name); })) {
      result.items.push({ label: name, fid: file.getId(), ignored: true });
      if (outbox) file.moveTo(subfolder(outbox, CFG.IGNORED_NAME));
      return;
    }

    var units;                                    // a zip is several files
    if (isZipFile(file)) {
      units = zipEntries(file).map(function (blob) {
        return { label: name + ' › ' + blob.getName(), fid: file.getId(), ext: 'csv',
                 checksum: 'c:' + digest(blob.getBytes()),
                 load: function () { return parseRows(csvBlobToRows(blob), blob.getName()); } };
      });
      if (!units.length) result.errors.push(name + ': the zip has no CSV files.');
    } else if (isRowFile(file) || file.getMimeType() === MimeType.PDF) {
      units = [{ label: name, fid: file.getId(), ext: fileExt(file),
                 checksum: 'c:' + digest(file.getBlob().getBytes()),
                 load: function () { return isRowFile(file) ? parseRows(fileToRows(file), name) : parsePdf(file.getId()); } }];
    } else {
      result.errors.push(name + ': not a statement file (PDF, CSV, XLS or zip).');
      units = [];
    }

    units.forEach(function (u) {
      if (doneHash[u.checksum]) { u.duplicate = true; result.items.push(u); return; }
      try {
        var got = u.load();
        u.acct = got.acct; u.recs = got.recs;
      } catch (err) {
        if (isTransient(err)) throw err;          // Google's side: retry the batch later
        u.check = { errors: ['C1 parse: ' + err.message], warnings: [], notes: [], keep: [] };
        result.items.push(u);
        return;
      }
      u.check = checkFile(u, snap, balances, todayIso);
      if (!u.check.errors.length) {
        extendSnapshot(snap, u, u.check);
        var close = closingBalance(u.recs);
        if (close && (!balances[u.acct.key] || close.date >= balances[u.acct.key].date)) balances[u.acct.key] = close;
      }
      result.items.push(u);
    });
  });

  return result;
}


/**
 * Write the whole batch at once. If anything after the first write throws,
 * the rows this call appended are deleted again before the error propagates.
 */
function commitBatch(result) {
  var ss = SpreadsheetApp.openById(CFG.SHEET_ID);
  var tx = getTab(ss, CFG.TAB_TX);
  var payees = readPayees(ss);
  var existing = existingIdSet(tx);
  var rows = [], issues = [], balRows = [];

  result.items.forEach(function (u) {
    if (!u.recs) return;
    var kept = u.recs.filter(function (r, i) { return u.check.keep[i]; });
    var built = buildRows(kept, u.acct, payees, existing, issues, u.label);
    u.added = built.rows.length;
    u.skipped = u.recs.length - built.rows.length;
    u.unlabelled = built.rows.filter(function (r) { return r[5] === 'Needs labelling'; }).length;
    rows = rows.concat(built.rows);
    var close = closingBalance(u.recs);
    if (close) balRows.push([new Date(), u.acct.key, u.acct.name, close.date, close.balance, u.label]);
  });
  rows.sort(function (a, b) { return a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0; });

  var start = tx.getLastRow() + 1, written = false;
  try {
    if (rows.length) { tx.getRange(start, 1, rows.length, CFG.COLS.length).setValues(rows); written = true; }
    if (balRows.length) appendRows(getTab(ss, CFG.TAB_BALANCES), balRows);
    if (issues.length) appendRows(getTab(ss, CFG.TAB_ISSUES), issues);
    SpreadsheetApp.flush();
  } catch (err) {
    if (written) tx.deleteRows(start, rows.length);
    throw err;
  }
  result.added = rows.length;

  try {
    result.flagged = rows.length ? flagReversals(tx) : 0;
  } catch (err) {
    result.warnings.push('Reversal flagging failed (rows are written): ' + err.message);
  }
}


function logRuns(result) {
  if (result.dryRun) return;
  var runs = getTab(SpreadsheetApp.openById(CFG.SHEET_ID), CFG.TAB_RUNS);
  var now = new Date(), status;
  var out = result.items.map(function (u) {
    if (u.ignored) status = 'IGNORED';
    else if (u.duplicate) status = 'OK (already ingested)';
    else if (u.check && u.check.errors.length) status = 'FAILED: ' + u.check.errors.join(' | ');
    else if (!result.ok) status = 'HELD: another file in the batch failed';
    else status = 'OK';
    var ok = status.indexOf('OK') === 0 && !u.duplicate;
    return [now, u.label, u.fid, ok ? u.checksum : (u.duplicate ? u.checksum : ''), u.acct ? u.acct.name : '',
            u.recs ? u.recs.length : 0, ok ? (u.added || 0) : 0, ok ? (u.skipped || 0) : 0, status];
  });
  if (!out.length && result.errors.length) out.push([now, result.batch, '', '', '', 0, 0, 0, 'FAILED: ' + result.errors.join(' | ')]);
  if (out.length) appendRows(runs, out);
}


/* ---- small helpers ------------------------------------------------------ */

function listFiles(folder) {
  var out = [], it = folder.getFiles();
  while (it.hasNext()) out.push(it.next());
  return out;
}

function subfolder(parent, name) {
  var it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

function appendRows(sh, rows) {
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
}

function fileExt(file) {
  var m = file.getName().match(/\.([a-z0-9]+)$/i);
  if (m) return m[1].toLowerCase();
  return file.getMimeType() === MimeType.GOOGLE_SHEETS ? 'xlsx' : '';
}

function digest(bytes) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, bytes).map(function (b) {
    return ('0' + (b & 0xFF).toString(16)).slice(-2);
  }).join('').substring(0, 16);
}

function CFG_TZ() { return Session.getScriptTimeZone() || 'America/Toronto'; }

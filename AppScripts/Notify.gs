/**
 * Notify.gs — the only two emails this script sends.
 *
 *   sendBatchEmail      after an upload was processed: a short summary when it
 *                       went in, the full list of problems when it did not.
 *   sendUploadReminder  Friday morning: per account, the login link and the
 *                       exact dates still missing from the sheet.
 *
 * Nothing is ever sent for an empty Inbox. Mail goes to the account the
 * script runs as (your Gmail).
 */

/**
 * Where mail goes: the account that owns the Inbox folder, i.e. you.
 * Session.getEffectiveUser().getEmail() returns '' unless the manifest
 * carries the userinfo.email scope, and MailApp then refuses to send — so
 * the folder owner (readable with the Drive scope we already hold) comes
 * first.
 */
function notifyAddress() {
  var candidates = [
    function () { return DriveApp.getFolderById(CFG.INBOX_ID).getOwner().getEmail(); },
    function () { return DriveApp.getFileById(CFG.SHEET_ID).getOwner().getEmail(); },
    function () { return Session.getEffectiveUser().getEmail(); }
  ];
  for (var i = 0; i < candidates.length; i++) {
    try { var a = candidates[i](); if (a) return a; } catch (e) {}
  }
  throw new Error('Could not work out which address to email.');
}

function sheetUrl()  { return 'https://docs.google.com/spreadsheets/d/' + CFG.SHEET_ID + '/edit'; }
function inboxUrl()  { return 'https://drive.google.com/drive/folders/' + CFG.INBOX_ID; }
function outboxUrl() { return 'https://drive.google.com/drive/folders/' + CFG.OUTBOX_ID; }

function esc(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function button(url, label) {
  return '<a href="' + esc(url) + '" style="display:inline-block;padding:6px 12px;background:#1a73e8;color:#fff;' +
         'border-radius:4px;text-decoration:none;font-size:13px">' + esc(label) + '</a>';
}


/* ---- batch result ------------------------------------------------------- */

function itemStatus(u, result) {
  if (u.ignored) return 'Ignored (not ingested by design)';
  if (u.duplicate) return result.ok || result.dryRun ? 'Already ingested — skipped' : 'Already ingested — held with the batch';
  if (u.check && u.check.errors.length) return 'FAILED';
  if (result.dryRun) return 'Passed (dry run)';
  if (!result.ok) return 'Held back — another file failed';
  return 'Added ' + (u.added || 0) + (u.skipped ? ', ' + u.skipped + ' already there' : '');
}

/** Plain-text version, also used for the log. */
function batchText(result) {
  var lines = [];
  result.items.forEach(function (u) {
    lines.push((u.check && u.check.errors.length ? '✗ ' : '✓ ') + u.label + (u.acct ? ' — ' + u.acct.name : '') +
               ': ' + itemStatus(u, result));
    if (u.check) u.check.errors.concat(u.check.warnings, u.check.notes).forEach(function (m) { lines.push('    ' + m); });
  });
  result.errors.forEach(function (e) { lines.push('✗ ' + e); });
  result.warnings.forEach(function (w) { lines.push('! ' + w); });
  return lines.join('\n');
}

function sendBatchEmail(result) {
  var failed = !result.dryRun && !result.ok;
  var files = result.items.filter(function (u) { return !u.ignored; }).length;
  var problems = result.errors.length + result.items.filter(function (u) { return u.check && u.check.errors.length; }).length;
  var unlabelled = result.items.reduce(function (n, u) { return n + (u.unlabelled || 0); }, 0);

  var subject = result.dryRun
    ? '🧪 Finance Engine (dry run): ' + (problems ? problems + ' problem(s)' : 'all ' + files + ' file(s) pass')
    : failed
      ? '❌ Finance Engine: upload failed — nothing written (' + problems + ' problem' + (problems === 1 ? '' : 's') + ')'
      : '✅ Finance Engine: ' + files + ' file(s) in, ' + (result.added || 0) + ' row(s) added';

  var h = [];
  h.push('<div style="font-family:Arial,sans-serif;font-size:14px;color:#202124">');
  if (failed) {
    h.push('<p><b>Nothing from this upload was written.</b> The files are in Outbox › Failed › ' + esc(result.batch) +
           '. Fix or replace the file(s) marked FAILED, then upload the whole set to the Inbox again.</p>');
  } else if (result.dryRun) {
    h.push('<p>Dry run: files were checked where they are. Nothing was written or moved.</p>');
  }

  h.push('<table cellpadding="6" style="border-collapse:collapse;font-size:13px">' +
         '<tr style="background:#f1f3f4"><th align="left">File</th><th align="left">Account</th>' +
         '<th align="right">Rows</th><th align="left">Result</th></tr>');
  result.items.forEach(function (u) {
    var bad = u.check && u.check.errors.length;
    h.push('<tr style="border-top:1px solid #e0e0e0' + (bad ? ';background:#fce8e6' : '') + '">' +
           '<td>' + esc(u.label) + '</td><td>' + esc(u.acct ? u.acct.name : '—') + '</td>' +
           '<td align="right">' + (u.recs ? u.recs.length : '') + '</td><td>' + esc(itemStatus(u, result)) + '</td></tr>');
    if (u.check) {
      u.check.errors.forEach(function (m) { h.push('<tr><td colspan="4" style="color:#c5221f;padding-left:18px">✗ ' + esc(m) + '</td></tr>'); });
      u.check.warnings.forEach(function (m) { h.push('<tr><td colspan="4" style="color:#b06000;padding-left:18px">! ' + esc(m) + '</td></tr>'); });
      u.check.notes.forEach(function (m) { h.push('<tr><td colspan="4" style="color:#5f6368;padding-left:18px">· ' + esc(m) + '</td></tr>'); });
    }
  });
  h.push('</table>');

  result.errors.forEach(function (e) { h.push('<p style="color:#c5221f">✗ ' + esc(e) + '</p>'); });
  result.warnings.forEach(function (w) { h.push('<p style="color:#b06000">! ' + esc(w) + '</p>'); });
  if (!failed && !result.dryRun) {
    if (unlabelled) h.push('<p>' + unlabelled + ' new row(s) say <b>Needs labelling</b> — add a Payees pattern, then run relabelEverything.</p>');
    if (result.flagged) h.push('<p>' + result.flagged + ' reversal leg(s) flagged.</p>');
  }
  h.push('<p>' + button(sheetUrl(), 'Open the sheet') + ' ' + button(outboxUrl(), 'Open Outbox') + '</p></div>');

  MailApp.sendEmail({ to: notifyAddress(), subject: subject, htmlBody: h.join('\n'), body: batchText(result) });
}


/* ---- weekly reminder ---------------------------------------------------- */

/** Time-driven trigger, CFG.REMINDER weekday and hour. */
function sendUploadReminder() {
  var ss = SpreadsheetApp.openById(CFG.SHEET_ID);
  var tx = getTab(ss, CFG.TAB_TX);
  var last = tx.getLastRow();
  var snap = sheetSnapshot(last > 1 ? tx.getRange(2, 1, last - 1, CFG.COLS.length).getValues() : []);
  var today = Utilities.formatDate(new Date(), CFG_TZ(), 'yyyy-MM-dd');
  var yesterday = addDays(today, -1);

  var rows = [], due = 0;
  Object.keys(CFG.BANKS).forEach(function (key) {
    var bank = CFG.BANKS[key];
    var acct = CFG.ACCOUNTS.filter(function (a) { return a.key === key; })[0];
    if (!acct) return;
    var lastDate = snap.lastDate[acct.name];
    var need, upToDate = lastDate && lastDate >= yesterday;
    if (upToDate) {
      need = 'Up to date (last: ' + lastDate + ')';
    } else if (bank.cadence === 'statement') {
      need = 'Latest billed statement, if one closed after ' + (lastDate || 'the start');
      due++;
    } else {
      need = '<b>' + (lastDate ? addDays(lastDate, 1) : 'as far back as you want') + '</b> to <b>' + yesterday + '</b>';
      due++;
    }
    rows.push('<tr style="border-top:1px solid #e0e0e0' + (upToDate ? ';color:#80868b' : '') + '">' +
              '<td><b>' + esc(acct.name) + '</b><br><span style="font-size:12px;color:#5f6368">' + esc(bank.howTo) + '</span></td>' +
              '<td>' + need + '</td><td>' + (upToDate ? '' : button(bank.login, 'Log in')) + '</td></tr>');
  });

  var html = '<div style="font-family:Arial,sans-serif;font-size:14px;color:#202124">' +
    '<p>Download these, then drop them all into the Inbox in one go. The script checks and ingests them within ~5 minutes and emails you the result.</p>' +
    '<p>' + button(inboxUrl(), 'Open the Inbox folder') + '</p>' +
    '<table cellpadding="8" style="border-collapse:collapse;font-size:13px">' +
    '<tr style="background:#f1f3f4"><th align="left">Account</th><th align="left">Dates to download</th><th></th></tr>' +
    rows.join('\n') + '</table>' +
    '<p style="font-size:12px;color:#5f6368">Dates come from the last transaction already in the sheet for each account. ' +
    'Overlapping a few days is fine — rows already there are skipped.</p></div>';

  MailApp.sendEmail({
    to: notifyAddress(),
    subject: '📥 Upload statements — ' + (due ? due + ' account(s) need data' : 'all up to date'),
    htmlBody: html
  });
  return due + ' account(s) need data.';
}

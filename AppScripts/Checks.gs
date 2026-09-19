/**
 * Checks.gs — everything a batch must pass before a single row is written.
 *
 * Pure functions over plain data (parsed records, a snapshot of the sheet,
 * the last recorded balances), so they can be tested outside Apps Script.
 *
 *   C1  account recognised                      (thrown by parseRows/parsePdf)
 *   C2  file type allowed for that account      CFG.BANKS[key].accepts
 *   C3  every row has a real date and amount
 *   C4  no dates in the future
 *   C5  the statement's own balance chain agrees
 *   C6  opening balance continues the last recorded closing balance
 *   C7  no clash with rows already in the sheet
 *   W1  gap since the last data for the account   (warning only)
 *
 * Errors block the whole batch. Warnings are reported and let it through.
 */


/** Transactions tab -> what the checks need to know about existing rows. */
function sheetSnapshot(values) {
  var snap = { ids: {}, byAcct: {}, lastDate: {} };
  values.forEach(function (r) {
    var id = normId(r[0]);
    if (!id) return;
    var d = isoCell(r[1]);
    var acct = String(r[3] || '');
    snap.ids[id] = true;
    (snap.byAcct[acct] = snap.byAcct[acct] || []).push({ id: id, date: d, amount: round2(Number(r[6])) });
    if (d && (!snap.lastDate[acct] || d > snap.lastDate[acct])) snap.lastDate[acct] = d;
  });
  return snap;
}

/** A date cell (Date object or 'yyyy-mm-dd' text) as 'yyyy-mm-dd'. */
function isoCell(v) {
  if (v instanceof Date) return iso(new Date(Date.UTC(v.getFullYear(), v.getMonth(), v.getDate())));
  return String(v || '').substring(0, 10);
}

function addDays(isoDate, n) {
  var d = new Date(isoDate + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
}

/** Transaction IDs exactly as buildRows will assign them. */
function recIds(recs, acct) {
  var seen = {};
  return recs.map(function (r) {
    var isoDate = iso(r.date);
    var key = [isoDate, r.amount.toFixed(2), normDesc(r.desc)].join('|');
    var occ = (seen[key] === undefined) ? 0 : seen[key] + 1;
    seen[key] = occ;
    return makeTxId(acct.key, isoDate, r.amount, r.desc, occ);
  });
}

/** Records carrying a balance, oldest first (CIBC-style exports run newest first). */
function balanceRecs(recs) {
  var withBal = recs.filter(function (r) { return r.balance !== null && r.balance !== undefined; });
  if (withBal.length > 1 && withBal[0].date > withBal[withBal.length - 1].date) withBal = withBal.slice().reverse();
  return withBal;
}


/**
 * Run C2–C7 and W1 on one parsed file.
 *   item      { label, ext, acct, recs }
 *   snap      sheetSnapshot(), already extended with earlier files in the batch
 *   balances  { accountKey: { date, balance } } — last recorded closing balances
 *   todayIso  'yyyy-mm-dd'
 * Returns { errors, warnings, notes, keep } where keep[i] says whether recs[i]
 * should be written (false = same money already in the sheet under other text).
 */
function checkFile(item, snap, balances, todayIso) {
  var out = { errors: [], warnings: [], notes: [], keep: item.recs.map(function () { return true; }) };
  var acct = item.acct, recs = item.recs;
  var bank = CFG.BANKS[acct.key] || {};

  // C2 — format
  if (bank.accepts && bank.accepts.indexOf(item.ext) === -1) {
    out.errors.push('C2 format: ' + acct.name + ' accepts ' + bank.accepts.join('/') + ', not .' + item.ext +
                    '. ' + (bank.howTo || ''));
  }

  // C3 — rows are real
  if (!recs.length) out.errors.push('C3 rows: parsed zero transactions — the layout has probably changed.');
  var bad = recs.filter(function (r) {
    return !(r.date instanceof Date) || isNaN(r.date.getTime()) || typeof r.amount !== 'number' || !isFinite(r.amount) || !r.amount;
  });
  if (bad.length) out.errors.push('C3 rows: ' + bad.length + ' row(s) without a valid date or amount, e.g. "' +
                                  String(bad[0].desc || '').substring(0, 60) + '".');
  if (out.errors.length) return out;          // nothing below means anything without clean rows

  // C4 — future dates
  var tomorrow = addDays(todayIso, 1);
  var future = recs.filter(function (r) { return iso(r.date) > tomorrow; });
  if (future.length) out.errors.push('C4 dates: ' + future.length + ' row(s) dated in the future, e.g. ' +
                                     iso(future[0].date) + ' "' + future[0].desc.substring(0, 50) + '".');

  // C5 — the statement's own balance chain
  var withBal = balanceRecs(recs);
  var chain = checkChain(withBal);
  if (chain) out.errors.push('C5 balance: ' + chain);

  // C6 — continuity with the last recorded closing balance
  var last = balances[acct.key];
  if (withBal.length && last) {
    var first = withBal[0], firstIso = iso(first.date);
    var opening = round2(first.balance - first.amount);
    if (firstIso > last.date) {
      if (Math.abs(opening - last.balance) > 0.02) {
        var msg = 'opens at ' + opening + ' on ' + firstIso + ' but the last statement closed at ' +
                  last.balance + ' on ' + last.date + '.';
        if (firstIso <= addDays(last.date, 1)) out.errors.push('C6 continuity: ' + msg);
        else out.warnings.push('Balance: ' + msg + ' Transactions between those dates are missing.');
      }
    } else {
      // Overlap: the balance at the end of last.date must agree.
      var onDay = withBal.filter(function (r) { return iso(r.date) === last.date; });
      if (onDay.length && Math.abs(onDay[onDay.length - 1].balance - last.balance) > 0.02) {
        out.errors.push('C6 continuity: on ' + last.date + ' this file shows ' + onDay[onDay.length - 1].balance +
                        ' but the sheet recorded ' + last.balance + '.');
      }
    }
  } else if (withBal.length && !last) {
    out.notes.push('No earlier balance on record for ' + acct.name + ' — continuity starts from this file.');
  }

  // C7 — clash with what is already in the sheet, by date + amount so it
  // does not depend on how a description was worded.
  var dates = recs.map(function (r) { return iso(r.date); }).sort();
  var from = dates[0], to = dates[dates.length - 1];
  var existing = (snap.byAcct[acct.name] || []).filter(function (s) { return s.date >= from && s.date <= to; });
  var ids = recIds(recs, acct);

  function k(date, amount) { return date + '|' + round2(amount).toFixed(2); }
  var fileCount = {}, sheetCount = {}, idHits = {}, newIdx = {};
  recs.forEach(function (r, i) {
    var key = k(iso(r.date), r.amount);
    fileCount[key] = (fileCount[key] || 0) + 1;
    if (snap.ids[ids[i]]) idHits[key] = (idHits[key] || 0) + 1;
    else (newIdx[key] = newIdx[key] || []).push(i);
  });
  existing.forEach(function (s) { var key = k(s.date, s.amount); sheetCount[key] = (sheetCount[key] || 0) + 1; });

  // (a) Sheet rows this file does not contain. Edge days are left out: a
  // statement's first day and last three days can legitimately differ from a
  // download (posting lag, pending items).
  var innerFrom = addDays(from, 1), innerTo = addDays(to, -3);
  var missing = [];
  Object.keys(sheetCount).forEach(function (key) {
    var d = key.split('|')[0];
    if (d < innerFrom || d > innerTo) return;
    var short = sheetCount[key] - (fileCount[key] || 0);
    if (short > 0) missing.push(key.replace('|', ' ') + (short > 1 ? ' ×' + short : ''));
  });
  if (missing.length) {
    out.errors.push('C7 clash: the sheet has ' + missing.length + ' amount(s) in ' + from + '…' + to +
                    ' that this file does not: ' + missing.slice(0, 8).join(', ') + (missing.length > 8 ? ', …' : '') +
                    '. The file is partial, for another account, or the sheet holds wrong rows for these dates.');
  }

  // (b) Same money already in the sheet under different text (e.g. the PDF
  // worded it differently): skip those rows rather than write them twice.
  var dup = 0;
  Object.keys(newIdx).forEach(function (key) {
    var already = (sheetCount[key] || 0) - (idHits[key] || 0);
    for (var j = 0; j < Math.min(already, newIdx[key].length); j++) { out.keep[newIdx[key][j]] = false; dup++; }
  });
  if (dup) out.notes.push(dup + ' row(s) already in the sheet from another source (same date and amount) — not written again.');

  // W1 — gap since the last data for this account
  var lastDate = snap.lastDate[acct.name];
  if (lastDate && from > addDays(lastDate, 1)) {
    out.warnings.push('Gap: no ' + acct.name + ' data between ' + addDays(lastDate, 1) + ' and ' + addDays(from, -1) + '.');
  }

  return out;
}


/** Add a checked file's kept rows to the snapshot, so later files in the batch see them. */
function extendSnapshot(snap, item, check) {
  var ids = recIds(item.recs, item.acct);
  item.recs.forEach(function (r, i) {
    if (!check.keep[i] || snap.ids[ids[i]]) return;   // skipped, or already there
    var d = iso(r.date);
    snap.ids[ids[i]] = true;
    (snap.byAcct[item.acct.name] = snap.byAcct[item.acct.name] || []).push({ id: ids[i], date: d, amount: round2(r.amount) });
    if (!snap.lastDate[item.acct.name] || d > snap.lastDate[item.acct.name]) snap.lastDate[item.acct.name] = d;
  });
}


/** The closing balance a file establishes, if it carries balances. */
function closingBalance(recs) {
  var withBal = balanceRecs(recs);
  if (!withBal.length) return null;
  var last = withBal[withBal.length - 1];
  return { date: iso(last.date), balance: round2(last.balance) };
}


/** Errors worth retrying (Google's side), as opposed to problems with the file. */
function isTransient(err) {
  return /too many times|timed out|timeout|server error|try again later|rate limit|backend error|internal error|temporarily/i
    .test(String(err && err.message || err));
}

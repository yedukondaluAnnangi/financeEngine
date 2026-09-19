/**
 * Ledger.gs — turning parsed records into rows, without ever writing the
 * same transaction twice.
 *
 * ── Deduplication, three layers ────────────────────────────────────────────
 *
 * 1. File level.  Every ingest is logged to _Runs with the file's id and a
 *    checksum of its contents. Re-dropping the same file is a no-op. Replace
 *    the file with a corrected version and the checksum changes, so it runs.
 *
 * 2. Row level.  Each row gets a Transaction ID derived from
 *       account | date | amount | normalised description | occurrence
 *    Hash the lot, keep 12 hex characters. Re-importing a statement produces
 *    byte-identical IDs, so every row is recognised and skipped.
 *
 *    The description is normalised (uppercased, punctuation and spaces
 *    stripped) before hashing. That matters: if Drive's PDF converter spaces
 *    a line differently next month, the raw text changes but the ID does not.
 *
 *    The occurrence counter is the part most people get wrong. Two identical
 *    Tim Hortons purchases on the same day for the same amount are two real
 *    coffees, not a double-entry. They become occurrence 0 and 1, get
 *    different IDs, and both survive. Drop the counter and you silently lose
 *    the second coffee every time.
 *
 * 3. Overlap.  Statements overlap at the edges by design. Because IDs are
 *    deterministic rather than statement-scoped, an overlapping row lands on
 *    the ID it already has and is skipped. The one case to watch is a
 *    statement that cuts off midway through a day containing repeats — then
 *    the occurrence counter can shift. Rare, and it shows up in _Issues.
 */


function shortHash(s) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, s, Utilities.Charset.UTF_8);
  var hex = bytes.map(function (b) {
    return ('0' + (b & 0xFF).toString(16)).slice(-2);
  }).join('');
  return hex.substring(0, 12);
}

function normDesc(d) {
  return String(d).toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function makeTxId(accountKey, isoDate, amount, desc, occurrence) {
  return shortHash([accountKey, isoDate, amount.toFixed(2), normDesc(desc), occurrence].join('|'));
}


/* ---------------------------------------------------------------------------
   Payees tab -> labelling
   --------------------------------------------------------------------------- */

function readPayees(ss) {
  var sh = getTab(ss, CFG.TAB_PAYEES);
  if (!sh) return [];
  var last = sh.getLastRow();
  if (last < 2) return [];

  // Columns: Pattern | Payee | Default Category | Amount (optional)
  var width = Math.max(3, Math.min(4, sh.getLastColumn()));
  var vals = sh.getRange(2, 1, last - 1, width).getValues();
  var out = [];
  vals.forEach(function (r, i) {
    var pat = String(r[0] || '').trim();
    if (!pat) return;
    var re = null;
    try {
      re = new RegExp(pat, 'i');
    } catch (e) {
      // Not valid regex — fall back to a literal substring match so a typo
      // degrades instead of breaking the whole run.
      re = new RegExp(pat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      out.badRegexRow = i + 2;
    }
    out.push({
      re: re,
      payee: String(r[1] || '').trim(),
      category: String(r[2] || '').trim(),
      amount: parseAmountRule(r[3]),
      row: i + 2
    });
  });
  return out;
}

/**
 * Optional Amount column on the Payees tab, compared against the absolute
 * amount, in the row's own currency:
 *   39388.30        that amount, give or take 1
 *   38000-40000     anything in the range
 *   blank           any amount
 * Needed where the description does not name the recipient — a PhonePe bill
 * payment reads "UPI-PHONEPE-…" whether it paid the Kotak EMI or a recharge.
 */
function parseAmountRule(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return { lo: Math.abs(v) - 1, hi: Math.abs(v) + 1 };
  var s = String(v).replace(/[,\s₹$]/g, '');
  var m = s.match(/^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/);
  if (m) return { lo: Math.min(+m[1], +m[2]), hi: Math.max(+m[1], +m[2]) };
  if (/^\d+(\.\d+)?$/.test(s)) return { lo: +s - 1, hi: +s + 1 };
  return null;
}

/**
 * First matching Payees row wins, so order the tab specific-first (a row with
 * an amount above the same pattern without one). If nothing matches and the
 * line is a UPI payment to a person, the person's name from the narration
 * becomes the payee, with category "Unknown - check" until you name it.
 */
function labelFor(desc, payees, amount) {
  var abs = (typeof amount === 'number') ? Math.abs(amount) : null;
  for (var i = 0; i < payees.length; i++) {
    var p = payees[i];
    if (!p.re.test(desc)) continue;
    if (p.amount && (abs === null || abs < p.amount.lo || abs > p.amount.hi)) continue;
    return p;
  }
  var who = upiPayee(desc);
  return who ? { payee: who, category: 'Unknown - check', auto: true } : null;
}

/**
 * The recipient's name from an Indian bank UPI narration:
 *   UPI-VENNA VENKATA REDDY-reddyvenna8910@okicici-SBIN0020581-1534…-KULI
 *       -> "Venna Venkata Reddy"
 * Payments through an app's own merchant account (PhonePe bill pay, Paytm,
 * autopay mandates) name the app, not who was paid, so they return null and
 * need a Payees row, usually with an amount.
 */
function upiPayee(desc) {
  var m = String(desc || '').match(/^UPI-([^-@]+?)-[^-\s]*@/i);
  if (!m) return null;
  var name = m[1].replace(/\s+/g, ' ').trim();
  if (!name || /^(PHONEPE|PAYTM|GOOGLE ?PAY|GPAY|BHARATPE|CRED|AMAZON ?PAY|AUTOPAY|MOBIKWIK|RAZORPAY)\b/i.test(name)) return null;
  if (!/[A-Za-z]{2}/.test(name)) return null;
  return name.toLowerCase().replace(/\b[a-z]/g, function (c) { return c.toUpperCase(); });
}


/* ---------------------------------------------------------------------------
   Reading what is already in the sheet
   --------------------------------------------------------------------------- */

function existingIdSet(sh) {
  var last = sh.getLastRow();
  var set = {};
  if (last < 2) return set;
  var ids = sh.getRange(2, 1, last - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    var v = String(ids[i][0] || '').trim();
    if (v) set[v] = true;
  }
  return set;
}


/* ---------------------------------------------------------------------------
   Records -> rows
   --------------------------------------------------------------------------- */

function buildRows(records, account, payees, existing, issues, sourceName) {
  var seen = {};       // occurrence counter within this batch
  var rows = [], skipped = 0;

  records.forEach(function (r) {
    var isoDate = iso(r.date);
    var key = [isoDate, r.amount.toFixed(2), normDesc(r.desc)].join('|');
    var occ = (seen[key] === undefined) ? 0 : seen[key] + 1;
    seen[key] = occ;

    var id = makeTxId(account.key, isoDate, r.amount, r.desc, occ);
    if (existing[id]) { skipped++; return; }
    existing[id] = true;

    var hit = CFG.WRITE_LABELS ? labelFor(r.desc, payees, r.amount) : null;
    // A record may carry its own currency (Wealthsimple mixes CAD and USD
    // in one account); otherwise it is the account's.
    var currency = r.currency || account.currency;
    var rate = CFG.FX_TO_CAD[currency];
    var amountCad = (rate === undefined) ? '' : round2(r.amount * rate);
    if (rate === undefined) {
      issues.push([new Date(), sourceName, isoDate, r.desc.substring(0, 120), r.amount,
                   'No rate for ' + currency + ' in CFG.FX_TO_CAD']);
    }

    if (r.warn) {
      issues.push([new Date(), sourceName, isoDate, r.desc.substring(0, 120), r.amount, r.warn]);
    }

    var row = [];
    row[0]  = id;
    row[1]  = isoDate;
    row[2]  = ym(r.date);
    row[3]  = account.name;
    row[4]  = r.desc;                                   // raw, never rewritten
    row[5]  = hit ? hit.payee : (CFG.WRITE_LABELS ? 'Needs labelling' : '');
    row[6]  = round2(r.amount);
    row[7]  = currency;
    row[8]  = amountCad;
    row[9]  = hit ? hit.category : '';
    row[10] = '';                                       // Notion Task
    row[11] = r.warn ? 'Check' : (r.status || '');
    rows.push(row);
  });

  return { rows: rows, skipped: skipped };
}


/**
 * Flag equal-and-opposite pairs on the same account within a few days —
 * a cancelled transfer, a refunded purchase. They net to nothing but both
 * legs are real statement lines, so they stay in the ledger and get marked
 * rather than deleted.
 *
 * This is the thing that made the RBC rent look like it was paid twice.
 */
function flagReversals(sh) {
  var last = sh.getLastRow();
  if (last < 3) return 0;

  var n = last - 1;
  var vals = sh.getRange(2, 1, n, CFG.COLS.length).getValues();
  var byKey = {};
  vals.forEach(function (r, i) {
    var amt = Number(r[6]);
    if (!amt) return;
    // Rows that already carry a status (e.g. 'Internal FX') are not candidates:
    // a CAD->USD conversion followed by a USD purchase is not a reversal.
    var st = String(r[11] || '');
    if (st && st.indexOf('Reversal') === -1) return;
    var k = r[3] + '|' + r[7] + '|' + Math.abs(amt).toFixed(2);
    (byKey[k] = byKey[k] || []).push({ i: i, amt: amt, d: new Date(r[1]), status: String(r[11] || '') });
  });

  var marked = 0;
  Object.keys(byKey).forEach(function (k) {
    var g = byKey[k];
    if (g.length < 2) return;
    for (var a = 0; a < g.length; a++) {
      for (var b = a + 1; b < g.length; b++) {
        if (g[a].amt * g[b].amt >= 0) continue;                       // same direction
        var days = Math.abs(g[a].d - g[b].d) / 86400000;
        if (days > 7) continue;
        if (g[a].status.indexOf('Reversal') === -1) { vals[g[a].i][11] = 'Reversal pair'; marked++; }
        if (g[b].status.indexOf('Reversal') === -1) { vals[g[b].i][11] = 'Reversal pair'; marked++; }
      }
    }
  });

  if (marked) sh.getRange(2, 12, n, 1).setValues(vals.map(function (r) { return [r[11]]; }));
  return marked;
}


/**
 * Re-run labelling over rows that are blank or still say "Needs labelling".
 * Add a pattern to the Payees tab, run this, and every past row it matches
 * fills in. Rows you have corrected by hand are left alone.
 */
function relabelAll() {
  var ss = SpreadsheetApp.openById(CFG.SHEET_ID);
  var sh = getTab(ss, CFG.TAB_TX);
  if (!sh) throw new Error('No tab named "' + CFG.TAB_TX + '". Run listTabs to see the real names.');
  var payees = readPayees(ss);
  var last = sh.getLastRow();
  if (last < 2) return 'Nothing to label.';

  var n = last - 1;
  var rng = sh.getRange(2, 1, n, CFG.COLS.length);
  var vals = rng.getValues();
  var changed = 0;

  vals.forEach(function (r) {
    var cur = String(r[5] || '').trim();
    if (cur && cur !== 'Needs labelling') return;        // hand-set, leave it
    var hit = labelFor(String(r[4] || ''), payees, Number(r[6]));
    if (hit) { r[5] = hit.payee; if (!r[9]) r[9] = hit.category; changed++; }
    else if (!cur) { r[5] = 'Needs labelling'; }
  });

  rng.setValues(vals);
  return 'Labelled ' + changed + ' row(s).';
}


/**
 * Re-apply the Payees tab to EVERY row, overwriting Payee and Category
 * wherever a Payees row (or a UPI name) matches. Use it after changing a
 * pattern, so old labels update without editing cells by hand.
 * Rows that match nothing are left exactly as they are, so a hand label on
 * a line no pattern covers survives. A hand label on a line a pattern does
 * cover is replaced — change the Payees row instead.
 */
function relabelEverything() {
  var ss = SpreadsheetApp.openById(CFG.SHEET_ID);
  var sh = getTab(ss, CFG.TAB_TX);
  if (!sh) throw new Error('No tab named "' + CFG.TAB_TX + '". Run listTabs to see the real names.');
  var payees = readPayees(ss);
  var last = sh.getLastRow();
  if (last < 2) return 'Nothing to label.';

  var rng = sh.getRange(2, 1, last - 1, CFG.COLS.length);
  var vals = rng.getValues();
  var changed = 0;

  vals.forEach(function (r) {
    var hit = labelFor(String(r[4] || ''), payees, Number(r[6]));
    if (!hit) return;
    if (hit.auto && r[5] && r[5] !== 'Needs labelling' && r[9] && r[9] !== 'Unknown - check') return; // keep a real label over a bare name
    if (r[5] !== hit.payee || r[9] !== hit.category) {
      r[5] = hit.payee; r[9] = hit.category; changed++;
    }
  });

  rng.setValues(vals);
  var msg = 'Updated ' + changed + ' row(s).';
  Logger.log(msg);
  return msg;
}

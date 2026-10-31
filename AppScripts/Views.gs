/**
 * Views.gs — the attention-first pages, rebuilt by the script.
 *
 *   🏠 Home      am I OK, and what do I do next? Tick ✔ when done; a tick
 *                waits for the bank before it says ✅ Verified.
 *   📒 Ledger    every past and future money event in one folded list:
 *                🔴 Needs you › ⏳ Next 30 days › 🗓 Later › ✅ Done.
 *   🗂 Summary   month by month, country › kind › category › item. Each month
 *                says whether it is actual, half-way or planned.
 *   🧠 Habits    spending you planned vs spending that just happens, with a
 *                monthly limit you set.
 *   🔮 Forecast  the next 12 months and the cash left at each month-end.
 *   🩺 Health    can the numbers be trusted?
 *
 * Folding groups need a fixed row count, which a formula cannot give, so
 * these pages are values written by the script: after every upload, once a
 * day, and within a poll or two of any edit to the sheet (vwMaybeRefresh).
 * Transactions is never written here.
 */

var VW = {
  TODAY: '🏠 Today', NETWORTH: '🏛 Net worth', MONEY: '📒 Money',
  HABITS: '🧠 Habits', FORECAST: '🔮 Forecast',
  NEXT_DAYS: 30,          // ⏳ Next 30 days
  LATER_MONTHS: 3,        // 🗓 Later runs to the end of this many months ahead
  PAST_MONTHS: 3,         // Summary: finished months shown
  FORECAST_MONTHS: 12,
  SOON_DAYS: 7,           // Home lists payments due within this many days
  TICK_WAIT_DAYS: 3,      // ticked but not seen in the bank after this → ⚠
  VERIFIED_KEEP_DAYS: 7,  // a ✅ Verified line stays on Home this long
  STALE_DAYS: 7,          // an account with no data for longer needs a statement
  MIN_GAP_MIN: 10,        // at most one edit-driven rebuild per this many minutes
  TIME_BUDGET_MS: 200000, // a poll stops writing pages after this, and the next poll carries on
  // 'finish' = locks + tab order: right after Today, and again at the end for the pages rebuilt since.
  RENDER_ORDER: ['today', 'networth', 'finish', 'forecast', 'habits', 'money', 'finish'],
  PAIR_BEFORE: 2,         // a transfer may land this many days before it leaves (bank dating)…
  PAIR_AFTER: 7,          // …or this many after (Remitly, e-transfers)
  PAIR_SLACK: 0.08,       // amounts may differ this much (exchange rate, fees)
  PAIR_GRACE: 7,          // an unmatched transfer is flagged once it is this old
  PAIR_LOOKBACK: 120,     // …and only if it is younger than this
  HOURLY_NOTE: /\b\d+(\.\d+)?\s*h\b/i,   // Commitments notes like "37.5 h × $…" = paid by the hour
  HOURLY_LAG: 11,         // a Friday payday pays the Mon–Fri week that started this many days before
  MOVED: 'Moved between your accounts',
  HOUSE_CASH: 'Construction - labour (cash)',   // India ATM cash beyond the parents' share
  TAB_ORDER: ['🏠 Today', 'Commitments', '📒 Money', '🔮 Forecast', '🏛 Net worth', 'Assets & Debts', '🧠 Habits', 'Transactions', 'Payees'],
  OLD_TABS_2: ['Now', 'Balance Sheet', 'Categories'],
  OLD_TABS: ['Dashboard'],
  AUTO_PAY: /^(auto-debit|card|direct deposit|bank fee)/i,   // "How it's paid" values that need no action from you
  UNPLANNED_GROUPS: ['Lifestyle', 'Fees & charges'],
  UNPLANNED_CATS: ['Subscription - cancel'],
  PLANNED_GROUPS: ['Bills & loans', 'Essentials', 'Personal subscriptions', 'Business costs', 'House construction'],
  NOT_SPENDING: ['Income', 'Moved between your accounts', 'Lent out', 'Saved / invested'],
  LIMITS: { Coffee: 60, Convenience: 40, 'Eating out': 150, Alcohol: 30 },   // placeholders; yours win
  C: { NAVY: '#1a2b4c', SECTION: '#24477f', WHITE: '#ffffff', LIGHT: '#e8edf7', GREY: '#5f6368', SUB: '#f7f7fa',
       GOOD: '#e6f4ea', BAD: '#fce8e6', WARN: '#fef7e0', INPUT: '#fffbe6', DONE_HEAD: '#1e7340', HALF_HEAD: '#b3730d', PAST: '#f4f4f4' }
};

var VW_CAD = '$#,##0;[Red]-$#,##0';
var VW_CAD2 = '$#,##0.00;[Red]-$#,##0.00';
var VW_INR = '"₹"#,##0;[Red]-"₹"#,##0';
function vwLocalFmt(cur) { return cur === 'INR' ? VW_INR : VW_CAD2; }
function vwNum(v) { if (typeof v === 'number') return v; var n = parseFloat(String(v == null ? '' : v).replace(/[$,₹\s]/g, '')); return isNaN(n) ? 0 : n; }
/** Text Sheets must not turn into a date or number ("Sep 2026"). */
function vwTxt(s) { return "'" + s; }
function vwR(n) { return Math.round(n); }
function vwShort(a) { return String(a).replace(/\s*(Chequing|Mastercard|Credit Card)\b/g, '').replace(/\s+73-83096/, ' 096').trim(); }
/** A date cell for 'yyyy-mm-dd' at local noon (a UTC midnight shows as the day before in Toronto). */
function vwLocalDate(iso) { return new Date(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10), 12); }
function vwDay(iso) {
  var d = pDate(iso);
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()] + ' ' + d.getUTCDate() + ' ' + pMonthName(iso.slice(0, 7)).slice(0, 3);
}


/* ---------------------------------------------------------------------------
   When to rebuild
   --------------------------------------------------------------------------- */

/** TEMPORARY: where a page build got to, on _Issues. */
function vwTrace(msg) { try { planIssue('TRACE ' + vwStamp() + ' ' + msg, 'trace'); } catch (e) {} }

/**
 * Called from the poll when nothing else ran. Rebuilds when the code version
 * changed, the day changed, or anyone edited the sheet since the last build
 * (Drive's last-updated time moves past the build's own stamp).
 */
function vwMaybeRefresh() {
  var props = PropertiesService.getScriptProperties();
  var today = Utilities.formatDate(new Date(), CFG_TZ(), 'yyyy-MM-dd');
  var stamp = today + '|' + PLAN.VERSION;
  var builtAt = +(props.getProperty('vw_built_at') || 0);
  var due = props.getProperty('vw_stamp') !== stamp;
  // A new day or a new deploy starts the page list again: steps left from the last build would skip Today.
  if (due) props.deleteProperty('vw_pending');
  if (!due) {
    if (Date.now() - builtAt < VW.MIN_GAP_MIN * 60000) return false;
    due = DriveApp.getFileById(CFG.SHEET_ID).getLastUpdated().getTime() > builtAt;
  }
  // A rebuild that ran out of time left the rest in vw_pending: carry on with it first.
  if (props.getProperty('vw_pending')) due = true;
  vwTrace('maybe due=' + due + ' pending=' + props.getProperty('vw_pending') + ' waits=' + props.getProperty('vw_now_waits'));
  if (!due) return false;
  var done = false;
  try {
    done = vwRefresh();
  } catch (err) {
    props.deleteProperty('vw_pending');
    planIssue('Today / Ledger / Summary pages failed', err);
    done = true;
  }
  props.setProperty('vw_stamp', stamp);
  if (done) props.setProperty('vw_built_at', String(Date.now()));
  return true;
}

/** Menu: Finance › Refresh Home, Ledger and the other pages. */
/**
 * Rebuild the pages, most important first. Writing all of them plus the locks can pass Apps
 * Script's 6-minute limit (a timeout logs nothing and stops mid-way), so after TIME_BUDGET_MS
 * the rest is left in vw_pending for the next poll. Returns true when everything is done.
 */
function vwRefresh() {
  var props = PropertiesService.getScriptProperties(), start = Date.now();
  var ss = SpreadsheetApp.openById(CFG.SHEET_ID);
  // Sorting gets a poll of its own: it and the pages together can pass the 6-minute limit.
  try { if (vwTidyInputs(ss)) return false; } catch (err) { planIssue('Sorting Commitments / Assets & Debts failed', err); return false; }
  SpreadsheetApp.flush();
  var d = vwRead(ss);
  var m = vwModel(d);
  vwTrace('read ok, cash positive=' + (m.nowInfo.cash > 0));
  // Right after a deploy Now is still recalculating and reads as $0: build from it on a later poll (3 tries at most).
  var waits = +(props.getProperty('vw_now_waits') || 0);
  if (!(m.nowInfo.cash > 0) && waits < 3) { props.setProperty('vw_now_waits', String(waits + 1)); return false; }
  props.deleteProperty('vw_now_waits');
  // Every page is worked out (cheap — some read numbers from others), then written in order.
  var built = {
    habits: vwHabitsPage(m), forecast: vwForecastPage(m), today: vwTodayPage(m), networth: vwNetWorthPage(m), money: vwMoneyPage(m)
  };
  var pending = JSON.parse(props.getProperty('vw_pending') || 'null') || VW.RENDER_ORDER.slice();
  while (pending.length) {
    // Money is the big page: it starts only with most of the run still ahead.
    if (Date.now() - start > (pending[0] === 'money' ? 90000 : VW.TIME_BUDGET_MS)) {
      props.setProperty('vw_pending', JSON.stringify(pending));
      vwSaveState(m);
      return false;
    }
    var step = pending.shift();
    vwTrace('step ' + step);
    if (step === 'finish') {
      try { vwWriteInvested(ss, m); } catch (err) { planIssue('Assets & Debts amount invested failed', err); }
      try { vwWritePlans(ss, m); } catch (err) { planIssue('Writing the Commitments plan column failed', err); }
      vwProtectTransactions(ss);
      try { vwProtectAll(ss); } catch (err) { planIssue('Locking the fact tabs failed', err); }
      vwArrangeTabs(ss);
    } else {
      vwRender(ss, built[step]);
    }
    props.setProperty('vw_pending', JSON.stringify(pending));
  }
  props.deleteProperty('vw_pending');
  vwTrace('all steps done');
  vwSaveState(m);
  SpreadsheetApp.flush();
  props.setProperty('vw_built_at', String(Date.now()));
  return true;
}


/* ---------------------------------------------------------------------------
   Reading the sheet (formula results, not recalculated here)
   --------------------------------------------------------------------------- */

function vwValues(ss, name) {
  var sh = getTab(ss, name);
  if (!sh || sh.getLastRow() < 1) return { v: [], t: [] };
  var rg = sh.getRange(1, 1, sh.getLastRow(), Math.max(1, sh.getLastColumn()));
  return { v: rg.getValues(), t: rg.getDisplayValues() };
}

function vwRead(ss) {
  var cat = vwValues(ss, 'Categories').v;
  var cm = vwValues(ss, PLAN.TAB_COMMIT);
  var habits = vwValues(ss, VW.HABITS), today = vwValues(ss, VW.TODAY);
  var dash = vwValues(ss, PLAN.TAB_DASH).v, ad = vwValues(ss, BS.TAB_INPUT).v;
  var runs = vwValues(ss, CFG.TAB_RUNS).v;
  return {
    today: Utilities.formatDate(new Date(), CFG_TZ(), 'yyyy-MM-dd'),
    cat: cat,
    tx: vwValues(ss, CFG.TAB_TX).v.slice(1),
    cm: cm.v.slice(1), cmText: cm.t.slice(1),
    now: vwValues(ss, PG.TAB_NOW),
    habitRows: habits.v, todayRows: today.v,
    cards: dash.slice(53, 57).filter(function (r) { return r[0]; }).map(function (r) { return { name: String(r[0]), owedCad: vwNum(r[1]) }; }),
    adRows: ad.slice(1),
    bsRows: vwValues(ss, BS.TAB_VIEW).v,
    lastRun: runs.length < 2 ? '' : runs[runs.length - 1][0] instanceof Date
      ? Utilities.formatDate(runs[runs.length - 1][0], CFG_TZ(), 'EEE d MMM, HH:mm') : String(runs[runs.length - 1][0]),
    accounts: CFG.ACCOUNTS.filter(function (a, i, all) {
      return !(CFG.BANKS[a.key] || {}).quiet && all.map(function (x) { return x.key; }).indexOf(a.key) === i;
    }).map(function (a) {
      return { name: a.name, cur: a.currency, card: !!(CFG.BANKS[a.key] || {}).payFrom || /mastercard|visa|regalia|credit/i.test(a.name) };
    }),
    ticks: JSON.parse(PropertiesService.getScriptProperties().getProperty('vw_ticks') || '{}'),
    limits: JSON.parse(PropertiesService.getScriptProperties().getProperty('vw_limits') || '{}')
  };
}


/* ---------------------------------------------------------------------------
   The model: one list of events, past and future (pure — testable in Node)
   --------------------------------------------------------------------------- */

function vwModel(d) {
  var today = d.today, m = { today: today, d: d };
  var group = {}, counts = {}, rate = { CAD: 1 };
  Object.keys(CFG.FX_TO_CAD).forEach(function (k) { rate[k] = CFG.FX_TO_CAD[k]; });
  d.cat.slice(1).forEach(function (r) {
    if (r[0]) { group[String(r[0]).trim()] = String(r[1] || '').trim(); counts[String(r[0]).trim()] = String(r[2] || '').trim(); }
    if (/^parents.*cash/i.test(String(r[4] || '')) && vwNum(r[5])) m.parentsCash = vwNum(r[5]);
    if (r[4] && vwNum(r[5])) rate[String(r[4]).trim()] = vwNum(r[5]);
  });
  m.rate = rate;
  m.countsOf = function (cat) { return counts[String(cat || '').trim()] || ''; };
  m.isHouse = function (e) { return m.countsOf(e.catg) === 'House'; };
  m.groupOf = function (cat) { cat = String(cat || '').trim(); return cat ? (group[cat] || planGroup(cat, -1)) : 'Not labelled yet'; };
  var curOf = {}; d.accounts.forEach(function (a) { curOf[a.name] = a.cur; });
  m.curOf = function (acct) { return curOf[acct] || (/HDFC/i.test(acct) ? 'INR' : 'CAD'); };
  m.country = function (acct) { return m.curOf(acct) === 'INR' ? '🇮🇳 India' : '🇨🇦 Canada'; };
  m.fullAcct = function (cell) {
    if (!cell) return '';
    // Bank accounts before cards ("CIBC" is the chequing account, not the CIBC card), and of
    // several matches the shortest name ("TD" is TD Business Chequing, not the investor account).
    var order = d.accounts.filter(function (a) { return !a.card; }).concat(d.accounts.filter(function (a) { return a.card; }));
    var hits = order.filter(function (a) { return planAcctMatches(cell, a.name); });
    var nonCard = hits.filter(function (a) { return !a.card; });
    var pool = nonCard.length ? nonCard : hits;
    if (pool.length) return pool.sort(function (a, b) { return a.name.length - b.name.length; })[0].name;
    return String(cell);
  };

  var ev = [];
  m.ev = ev;

  // Past: every bank row.
  d.tx.forEach(function (r) {
    var date = pCellIso(r[1]), amt = vwNum(r[6]);
    if (!date || !amt || String(r[11]) === 'Reversal pair') return;
    var cur = String(r[7] || 'CAD'), cad = cur !== 'CAD' || r[8] === '' || r[8] == null ? amt * (rate[cur] || 0) : vwNum(r[8]);
    var catg = String(r[9] || '').trim(), kind = m.groupOf(catg);
    var unl = !catg || kind === 'Not labelled yet';
    var payee = String(r[5] || '').trim();
    if (!payee || /^needs labell?ing$/i.test(payee)) payee = String(r[4] || '').trim();
    ev.push({ date: date, what: payee, acct: String(r[3] || ''), amt: amt, cur: cur, cad: cad,
      catg: catg || 'Not labelled yet', kind: kind, past: true,
      status: unl ? '🏷 Needs a label' : '✅ Done', tag: unl ? 'label' : 'done',
      dir: kind === VW.MOVED ? 'Move' : cad >= 0 ? 'In' : 'Out', source: 'Statement · ' + String(r[4] || '').slice(0, 60) });
  });

  vwSplitIndiaCash(m);

  // Future: recurring payments (Commitments), with what the sheet already knows about them.
  var horizon = pMonthAdd(today.slice(0, 7), VW.FORECAST_MONTHS) + '-' + pLastDay(pMonthAdd(today.slice(0, 7), VW.FORECAST_MONTHS));
  // The newest statement row per account: nothing can be called late past that date.
  var dataTo = {};
  ev.forEach(function (e) { if (e.past && (!dataTo[e.acct] || e.date > dataTo[e.acct])) dataTo[e.acct] = e.date; });
  var cms = planReadCommitments(d.cm, rate);
  m.cms = cms;
  m.cardRows = [];
  cms.forEach(function (c) {
    var r = d.cm[c.row - 2];
    // A credit card row is planned from its own limit and dates (vwCardEvents), not as a bill.
    if (vwIsCardRow(c, r)) { m.cardRows.push({ c: c, r: r }); return; }
    var dec = String(c.decision || '');
    if (/^(cancel|later)$/i.test(dec)) {
      if (/^⚠/.test(String(r[19] || ''))) ev.push(vwCm(m, c, r, pCellIso(r[17]) || today, '⚠ ' + String(r[19]).replace(/^⚠\s*/, '') + ' — check', 'check'));
      return;
    }
    var st = String(r[19] || ''), cycle = pCellIso(r[17]), next = pCellIso(r[18]);
    var from = today;
    if (/^✅/.test(st)) from = next || pAddDays(today, 1);
    else if ((/^🔴/.test(st) && cycle !== today) || (/^⏳/.test(st) && cycle && cycle < today)) {
      var noData = cycle && (dataTo[m.fullAcct(c.acct)] || '') < cycle;
      ev.push(noData ? vwCm(m, c, r, cycle, '🗓 Expected — the statement for that date is not in yet', 'planned')
                     : vwCm(m, c, r, cycle || today, '🔴 Overdue since ' + vwDay(cycle || today), 'overdue'));
      from = pAddDays(cycle || today, 1);
    } else if (/^❔/.test(st)) {
      if (cycle && cycle < today) {
        ev.push(vwCm(m, c, r, cycle, '❔ ' + st.replace(/^❔\s*/, ''), 'unknown'));
        from = pAddDays(cycle, 1);
      }
    } else if (cycle) from = cycle < today ? today : cycle;
    var hourly = c.income && /^weekly$/i.test(c.freq) && VW.HOURLY_NOTE.test(c.notes);
    planDueDates(c, from, horizon).forEach(function (when) {
      var e = vwCm(m, c, r, when, '🗓 Planned', 'planned');
      // Paid by the hour: a statutory holiday in the week this payday covers is unpaid.
      var off = hourly ? vwHolidaysIn(pAddDays(when, -VW.HOURLY_LAG), pAddDays(when, -VW.HOURLY_LAG + 4)) : [];
      if (off.length) {
        var k = (5 - off.length) / 5;
        e.amt *= k; e.cad *= k;
        e.status = '🗓 Planned — ' + off.length + ' holiday' + (off.length > 1 ? 's' : '') + ' unpaid (' + off.map(vwDay).join(', ') + ')';
      }
      ev.push(e);
    });
  });


  // Money moves the Now tab asks for.
  m.moves = vwMoves(d);
  m.moves.forEach(function (mv) {
    ev.push({ date: mv.by || today, what: 'Move money: ' + vwShort(mv.from) + ' → ' + vwShort(mv.to), acct: mv.from, amt: -mv.cad, cur: 'CAD', cad: -mv.cad,
      catg: 'Transfer', kind: VW.MOVED, past: false, dir: 'Move', status: '⏳ To do — move about $' + vwR(mv.cad).toLocaleString('en-US') + ' by ' + (mv.by ? vwDay(mv.by) : 'soon'),
      tag: 'todo', moveTo: mv.to, source: 'Now tab · ' + mv.text });
  });

  vwCardEvents(m);
  vwPairTransfers(m);

  // Facts the other pages share.
  m.lastData = {};
  ev.forEach(function (e) { if (e.past && (!m.lastData[e.acct] || e.date > m.lastData[e.acct])) m.lastData[e.acct] = e.date; });
  m.nowInfo = vwNowInfo(d);
  return m;
}

/**
 * Own-account transfers that left one account and arrived in another are paired up
 * (amounts within PAIR_SLACK at today's rate, dates within PAIR_BEFORE / PAIR_AFTER).
 * One side alone, older than PAIR_GRACE days, needs you: money that vanished, or an
 * account the sheet does not track (label it "Transfer - untracked account").
 */
function vwPairTransfers(m) {
  var moves = m.ev.filter(function (e) {
    return e.past && e.kind === VW.MOVED && !/^reversal$/i.test(e.catg) && !/untracked/i.test(e.catg);
  });
  var outs = moves.filter(function (e) { return e.cad < 0; }), ins = moves.filter(function (e) { return e.cad > 0; });
  var fits = function (o, x) {
    if (x.acct === o.acct) return false;
    var days = pDaysBetween(o.date, x.date);
    return days >= -VW.PAIR_BEFORE && days <= VW.PAIR_AFTER && Math.abs(x.cad + o.cad) <= Math.max(5, VW.PAIR_SLACK * -o.cad);
  };
  var score = function (o, x) { return Math.abs(x.cad + o.cad) / -o.cad + Math.abs(pDaysBetween(o.date, x.date)) / 100; };
  outs.sort(function (a, b) { return a.date < b.date ? -1 : 1; }).forEach(function (o) {
    var best = null;
    ins.forEach(function (x) { if (!x.pair && fits(o, x) && (!best || score(o, x) < score(o, best))) best = x; });
    if (best) { o.pair = best; best.pair = o; }
  });
  // Same-day look-alikes (two $3,000 moves) can cross: an unmatched departure takes a
  // matched arrival when its partner can move to an arrival nobody took.
  outs.forEach(function (o) {
    if (o.pair) return;
    ins.some(function (x) {
      if (!x.pair || !fits(o, x)) return false;
      var o2 = x.pair, y = ins.filter(function (z) { return !z.pair && fits(o2, z); })[0];
      if (!y) return false;
      o.pair = x; x.pair = o; o2.pair = y; y.pair = o2;
      return true;
    });
  });
  // One arrival funded from two accounts (a card paid from chequing and savings).
  ins.forEach(function (x) {
    if (x.pair) return;
    var near = outs.filter(function (o) {
      var days = pDaysBetween(o.date, x.date);
      return !o.pair && o.acct !== x.acct && days >= -VW.PAIR_BEFORE && days <= VW.PAIR_AFTER + 2;
    });
    near.some(function (a, i) {
      return near.slice(i + 1).some(function (b) {
        if (Math.abs(x.cad + a.cad + b.cad) > Math.max(5, VW.PAIR_SLACK * x.cad)) return false;
        a.pair = x; b.pair = x; x.pair = a;
        return true;
      });
    });
  });
  outs.forEach(function (o) {
    if (!o.pair) return;
    var x = o.pair;
    o.source = '↔ arrived in ' + vwShort(x.acct) + ' ' + vwDay(x.date) + ' · ' + o.source;
    x.source = '↔ came from ' + vwShort(o.acct) + ' ' + vwDay(o.date) + ' · ' + x.source;
  });
  m.unpaired = moves.filter(function (e) {
    var age = pDaysBetween(e.date, m.today);
    return !e.pair && age >= VW.PAIR_GRACE && age <= VW.PAIR_LOOKBACK;
  });
  m.unpaired.forEach(function (e) {
    e.tag = 'unpaired';
    e.status = e.cad < 0 ? '↔ Left ' + vwShort(e.acct) + ' — never arrived in another of your accounts'
                         : '↔ Arrived — never seen leaving another of your accounts';
  });
}

/** Ontario statutory holidays (weekday dates as observed) between two ISO dates. */
function vwHolidaysIn(from, to) {
  var out = [];
  for (var y = +from.slice(0, 4); y <= +to.slice(0, 4); y++) {
    vwHolidays(y).forEach(function (d) { if (d >= from && d <= to) out.push(d); });
  }
  return out;
}

function vwHolidays(y) {
  var iso = function (m, d) { return y + '-' + ('0' + m).slice(-2) + '-' + ('0' + d).slice(-2); };
  var dow = function (s) { return pDate(s).getUTCDay(); };
  var nth = function (m, wd, n) { var s = iso(m, 1); s = pAddDays(s, (wd - dow(s) + 7) % 7); return pAddDays(s, 7 * (n - 1)); };
  var observed = function (s) { var d = dow(s); return d === 6 ? pAddDays(s, 2) : d === 0 ? pAddDays(s, 1) : s; };
  // Easter (anonymous Gregorian algorithm) for Good Friday.
  var a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25),
      g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4,
      l = (32 + 2 * e + 2 * i - h - k) % 7, mm = Math.floor((a + 11 * h + 22 * l) / 451);
  var em = Math.floor((h + l - 7 * mm + 114) / 31), ed = ((h + l - 7 * mm + 114) % 31) + 1;
  var victoria = pAddDays(iso(5, 25), -((dow(iso(5, 25)) + 6) % 7 || 7));
  var xmas = iso(12, 25), boxing = iso(12, 26);
  var xd = dow(xmas);
  var xObs = xd === 6 ? pAddDays(xmas, 2) : xd === 0 ? pAddDays(xmas, 1) : xmas;
  var bObs = xd === 6 ? pAddDays(xmas, 3) : xd === 5 ? pAddDays(xmas, 3) : xd === 0 ? pAddDays(xmas, 2) : boxing;
  return [observed(iso(1, 1)), nth(2, 1, 3), pAddDays(iso(em, ed), -2), victoria, observed(iso(7, 1)),
          nth(9, 1, 1), nth(10, 1, 2), xObs, bObs];
}

function vwCm(m, c, r, when, status, tag) {
  var inc = String(r[22]) === 'In', sign = inc ? 1 : -1;
  var acct = m.fullAcct(c.acct) || '(no account set)';
  return { date: when, what: c.name, acct: acct, amt: sign * c.amount, cur: c.cur, cad: sign * c.cad, catg: c.cat || 'Not labelled yet',
    kind: inc ? 'Income' : m.groupOf(c.cat), past: false, dir: inc ? 'In' : 'Out', status: status, tag: tag, cmName: c.name, how: String(r[PLAN.HOW_COL - 1] || '').trim(),
    source: 'Recurring · ' + (c.notes ? String(c.notes).slice(0, 90) : 'Commitments tab') };
}

/** '28 Oct 2026' → '2026-10-28'. */
function vwParseDate(v) {
  var s = String(v || '').trim(), mm = s.match(/^(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})$/);
  if (!mm || CFG.MONTHS[mm[2].toUpperCase()] === undefined) return '';
  return mm[3] + '-' + ('0' + (CFG.MONTHS[mm[2].toUpperCase()] + 1)).slice(-2) + '-' + ('0' + mm[1]).slice(-2);
}

/** The Now tab's account block: rows under the "Account | Balance" header until "Total". */
function vwNowRows(d) {
  var v = d.now.v, t = d.now.t, out = { banks: [], total: null };
  for (var i = 0; i < v.length; i++) {
    if (String(v[i][0]) !== 'Account' || String(v[i][1]) !== 'Balance') continue;
    for (var j = i + 1; j < v.length && String(v[j][0]); j++) {
      if (String(v[j][0]) === 'Total') { out.total = { cash: vwNum(v[j][3]), spare: vwNum(v[j][9]) }; break; }
      out.banks.push({ name: String(v[j][0]), asOf: v[j][2], asOfText: t[j][2], action: String(t[j][10] || ''),
        bal: v[j][1] === '' ? null : vwNum(v[j][1]), inLocal: vwNum(v[j][4]), hst: vwNum(v[j][7]) });
    }
    break;
  }
  return out;
}

function vwNowInfo(d) {
  var n = vwNowRows(d);
  return { banks: n.banks, cash: n.total ? n.total.cash : null, spare: n.total ? n.total.spare : null };
}

/** "⚠ Short ₹53,838 → move about $872 from TD Business Chequing by Thu 29 Oct" → a move. */
function vwMoves(d) {
  var out = [], year = +d.today.slice(0, 4);
  vwNowRows(d).banks.forEach(function (b) {
    var mm = b.action.match(/move about \$([\d,]+(?:\.\d+)?) from (.+?)(?: by (?:\w{3} )?(\d{1,2}) (\w{3}))?$/);
    if (!/^⚠/.test(b.action) || !mm) return;
    var by = '';
    if (mm[3] && CFG.MONTHS[mm[4].toUpperCase()] !== undefined) {
      var mo = CFG.MONTHS[mm[4].toUpperCase()] + 1;
      by = (mo < +d.today.slice(5, 7) - 6 ? year + 1 : year) + '-' + ('0' + mo).slice(-2) + '-' + ('0' + mm[3]).slice(-2);
    }
    out.push({ to: b.name, from: mm[2].trim(), cad: vwNum(mm[1]), by: by, text: b.action });
  });
  return out;
}


/* ---------------------------------------------------------------------------
   A page = rows plus how to show them; vwRender writes it in one go
   --------------------------------------------------------------------------- */

function vwPage(name, title, sub) {
  return { name: name, rows: [[title], [sub], []], fmt: [], groups: [], widths: [], freeze: 0, numFmt: [], rules: [], checks: [], notes: [], wrapCols: [],
           merges: [], heights: {} };
}
/** Style rows [r0, r1) (0-based), columns [c0, c1). */
function vwStyle(p, r0, r1, c0, c1, s) { p.fmt.push({ r0: r0, r1: r1, c0: c0, c1: c1, s: s }); }
function vwNumFmt(p, r0, r1, c0, c1, f) { p.numFmt.push({ r0: r0, r1: r1, c0: c0, c1: c1, f: f }); }
function vwHead(p, r, n) { vwStyle(p, r, r + 1, 0, n, { bg: VW.C.NAVY, color: VW.C.WHITE, bold: true, wrap: true }); }
function vwBand(p, r, n, text, bg, color) {
  p.rows[r] = [text]; vwStyle(p, r, r + 1, 0, n, { bg: bg || VW.C.SECTION, color: color || VW.C.WHITE, bold: true, size: 12 });
}

function vwRender(ss, p) {
  var width = Math.max.apply(null, p.rows.map(function (r) { return r.length; }).concat([p.widths.length, 1]));
  var rows = p.rows.map(function (r) { var x = r.slice(); while (x.length < width) x.push(''); return x; });

  // Build on a fresh tab, then swap it in: groups and formats from the last build go with the old tab.
  var old = getTab(ss, p.name);
  var tmp = getTab(ss, p.name + ' (building)');
  if (tmp) ss.deleteSheet(tmp);
  var at = old ? old.getIndex() : ss.getNumSheets() + 1;
  var sh = ss.insertSheet(p.name + ' (building)', Math.max(0, at - 1));
  var need = rows.length + 5;
  if (sh.getMaxRows() < need) sh.insertRowsAfter(sh.getMaxRows(), need - sh.getMaxRows());
  if (sh.getMaxColumns() < width) sh.insertColumnsAfter(sh.getMaxColumns(), width - sh.getMaxColumns());
  sh.setHiddenGridlines(true);

  var all = sh.getRange(1, 1, rows.length, width);

  // Formats as whole arrays: one call each instead of one per cell.
  var bg = [], fc = [], fw = [], fs = [], fst = [], nf = [];
  for (var i = 0; i < rows.length; i++) {
    bg.push([]); fc.push([]); fw.push([]); fs.push([]); fst.push([]); nf.push([]);
    for (var j = 0; j < width; j++) { bg[i].push(null); fc[i].push('#202124'); fw[i].push('normal'); fs[i].push(10); fst[i].push('normal'); nf[i].push('General'); }
  }
  var wrapRows = [];
  p.fmt.forEach(function (f) {
    for (var r = f.r0; r < Math.min(f.r1, rows.length); r++) {
      for (var c = f.c0; c < Math.min(f.c1, width); c++) {
        if (f.s.bg !== undefined) bg[r][c] = f.s.bg;
        if (f.s.color) fc[r][c] = f.s.color;
        if (f.s.bold) fw[r][c] = 'bold';
        if (f.s.size) fs[r][c] = f.s.size;
        if (f.s.italic) fst[r][c] = 'italic';
      }
      if (f.s.wrap) wrapRows.push(r);
    }
  });
  p.numFmt.forEach(function (f) {
    for (var r = f.r0; r < Math.min(f.r1, rows.length); r++) for (var c = f.c0; c < Math.min(f.c1, width); c++) nf[r][c] = f.f;
  });
  // Text marked with a leading ' (vwTxt / vwSafe) goes in as plain text: the format is set
  // before the value, otherwise setValues reads "Nov 2026" or "Sat 31 Oct" as a date.
  rows.forEach(function (r, i) {
    r.forEach(function (v, j) { if (typeof v === 'string' && v.charAt(0) === "'") { r[j] = v.slice(1); nf[i][j] = '@'; } });
  });
  all.setNumberFormats(nf);
  all.setValues(rows).setFontFamily(TH.FONT).setVerticalAlignment('middle');
  all.setBackgrounds(bg).setFontColors(fc).setFontWeights(fw).setFontSizes(fs).setFontStyles(fst);
  sh.getRange(1, 1).setFontSize(17).setFontWeight('bold').setFontColor(VW.C.NAVY);
  sh.getRange(2, 1).setFontSize(9).setFontStyle('italic').setFontColor(VW.C.GREY);
  wrapRows.forEach(function (r) { sh.getRange(r + 1, 1, 1, width).setWrap(true); });
  p.wrapCols.forEach(function (c) { sh.getRange(4, c + 1, Math.max(1, rows.length - 3), 1).setWrap(true); });

  p.widths.forEach(function (w, i) { if (w) sh.setColumnWidth(i + 1, w); });
  if (width > p.widths.length && p.widths.length) sh.hideColumns(p.widths.length + 1, width - p.widths.length);
  if (p.freeze) sh.setFrozenRows(p.freeze);
  p.checks.forEach(function (c) {
    sh.getRange(c.r0 + 1, c.c + 1, c.r1 - c.r0, 1).insertCheckboxes().setHorizontalAlignment('center');
  });

  var rules = p.rules.map(function (x) {
    return SpreadsheetApp.newConditionalFormatRule().whenTextStartsWith(x.starts).setBackground(x.bg)
      .setRanges([sh.getRange(x.r0 + 1, x.c + 1, Math.max(1, x.r1 - x.r0), 1)]).build();
  });
  if (rules.length) sh.setConditionalFormatRules(rules);
  p.notes.forEach(function (n) { sh.getRange(n.r + 1, n.c + 1).setNote(n.text); });
  (p.merges || []).forEach(function (g) { sh.getRange(g[0] + 1, g[1] + 1, g[2], g[3]).merge(); });
  Object.keys(p.heights || {}).forEach(function (r) { sh.setRowHeight(+r + 1, p.heights[r]); });

  // Folding: outer groups first, then inner; every group starts folded.
  if (p.groups.length) {
    sh.setRowGroupControlPosition(SpreadsheetApp.GroupControlTogglePosition.BEFORE);
    p.groups.slice().sort(function (a, b) { return a[0] - b[0] || (b[1] - b[0]) - (a[1] - a[0]); }).forEach(function (g) {
      if (g[1] > g[0]) sh.getRange(g[0] + 1, 1, g[1] - g[0], 1).shiftRowGroupDepth(1);
    });
    sh.collapseAllRowGroups();
  }

  if (old && old.isSheetHidden()) sh.hideSheet();   // a page you hid stays hidden when it is rebuilt
  if (old) ss.deleteSheet(old);
  sh.setName(p.name);
  return sh;
}


/* ---------------------------------------------------------------------------
   📒 Ledger
   --------------------------------------------------------------------------- */


/** Bank text is shown, never run: a leading = + - @ would make Sheets read a formula. */
function vwSafe(s) { s = String(s == null ? '' : s); return /^[=+@-]/.test(s) ? "'" + s : s; }
function vwUniq(xs) { var s = {}, out = []; xs.forEach(function (x) { if (!s[x]) { s[x] = 1; out.push(x); } }); return out; }
function vwStamp() { return Utilities.formatDate(new Date(), CFG_TZ(), 'EEE d MMM HH:mm'); }


/* ---------------------------------------------------------------------------
   🗂 Summary
   --------------------------------------------------------------------------- */

/** Day-to-day spending a month (local money per country): the last two full months, outside recurring categories. */
function vwEstimates(m) {
  if (m.est) return m.est;
  var cur = m.today.slice(0, 7), full = [pMonthAdd(cur, -2), pMonthAdd(cur, -1)];
  var recurring = {};
  m.cms.forEach(function (c) { if (!/^(cancel|later)$/i.test(c.decision) && !/^one-off$/i.test(c.freq) && c.cat) recurring[c.cat] = 1; });
  var est = { '🇨🇦 Canada': 0, '🇮🇳 India': 0 };
  m.ev.forEach(function (e) {
    if (!e.past || e.cad >= 0 || full.indexOf(e.date.slice(0, 7)) === -1) return;
    if (VW.NOT_SPENDING.indexOf(e.kind) !== -1 || recurring[e.catg]) return;
    // The house is a project: only signed contract instalments (Commitments rows) are planned, never a monthly pace.
    if (m.isHouse(e)) return;
    est[m.country(e.acct)] += e.amt / full.length;
  });
  m.est = est;
  return est;
}

/** One-off Commitments parked as "Later" with an amount: budgets whose dates are not known yet. */
function vwOpenBudgets(m) {
  if (!m.open) m.open = m.cms.filter(function (c) {
    return /^later$/i.test(c.decision) && /^one-off$/i.test(c.freq) && c.amount > 0 && m.countsOf(c.cat) === 'House';
  }).map(function (c) { return { name: c.name, amount: c.amount, cur: c.cur, cad: c.cad, notes: c.notes, kind: 'House construction' }; });
  return m.open;
}


function vwCopy(o, extra) { var x = {}; Object.keys(o).forEach(function (k) { x[k] = o[k]; }); Object.keys(extra).forEach(function (k) { x[k] = extra[k]; }); return x; }


/* ---------------------------------------------------------------------------
   🧠 Habits
   --------------------------------------------------------------------------- */

function vwHabitsPage(m) {
  var cur = m.today.slice(0, 7), months = [pMonthAdd(cur, -2), pMonthAdd(cur, -1), cur];
  var p = vwPage(VW.HABITS, '🧠 Habits — spending you planned vs spending that just happens',
    'Set your own monthly limit in the yellow column; it turns ✅ or ⚠ by itself and is kept when the page rebuilds. Open a row (➕ on the left) to see the places. CAD. Average = the two full months.');
  var limits = vwLimits(m);
  var spend = m.ev.filter(function (e) { return e.past && e.cad < 0 && months.indexOf(e.date.slice(0, 7)) !== -1; });
  var unplanned = function (e) { return VW.UNPLANNED_GROUPS.indexOf(e.kind) !== -1 || VW.UNPLANNED_CATS.indexOf(e.catg) !== -1; };
  var planned = function (e) { return !unplanned(e) && (VW.PLANNED_GROUPS.indexOf(e.kind) !== -1 || m.isHouse(e)); };
  p.rows.push([''].concat(months.map(function (mo) { return vwTxt(pMonthName(mo) + (mo === cur ? ' (so far)' : '')); }), ['Per month (avg)', 'Per year', '🎯 Your limit / month', 'vs limit', 'key']));
  vwHead(p, 3, 8); p.freeze = 4;

  var top = [];
  function block(label, test, bg) {
    var r = p.rows.length; vwBand(p, r, 8, label, bg, '#202124');
    var catRows = [];
    var cats = vwUniq(spend.filter(test).map(function (e) { return e.catg; }));
    var tot = function (cg) { return spend.filter(function (e) { return e.catg === cg; }).reduce(function (s, e) { return s - e.cad; }, 0); };
    cats.sort(function (a, b) { return tot(b) - tot(a); }).forEach(function (cg) {
      var L = spend.filter(function (e) { return e.catg === cg; });
      var mv = months.map(function (mo) { return vwR(-L.filter(function (e) { return e.date.slice(0, 7) === mo; }).reduce(function (s, e) { return s + e.cad; }, 0)); });
      if (test === unplanned) { m.unplannedYear = (m.unplannedYear || 0) + (mv[0] + mv[1]) / 2 * 12; top.push([cg, (mv[0] + mv[1]) / 2]); }
      var row = p.rows.length + 1;   // sheet row
      var lim = limits[cg] !== undefined ? limits[cg] : (test === unplanned && VW.LIMITS[cg] !== undefined ? VW.LIMITS[cg] : '');
      p.rows.push(['   ' + cg + '  (' + L.length + ' times)'].concat(mv, ['=IF(B' + row + '+C' + row + '=0,"new",AVERAGE(B' + row + ':C' + row + '))', '=IF(ISNUMBER(E' + row + '),E' + row + '*12,"")', lim,
        '=IF(G' + row + '="",' + (test === unplanned ? '"set a limit →"' : '""') + ',IF(N(E' + row + ')<=G' + row + ',"✅ within","⚠ over by "&TEXT(N(E' + row + ')-G' + row + ',"$#,##0")))', cg]));
      catRows.push(row);
      vwStyle(p, row - 1, row, 0, 1, { bold: true });
      vwStyle(p, row - 1, row, 6, 7, { bg: VW.C.INPUT });
      var s = p.rows.length, by = {};
      L.forEach(function (e) {
        var b = by[e.what] = by[e.what] || { n: 0, c: 0, m: {} };
        b.n++; b.c -= e.cad; b.m[e.date.slice(0, 7)] = (b.m[e.date.slice(0, 7)] || 0) - e.cad;
      });
      Object.keys(by).sort(function (a, b) { return by[b].c - by[a].c; }).slice(0, 8).forEach(function (w) {
        p.rows.push(['         ' + w + '  ×' + by[w].n].concat(months.map(function (mo) { return vwR(by[w].m[mo] || 0); })));
        vwStyle(p, p.rows.length - 1, p.rows.length, 0, 4, { color: VW.C.GREY });
      });
      p.groups.push([s, p.rows.length]);
    });
    var tr = p.rows.length + 1;
    var sumOf = function (col) { return catRows.length ? '=' + catRows.map(function (x) { return col + x; }).join('+') : 0; };
    p.rows.push(['   Total', sumOf('B'), sumOf('C'), sumOf('D'), '=AVERAGE(B' + tr + ':C' + tr + ')', '=E' + tr + '*12']);
    vwStyle(p, tr - 1, tr, 0, 8, { bold: true, bg: VW.C.SUB });
    return tr;
  }
  var aTot = block('✅ SPENDING YOU PLANNED — bills, loans, essentials, the house', planned, VW.C.GOOD);
  p.rows.push([]);
  var uTot = block('⚠ SPENDING THAT JUST HAPPENS — coffee, convenience store, eating out, cash, shopping, fees', unplanned, VW.C.BAD);
  p.rows.push([]);
  p.rows.push(['👉 Unplanned share of your spending', '=IFERROR(B' + uTot + '/(B' + aTot + '+B' + uTot + '),0)', '=IFERROR(C' + uTot + '/(C' + aTot + '+C' + uTot + '),0)',
    '=IFERROR(D' + uTot + '/(D' + aTot + '+D' + uTot + '),0)', '', '=F' + uTot, '← what unplanned spending costs you a year']);
  var sr = p.rows.length - 1;
  p.rows.push(['Cash withdrawals count as unplanned until the Cash log says what they paid for (e.g. workers at the house).']);
  vwStyle(p, sr + 1, sr + 2, 0, 1, { italic: true, color: VW.C.GREY });
  m.unplannedYearRow = uTot;
  var biggest = top.sort(function (a, b) { return b[1] - a[1]; }).slice(0, 3).map(function (x) { return x[0] + ' $' + vwR(x[1]).toLocaleString('en-US'); });
  p.rows[1][0] = '👉 Spending that just happens costs about $' + vwR((m.unplannedYear || 0) / 12).toLocaleString('en-US') + ' a month ($' + vwR(m.unplannedYear || 0).toLocaleString('en-US') + ' a year). Biggest: ' + biggest.join(', ') + '. Yellow column = your own limit. ➕ opens a row. CAD; average = the two full months.';
  vwNumFmt(p, 4, sr, 1, 7, VW_CAD);
  vwNumFmt(p, sr, sr + 1, 1, 4, '0%'); vwNumFmt(p, sr, sr + 1, 5, 6, VW_CAD);
  vwStyle(p, sr, sr + 1, 0, 8, { bg: VW.C.NAVY, color: VW.C.WHITE, bold: true, size: 12 });
  p.rules.push({ r0: 4, r1: sr, c: 7, starts: '✅', bg: VW.C.GOOD }, { r0: 4, r1: sr, c: 7, starts: '⚠', bg: VW.C.BAD });
  p.widths = [440, 105, 105, 105, 115, 105, 140, 150];   // column I (key) is hidden
  return p;
}

/** Limits typed on the old Habits tab win over saved ones, which win over the placeholders. */
function vwLimits(m) {
  var saved = m.d.limits || {};
  (m.d.habitRows || []).forEach(function (r) {
    var cg = String(r[8] || '').trim();
    if (!cg || cg === 'key') return;
    if (r[6] === '' || r[6] === null) saved[cg] = '';
    else if (!isNaN(Number(r[6]))) saved[cg] = Number(r[6]);
  });
  m.limitsOut = saved;
  return saved;
}


/* ---------------------------------------------------------------------------
   🔮 Forecast
   --------------------------------------------------------------------------- */

function vwForecastPage(m) {
  var cur = m.today.slice(0, 7), months = [];
  for (var k = 0; k <= VW.FORECAST_MONTHS; k++) months.push(pMonthAdd(cur, k));
  var est = vwEstimates(m), rateINR = m.rate.INR || 0.0162;
  var left = 1 - (+m.today.slice(8, 10)) / pLastDay(cur);
  var hstHeld = (m.nowInfo.banks || []).reduce(function (s, b) { return s + (b.hst || 0) * (m.rate[m.curOf(b.name)] || 1); }, 0);
  var cash0 = (m.nowInfo.cash || 0) - hstHeld;
  var p = vwPage(VW.FORECAST, '🔮 Forecast — the next ' + VW.FORECAST_MONTHS + ' months (planned, CAD)',
    'Folded: click ➕ on the far left. Starts from the cash in your accounts today; the first column is only the rest of this month. Pay is after HST. Day-to-day spending uses the pace of the last 2 months. Rebuilt ' + vwStamp() + '.');
  var W = 2 + months.length;
  p.rows.push([''].concat(months.map(function (mo, i) { return vwTxt(i ? pMonthName(mo) : 'Rest of ' + pMonthName(mo).slice(0, 3)); }), ['Total']));
  vwHead(p, 3, W); p.freeze = 4;
  var fut = m.ev.filter(function (e) { return !e.past && (e.tag === 'planned' || e.tag === 'overdue') && e.dir !== 'Move'; })
    .map(function (e) { return e.date < m.today ? vwCopy(e, { date: m.today }) : e; });
  var lines = {};
  fut.forEach(function (e) {
    var kd = e.dir === 'In' ? 'Money in' : e.kind;
    var mo = e.date.slice(0, 7), i = months.indexOf(mo);
    if (i === -1) return;
    lines[kd] = lines[kd] || {}; lines[kd][e.what] = lines[kd][e.what] || months.map(function () { return 0; });
    lines[kd][e.what][i] += e.cad;
  });
  lines['Day-to-day spending (estimate)'] = {
    'Canada': months.map(function (mo, i) { return est['🇨🇦 Canada'] * (i ? 1 : left); }),
    'India': months.map(function (mo, i) { return est['🇮🇳 India'] * rateINR * (i ? 1 : left); })
  };
  var sumArr = function (a) { return a.reduce(function (s, x) { return s + x; }, 0); };
  function sec(name, items) {
    var tot = months.map(function (mo, i) { return vwR(items.reduce(function (s, it) { return s + it[1][i]; }, 0)); });
    p.rows.push([name].concat(tot, [sumArr(tot)]));
    var r = p.rows.length - 1; vwStyle(p, r, r + 1, 0, W, { bold: true, bg: VW.C.LIGHT });
    var s = p.rows.length;
    items.forEach(function (it) { var v = it[1].map(vwR); p.rows.push(['      ' + it[0]].concat(v, [sumArr(v)])); });
    p.groups.push([s, p.rows.length]);
    return tot;
  }
  var items = function (kd) { return Object.keys(lines[kd] || {}).map(function (w) { return [w, lines[kd][w]]; }); };
  var tin = sec('➕ Money in', items('Money in'));
  var tout = months.map(function () { return 0; });
  Object.keys(lines).filter(function (kd) { return kd !== 'Money in'; }).sort(function (a, b) {
    return (a.indexOf('estimate') !== -1) - (b.indexOf('estimate') !== -1) || (a < b ? -1 : 1);
  }).forEach(function (kd) {
    sec('➖ ' + kd, items(kd)).forEach(function (v, i) { tout[i] += v; });
  });
  var net = tin.map(function (v, i) { return v + tout[i]; }), run = cash0, low = { v: Infinity, mo: '' };
  var ends = net.map(function (v, i) { run += v; if (run < low.v) low = { v: run, mo: months[i] }; return vwR(run); });
  p.rows.push(['Left over that month'].concat(net, [sumArr(net)]));
  p.rows.push(['Cash at month-end (from $' + vwR(cash0).toLocaleString('en-US') + ' today, after $' + vwR(hstHeld).toLocaleString('en-US') + ' HST kept for CRA)'].concat(ends, ['']));
  var typical = net.slice(1).sort(function (a, b) { return a - b; })[Math.floor((net.length - 1) / 2)];
  p.rows[1][0] = '👉 A typical month ' + (typical >= 0 ? 'leaves you $' : 'costs you $') + Math.abs(typical).toLocaleString('en-US') + (typical >= 0 ? ' to spare' : ' more than comes in') +
    '. Cash is lowest at ' + (low.v < 0 ? '−' : '') + '$' + Math.abs(vwR(low.v)).toLocaleString('en-US') + ' in ' + pMonthName(low.mo) + ' and ends at $' + ends[ends.length - 1].toLocaleString('en-US') + '. ➕ opens a row. Not included: house construction with no dated row, and income tax. Pay is after HST. Day-to-day = pace of the last 2 full months.';
  var e0 = p.rows.length - 2;
  vwStyle(p, e0, e0 + 2, 0, W, { bg: VW.C.NAVY, color: VW.C.WHITE, bold: true });
  vwNumFmt(p, 4, p.rows.length, 1, W, VW_CAD);
  // Money that is coming but has no dates yet (Decision "Later"): shown, not spread over months.
  var open = vwOpenBudgets(m);
  if (open.length) {
    p.rows.push([]);
    open.forEach(function (o) {
      p.rows.push(['⏸ Not in the months above — no dates yet: ' + o.name + '  ' + (o.cur === 'INR' ? '₹' : '$') +
        vwR(o.amount).toLocaleString('en-IN') + ' (≈ $' + vwR(o.cad).toLocaleString('en-US') + ')' + (o.notes ? ' · ' + o.notes : '')]);
      vwStyle(p, p.rows.length - 1, p.rows.length, 0, W, { bg: VW.C.WARN, bold: true });
    });
  }
  m.lowest = low;
  p.widths = [360].concat(months.map(function () { return 84; }), [96]);
  return p;
}


/* ---------------------------------------------------------------------------
   🩺 Health
   --------------------------------------------------------------------------- */

/** Accounts whose newest transaction is older than STALE_DAYS. */
function vwStale(m) {
  if (!m.stale) m.stale = m.d.accounts.filter(function (a) { return !m.lastData[a.name] || pDaysBetween(m.lastData[a.name], m.today) > VW.STALE_DAYS; });
  return m.stale;
}

function vwHealthChecks(m) {
  if (m.checks) return m.checks;
  var today = m.today, out = [];
  var add = function (name, ok, found, todo) { out.push({ name: name, ok: ok, found: found, todo: todo }); };

  var oldBal = m.nowInfo.banks.filter(function (b) {
    var iso = b.asOf instanceof Date ? pCellIso(b.asOf) : '';
    return iso && pDaysBetween(iso, today) > VW.STALE_DAYS;
  });
  add('1. Balances are recent', oldBal.length ? '⚠' : '✅',
    oldBal.length ? oldBal.map(function (b) { return vwShort(b.name) + ' as of ' + b.asOfText; }).join(' · ') : 'Every account has a balance from the last ' + VW.STALE_DAYS + ' days',
    oldBal.length ? 'Upload a statement or type the balance on Assets & Debts' : '—');

  var stale = vwStale(m);
  add('2. No gaps — every account has recent transactions', stale.length ? '⚠' : '✅',
    stale.length ? stale.map(function (a) { return vwShort(a.name) + ' ends ' + (m.lastData[a.name] ? vwDay(m.lastData[a.name]) : '— no data'); }).join(' · ') : 'All accounts up to the last ' + VW.STALE_DAYS + ' days',
    stale.length ? 'Download these and drop them in the Inbox (a card with no new charges can be ignored)' : '—');

  var unl = m.ev.filter(function (e) { return e.tag === 'label'; });
  add('3. Every transaction labelled', unl.length ? '⚠' : '✅',
    unl.length ? unl.length + ' without a category · $' + vwR(-unl.reduce(function (s, e) { return s + e.cad; }, 0)).toLocaleString('en-US') + ' net out' : 'All labelled',
    unl.length ? 'Money › 🔴 Needs you › 🏷 — add Payees rules (or ask Claude), then Finance › Re-label unlabelled rows' : '—');

  var od = m.ev.filter(function (e) { return (e.tag === 'overdue' && e.kind !== 'Fees & charges') || e.tag === 'check'; });
  add('4. Every bill paid on time', od.length ? '🔴' : '✅',
    od.length ? od.map(function (e) { return e.what + ' (' + e.status.replace(/^\S+\s/, '') + ')'; }).join(' · ') : 'Nothing overdue',
    od.length ? 'Pay it, or set it to Cancel / Later on Commitments' : '—');

  var up = m.unpaired || [];
  add('5. Transfers arrive — every move between your accounts seen on both sides', up.length ? '🔴' : '✅',
    up.length ? up.length + ' not matched: ' + up.slice(0, 6).map(function (e) { return vwShort(e.acct) + ' ' + vwDay(e.date) + ' $' + Math.abs(vwR(e.cad)).toLocaleString('en-US'); }).join(' · ') + (up.length > 6 ? ' …' : '')
      : 'All matched',
    up.length ? 'Money › 🔴 Needs you › ↔ — upload the missing account, or label it "Transfer - untracked account"' : '—');

  var waiting = m.cms.filter(function (c) { return !c.income && (!c.decision || /^review$/i.test(c.decision)); });
  add('6. Every commitment approved', waiting.length ? '⚠' : '✅',
    waiting.length ? waiting.length + ' waiting: ' + waiting.map(function (c) { return c.name; }).join(' · ') : 'All decided',
    waiting.length ? 'Commitments › orange rows: choose Keep, Cancel or Later' : '—');

  var late = vwTickRows(m).filter(function (t) { return /^⚠/.test(t.seen); });
  add('7. Ticked "done" but not seen in the bank after ' + VW.TICK_WAIT_DAYS + ' days', late.length ? '⚠' : '✅',
    late.length ? late.map(function (t) { return t.what; }).join(' · ') : 'None', late.length ? 'Check the payment went through; upload the statement' : '—');

  add('8. Uploads arrive', m.d.lastRun ? '✅' : '⚠', 'Last upload: ' + (m.d.lastRun || 'none recorded'), '—');
  m.checks = out;
  return out;
}



/* ---------------------------------------------------------------------------
   🏠 Home — and the ticks that wait for the bank
   --------------------------------------------------------------------------- */

/** What Home asks you to do now: each with a stable key so a tick survives rebuilds. */
function vwTodo(m) {
  if (m.todo) return m.todo;
  var out = [], soon = pAddDays(m.today, VW.SOON_DAYS);
  var byHow = function (e) { return e.how && !VW.AUTO_PAY.test(e.how) ? ' by ' + e.how : ''; };
  var money = function (e) { return (e.cur === 'INR' ? '₹' : '$') + Math.abs(vwR(e.amt)).toLocaleString('en-US'); };
  m.ev.filter(function (e) { return e.tag === 'overdue' && e.kind !== 'Fees & charges'; }).forEach(function (e) {
    var auto = VW.AUTO_PAY.test(e.how || '');
    out.push({ key: 'cm|' + e.what + '|' + e.date, what: (auto ? 'Check ' + e.what + ': the auto-debit of ' + money(e) + ' was not seen in ' + vwShort(e.acct) : 'Pay ' + e.what + ' ' + money(e) + ' from ' + vwShort(e.acct) + byHow(e)), when: '🔴 overdue since ' + vwDay(e.date), cm: e.what });
  });
  m.moves.forEach(function (mv) {
    var abroad = m.curOf(mv.to) !== m.curOf(mv.from);
    out.push({ key: 'mv|' + mv.to, what: 'Move about $' + vwR(mv.cad).toLocaleString('en-US') + ' ' + vwShort(mv.from) + ' → ' + vwShort(mv.to) +
      (abroad ? ' by Remitly (it takes a few days)' : ' by e-Transfer'), when: mv.by ? 'by ' + vwDay(mv.by) : 'soon' });
  });
  // Bank fees and charges on a card take themselves; only what you pay by hand is listed.
  var cards = {}; m.d.accounts.forEach(function (a) { if (a.card) cards[a.name] = 1; });
  m.ev.filter(function (e) { return e.tag === 'planned' && e.dir === 'Out' && e.date <= soon && !e.exKey && !cards[e.acct] && e.kind !== 'Fees & charges' && !VW.AUTO_PAY.test(e.how || ''); }).sort(function (a, b) { return a.date < b.date ? -1 : 1; }).forEach(function (e) {
    out.push({ key: 'cm|' + e.what + '|' + e.date, what: 'Pay ' + e.what + ' ' + money(e) + ' from ' + vwShort(e.acct) + byHow(e), when: vwDay(e.date), cm: e.what });
  });
  m.ev.filter(function (e) { return e.exKey && e.tag === 'planned' && e.date <= soon; }).forEach(function (e) {
    out.push({ key: 'ex|' + e.exKey, what: 'Pay ' + e.what + ' ' + money(e) + ' from ' + vwShort(e.acct) + ' (you approved it)', when: vwDay(e.date) });
  });
  // Card payments (pay-down before the statement closes, statement before the due date).
  m.ev.filter(function (e) { return e.cardPay && e.date <= soon; }).sort(function (a, b) { return a.date < b.date ? -1 : 1; }).forEach(function (e) {
    out.push({ key: 'cd|' + e.what + '|' + e.date, what: e.what + ' ' + money(e) + ' from ' + vwShort(e.acct) + byHow(e) + (/^Pay down/.test(e.what) ? ' — keeps the reported balance under target' : ''), when: 'by ' + vwDay(e.date), cm: e.cmName });
  });
  var waiting = m.cms.filter(function (c) { return !c.income && (!c.decision || /^review$/i.test(c.decision)); }).length;
  if (waiting) out.push({ key: 'ex|review', what: 'Decide on Commitments (Keep, Cancel or Later): ' + m.cms.filter(function (c) { return !c.income && (!c.decision || /^review$/i.test(c.decision)); }).map(function (c) { return c.name; }).join(', '), when: 'this week' });
  if (vwStale(m).length) out.push({ key: 'st|upload', what: 'Upload statements: ' + m.stale.map(function (a) { return vwShort(a.name); }).join(', '), when: 'pay night' });
  m.todo = out;
  return out;
}

/** Ticks: read from the old Home tab, kept in script properties, checked against the bank. */
function vwTickRows(m) {
  if (m.tickRows) return m.tickRows;
  var store = m.d.ticks || {}, today = m.today, todo = vwTodo(m), keys = {};
  todo.forEach(function (t) { keys[t.key] = t; });
  (m.d.todayRows || []).map(function (r) { return [r[0], r[1], r[7]]; }).forEach(function (r) {
    var key = String(r[2] || '');
    if (!key || key === 'key') return;
    if (r[0] === true && (!store[key] || store[key].verified)) store[key] = { on: today, what: String(r[1] || '') };
    if (r[0] === false && store[key] && !store[key].verified) delete store[key];
  });
  var rows = [];
  todo.forEach(function (t) {
    var s = store[t.key];
    if (s && s.verified) { delete store[t.key]; s = null; }   // due again: a new round
    var wait = s ? pDaysBetween(s.on, today) : 0;
    rows.push({ key: t.key, what: t.what, when: t.when, ticked: !!s,
      seen: s && wait >= VW.TICK_WAIT_DAYS ? '⚠ Ticked ' + wait + ' days ago, not in the bank yet — check' : 'Not yet' });
  });
  Object.keys(store).forEach(function (k) {
    if (keys[k]) return;
    var s = store[k];
    if (!s.verified) s.verified = today;
    if (pDaysBetween(s.verified, today) > VW.VERIFIED_KEEP_DAYS) { delete store[k]; return; }
    rows.push({ key: k, what: s.what, when: 'done', ticked: true, seen: '✅ Verified ' + vwDay(s.verified) + ' — ' + vwProof(m, k) });
  });
  m.ticksOut = store;
  m.tickRows = rows;
  return rows;
}

function vwProof(m, key) {
  var name = key.split('|')[1];
  if (/^cm\|/.test(key)) {
    var c = (m.cms || []).filter(function (x) { return x.name === name; })[0];
    var st = c ? String(m.d.cm[c.row - 2][19] || '') : '';
    if (/^✅/.test(st)) return st.replace(/^✅\s*/, '').split(' · ')[0] + ' in the bank';
  }
  if (/^mv\|/.test(key)) return 'the account is no longer short';
  if (/^ex\|review/.test(key)) return 'all decided';
  if (/^ex\|/.test(key)) return 'the payment shows in the bank';
  if (/^st\|/.test(key)) return 'statements are up to date';
  return 'no longer due';
}



/* ---------------------------------------------------------------------------
   🏠 Today — the one page to open: am I OK, what do I do, what happens in each account
   --------------------------------------------------------------------------- */

var VW_TONE = { good: '#1e8e3e', warn: '#e37400', bad: '#c5221f' };

function vwTodayPage(m) {
  var p = vwPage(VW.TODAY, '🏠 Today · ' + vwDay(m.today),
    'Updated ' + vwStamp() + ' — worked out for you from your statements, balances and lists. Tick ✔ when you have done something. Click ➕ on the far left to open a row.');
  var C = VW.C, W = 7, soon = pAddDays(m.today, PG.MOVE_DAYS), later = pAddDays(m.today, VW.NEXT_DAYS);
  var rate = function (cur) { return m.rate[cur] || 1; };
  var money = function (v, cur) { return (v < 0 ? '−' : '') + (cur === 'INR' ? '₹' : '$') + Math.abs(vwR(v)).toLocaleString(cur === 'INR' ? 'en-IN' : 'en-US'); };
  var band = function (text, bg, color) {
    var r = p.rows.length; p.rows.push([text]); p.merges.push([r, 0, 1, W]);
    vwStyle(p, r, r + 1, 0, W, { bg: bg || C.SECTION, color: color || C.WHITE, bold: true, size: 12 }); p.heights[r] = 30;
    return r;
  };
  var head = function (cells) { var r = p.rows.length; p.rows.push(cells); vwStyle(p, r, r + 1, 0, W, { bg: C.LIGHT, bold: true, color: C.NAVY }); return r; };
  var statusRule = function (r0, r1, c) {
    [['✅', C.GOOD], ['⚠', C.WARN], ['🔴', C.BAD], ['🟡', C.WARN], ['⏳', C.SUB]].forEach(function (x) {
      p.rules.push({ r0: r0, r1: r1, c: c, starts: x[0], bg: x[1] });
    });
  };

  // ---- 1. Am I OK? ----------------------------------------------------------------
  var todo = vwTickRows(m), checks = vwHealthChecks(m);
  var overdue = m.ev.filter(function (e) { return e.tag === 'overdue' && e.kind !== 'Fees & charges'; }).length;
  var open = todo.filter(function (t) { return !t.ticked && !/^✅/.test(t.seen); }).length;
  var bad = checks.filter(function (c) { return c.ok !== '✅'; }).length;
  var parts = [];
  if (overdue) parts.push('🔴 ' + overdue + ' overdue');
  if (m.moves.length) parts.push('💸 ' + m.moves.length + ' money move' + (m.moves.length > 1 ? 's' : ''));
  if (open) parts.push('👉 ' + open + ' to do');
  var unapproved = m.cms.filter(function (c) { return !c.income && (!c.decision || /^review$/i.test(c.decision)); }).length;
  if (unapproved) parts.push('🟠 ' + unapproved + ' commitment' + (unapproved > 1 ? 's' : '') + ' to approve');
  if (bad) parts.push('🩺 ' + bad + ' check' + (bad > 1 ? 's' : '') + ' to look at');
  var tone = overdue ? 'bad' : (open || bad || unapproved) ? 'warn' : 'good';
  var r = p.rows.length;
  p.rows.push([tone === 'good' ? '✅  All good — nothing needs you today' : (tone === 'bad' ? '🔴  ' : '⚠  ') + 'Needs you:   ' + parts.join('    ·    ')]);
  p.merges.push([r, 0, 1, W]); p.heights[r] = 44;
  vwStyle(p, r, r + 1, 0, W, { bg: VW_TONE[tone], color: C.WHITE, bold: true, size: 14 });
  p.rows.push([]);

  // ---- 2. How much do I have? (four tiles) -------------------------------------------
  var banks = m.nowInfo.banks.map(function (b) { return vwTodayAccount(m, b, soon); });
  // The Now tab's total, so every page shows the same cash to the dollar (rupees converted once).
  var cashCad = m.nowInfo.cash !== null ? m.nowInfo.cash : banks.reduce(function (s, a) { return s + (a.bal || 0) * rate(a.cur); }, 0);
  var afterCad = banks.reduce(function (s, a) { return s + (a.after || 0) * rate(a.cur); }, 0);
  var owedCad = (m.d.cards || []).reduce(function (s, c) { return s + Math.max(0, c.owedCad); }, 0);
  var low = m.lowest && m.lowest.mo ? m.lowest : null;
  var t0 = p.rows.length;
  p.rows.push(['', 'Cash in your accounts', 'After the next 14 days', '', 'Owed on cards', '', 'Lowest point ahead']);
  p.rows.push(['', cashCad, afterCad, '', owedCad, '', low ? low.v : '']);
  p.rows.push(['', 'in ' + banks.length + ' accounts, today', 'after every bill, card bill and money move due by ' + vwDay(soon), '',
    (m.d.cards || []).filter(function (c) { return c.owedCad > 0; }).length + ' cards — paid from your accounts', '', low ? 'in ' + pMonthName(low.mo) + ' (12-month forecast)' : '']);
  [[t0, 2], [t0 + 1, 2], [t0 + 2, 2], [t0, 4], [t0 + 1, 4], [t0 + 2, 4]].forEach(function (x) { p.merges.push([x[0], x[1], 1, 2]); });
  vwStyle(p, t0, t0 + 3, 1, W, { bg: C.SUB });
  vwStyle(p, t0, t0 + 1, 1, W, { color: C.GREY, bold: true });
  vwStyle(p, t0 + 1, t0 + 2, 1, W, { size: 20, bold: true, color: C.NAVY });
  vwStyle(p, t0 + 2, t0 + 3, 1, W, { color: C.GREY, size: 9 });
  vwNumFmt(p, t0 + 1, t0 + 2, 1, W, VW_CAD);
  p.heights[t0 + 1] = 46;
  if (afterCad < 0) vwStyle(p, t0 + 1, t0 + 2, 2, 4, { color: VW_TONE.bad });
  p.rows.push([]);

  // ---- 3. What do I do? -------------------------------------------------------------
  band('👉  DO NOW — tick ✔ when done. It stays 🟡 until the bank shows it, then turns ✅');
  head(['✔', 'What to do', 'By', 'Seen in the bank? (automatic)', '', '', 'Status', 'key']);
  var d0 = p.rows.length;
  if (!todo.length) { p.rows.push(['', '🎉 Nothing to do right now']); vwStyle(p, d0, d0 + 1, 1, 2, { color: VW_TONE.good, bold: true }); }
  todo.forEach(function (t) {
    var row = p.rows.length, n = row + 1;
    p.rows.push([t.ticked, vwSafe(t.what), vwTxt(t.when), t.seen, '', '',
      '=IF(LEFT(D' + n + ',1)="✅",D' + n + ',IF(LEFT(D' + n + ',1)="⚠",D' + n + ',IF(A' + n + ',"🟡 Done — waiting for the bank","⏳ To do")))', t.key]);
    p.merges.push([row, 3, 1, 3]);
    if (/overdue/.test(t.when)) vwStyle(p, row, row + 1, 2, 3, { color: VW_TONE.bad, bold: true });
  });
  if (todo.length) { p.checks.push({ r0: d0, r1: p.rows.length, c: 0 }); statusRule(d0, p.rows.length, 6); }
  vwStyle(p, d0, p.rows.length, 3, 6, { color: C.GREY });
  p.rows.push([]);

  // ---- 4. Each account, the next 14 days ----------------------------------------------
  band('💰  YOUR ACCOUNTS — the next 14 days, account by account (➕ shows every payment)');
  head(['', 'Account', 'Now', '+ Coming in', '− Going out', 'After 14 days', 'What it means']);
  var a0 = p.rows.length;
  banks.forEach(function (a) {
    var fmt = a.cur === 'INR' ? VW_INR : VW_CAD;
    var row = p.rows.length;
    p.rows.push(['', '🏦  ' + a.name, a.bal === null ? '' : a.bal, a.inTotal, -a.outTotal, a.after === null ? '' : a.after, a.status]);
    vwStyle(p, row, row + 1, 1, W, { bold: true }); vwNumFmt(p, row, row + 1, 2, 6, fmt); p.heights[row] = 28;
    var s = p.rows.length;
    a.lines.forEach(function (l) {
      var lr = p.rows.length;
      p.rows.push(['', '      ' + l.text, '', l.amt > 0 ? l.amt : '', l.amt < 0 ? l.amt : '', '', l.note || '']);
      vwNumFmt(p, lr, lr + 1, 3, 5, l.cur === 'INR' ? VW_INR : VW_CAD);
      vwStyle(p, lr, lr + 1, 1, W, { color: l.red ? VW_TONE.bad : '#3c4043' });
      vwStyle(p, lr, lr + 1, 6, 7, { color: C.GREY });
      if (l.card) vwStyle(p, lr, lr + 1, 1, 2, { bold: true });
      if (l.sub && l.sub.length) {
        var ss = p.rows.length;
        l.sub.forEach(function (x) {
          var xr = p.rows.length;
          p.rows.push(['', '            ' + x.text, '', '', '', '', x.note || '']);
          vwStyle(p, xr, xr + 1, 1, W, { color: C.GREY, italic: true });
        });
        p.groups.push([ss, p.rows.length]);
      }
    });
    if (!a.lines.length) { p.rows.push(['', '      Nothing in or out in the next 14 days']); vwStyle(p, p.rows.length - 1, p.rows.length, 1, 2, { color: C.GREY, italic: true }); }
    p.groups.push([s, p.rows.length]);
  });
  var tr = p.rows.length;
  p.rows.push(['', 'All accounts, in CAD', cashCad, banks.reduce(function (s, a) { return s + a.inTotal * rate(a.cur); }, 0),
    -banks.reduce(function (s, a) { return s + a.outTotal * rate(a.cur); }, 0), afterCad, 'Money moves between your accounts cancel out here']);
  vwStyle(p, tr, tr + 1, 1, W, { bg: C.NAVY, color: C.WHITE, bold: true }); vwNumFmt(p, tr, tr + 1, 2, 6, VW_CAD);
  statusRule(a0, tr, 6);
  p.rows.push([]);

  // ---- 5. Cards ------------------------------------------------------------------------
  band('💳  CARDS — what you owe, and which account pays it');
  head(['', 'Card', 'Owed now', 'Paid from', '', '', 'Note']);
  var c0 = p.rows.length;
  vwTodayCards(m).forEach(function (c) {
    var row = p.rows.length;
    p.rows.push(['', '💳  ' + c.name, c.owed, vwShort(c.payFrom || '—'), '', '', c.note]);
    p.merges.push([row, 3, 1, 3]);
    vwNumFmt(p, row, row + 1, 2, 3, c.cur === 'INR' ? VW_INR : VW_CAD);
    vwStyle(p, row, row + 1, 6, 7, { color: C.GREY });
  });
  if (p.rows.length === c0) p.rows.push(['', 'No card balances known yet — type them on Assets & Debts']);
  p.rows.push([]);

  // ---- 6. Health (folded) ----------------------------------------------------------------
  band('🩺  CAN YOU TRUST THESE NUMBERS?   ' + (bad ? '⚠ ' + bad + ' of ' + checks.length + ' checks need a look — ➕ to open' : '✅ all ' + checks.length + ' checks pass'),
    bad ? '#fde7c4' : C.GOOD, '#202124');
  var h0 = p.rows.length;
  checks.forEach(function (c) {
    var row = p.rows.length;
    p.rows.push(['', c.name, c.ok, c.found, '', '', c.todo === '—' ? '' : c.todo]);
    p.merges.push([row, 3, 1, 3]);
    vwStyle(p, row, row + 1, 3, W, { color: '#3c4043' });
  });
  statusRule(h0, p.rows.length, 2);
  p.groups.push([h0, p.rows.length]);
  p.rows.push([]);

  // ---- 7. Coming up after the 14 days (folded) ---------------------------------------------
  var next = m.ev.filter(function (e) { return !e.past && e.tag === 'planned' && e.date > soon && e.date <= later; })
    .sort(function (a, b) { return a.date < b.date ? -1 : 1; });
  var nextIn = next.reduce(function (t, e) { return t + Math.max(0, e.cad); }, 0), nextOut = next.reduce(function (t, e) { return t + Math.min(0, e.cad); }, 0);
  band('📅  COMING UP — ' + vwDay(pAddDays(soon, 1)) + ' to ' + vwDay(later) + '  ·  ' + next.length + ' items  ·  in ' + vwMoneyCad(nextIn) + '  ·  out ' + vwMoneyCad(nextOut) + ' (➕ to open)', C.LIGHT, C.NAVY);
  var u0 = p.rows.length;
  next.forEach(function (e) {
    var row = p.rows.length;
    p.rows.push(['', '      ' + vwDay(e.date) + '  ·  ' + vwSafe(e.what), '', e.amt > 0 ? e.amt : '', e.amt < 0 ? e.amt : '', '', vwShort(e.acct) + (e.how ? ' · ' + e.how : '')]);
    vwNumFmt(p, row, row + 1, 3, 5, vwLocalFmt(e.cur).replace('.00', ''));
    vwStyle(p, row, row + 1, 6, 7, { color: C.GREY });
  });
  if (next.length) p.groups.push([u0, p.rows.length]);
  p.rows.push([]);

  // ---- 8. How to read this page (folded) ------------------------------------------------------
  band('ℹ️  How this page works (➕)', C.SUB, C.GREY);
  var i0 = p.rows.length;
  ['Balances: the last statement or the balance you typed on Assets & Debts (the newer wins), plus every transaction since.',
   'Going out: payments due in the next 14 days from Commitments, card bills (what you owe now plus new charges), and HST kept for CRA.',
   'Money moves: when an account would go below zero, the account with the most to spare is asked to send the difference before the first payment.',
   'Auto-debits and card charges take themselves — Do now only lists what you must do by hand. A tick waits for the bank before it says ✅.',
   'Blue tabs are facts (locked). Yellow tabs are yours: Commitments, Assets & Debts, Payees.'
  ].forEach(function (t) { p.rows.push(['', t]); p.merges.push([p.rows.length - 1, 1, 1, W - 1]); });
  vwStyle(p, i0, p.rows.length, 1, W, { color: '#3c4043' });
  p.groups.push([i0, p.rows.length]);

  p.widths = [40, 400, 120, 120, 120, 120, 300];   // H (key) hidden
  return p;
}

/** One account's next 14 days: every line in and out, card bills with what is on the card. */
function vwTodayAccount(m, b, soon) {
  var cur = m.curOf(b.name), rate = m.rate[cur] || 1, lines = [];
  var due = function (e) { return !e.past && (e.tag === 'planned' || e.tag === 'overdue') && e.date <= soon && e.dir !== 'Move'; };
  var howOf = function (e) { return e.how ? e.how : ''; };
  m.moves.filter(function (mv) { return mv.to === b.name; }).forEach(function (mv) {
    lines.push({ text: '⬅  Move in from ' + vwShort(mv.from) + (mv.by ? ' — by ' + vwDay(mv.by) : ''), amt: mv.cad / rate, cur: cur, note: 'you do this (see Do now)' });
  });
  m.ev.filter(function (e) { return due(e) && e.acct === b.name; }).sort(function (x, y) { return x.date < y.date ? -1 : 1; }).forEach(function (e) {
    lines.push({ text: (e.tag === 'overdue' ? '🔴 overdue since ' : '') + vwDay(e.date) + '  ·  ' + vwSafe(e.what), amt: e.amt, cur: e.cur,
      note: howOf(e) || (e.dir === 'In' ? 'coming in' : ''), red: e.tag === 'overdue' });
  });
  if (b.hst > 0) lines.push({ text: '🧾  Keep aside for CRA (HST you collected)', amt: -b.hst, cur: cur, note: 'not yours — filed once a year' });
  vwTodayCards(m).filter(function (c) { return c.payFrom === b.name; }).forEach(function (c) {
    var charges = m.ev.filter(function (e) { return due(e) && e.acct === c.name && e.dir === 'Out'; })
      .sort(function (x, y) { return x.date < y.date ? -1 : 1; });
    var newOnCard = charges.reduce(function (s, e) { return s + e.amt; }, 0);   // card currency, negative
    var total = (-c.owed + newOnCard) * (m.rate[c.cur] || 1) / rate;
    if (!total) return;
    var sub = [{ text: 'Owed today: ' + (c.cur === 'INR' ? '₹' : '$') + vwR(c.owed).toLocaleString('en-US'), note: c.note }];
    charges.forEach(function (e) { sub.push({ text: vwDay(e.date) + '  ·  ' + e.what + '  ' + (e.cur === 'INR' ? '₹' : '$') + Math.abs(vwR(e.amt)).toLocaleString('en-US'), note: 'charged to the card' }); });
    lines.push({ text: '💳  ' + vwShort(c.name) + ' card bill', amt: total, cur: cur, note: 'owed now + new charges (➕)', card: true, sub: sub });
  });
  m.moves.filter(function (mv) { return mv.from === b.name; }).forEach(function (mv) {
    lines.push({ text: '➡  Send to ' + vwShort(mv.to) + (mv.by ? ' — by ' + vwDay(mv.by) : ''), amt: -mv.cad / rate, cur: cur, note: 'you do this (see Do now)' });
  });
  // Lines in another currency (an INR card bill on an INR account is fine) are converted for the totals.
  var inT = 0, outT = 0;
  lines.forEach(function (l) {
    var v = l.cur === cur ? l.amt : l.amt * (m.rate[l.cur] || 1) / rate;
    if (v > 0) inT += v; else outT -= v;
  });
  var after = b.bal === null ? null : b.bal + inT - outT;
  var status = after === null ? '✍ Type a balance on Assets & Debts'
    : after * rate < -2 ? '⚠ Short ' + (cur === 'INR' ? '₹' : '$') + vwR(-after).toLocaleString('en-US') + ' — move money in'
    : m.moves.some(function (mv) { return mv.to === b.name; }) ? '✅ OK once the move arrives'
    : '✅ OK — ' + (cur === 'INR' ? '₹' : '$') + vwR(after).toLocaleString('en-US') + ' left';
  return { name: b.name, cur: cur, bal: b.bal, inTotal: inT, outTotal: outT, after: after, status: status, lines: lines };
}

/** Cards with what is owed (Dashboard, which follows a typed balance) and the account that pays them. */
function vwTodayCards(m) {
  if (m.cardsOut) return m.cardsOut;
  var payFrom = {};
  pgAccounts().cards.forEach(function (c) { payFrom[c.name] = c.payFrom; });
  var note = {};
  (m.d.adRows || []).forEach(function (r) { if (r[0]) note[String(r[0])] = String(r[7] || ''); });   // H = notes
  m.cardsOut = (m.d.cards || []).map(function (c) {
    var cur = m.curOf(c.name);
    return { name: c.name, cur: cur, owed: c.owedCad / (m.rate[cur] || 1), payFrom: payFrom[c.name] || '',
             note: (note[c.name] || 'Pay the statement in full by its due date').replace(/^You, \d+ \w+:?\s*/, '') };
  });
  return m.cardsOut;
}

/* ---------------------------------------------------------------------------
   📅 The plan for every commitment — when to pay, and why (Commitments column AE)
   --------------------------------------------------------------------------- */

// Days before the due date to act, by how it is paid (so the money lands in time).
var VW_LEAD = { 'e-transfer': 2, 'bill payment': 3, 'remitly': 4, 'cheque': 5, 'upi / phonepe': 0, 'cash': 0, 'auto-debit': 1, 'card': 0 };
function vwLeadFor(how) { var k = String(how || '').toLowerCase(); return VW_LEAD[k] !== undefined ? VW_LEAD[k] : 1; }

/** A Commitments row that is a credit card's own plan (category Creditcard, or a limit in AF). */
function vwIsCardRow(c, r) { return /^creditcard$/i.test(c.cat) || vwNum(r[PLAN.CARD_COL - 1]) > 0; }

/** The card a card row is about: the card whose first word (Neo, HDFC, CIBC) is in the row's name. */
function vwCardFor(m, name) {
  return vwTodayCards(m).filter(function (k) {
    var w = k.name.split(' ')[0];
    return new RegExp('\\b' + w + '\\b', 'i').test(name) || (/regalia/i.test(k.name) && /regalia/i.test(name));
  })[0] || null;
}

/**
 * A card's two payments a cycle:
 *   ① before the statement closes — pay down so the closing balance (what the credit bureau is
 *      told) stays under the target share of the limit;
 *   ② before the due date — pay the full statement, so no interest.
 * Amounts in the card's money. Steps with an amount become planned events (Today's to-do list).
 */
function vwCardPlan(m, c, r) {
  var card = vwCardFor(m, c.name);
  if (!card) return null;
  var today = m.today, ym = today.slice(0, 7), lead = vwLeadFor(r[PLAN.HOW_COL - 1] || 'Bill payment');
  var limit = vwNum(r[PLAN.CARD_COL - 1]), close = parseInt(r[PLAN.CARD_COL], 10) || 0;
  var target = vwNum(r[PLAN.CARD_COL + 1]) || 0.2; if (target > 1) target = target / 100;
  var dueDay = parseInt(c.due, 10) || 0;
  var sym = card.cur === 'INR' ? '₹' : '$';
  var money = function (v) { return sym + Math.round(v).toLocaleString(card.cur === 'INR' ? 'en-IN' : 'en-US'); };
  var dayIn = function (y, d) { return y + '-' + ('0' + Math.min(d, pLastDay(y))).slice(-2); };
  var payBy = function (d) { var x = pAddDays(d, -lead); return x < today ? today : x; };
  var dueAfter = function (s) { var d = dayIn(s.slice(0, 7), dueDay); return d > s ? d : dayIn(pMonthAdd(s.slice(0, 7), 1), dueDay); };
  var out = { card: card, steps: [], text: [] };
  if (!close || !dueDay) {
    out.text.push('Add the card limit (AF) and the day its statement closes (AG) to plan the payments');
    return out;
  }
  var thisClose = dayIn(ym, close);
  var prevClose = thisClose <= today ? thisClose : dayIn(pMonthAdd(ym, -1), close);
  var nextClose = thisClose > today ? thisClose : dayIn(pMonthAdd(ym, 1), close);
  // Card balance now (typed balance + later charges), plus charges planned on the card before the close.
  var future = m.ev.filter(function (e) { return !e.past && e.acct === card.name && e.dir === 'Out' && e.date > today && e.date <= nextClose; })
    .reduce(function (s, e) { return s - e.amt; }, 0);
  var atClose = card.owed + future, cap = target * limit;

  // A statement that has closed and is not due yet comes first.
  var due1 = dueAfter(prevClose);
  if (due1 >= today) {
    var since = m.ev.filter(function (e) { return e.past && e.acct === card.name && e.date > prevClose; })
      .reduce(function (s, e) { return s + e.amt; }, 0);
    var stmt = Math.max(0, card.owed + since);
    out.steps.push({ date: payBy(due1), amt: stmt, kind: 'statement',
      text: '② Pay the full statement (about ' + money(stmt) + ') by ' + vwDay(payBy(due1)) + ' — due ' + vwDay(due1) + ', so no interest' });
  }
  if (limit) {
    var pay1 = Math.max(0, atClose - cap);
    out.steps.push({ date: payBy(nextClose), amt: pay1, kind: 'paydown',
      text: pay1 > 1
        ? '① Pay down ' + money(pay1) + ' by ' + vwDay(payBy(nextClose)) + ' — the balance on ' + vwDay(nextClose) + ' is reported to the credit bureau; keep it under ' + money(cap) + ' (' + Math.round(target * 100) + '% of ' + money(limit) + ')'
        : '① No pay-down needed before ' + vwDay(nextClose) + ' — about ' + money(atClose) + ' will be reported, under ' + money(cap) + ' (' + Math.round(target * 100) + '%)' });
  }
  if (due1 < today) {
    var due2 = dueAfter(nextClose), stmt2 = limit ? Math.min(atClose, cap) : atClose;
    out.steps.push({ date: payBy(due2), amt: 0, kind: 'statement',   // not yet known: no to-do item until the statement exists
      text: '② Then pay that statement in full (about ' + money(stmt2) + ') by ' + vwDay(payBy(due2)) + ' — due ' + vwDay(due2) });
  }
  out.steps.sort(function (a, b) { return a.date < b.date ? -1 : 1; });
  out.text = out.steps.map(function (s) { return s.text; });
  return out;
}

/** Card payments as planned events: Today's to-do list and the Ledger. Never counted as spending (dir Move). */
function vwCardEvents(m) {
  (m.cardRows || []).forEach(function (x) {
    if (/^(cancel|later)$/i.test(x.c.decision)) return;
    var plan = vwCardPlan(m, x.c, x.r);
    x.plan = plan;
    if (!plan) return;
    var payer = m.fullAcct(x.c.acct) || plan.card.payFrom;
    var how = String(x.r[PLAN.HOW_COL - 1] || 'Bill payment');
    plan.steps.forEach(function (s) {
      if (!(s.amt > 1)) return;
      var cad = s.amt * (m.rate[plan.card.cur] || 1);
      m.ev.push({ date: s.date, what: (s.kind === 'paydown' ? 'Pay down ' : 'Pay the statement of ') + vwShort(plan.card.name),
        acct: payer, amt: -s.amt, cur: plan.card.cur, cad: -cad, catg: 'Creditcard', kind: VW.MOVED, past: false, dir: 'Move',
        status: '🗓 Planned — ' + (s.kind === 'paydown' ? 'keeps the reported balance under target' : 'statement in full, no interest'),
        tag: 'planned', cardPay: true, how: how, cmName: x.c.name, source: 'Card plan · ' + s.text });
    });
  });
}

/** Column AE text for one commitment row. */
function vwCommitPlan(m, c, r, cardPlan) {
  var dec = String(c.decision || ''), how = String(r[PLAN.HOW_COL - 1] || '').trim();
  var pre = (!dec || /^review$/i.test(dec)) ? '🟠 Not approved yet — choose Keep (it must happen) or Cancel. ' : '';
  if (/^cancel$/i.test(dec)) return '✂ Cancelled — nothing to pay. ' + (/^⚠/.test(String(r[19])) ? '⚠ It charged again: dispute it.' : 'Watch that it does not charge again.');
  if (/^later$/i.test(dec)) return '⏸ Parked — not planned, not counted.';
  if (cardPlan) return pre + cardPlan.text.join('\n');
  var evs = m.ev.filter(function (e) { return !e.past && e.cmName === c.name && !e.cardPay && (e.tag === 'planned' || e.tag === 'overdue'); })
    .sort(function (a, b) { return a.date < b.date ? -1 : 1; });
  if (!evs.length) return pre + (/^❔/.test(String(r[19])) ? '❔ ' + String(r[19]).replace(/^❔\s*/, '') + ' — upload a newer statement.' : 'Nothing due in the next 12 months.');
  var e = evs[0], next = evs[1] ? '  ·  then ' + vwDay(evs[1].date) + (evs[2] ? ', ' + vwDay(evs[2].date) : '') : '';
  var amt = (e.cur === 'INR' ? '₹' : '$') + Math.abs(vwR(e.amt)).toLocaleString(e.cur === 'INR' ? 'en-IN' : 'en-US');
  var acct = vwShort(e.acct);
  if (e.dir === 'In') return pre + 'Comes in ' + vwDay(e.date) + ' into ' + acct + ' (' + (how || 'deposit') + ')' + next;
  if (e.tag === 'overdue') return pre + '🔴 Overdue since ' + vwDay(e.date) + ' — pay ' + amt + ' from ' + acct + ' now' + (how ? ' (' + how + ')' : '') + next;
  var cover = vwCover(m, e.acct);
  if (m.d.accounts.some(function (a) { return a.card && a.name === e.acct; }))
    return pre + 'Charged to ' + acct + ' on ' + vwDay(e.date) + ' (' + amt + ') → paid with that card\'s bill' + next;
  if (/^auto-debit|^bank fee/i.test(how))
    return pre + 'Auto-debit ' + vwDay(e.date) + ' from ' + acct + ' → keep ' + amt + ' there by ' + vwDay(pAddDays(e.date, -1)) + '  ' + cover + next;
  var by = pAddDays(e.date, -vwLeadFor(how));
  if (by < m.today) by = m.today;
  return pre + 'Send ' + amt + ' from ' + acct + ' by ' + vwDay(by) + (how ? ' (' + how + ')' : '') + ' so it lands by ' + vwDay(e.date) + '  ' + cover + next;
}

/** "✅ covered" / "⚠ RBC short — move money in" for the account a payment comes out of (Today's numbers). */
function vwCover(m, acct) {
  if (!m.coverOf) {
    m.coverOf = {};
    m.nowInfo.banks.forEach(function (b) { m.coverOf[b.name] = vwTodayAccount(m, b, pAddDays(m.today, PG.MOVE_DAYS)).status; });
  }
  var s = m.coverOf[acct];
  if (!s) return '';
  if (/once the move/.test(s)) return '✅ covered once the move into ' + vwShort(acct) + ' arrives';
  return /^✅/.test(s) ? '✅ money is there' : s;
}

/** Write column AE on Commitments (only when something changed, so it does not trigger another rebuild). */
function vwWritePlans(ss, m) {
  var sh = getTab(ss, PLAN.TAB_COMMIT);
  if (!sh || sh.getLastRow() < 2) return;
  var n = sh.getLastRow() - 1, col = PLAN.PLAN_COL;
  if (sh.getMaxColumns() < col) return;
  var cards = {};
  (m.cardRows || []).forEach(function (x) { cards[x.c.row] = x.plan || vwCardPlan(m, x.c, x.r); });
  var want = [];
  for (var i = 0; i < n; i++) want.push(['']);
  m.cms.forEach(function (c) {
    var r = m.d.cm[c.row - 2];
    if (c.row - 2 < n) want[c.row - 2] = [vwCommitPlan(m, c, r, cards[c.row] || null)];
  });
  var rg = sh.getRange(2, col, n, 1), have = rg.getValues();
  if (JSON.stringify(have) !== JSON.stringify(want)) rg.setValues(want);
}

/* ---------------------------------------------------------------------------
   Assets & Debts › Amount invested — worked out from your transactions
   --------------------------------------------------------------------------- */

/**
 * What you have put into an asset so far, in that row's own currency:
 *   Wealthsimple …   every transfer to Wealthsimple (category Investment)
 *   Gold / jewellery every purchase in a gold / jewellery category
 *   the house        every house-construction payment (row class Property)
 * Other rows keep whatever you typed. Written only when the number changed.
 */
function vwWriteInvested(ss, m) {
  var sh = getTab(ss, BS.TAB_INPUT);
  if (!sh || sh.getLastRow() < 2) return;
  var n = sh.getLastRow() - 1, rows = sh.getRange(2, 1, n, 6).getValues();
  var sum = function (test, cur) {
    return m.ev.filter(function (e) { return e.past && e.cad < 0 && test(e); }).reduce(function (s, e) {
      return s + (e.cur === cur ? -e.amt : -e.cad / (m.rate[cur] || 1));
    }, 0);
  };
  rows.forEach(function (r, i) {
    var name = String(r[0] || ''), cls = String(r[2] || ''), cur = String(r[3] || 'CAD') || 'CAD', v = null;
    if (/wealthsimple/i.test(name)) {
      if (rows.filter(function (x) { return /wealthsimple/i.test(String(x[0])); }).length > 1) return;   // per account: typed from the app
      v = sum(function (e) { return /wealthsimple/i.test(e.source + ' ' + e.what) && e.kind === 'Saved / invested'; }, cur);
    }
    else if (/gold|jewel/i.test(name)) v = sum(function (e) { return /gold|jewel/i.test(e.catg); }, cur);
    else if (cls === 'Real estate' || name === BS.HOUSE) v = sum(function (e) { return m.isHouse(e); }, cur);
    if (v === null) return;
    v = Math.round(v * 100) / 100;
    if (Number(r[5]) !== v) sh.getRange(i + 2, 6).setValue(v);
    if (!sh.getRange(i + 2, 6).getNote()) sh.getRange(i + 2, 6).setNote('Automatic — the sum of these payments in your transactions.');
  });
  vwAssetTitleValues(ss);
}

/** Section titles on Assets & Debts show their total as a plain number: J reads E, so a formula would be circular. */
function vwAssetTitleValues(ss) {
  var sh = getTab(ss, BS.TAB_INPUT);
  if (!sh || sh.getLastRow() < 2) return;
  var n = sh.getLastRow() - 1, a = sh.getRange(2, 1, n, 2).getValues(), k = sh.getRange(2, 11, n, 1).getValues();
  a.forEach(function (r, i) {
    if (String(r[0]).trim() || !String(r[1]).trim() || typeof k[i][0] !== 'number') return;
    sh.getRange(i + 2, 5).setValue(k[i][0]).setNumberFormat('$#,##0');
  });
}

/**
 * India ATM cash has two jobs: the parents' household (the first m.parentsCash rupees a month,
 * from the Categories tab) and paying workers at the house (the rest). The raw rows stay as they
 * are; the pages see a withdrawal split into "Parents household (cash)" and house labour.
 */
function vwSplitIndiaCash(m) {
  if (!(m.parentsCash > 0)) return;
  var cash = m.ev.filter(function (e) { return e.past && e.catg === 'Cash' && e.cur === 'INR' && e.amt < 0; })
    .sort(function (a, b) { return a.date < b.date ? -1 : 1; });
  var left = {}, add = [];
  cash.forEach(function (e) {
    var mo = e.date.slice(0, 7);
    if (left[mo] === undefined) left[mo] = m.parentsCash;
    var parents = Math.min(-e.amt, left[mo]), house = -e.amt - parents, k = e.cad / e.amt;
    left[mo] -= parents;
    if (house > 0) {
      var h = vwCopy(e, { amt: -house, cad: -house * k, catg: VW.HOUSE_CASH, kind: m.groupOf(VW.HOUSE_CASH),
        what: e.what + ' — house workers', source: e.source + ' · beyond the parents\' ₹' + m.parentsCash.toLocaleString('en-IN') + ' this month' });
      add.push(h);
    }
    if (parents > 0) { e.amt = -parents; e.cad = -parents * k; e.catg = 'Parents household (cash)'; e.kind = m.groupOf(e.catg); e.what = e.what + ' — parents'; }
    else { e.skip = true; }
  });
  // In place: vwModel keeps adding to this same list after the split.
  for (var i = m.ev.length - 1; i >= 0; i--) if (m.ev[i].skip) m.ev.splice(i, 1);
  add.forEach(function (x) { m.ev.push(x); });
}

/* ---------------------------------------------------------------------------
   🏛 Net worth — what you own and owe, folded by meaning
   --------------------------------------------------------------------------- */

var VW_CLASS_ORDER = ['Cash', 'Investments', 'Commodities', 'Real estate', 'Money owed to you'];
var VW_CLASS_ICON = { 'Cash': '💵', 'Investments': '📈', 'Commodities': '💍', 'Real estate': '🏠', 'Money owed to you': '🤝' };

/** The institution an item belongs to: the bank or platform its name starts with. */
function vwInstitution(name) {
  var mm = String(name).match(/^(TD|RBC|CIBC|HDFC|Neo|Wealthsimple|Kotak|GM Financial)\b/i);
  if (mm) return mm[1].replace(/^neo$/i, 'Neo').replace(/^wealthsimple$/i, 'Wealthsimple');
  if (/HST|CRA/i.test(name)) return 'CRA';
  return String(name);
}

function vwNetWorthPage(m) {
  var p = vwPage(VW.NETWORTH, '🏛 Net worth — what you own and what you owe, by meaning',
    'Folded: ➕ opens a class, then the bank or platform, then each account. Values from Assets & Debts and your statements; ' +
    'Invested = what you put in, Gain = value − invested. Type values on the Assets & Debts tab. Rebuilt ' + vwStamp() + '.');
  var C = VW.C, W = 8, L = bsLayout(), bs = m.d.bsRows || [];
  var invested = {}, adCur = {};
  (m.d.adRows || []).forEach(function (r) {
    if (!r[0]) return;
    adCur[String(r[0])] = String(r[3] || '');
    if (r[5] !== '' && r[5] !== null && !isNaN(Number(r[5]))) invested[String(r[0])] = Number(r[5]);
  });
  // Invested is in the row's own money; the value may be in CAD (the house until its value is typed).
  var invOf = function (x) { return invested[x.name] * (m.rate[adCur[x.name] || x.cur] || 1) / (m.rate[x.cur] || 1); };
  var read = function (r0, r1) {
    var out = [];
    for (var i = r0 - 1; i < r1 - 1 && i < bs.length; i++) {
      var r = bs[i];
      if (!r || !r[0] || /^Nothing/.test(String(r[0]))) continue;
      out.push({ name: String(r[0]), cls: String(r[1] || 'Commodities'), from: String(r[2] || ''), asOf: String(r[3] || ''),
                 amt: vwNum(r[4]), cur: String(r[5] || 'CAD'), cad: vwNum(r[6]) });
    }
    return out;
  };
  var assets = read(L.a0, L.aTot), debts = read(L.d0, L.dTot);
  var sum = function (l) { return l.reduce(function (s, x) { return s + x.cad; }, 0); };
  var own = sum(assets), owe = sum(debts);
  var money = function (v, cur) { return v; };

  // Tiles.
  var t0 = p.rows.length;
  p.rows.push(['', 'What you own', 'What you owe', '', 'Net worth', '', '']);
  p.rows.push(['', own, owe, '', own - owe, '', '']);
  [[t0, 2], [t0 + 1, 2], [t0, 4], [t0 + 1, 4]].forEach(function (x) { p.merges.push([x[0], x[1], 1, 2]); });
  vwStyle(p, t0, t0 + 2, 1, 7, { bg: C.SUB });
  vwStyle(p, t0, t0 + 1, 1, 7, { color: C.GREY, bold: true });
  vwStyle(p, t0 + 1, t0 + 2, 1, 7, { size: 20, bold: true, color: C.NAVY });
  vwNumFmt(p, t0 + 1, t0 + 2, 1, 7, VW_CAD);
  p.heights[t0 + 1] = 46;
  p.rows.push([]);
  p.rows.push(['', 'Item', 'Value', 'Value (CAD)', 'Invested', 'Gain / loss', 'As of', 'Where the value comes from']);
  vwHead(p, p.rows.length - 1, W);

  function item(x, depth) {
    var r = p.rows.length, inv = invested[x.name] !== undefined ? invOf(x) : undefined, gain = inv !== undefined && x.amt ? x.amt - inv : '';
    p.rows.push(['', (depth === 1 ? '      ' : '            ') + x.name, x.amt, x.cad, inv !== undefined ? inv : '', gain, x.asOf, x.from]);
    var f = x.cur === 'INR' ? VW_INR : VW_CAD2;
    vwNumFmt(p, r, r + 1, 2, 3, f); vwNumFmt(p, r, r + 1, 3, 4, VW_CAD); vwNumFmt(p, r, r + 1, 4, 6, f);
    vwStyle(p, r, r + 1, 6, 8, { color: C.GREY });
  }
  // A folded row: value when it is one currency, CAD, invested and gain (in CAD), latest date, count.
  function totals(r, list) {
    var curs = vwUniq(list.map(function (x) { return x.cur; }));
    var withInv = list.filter(function (x) { return invested[x.name] !== undefined; });
    var inv = withInv.reduce(function (t, x) { return t + invOf(x) * (m.rate[x.cur] || 1); }, 0);
    var gain = withInv.filter(function (x) { return x.amt; }).reduce(function (t, x) { return t + (x.amt - invOf(x)) * (m.rate[x.cur] || 1); }, 0);
    var asOf = list.map(function (x) { return x.asOf; }).sort().pop() || '';
    p.rows[r] = [p.rows[r][0], p.rows[r][1], curs.length === 1 ? list.reduce(function (t, x) { return t + x.amt; }, 0) : '', sum(list),
      withInv.length ? inv : '', withInv.length ? gain : '', asOf ? vwTxt(asOf) : '', list.length + (list.length === 1 ? ' item' : ' items')];
    if (curs.length === 1) vwNumFmt(p, r, r + 1, 2, 3, curs[0] === 'INR' ? VW_INR : VW_CAD);
    vwNumFmt(p, r, r + 1, 3, 6, VW_CAD);
  }
  function block(label, list, groupOf, order, bg, byInst) {
    var r = p.rows.length;
    p.rows.push(['', label, '', sum(list)]);
    vwStyle(p, r, r + 1, 0, W, { bg: bg, bold: true, size: 12 }); totals(r, list); p.heights[r] = 30;
    var s0 = p.rows.length;
    var keys = vwUniq(list.map(groupOf));
    if (order) keys.sort(function (a, b) { return (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99); });
    keys.forEach(function (k) {
      var inK = list.filter(function (x) { return groupOf(x) === k; }), kr = p.rows.length;
      p.rows.push(['', '   ' + (VW_CLASS_ICON[k] ? VW_CLASS_ICON[k] + '  ' : '') + k + '  (' + inK.length + ')', '', sum(inK)]);
      vwStyle(p, kr, kr + 1, 1, W, { bold: true, bg: C.LIGHT }); totals(kr, inK);
      var s1 = p.rows.length;
      if (!byInst) { inK.forEach(function (x) { item(x); }); p.groups.push([s1, p.rows.length]); return; }
      vwUniq(inK.map(function (x) { return vwInstitution(x.name); })).forEach(function (inst) {
        var inI = inK.filter(function (x) { return vwInstitution(x.name) === inst; });
        if (inI.length === 1) { item(inI[0], 1); return; }   // one account: nothing to fold
        var ir = p.rows.length;
        p.rows.push(['', '      ' + inst + '  (' + inI.length + ')', '', sum(inI)]);
        vwStyle(p, ir, ir + 1, 1, 2, { bold: true }); totals(ir, inI);
        var s2 = p.rows.length;
        inI.forEach(function (x) { item(x); });
        p.groups.push([s2, p.rows.length]);
      });
      p.groups.push([s1, p.rows.length]);
    });
    p.groups.push([s0, p.rows.length]);
  }
  block('🟢  WHAT YOU OWN', assets, function (x) { return x.cls; }, VW_CLASS_ORDER, C.GOOD, true);
  p.rows.push([]);
  // Debts by bank: HDFC (home loan + Regalia card), Kotak, Neo, CIBC, CRA …
  block('🔴  WHAT YOU OWE', debts, function (x) { return vwInstitution(x.name); }, null, C.BAD, false);
  p.rows.push([]);
  var nr = p.rows.length;
  p.rows.push(['', 'NET WORTH = what you own − what you owe', '', own - owe]);
  vwStyle(p, nr, nr + 1, 0, W, { bg: C.NAVY, color: C.WHITE, bold: true, size: 12 }); vwNumFmt(p, nr, nr + 1, 3, 4, VW_CAD);
  p.rows.push(['', 'The house counts at what it cost until you type its value on Assets & Debts. Its cost before Aug 2026 comes in when older HDFC statements are uploaded.']);
  vwStyle(p, nr + 1, nr + 2, 1, 2, { italic: true, color: C.GREY });

  // 🏦 Loans: what each costs and when it ends. The balance owed is in the list above.
  p.rows.push([]);
  var loans = m.cms.filter(function (c) { return c.cat === 'Loan' && !/^(cancel|later)$/i.test(c.decision); });
  var lr0 = p.rows.length;
  p.rows.push(['', '🏦  LOANS (' + loans.length + ')', '', loans.reduce(function (s, c) { return s + c.cad; }, 0), '', '', '', 'CAD a month, all loans']);
  vwStyle(p, lr0, lr0 + 1, 0, W, { bg: C.LIGHT, bold: true, size: 12 }); vwNumFmt(p, lr0, lr0 + 1, 3, 4, VW_CAD); p.heights[lr0] = 30;
  var ls = p.rows.length;
  loans.forEach(function (c) {
    var left = c.ends ? planDueDates(c, m.today, c.ends).length : '';
    var r = p.rows.length;
    p.rows.push(['', '      ' + c.name, c.amount, c.cad, '', '', c.ends ? vwTxt(vwDay(c.ends)) : '', c.ends ? left + ' payments left' : 'No end date on Commitments']);
    vwNumFmt(p, r, r + 1, 2, 3, c.cur === 'INR' ? VW_INR : VW_CAD2); vwNumFmt(p, r, r + 1, 3, 4, VW_CAD);
    vwStyle(p, r, r + 1, 6, 8, { color: C.GREY });
  });
  if (p.rows.length > ls) p.groups.push([ls, p.rows.length]);

  // 💼 Business expenses this year, for the tax return: category ▸ payee.
  p.rows.push([]);
  var yr = m.today.slice(0, 4);
  var biz = m.ev.filter(function (e) { return e.past && e.cad < 0 && e.kind === 'Business costs' && e.date.slice(0, 4) === yr; });
  var br0 = p.rows.length;
  p.rows.push(['', '💼  BUSINESS EXPENSES ' + yr + ' — for your tax return (' + biz.length + ')', '', -sum(biz)]);
  vwStyle(p, br0, br0 + 1, 0, W, { bg: C.LIGHT, bold: true, size: 12 }); vwNumFmt(p, br0, br0 + 1, 3, 4, VW_CAD); p.heights[br0] = 30;
  var bs0 = p.rows.length;
  vwUniq(biz.map(function (e) { return e.catg; })).sort().forEach(function (cg) {
    var inC = biz.filter(function (e) { return e.catg === cg; }), cr = p.rows.length;
    p.rows.push(['', '   ' + cg + '  (' + inC.length + ')', '', -sum(inC)]);
    vwStyle(p, cr, cr + 1, 1, 2, { bold: true }); vwNumFmt(p, cr, cr + 1, 3, 4, VW_CAD);
    var cs = p.rows.length;
    vwUniq(inC.map(function (e) { return e.what; })).forEach(function (w) {
      var ir = p.rows.length;
      p.rows.push(['', '            ' + vwSafe(w), '', -sum(inC.filter(function (e) { return e.what === w; }))]);
      vwNumFmt(p, ir, ir + 1, 3, 4, VW_CAD); vwStyle(p, ir, ir + 1, 1, 2, { color: C.GREY });
    });
    p.groups.push([cs, p.rows.length]);
  });
  if (p.rows.length > bs0) p.groups.push([bs0, p.rows.length]);
  p.widths = [30, 360, 120, 110, 120, 110, 95, 230];
  return p;
}

/* ---------------------------------------------------------------------------
   📒 Money — every transaction, folded: Needs you, then month ▸ country ▸ category ▸ sub-category
   --------------------------------------------------------------------------- */

function vwMoneyPage(m) {
  var p = vwPage(VW.MONEY, '📒 Money — where your money went',
    'Folded: ➕ opens a month, then Canada / India, then the category and sub-category, then each payment. India in ₹, Canada in $, month lines in CAD. Rebuilt ' + vwStamp() + '.');
  var C = VW.C, W = 7, cur = m.today.slice(0, 7);
  p.rows.push(['Item', 'Date', 'Account', 'Amount', 'CAD', 'Status', 'From the bank']);
  vwHead(p, 3, W); p.freeze = 4;
  var sum = function (l) { return l.reduce(function (s, e) { return s + e.cad; }, 0); };
  var byDate = function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; };
  function tx(e, pad) {
    var r = p.rows.length;
    p.rows.push([pad + vwSafe(e.what), vwLocalDate(e.date), vwShort(e.acct), e.amt, e.cad, e.status, vwSafe(e.source)]);
    vwNumFmt(p, r, r + 1, 3, 4, vwLocalFmt(e.cur)); vwNumFmt(p, r, r + 1, 1, 2, 'ddd d mmm yy'); vwNumFmt(p, r, r + 1, 4, 5, VW_CAD);
    vwStyle(p, r, r + 1, 5, 7, { color: C.GREY });
  }
  // A folded row sums what is inside it: dates, account(s), amount when it is one currency, CAD, count.
  function head(label, list, pad, style, note) {
    var r = p.rows.length, dates = list.map(function (e) { return e.date; }).sort();
    var curs = vwUniq(list.map(function (e) { return e.cur; })), accts = vwUniq(list.map(function (e) { return vwShort(e.acct); }));
    var day = function (d) { return vwDay(d).replace(/^\S+ /, ''); };
    var span = !dates.length ? '' : dates[0] === dates[dates.length - 1] ? day(dates[0]) : day(dates[0]) + ' → ' + day(dates[dates.length - 1]);
    p.rows.push([pad + label, span ? vwTxt(span) : '', accts.length === 1 ? accts[0] : accts.length ? accts.length + ' accounts' : '',
      curs.length === 1 ? list.reduce(function (t, e) { return t + e.amt; }, 0) : '', sum(list), note || list.length + (list.length === 1 ? ' payment' : ' payments')]);
    vwStyle(p, r, r + 1, 0, W, style);
    if (curs.length === 1) vwNumFmt(p, r, r + 1, 3, 4, curs[0] === 'INR' ? VW_INR : VW_CAD);
    vwNumFmt(p, r, r + 1, 4, 5, VW_CAD);
    return p.rows.length;
  }

  // 🔴 What needs you (bank data problems; what to pay is on Today).
  var needs = m.ev.filter(function (e) { return ['label', 'unpaired', 'check', 'unknown'].indexOf(e.tag) !== -1; });
  var s0 = head('🔴  NEEDS YOU  (' + needs.length + ')', needs, '', { bg: C.BAD, bold: true, size: 12 });
  [['❔ Can\'t tell yet — upload a newer statement', 'unknown'], ['⚠ Charged after you cancelled', 'check'],
   ['↔ Transfers that did not match', 'unpaired'], ['🏷 No category yet — add a Payees rule', 'label']].forEach(function (x) {
    var l = needs.filter(function (e) { return e.tag === x[1]; }).sort(byDate);
    if (!l.length) return;
    var s = head(x[0] + '  (' + l.length + ')', l, '   ', { bold: true, bg: C.SUB });
    l.forEach(function (e) { tx(e, '      '); });
    p.groups.push([s, p.rows.length]);
  });
  if (p.rows.length > s0) p.groups.push([s0, p.rows.length]);
  p.rows.push([]);

  // Months, newest first.
  var past = m.ev.filter(function (e) { return e.past; });
  vwUniq(past.map(function (e) { return e.date.slice(0, 7); })).sort().reverse().forEach(function (mo) {
    var inM = past.filter(function (e) { return e.date.slice(0, 7) === mo; }).sort(byDate);
    var real = inM.filter(function (e) { return e.kind !== VW.MOVED; });
    var inn = sum(real.filter(function (e) { return e.cad > 0; })), out = sum(real.filter(function (e) { return e.cad < 0; }));
    var s1 = head(pMonthName(mo) + (mo === cur ? '  ⏳ so far' : '  ✅'), real, '', { bg: mo === cur ? C.WARN : C.LIGHT, bold: true, size: 12 },
      'In ' + vwMoneyCad(inn) + '  ·  Out ' + vwMoneyCad(-out) + '  ·  CAD column = left over (moves between your accounts not counted)');
    ['🇨🇦 Canada', '🇮🇳 India'].forEach(function (cn) {
      var L = inM.filter(function (e) { return m.country(e.acct) === cn; });
      if (!L.length) return;
      var s2 = head(cn + '  (' + L.length + ')', L.filter(function (e) { return e.kind !== VW.MOVED; }), '   ', { bold: true }, 'Moves between your accounts not counted');
      vwUniq(L.map(function (e) { return e.kind; })).sort(function (a, b) {
        return (a === 'Income' ? -1 : a === VW.MOVED ? 1 : 0) - (b === 'Income' ? -1 : b === VW.MOVED ? 1 : 0) || (a < b ? -1 : 1);
      }).forEach(function (k) {
        var K = L.filter(function (e) { return e.kind === k; });
        var s3 = head(k + '  (' + K.length + ')', K, '      ', { bold: true, bg: C.SUB });
        var cats = vwUniq(K.map(function (e) { return e.catg; })).sort();
        if (cats.length === 1) K.forEach(function (e) { tx(e, '            '); });
        else cats.forEach(function (cg) {
          var Cg = K.filter(function (e) { return e.catg === cg; });
          var s4 = head(cg + '  (' + Cg.length + ')', Cg, '         ', { italic: true, bold: true });
          Cg.forEach(function (e) { tx(e, '               '); });
          p.groups.push([s4, p.rows.length]);
        });
        p.groups.push([s3, p.rows.length]);
      });
      p.groups.push([s2, p.rows.length]);
    });
    p.groups.push([s1, p.rows.length]);
  });
  p.widths = [420, 90, 130, 100, 90, 330, 360];
  return p;
}

function vwMoneyCad(v) { return '$' + Math.abs(vwR(v)).toLocaleString('en-US'); }


/* ---------------------------------------------------------------------------
   Commitments and Assets & Debts: sorted and folded by meaning, in place
   --------------------------------------------------------------------------- */

/**
 * These two tabs are typed into, so they are never rebuilt: rows are sorted into sections and
 * folded where they stand. A section is a row with no name (every reader skips those) and its
 * title in column B. New rows wait at the bottom until the next tidy. Runs after a deploy and
 * once at night (02:00–05:59), so it does not move rows while you are typing.
 */
function vwTidyInputs(ss) {
  var props = PropertiesService.getScriptProperties(), now = new Date();
  var day = Utilities.formatDate(now, CFG_TZ(), 'yyyy-MM-dd'), hour = +Utilities.formatDate(now, CFG_TZ(), 'H');
  var newCode = props.getProperty('vw_tidy_version') !== PLAN.VERSION;
  if (!newCode && !(hour >= 2 && hour < 6 && props.getProperty('vw_tidy_day') !== day)) return false;
  // One tab per poll, marked before the work: a timeout logs nothing, and must not repeat forever.
  if (props.getProperty('vw_tidy_step') !== 'assets') {
    props.setProperty('vw_tidy_step', 'assets');
    vwTrace('tidy commitments');
    vwTidyCommitments(ss);
  } else {
    props.setProperty('vw_tidy_version', PLAN.VERSION);
    props.setProperty('vw_tidy_day', day);
    props.deleteProperty('vw_tidy_step');
    vwTrace('tidy assets');
    vwTidyAssets(ss);
  }
  SpreadsheetApp.flush();
  vwTrace('tidy step done');
  return true;
}

/** Write the sorted sections to the listed columns, reset the row groups, fold, colour the title rows. */
function vwWriteSections(sh, sections, cols, titleCol, width) {
  var total = 0;
  sections.forEach(function (x) { total += 1 + x.rows.length; });
  var used = Math.max(sh.getLastRow() - 1, total);
  if (sh.getMaxRows() < used + 1) sh.insertRowsAfter(sh.getMaxRows(), used + 1 - sh.getMaxRows());
  // Old groups off.
  // Formula columns can make the last row far below the typed rows; groups only ever sit near them.
  for (var r = 2; r <= Math.min(used + 1, total + 40); r++) {
    var depth = sh.getRowGroupDepth(r);
    if (depth > 0) sh.getRange(r, 1).shiftRowGroupDepth(-depth);
  }
  var blocks = cols.map(function () { return []; }), titles = [], row = 2;
  sections.forEach(function (x) {
    titles.push({ row: row, n: x.rows.length, title: x.title });
    blocks.forEach(function (b, k) { b.push(cols[k].map(function (c, i) { return c === titleCol ? x.title : ''; })); });
    x.rows.forEach(function (rw) { blocks.forEach(function (b, k) { b.push(cols[k].map(function (c) { return rw[c - 1]; })); }); });
    row += 1 + x.rows.length;
  });
  cols.forEach(function (list, k) {
    // Overwrite first, then clear only what is left below: a failure can never leave typed rows erased.
    sh.getRange(2, list[0], blocks[k].length, list.length).setValues(blocks[k]);
    if (used > blocks[k].length) sh.getRange(2 + blocks[k].length, list[0], used - blocks[k].length, list.length).clearContent();
    sh.getRange(2, list[0], used, list.length).setBackground(null).setFontWeight('normal');
  });
  titles.forEach(function (t) {
    sh.getRange(t.row, 1, 1, width).setBackground(TH.HEAD).setFontWeight('bold').setFontColor(TH.NAVY);
    if (t.n) sh.getRange(t.row + 1, 1, t.n, 1).shiftRowGroupDepth(1);
  });
  sh.setRowGroupControlPosition(SpreadsheetApp.GroupControlTogglePosition.BEFORE);
  sh.collapseAllRowGroups();
  return titles;
}

function vwTidyCommitments(ss) {
  var sh = getTab(ss, PLAN.TAB_COMMIT), cat = getTab(ss, FX.CATS);
  if (!sh || !cat || sh.getLastRow() < 2) return;
  var W = PLAN.CARD_COL + 2, all = sh.getRange(2, 1, sh.getLastRow() - 1, W).getValues();
  var group = {}, counts = {};
  cat.getRange(2, 1, cat.getLastRow() - 1, 3).getValues().forEach(function (r) { group[String(r[0]).trim()] = String(r[1]); counts[String(r[0]).trim()] = String(r[2]); });
  var order = ['Income', 'Bills & loans', 'Essentials', 'Personal subscriptions', 'Business costs', 'Fees & charges'];
  var buckets = {}, houseName = '';
  all.forEach(function (r) {
    if (!String(r[0]).trim()) return;
    var c = String(r[7]).trim(), g;
    if (/^(cancel|later)$/i.test(String(r[8]))) g = '✂ Cancelled or parked';
    else if (/^creditcard$/i.test(c)) g = '💳 Credit cards';
    else if (counts[c] === 'House') { g = group[c]; houseName = g; }
    else g = group[c] || 'Other';
    (buckets[g] = buckets[g] || []).push(r);
  });
  var names = order.concat(houseName ? [houseName] : [], ['💳 Credit cards'],
    Object.keys(buckets).filter(function (k) { return order.indexOf(k) === -1 && k !== houseName && k !== '💳 Credit cards' && k !== '✂ Cancelled or parked'; }), ['✂ Cancelled or parked']);
  var dueOf = function (r) { var n = parseInt(r[5], 10); return isNaN(n) ? 99 : n; };
  var sections = names.filter(function (k) { return buckets[k]; }).map(function (k) {
    return { title: k + '  (' + buckets[k].length + ')', rows: buckets[k].sort(function (a, b) { return dueOf(a) - dueOf(b); }) };
  });
  // A–L = yours, AC–AD = how it is paid + advice, AF–AH = card settings. Formula columns are not moved.
  var list = function (a, b) { var o = []; for (var i = a; i <= b; i++) o.push(i); return o; };
  sh.getRange(2, 3, sh.getMaxRows() - 1, 1).setNumberFormat('#,##0.00');
  var titles = vwWriteSections(sh, sections, [list(1, 12), list(PLAN.HOW_COL, PLAN.HOW_COL + 1), list(PLAN.CARD_COL, PLAN.CARD_COL + 2)], 2, 12);
  fxCommitFormulas(sh);
  var endRow = titles[titles.length - 1].row + titles[titles.length - 1].n;
  var dueCells = sh.getRange(2, 6, endRow - 1, 1), dueVals = dueCells.getValues();
  var dayOf = function (v) { return Math.round((v.getTime() - new Date(1899, 11, 30).getTime()) / 864e5); };
  var old = function (v) { return v instanceof Date && v.getFullYear() < 1901; };
  if (dueVals.some(function (x) { return old(x[0]); })) dueCells.setValues(dueVals.map(function (x) { return [old(x[0]) ? dayOf(x[0]) : x[0]]; }));
  dueCells.setNumberFormats(dueVals.map(function (x) { return [x[0] instanceof Date && !old(x[0]) ? 'dd/mm/yyyy' : '0']; }));
  // A folded section shows what it costs a month (N = per month in CAD).
  titles.forEach(function (t) {
    if (t.n && !/^✂/.test(t.title)) sh.getRange(t.row, 3).setFormula('=SUM(N' + (t.row + 1) + ':N' + (t.row + t.n) + ')').setNumberFormat('$#,##0" /month";;');
  });
}

function vwTidyAssets(ss) {
  var sh = getTab(ss, BS.TAB_INPUT);
  if (!sh || sh.getLastRow() < 2) return;
  var all = sh.getRange(2, 1, sh.getLastRow() - 1, 8).getValues();
  var order = ['💵 Cash', '📈 Investments', '💍 Commodities', '🏠 Real estate', '🤝 Money owed to you', '🔴 Debts'];
  var label = { 'Cash': order[0], 'Investments': order[1], 'Commodities': order[2], 'Real estate': order[3], 'Money owed to you': order[4] };
  var buckets = {};
  all.forEach(function (r) {
    if (!String(r[0]).trim()) return;
    var g = String(r[1]) === 'Debt' ? order[5] : (label[String(r[2])] || order[0]);
    (buckets[g] = buckets[g] || []).push(r);
  });
  var sections = [{ title: '📊 Totals', rows: [] }].concat(order.filter(function (k) { return buckets[k]; }).map(function (k) {
    return { title: k, rows: buckets[k].sort(function (a, b) { return String(a[0]) < String(b[0]) ? -1 : 1; }) };
  }));
  sh.getRange(2, 5, sh.getMaxRows() - 1, 2).setNumberFormat('#,##0.00');
  var titles = vwWriteSections(sh, sections, [[1, 2, 3, 4, 5, 6, 7, 8]], 2, 12);
  // Live totals beside each section title. J = what each row is worth now, in CAD.
  var sign = {};
  titles.forEach(function (t, i) {
    if (!i) return;
    var a = t.row + 1, z = t.row + t.n;
    sh.getRange(t.row, 11).setFormula('=SUM(J' + a + ':J' + z + ')').setNumberFormat('$#,##0');
    // A folded section: invested (CAD) and the latest date. Value in E is written by vwAssetTitleValues: a formula there would be circular (J reads E).
    sh.getRange(t.row, 6).setFormula('=ARRAYFORMULA(SUM(IF(ISNUMBER(F' + a + ':F' + z + '),F' + a + ':F' + z + '*IFERROR(VLOOKUP(D' + a + ':D' + z + ',Categories!$E:$F,2,0),1),0)))').setNumberFormat('$#,##0;;');
    sh.getRange(t.row, 7).setFormula('=IF(COUNT(G' + a + ':G' + z + ')=0,"",MAX(G' + a + ':G' + z + '))').setNumberFormat('yyyy-mm-dd');
    sign[t.title] = t.row;
  });
  var rows = function (test) { return titles.filter(function (t, i) { return i && test(t.title); }).map(function (t) { return 'K' + t.row; }).join('+') || '0'; };
  var own = rows(function (x) { return x !== order[5]; }), owe = rows(function (x) { return x === order[5]; }) + '+MAX(0,-N(Dashboard!B20))';
  sh.getRange(titles[0].row, 3).setFormula('="Own "&TEXT(' + own + ',"$#,##0")&"   ·   Owe "&TEXT(' + owe + ',"$#,##0")&" (with HST for CRA)   ·   Net worth "&TEXT(' + own + '-(' + owe + '),"$#,##0;-$#,##0")');
}

/* ---------------------------------------------------------------------------
   Housekeeping
   --------------------------------------------------------------------------- */

/** Transactions is raw bank data: Sheets warns anyone who edits it by hand. */
function vwProtectTransactions(ss) {
  var sh = getTab(ss, CFG.TAB_TX);
  if (!sh || sh.getProtections(SpreadsheetApp.ProtectionType.SHEET).length) return;
  sh.protect().setDescription('Raw bank data — only the upload (and labelling) process writes here').setWarningOnly(true);
}

/**
 * Facts are locked, inputs are open. The owner of a sheet can never be fully locked out, so
 * "locked" = Sheets stops and warns before an edit (warning-only protection); the script is
 * not affected. Tab colours say which is which: blue = read only, yellow = yours to fill in.
 * Idempotent: a tab or range that already carries our lock is left alone (a rebuilt page is a
 * new tab, so it gets a fresh lock).
 */
var VW_LOCK = '🔒 Finance Engine — facts, worked out by the sheet';
var VW_FACT_TABS = {            // whole tab locked, except these columns (yours on a fact page)
  '🏠 Today': ['A'], '📒 Money': [], '🧠 Habits': ['G'], '🔮 Forecast': [], '🏛 Net worth': [],
  'Now': [], 'Balance Sheet': [], 'Dashboard': []
};
var VW_INPUT_TABS = {           // your tabs: only the formula / Claude columns are locked
  'Commitments': ['M2:AB', 'AD2:AE'], 'Assets & Debts': ['I2:L'],
  'Categories': ['E2:F4'], 'Payees': []   // E8:F8 (HST rate) stays yours
};
var VW_TAB_COLOUR = { fact: '#1a73e8', input: '#f9ab00', raw: '#9aa0a6' };

function vwProtectAll(ss) {
  var mine = function (p) { return p.getDescription() === VW_LOCK; };
  Object.keys(VW_FACT_TABS).forEach(function (name) {
    var sh = getTab(ss, name);
    if (!sh) return;
    if (!sh.isSheetHidden()) sh.setTabColor(VW_TAB_COLOUR.fact);
    if (sh.getProtections(SpreadsheetApp.ProtectionType.SHEET).some(mine)) return;
    var p = sh.protect().setDescription(VW_LOCK).setWarningOnly(true);
    var open = VW_FACT_TABS[name].map(function (col) { return sh.getRange(col + ':' + col); });
    if (open.length) p.setUnprotectedRanges(open);
  });
  Object.keys(VW_INPUT_TABS).forEach(function (name) {
    var sh = getTab(ss, name);
    if (!sh) return;
    sh.setTabColor(VW_TAB_COLOUR.input);
    // Compared by columns: the row count grows, so the A1 text of the same lock changes.
    var key = function (rg) { return rg.getColumn() + ':' + rg.getLastColumn() + ':' + rg.getRow(); };
    var have = sh.getProtections(SpreadsheetApp.ProtectionType.RANGE).filter(mine)
      .map(function (p) { return key(p.getRange()); });
    VW_INPUT_TABS[name].forEach(function (a1) {
      var rg = sh.getRange(a1);
      if (have.indexOf(key(rg)) !== -1) return;
      rg.protect().setDescription(VW_LOCK).setWarningOnly(true);
    });
  });
  var tx = getTab(ss, CFG.TAB_TX);
  if (tx) tx.setTabColor(VW_TAB_COLOUR.raw);
}

/** The new pages first, in reading order. */
function vwArrangeTabs(ss) {
  var props = PropertiesService.getScriptProperties();
  // The tabs the new pages replace: hidden once (still working — the monthly email reads the
  // Dashboard), to be deleted later. Unhide one by hand and it stays visible.
  if (!props.getProperty('vw_hidden_v1')) {
    VW.OLD_TABS.forEach(function (name) {
      var sh = getTab(ss, name);
      if (sh && !sh.isSheetHidden()) sh.hideSheet();
    });
    props.setProperty('vw_hidden_v1', new Date().toISOString());
  }
  // Second round (27 Oct): only the pages you use stay visible; these wait to be deleted once approved.
  if (!props.getProperty('vw_hidden_v2')) {
    VW.OLD_TABS_2.forEach(function (name) {
      var sh = getTab(ss, name);
      if (sh && !sh.isSheetHidden()) sh.hideSheet();
    });
    props.setProperty('vw_hidden_v2', new Date().toISOString());
  }
  // Reading order. Activating a hidden tab would show it again, so hidden ones are skipped.
  VW.TAB_ORDER.forEach(function (name, i) {
    var sh = getTab(ss, name);
    if (!sh || sh.isSheetHidden()) return;
    ss.setActiveSheet(sh);
    ss.moveActiveSheet(i + 1);
  });
  var first = getTab(ss, VW.TODAY);
  if (first) ss.setActiveSheet(first);
}

/** Save what the rebuild learned: ticks and limits (called after a successful render). */
function vwSaveState(m) {
  var props = PropertiesService.getScriptProperties();
  if (m.ticksOut) props.setProperty('vw_ticks', JSON.stringify(m.ticksOut));
  if (m.limitsOut) props.setProperty('vw_limits', JSON.stringify(m.limitsOut));
}

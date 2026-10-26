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
  HOME: '🏠 Home', LEDGER: '📒 Ledger', SUMMARY: '🗂 Summary',
  HABITS: '🧠 Habits', FORECAST: '🔮 Forecast', HEALTH: '🩺 Health',
  NEXT_DAYS: 30,          // ⏳ Next 30 days
  LATER_MONTHS: 3,        // 🗓 Later runs to the end of this many months ahead
  PAST_MONTHS: 3,         // Summary: finished months shown
  FORECAST_MONTHS: 12,
  SOON_DAYS: 7,           // Home lists payments due within this many days
  TICK_WAIT_DAYS: 3,      // ticked but not seen in the bank after this → ⚠
  VERIFIED_KEEP_DAYS: 7,  // a ✅ Verified line stays on Home this long
  STALE_DAYS: 7,          // an account with no data for longer needs a statement
  MIN_GAP_MIN: 10,        // at most one edit-driven rebuild per this many minutes
  MOVED: 'Moved between your accounts',
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
  if (!due) {
    if (Date.now() - builtAt < VW.MIN_GAP_MIN * 60000) return false;
    due = DriveApp.getFileById(CFG.SHEET_ID).getLastUpdated().getTime() > builtAt;
  }
  if (!due) return false;
  try {
    vwRefresh();
  } catch (err) {
    planIssue('Home / Ledger / Summary pages failed', err);
  }
  props.setProperty('vw_stamp', stamp);
  props.setProperty('vw_built_at', String(Date.now()));
  return true;
}

/** Menu: Finance › Refresh Home, Ledger and the other pages. */
function vwRefresh() {
  var ss = SpreadsheetApp.openById(CFG.SHEET_ID);
  var d = vwRead(ss);
  var m = vwModel(d);
  [vwLedgerPage(m), vwSummaryPage(m), vwHabitsPage(m), vwForecastPage(m), vwHealthPage(m), vwHomePage(m)]
    .forEach(function (p) { vwRender(ss, p); });
  vwSaveState(m);
  vwProtectTransactions(ss);
  vwArrangeTabs(ss);
  SpreadsheetApp.flush();
  PropertiesService.getScriptProperties().setProperty('vw_built_at', String(Date.now()));
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
  var home = vwValues(ss, VW.HOME), habits = vwValues(ss, VW.HABITS);
  var runs = vwValues(ss, CFG.TAB_RUNS).v;
  return {
    today: Utilities.formatDate(new Date(), CFG_TZ(), 'yyyy-MM-dd'),
    cat: cat,
    tx: vwValues(ss, CFG.TAB_TX).v.slice(1),
    cm: cm.v.slice(1), cmText: cm.t.slice(1),
    ex: vwValues(ss, EX.TAB).v.slice(1),
    now: vwValues(ss, PG.TAB_NOW),
    big: vwValues(ss, PG.TAB_BIG).t,
    homeRows: home.v, habitRows: habits.v,
    lastRun: runs.length > 1 ? String(runs[runs.length - 1][0]) : '',
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
  var group = {}, rate = { CAD: 1 };
  Object.keys(CFG.FX_TO_CAD).forEach(function (k) { rate[k] = CFG.FX_TO_CAD[k]; });
  d.cat.slice(1).forEach(function (r) {
    if (r[0]) group[String(r[0]).trim()] = String(r[1] || '').trim();
    if (r[4] && vwNum(r[5])) rate[String(r[4]).trim()] = vwNum(r[5]);
  });
  m.rate = rate;
  m.groupOf = function (cat) { cat = String(cat || '').trim(); return cat ? (group[cat] || planGroup(cat, -1)) : 'Not labelled yet'; };
  var curOf = {}; d.accounts.forEach(function (a) { curOf[a.name] = a.cur; });
  m.curOf = function (acct) { return curOf[acct] || (/HDFC/i.test(acct) ? 'INR' : 'CAD'); };
  m.country = function (acct) { return m.curOf(acct) === 'INR' ? '🇮🇳 India' : '🇨🇦 Canada'; };
  m.fullAcct = function (cell) {
    if (!cell) return '';
    // Bank accounts before cards: "CIBC" is the chequing account, not the CIBC card.
    var order = d.accounts.filter(function (a) { return !a.card; }).concat(d.accounts.filter(function (a) { return a.card; }));
    for (var i = 0; i < order.length; i++) if (planAcctMatches(cell, order[i].name)) return order[i].name;
    return String(cell);
  };

  var ev = [];
  m.ev = ev;

  // Past: every bank row.
  d.tx.forEach(function (r) {
    var date = pCellIso(r[1]), amt = vwNum(r[6]);
    if (!date || !amt || String(r[11]) === 'Reversal pair') return;
    var cur = String(r[7] || 'CAD'), cad = r[8] === '' || r[8] == null ? amt * (rate[cur] || 0) : vwNum(r[8]);
    var catg = String(r[9] || '').trim(), kind = m.groupOf(catg);
    var unl = !catg || kind === 'Not labelled yet';
    var payee = String(r[5] || '').trim();
    if (!payee || /^needs labell?ing$/i.test(payee)) payee = String(r[4] || '').trim();
    ev.push({ date: date, what: payee, acct: String(r[3] || ''), amt: amt, cur: cur, cad: cad,
      catg: catg || 'Not labelled yet', kind: kind, past: true,
      status: unl ? '🏷 Needs a label' : '✅ Done', tag: unl ? 'label' : 'done',
      dir: kind === VW.MOVED ? 'Move' : cad >= 0 ? 'In' : 'Out', source: 'Statement · ' + String(r[4] || '').slice(0, 60) });
  });

  // Future: recurring payments (Commitments), with what the sheet already knows about them.
  var horizon = pMonthAdd(today.slice(0, 7), VW.FORECAST_MONTHS) + '-' + pLastDay(pMonthAdd(today.slice(0, 7), VW.FORECAST_MONTHS));
  var cms = planReadCommitments(d.cm, rate);
  m.cms = cms;
  cms.forEach(function (c) {
    var r = d.cm[c.row - 2];
    var dec = String(c.decision || '');
    if (/^(cancel|later)$/i.test(dec)) {
      if (/^⚠/.test(String(r[19] || ''))) ev.push(vwCm(m, c, r, pCellIso(r[17]) || today, '⚠ ' + String(r[19]).replace(/^⚠\s*/, '') + ' — check', 'check'));
      return;
    }
    var st = String(r[19] || ''), cycle = pCellIso(r[17]), next = pCellIso(r[18]);
    var from = today;
    if (/^✅/.test(st)) from = next || pAddDays(today, 1);
    else if (/^🔴/.test(st) || (/^⏳/.test(st) && cycle && cycle <= today)) {
      ev.push(vwCm(m, c, r, cycle || today, '🔴 Overdue since ' + vwDay(cycle || today), 'overdue'));
      from = pAddDays(cycle || today, 1);
    } else if (/^❔/.test(st)) {
      if (cycle && cycle < today) {
        ev.push(vwCm(m, c, r, cycle, '❔ ' + st.replace(/^❔\s*/, ''), 'unknown'));
        from = pAddDays(cycle, 1);
      }
    } else if (cycle) from = cycle < today ? today : cycle;
    planDueDates(c, from, horizon).forEach(function (when) {
      ev.push(vwCm(m, c, r, when, '🗓 Planned', 'planned'));
    });
  });

  // Expected payments found in messages.
  d.ex.forEach(function (r) {
    var what = String(r[3] || '').trim();
    if (!what || /^reject/i.test(String(r[10])) || /^💸/.test(String(r[13]))) return;
    var amt = vwNum(r[4]), cur = String(r[5] || 'CAD').trim() || 'CAD', due = pCellIso(r[6]) || vwParseDate(r[6]);
    var ok = /^approve/i.test(String(r[10]));
    var acct = m.fullAcct(String(r[7] || '')) || '(no account set)';
    ev.push({ date: ok ? (due || today) : today, what: what, acct: acct, amt: -amt, cur: cur, cad: -amt * (rate[cur] || 1),
      catg: 'Expected payment', kind: 'Expected payments', past: false, dir: 'Out',
      status: ok ? '✅ Approved — pay by ' + (due ? vwDay(due) : 'soon') : '💡 Found in your messages — approve or reject',
      tag: ok ? 'planned' : 'found', exKey: what + '|' + (due || ''), source: String(r[1] || '') + ' · ' + String(r[8] || '').slice(0, 90) });
  });

  // Money moves the Now tab asks for.
  m.moves = vwMoves(d);
  m.moves.forEach(function (mv) {
    ev.push({ date: mv.by || today, what: 'Move money: ' + vwShort(mv.from) + ' → ' + vwShort(mv.to), acct: mv.from, amt: -mv.cad, cur: 'CAD', cad: -mv.cad,
      catg: 'Transfer', kind: VW.MOVED, past: false, dir: 'Move', status: '⏳ To do — move about $' + vwR(mv.cad).toLocaleString('en-US') + ' by ' + (mv.by ? vwDay(mv.by) : 'soon'),
      tag: 'todo', moveTo: mv.to, source: 'Now tab · ' + mv.text });
  });

  // Facts the other pages share.
  m.lastData = {};
  ev.forEach(function (e) { if (e.past && (!m.lastData[e.acct] || e.date > m.lastData[e.acct])) m.lastData[e.acct] = e.date; });
  m.nowInfo = vwNowInfo(d);
  return m;
}

function vwCm(m, c, r, when, status, tag) {
  var inc = String(r[22]) === 'In', sign = inc ? 1 : -1;
  var acct = m.fullAcct(c.acct) || '(no account set)';
  return { date: when, what: c.name, acct: acct, amt: sign * c.amount, cur: c.cur, cad: sign * c.cad, catg: c.cat || 'Not labelled yet',
    kind: inc ? 'Income' : m.groupOf(c.cat), past: false, dir: inc ? 'In' : 'Out', status: status, tag: tag, cmName: c.name,
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
      out.banks.push({ name: String(v[j][0]), asOf: v[j][2], asOfText: t[j][2], action: String(t[j][10] || '') });
    }
    break;
  }
  return out;
}

function vwNowInfo(d) {
  var n = vwNowRows(d), worth = '';
  for (var i = 0; i < Math.min(12, d.big.length); i++) {
    if (String(d.big[i][2]) === 'Net worth' && d.big[i + 1]) { worth = d.big[i + 1][2]; break; }
  }
  return { banks: n.banks, cash: n.total ? n.total.cash : null, spare: n.total ? n.total.spare : null, worth: worth };
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
  return { name: name, rows: [[title], [sub], []], fmt: [], groups: [], widths: [], freeze: 0, numFmt: [], rules: [], checks: [], notes: [], wrapCols: [] };
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
  all.setValues(rows).setFontFamily(TH.FONT).setVerticalAlignment('middle');

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
  all.setBackgrounds(bg).setFontColors(fc).setFontWeights(fw).setFontSizes(fs).setFontStyles(fst).setNumberFormats(nf);
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

  // Folding: outer groups first, then inner; every group starts folded.
  if (p.groups.length) {
    sh.setRowGroupControlPosition(SpreadsheetApp.GroupControlTogglePosition.BEFORE);
    p.groups.slice().sort(function (a, b) { return a[0] - b[0] || (b[1] - b[0]) - (a[1] - a[0]); }).forEach(function (g) {
      if (g[1] > g[0]) sh.getRange(g[0] + 1, 1, g[1] - g[0], 1).shiftRowGroupDepth(1);
    });
    sh.collapseAllRowGroups();
  }

  if (old) ss.deleteSheet(old);
  sh.setName(p.name);
  return sh;
}


/* ---------------------------------------------------------------------------
   📒 Ledger
   --------------------------------------------------------------------------- */

function vwLedgerPage(m) {
  var p = vwPage(VW.LEDGER, '📒 Ledger — everything, folded. Open only what you need.',
    'Click ➕ on the far left to open a section. 🔴 Needs you is always on top. Amounts in the account\'s own money (₹ for India, $ for Canada); the CAD column and totals in CAD. Rebuilt ' + vwStamp() + '.');
  var cols = ['', 'Date', 'What', 'Account', 'Amount', 'CAD', 'Status', 'Kind', 'Source / context'];
  var N = cols.length, today = m.today, in30 = pAddDays(today, VW.NEXT_DAYS);
  var endLater = pMonthAdd(today.slice(0, 7), VW.LATER_MONTHS);
  p.rows.push(cols); vwHead(p, 3, N); p.freeze = 4;
  var sum = function (l) { return l.reduce(function (s, e) { return s + e.cad; }, 0); };
  var byDate = function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; };

  function item(e) {
    p.rows.push(['', vwLocalDate(e.date), vwSafe(e.what), vwShort(e.acct), e.amt, e.cad, e.status, e.kind, vwSafe(e.source)]);
    vwNumFmt(p, p.rows.length - 1, p.rows.length, 4, 5, vwLocalFmt(e.cur));
    vwNumFmt(p, p.rows.length - 1, p.rows.length, 1, 2, 'ddd d mmm yy');
  }
  function header(label, list, depth, bg) {
    var pad = ['', '   ', '      '][depth] || '';
    p.rows.push([pad + label + '  (' + list.length + ')', '', '', '', '', sum(list)]);
    var r = p.rows.length - 1;
    if (depth === 0) vwStyle(p, r, r + 1, 0, N, { bg: bg, bold: true, size: 12 });
    else vwStyle(p, r, r + 1, 0, N, { bg: depth === 1 ? VW.C.SUB : null, bold: true, italic: depth === 2 });
    return p.rows.length;
  }
  function section(label, list, bg, inner) {
    var s = header(label, list, 0, bg);
    if (inner) inner(list); else list.forEach(item);
    if (p.rows.length > s) p.groups.push([s, p.rows.length]);
  }
  function sub(label, list, depth, inner) {
    if (!list.length) return;
    var s = header(label, list, depth || 1);
    if (inner) inner(list); else list.forEach(item);
    p.groups.push([s, p.rows.length]);
  }

  var ev = m.ev;
  var needs = ev.filter(function (e) { return ['overdue', 'check', 'todo', 'found', 'unknown', 'label'].indexOf(e.tag) !== -1; });
  var next = ev.filter(function (e) { return !e.past && e.tag === 'planned' && e.date <= in30; }).sort(byDate);
  var later = ev.filter(function (e) { return !e.past && e.tag === 'planned' && e.date > in30 && e.date.slice(0, 7) <= endLater; }).sort(byDate);
  var done = ev.filter(function (e) { return e.past; }).sort(function (a, b) { return -byDate(a, b); });

  section('🔴 NEEDS YOU', needs, VW.C.BAD, function (l) {
    [['🔴 Overdue', 'overdue'], ['⚠ Check — charged after you cancelled', 'check'], ['⏳ To do now (money moves)', 'todo'],
     ['💡 Found in your messages — approve or reject on Expected payments', 'found'], ['❔ Can\'t tell yet — upload a newer statement', 'unknown'],
     ['🏷 Needs a label — add a Payees rule', 'label']].forEach(function (x) {
      sub(x[0], l.filter(function (e) { return e.tag === x[1]; }).sort(byDate));
    });
  });
  section('⏳ NEXT ' + VW.NEXT_DAYS + ' DAYS', next, VW.C.WARN);
  section('🗓 LATER — planned', later, VW.C.LIGHT, function (l) {
    vwUniq(l.map(function (e) { return e.date.slice(0, 7); })).forEach(function (mo) {
      sub(pMonthName(mo), l.filter(function (e) { return e.date.slice(0, 7) === mo; }));
    });
  });
  section('✅ DONE — from your statements', done.filter(function (e) { return e.tag === 'done'; }), VW.C.GOOD, function (l) {
    vwUniq(l.map(function (e) { return e.date.slice(0, 7); })).forEach(function (mo) {
      var inM = l.filter(function (e) { return e.date.slice(0, 7) === mo; });
      sub(pMonthName(mo), inM, 1, function (x) {
        vwUniq(x.map(function (e) { return e.kind; })).sort().forEach(function (k) {
          sub(k, x.filter(function (e) { return e.kind === k; }), 2);
        });
      });
    });
  });
  vwNumFmt(p, 4, p.rows.length, 5, 6, VW_CAD);
  p.widths = [330, 85, 260, 130, 100, 90, 300, 160, 380];
  return p;
}

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
    est[m.country(e.acct)] += e.amt / full.length;
  });
  m.est = est;
  return est;
}

function vwSummaryPage(m) {
  var p = vwPage(VW.SUMMARY, '🗂 Summary — money in and out by month',
    'Folded: open a country ▸ kind ▸ category ▸ item. India in ₹, Canada in $; the bottom lines are grand totals in CAD. Moves between your own accounts are left out. Rebuilt ' + vwStamp() + '.');
  var cur = m.today.slice(0, 7), months = [];
  var first = m.ev.filter(function (e) { return e.past; }).reduce(function (a, e) { return e.date < a ? e.date : a; }, cur).slice(0, 7);
  for (var k = -VW.PAST_MONTHS; k <= 3; k++) if (pMonthAdd(cur, k) >= first) months.push(pMonthAdd(cur, k));   // nothing before the data starts
  var label = function (mo) { return mo < cur ? '✅ Actual' : mo === cur ? '⏳ Actual so far + rest planned' : '🗓 Planned'; };
  var est = vwEstimates(m), rateINR = m.rate.INR || 0.0162;
  var left = 1 - (+m.today.slice(8, 10)) / pLastDay(cur);

  var pool = m.ev.filter(function (e) { return e.dir !== 'Move' && (e.past || e.tag === 'planned' || e.tag === 'overdue'); })
    .map(function (e) { return e.tag === 'overdue' ? vwCopy(e, { date: m.today }) : e; });
  months.filter(function (mo) { return mo >= cur; }).forEach(function (mo) {
    var f = mo === cur ? left : 1;
    if (est['🇨🇦 Canada']) pool.push({ date: mo + '-28', what: 'Day-to-day spending (estimate)', acct: 'CAD', amt: est['🇨🇦 Canada'] * f, cur: 'CAD', cad: est['🇨🇦 Canada'] * f, kind: 'Estimates', catg: 'Day-to-day spending — the pace of the last 2 months' });
    if (est['🇮🇳 India']) pool.push({ date: mo + '-28', what: 'Day-to-day spending (estimate)', acct: 'INR', amt: est['🇮🇳 India'] * f, cur: 'INR', cad: est['🇮🇳 India'] * f * rateINR, kind: 'Estimates', catg: 'Day-to-day spending — the pace of the last 2 months' });
  });
  var countryOf = function (e) { return e.acct === 'INR' ? '🇮🇳 India' : e.acct === 'CAD' ? '🇨🇦 Canada' : m.country(e.acct); };
  var W = 1 + months.length;
  p.rows.push([''].concat(months.map(function (mo) { return vwTxt(pMonthName(mo)); })));
  p.rows.push(['Country ▸ Kind ▸ Category ▸ Item'].concat(months.map(label)));
  vwHead(p, 3, W); vwHead(p, 4, W); p.freeze = 5;
  months.forEach(function (mo, i) {
    var l = label(mo);
    vwStyle(p, 4, 5, 1 + i, 2 + i, { bg: /^✅/.test(l) ? VW.C.DONE_HEAD : /^⏳/.test(l) ? VW.C.HALF_HEAD : VW.C.SECTION, color: VW.C.WHITE, bold: true, wrap: true });
  });
  var vals = function (list, f) { return months.map(function (mo) { return vwR(list.filter(function (e) { return e.date.slice(0, 7) === mo; }).reduce(function (s, e) { return s + f(e); }, 0)); }); };
  var amt = function (e) { return e.amt; };

  ['🇨🇦 Canada', '🇮🇳 India'].forEach(function (cn) {
    var L = pool.filter(function (e) { return countryOf(e) === cn; });
    if (!L.length) return;
    var fmt = cn === '🇮🇳 India' ? VW_INR : VW_CAD;
    p.rows.push([cn + (cn === '🇮🇳 India' ? '  (₹)' : '  ($)')].concat(vals(L, amt)));
    var r0 = p.rows.length - 1; vwStyle(p, r0, r0 + 1, 0, W, { bg: VW.C.LIGHT, bold: true, size: 12 }); vwNumFmt(p, r0, r0 + 1, 1, W, fmt);
    var s1 = p.rows.length;
    vwUniq(L.map(function (e) { return e.kind; })).sort().forEach(function (kd) {
      var K = L.filter(function (e) { return e.kind === kd; });
      p.rows.push(['   ' + kd].concat(vals(K, amt))); var r1 = p.rows.length - 1;
      vwStyle(p, r1, r1 + 1, 0, 1, { bold: true }); vwNumFmt(p, r1, r1 + 1, 1, W, fmt);
      var s2 = p.rows.length;
      vwUniq(K.map(function (e) { return e.catg; })).sort().forEach(function (cg) {
        var Cg = K.filter(function (e) { return e.catg === cg; });
        p.rows.push(['      ' + cg].concat(vals(Cg, amt))); vwNumFmt(p, p.rows.length - 1, p.rows.length, 1, W, fmt);
        var s3 = p.rows.length;
        vwUniq(Cg.map(function (e) { return e.what; })).forEach(function (w) {
          p.rows.push(['         ' + w].concat(vals(Cg.filter(function (e) { return e.what === w; }), amt)));
          var r3 = p.rows.length - 1; vwNumFmt(p, r3, r3 + 1, 1, W, fmt); vwStyle(p, r3, r3 + 1, 0, 1, { color: VW.C.GREY });
        });
        p.groups.push([s3, p.rows.length]);
      });
      p.groups.push([s2, p.rows.length]);
    });
    p.groups.push([s1, p.rows.length]);
  });
  var cad = function (e) { return e.cad; };
  var tin = vals(pool.filter(function (e) { return e.cad > 0; }), cad), tout = vals(pool.filter(function (e) { return e.cad < 0; }), cad);
  p.rows.push([]);
  var g = p.rows.length;
  p.rows.push(['GRAND TOTAL (CAD) — money in'].concat(tin));
  p.rows.push(['GRAND TOTAL (CAD) — money out'].concat(tout));
  p.rows.push(['GRAND TOTAL (CAD) — left over'].concat(tin.map(function (v, i) { return v + tout[i]; })));
  vwNumFmt(p, g, g + 3, 1, W, VW_CAD);
  vwStyle(p, g, g + 3, 0, W, { bg: VW.C.NAVY, color: VW.C.WHITE, bold: true });
  // Finished months greyed, so the eye goes to what is still open.
  months.forEach(function (mo, i) { if (mo < cur) vwStyle(p, 5, g - 1, 1 + i, 2 + i, { bg: VW.C.PAST }); });
  p.widths = [430].concat(months.map(function () { return 120; }));
  return p;
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
  var planned = function (e) { return !unplanned(e) && VW.PLANNED_GROUPS.indexOf(e.kind) !== -1; };
  p.rows.push([''].concat(months.map(function (mo) { return vwTxt(pMonthName(mo) + (mo === cur ? ' (so far)' : '')); }), ['Per month (avg)', 'Per year', '🎯 Your limit / month', 'vs limit', 'key']));
  vwHead(p, 3, 8); p.freeze = 4;

  function block(label, test, bg) {
    var r = p.rows.length; vwBand(p, r, 8, label, bg, '#202124');
    var catRows = [];
    var cats = vwUniq(spend.filter(test).map(function (e) { return e.catg; }));
    var tot = function (cg) { return spend.filter(function (e) { return e.catg === cg; }).reduce(function (s, e) { return s - e.cad; }, 0); };
    cats.sort(function (a, b) { return tot(b) - tot(a); }).forEach(function (cg) {
      var L = spend.filter(function (e) { return e.catg === cg; });
      var mv = months.map(function (mo) { return vwR(-L.filter(function (e) { return e.date.slice(0, 7) === mo; }).reduce(function (s, e) { return s + e.cad; }, 0)); });
      var row = p.rows.length + 1;   // sheet row
      var lim = limits[cg] !== undefined ? limits[cg] : (test === unplanned && VW.LIMITS[cg] !== undefined ? VW.LIMITS[cg] : '');
      p.rows.push(['   ' + cg + '  (' + L.length + ' times)'].concat(mv, ['=AVERAGE(B' + row + ':C' + row + ')', '=E' + row + '*12', lim,
        '=IF(G' + row + '="","set a limit →",IF(E' + row + '<=G' + row + ',"✅ within","⚠ over by "&TEXT(E' + row + '-G' + row + ',"$#,##0")))', cg]));
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
  var cash0 = m.nowInfo.cash || 0;
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
  p.rows.push(['Cash at month-end (starting from $' + vwR(cash0).toLocaleString('en-US') + ' today)'].concat(ends, ['']));
  var e0 = p.rows.length - 2;
  vwStyle(p, e0, e0 + 2, 0, W, { bg: VW.C.NAVY, color: VW.C.WHITE, bold: true });
  vwNumFmt(p, 4, p.rows.length, 1, W, VW_CAD);
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
    unl.length ? 'Ledger › 🔴 Needs you › 🏷 — add Payees rules (or ask Claude), then Finance › Re-label unlabelled rows' : '—');

  var od = m.ev.filter(function (e) { return e.tag === 'overdue' || e.tag === 'check'; });
  add('4. Every bill paid on time', od.length ? '🔴' : '✅',
    od.length ? od.map(function (e) { return e.what + ' (' + e.status.replace(/^\S+\s/, '') + ')'; }).join(' · ') : 'Nothing overdue',
    od.length ? 'Pay it, or set it to Cancel / Later on Commitments' : '—');

  var found = m.ev.filter(function (e) { return e.tag === 'found'; });
  add('5. Payments found in messages decided', found.length ? '⚠' : '✅',
    found.length ? found.length + ' waiting: ' + found.map(function (e) { return e.what; }).join(' · ') : 'None waiting',
    found.length ? 'Expected payments tab › Your decision: Approve or Reject' : '—');

  var late = vwTickRows(m).filter(function (t) { return /^⚠/.test(t.seen); });
  add('6. Ticked "done" but not seen in the bank after ' + VW.TICK_WAIT_DAYS + ' days', late.length ? '⚠' : '✅',
    late.length ? late.map(function (t) { return t.what; }).join(' · ') : 'None', late.length ? 'Check the payment went through; upload the statement' : '—');

  add('7. Uploads arrive', m.d.lastRun ? '✅' : '⚠', 'Last upload: ' + (m.d.lastRun || 'none recorded'), '—');
  m.checks = out;
  return out;
}

function vwHealthPage(m) {
  var p = vwPage(VW.HEALTH, '🩺 Health — can you trust the numbers?', 'All green, or fix the top red line first. Rebuilt ' + vwStamp() + '.');
  var cols = ['Check', 'Status', 'What it found', 'What to do'];
  p.rows.push(cols); vwHead(p, 3, 4);
  vwHealthChecks(m).forEach(function (c) { p.rows.push([c.name, c.ok, c.found, c.todo]); });
  var n = p.rows.length;
  p.rules.push({ r0: 4, r1: n, c: 1, starts: '✅', bg: VW.C.GOOD }, { r0: 4, r1: n, c: 1, starts: '⚠', bg: VW.C.WARN }, { r0: 4, r1: n, c: 1, starts: '🔴', bg: VW.C.BAD });
  vwStyle(p, 4, n, 1, 2, { size: 14 });
  p.wrapCols = [0, 2, 3];
  p.widths = [360, 70, 560, 360];
  return p;
}


/* ---------------------------------------------------------------------------
   🏠 Home — and the ticks that wait for the bank
   --------------------------------------------------------------------------- */

/** What Home asks you to do now: each with a stable key so a tick survives rebuilds. */
function vwTodo(m) {
  if (m.todo) return m.todo;
  var out = [], soon = pAddDays(m.today, VW.SOON_DAYS);
  var money = function (e) { return (e.cur === 'INR' ? '₹' : '$') + Math.abs(vwR(e.amt)).toLocaleString('en-US'); };
  m.ev.filter(function (e) { return e.tag === 'overdue'; }).forEach(function (e) {
    out.push({ key: 'cm|' + e.what + '|' + e.date, what: 'Pay ' + e.what + ' ' + money(e) + ' from ' + vwShort(e.acct), when: '🔴 overdue since ' + vwDay(e.date), cm: e.what });
  });
  m.moves.forEach(function (mv) {
    out.push({ key: 'mv|' + mv.to, what: 'Move about $' + vwR(mv.cad).toLocaleString('en-US') + ' ' + vwShort(mv.from) + ' → ' + vwShort(mv.to), when: mv.by ? 'by ' + vwDay(mv.by) : 'soon' });
  });
  // Bank fees and charges on a card take themselves; only what you pay by hand is listed.
  var cards = {}; m.d.accounts.forEach(function (a) { if (a.card) cards[a.name] = 1; });
  m.ev.filter(function (e) { return e.tag === 'planned' && e.dir === 'Out' && e.date <= soon && !e.exKey && !cards[e.acct] && e.kind !== 'Fees & charges'; }).sort(function (a, b) { return a.date < b.date ? -1 : 1; }).forEach(function (e) {
    out.push({ key: 'cm|' + e.what + '|' + e.date, what: 'Pay ' + e.what + ' ' + money(e) + ' from ' + vwShort(e.acct), when: vwDay(e.date), cm: e.what });
  });
  m.ev.filter(function (e) { return e.exKey && e.tag === 'planned' && e.date <= soon; }).forEach(function (e) {
    out.push({ key: 'ex|' + e.exKey, what: 'Pay ' + e.what + ' ' + money(e) + ' from ' + vwShort(e.acct) + ' (you approved it)', when: vwDay(e.date) });
  });
  var found = m.ev.filter(function (e) { return e.tag === 'found'; }).length;
  if (found) out.push({ key: 'ex|review', what: 'Approve or reject ' + found + ' payment(s) found in your messages — Expected payments tab', when: 'this week' });
  if (vwStale(m).length) out.push({ key: 'st|upload', what: 'Upload statements: ' + m.stale.map(function (a) { return vwShort(a.name); }).join(', '), when: 'pay night' });
  m.todo = out;
  return out;
}

/** Ticks: read from the old Home tab, kept in script properties, checked against the bank. */
function vwTickRows(m) {
  if (m.tickRows) return m.tickRows;
  var store = m.d.ticks || {}, today = m.today, todo = vwTodo(m), keys = {};
  todo.forEach(function (t) { keys[t.key] = t; });
  (m.d.homeRows || []).forEach(function (r) {
    var key = String(r[6] || '');
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

function vwHomePage(m) {
  var p = vwPage(VW.HOME, '🏠 Home — am I OK, and what do I do next?',
    'Tick ✔ when you have done something. It stays 🟡 until the bank shows it, then turns ✅ Verified. Rebuilt ' + vwStamp() + ' — after every upload, every morning, and a few minutes after you edit anything.');
  var checks = vwHealthChecks(m), bad = checks.filter(function (c) { return c.ok !== '✅'; }).length;
  var low = m.lowest && m.lowest.mo ? '$' + vwR(m.lowest.v).toLocaleString('en-US') + ' in ' + pMonthName(m.lowest.mo) : '—';
  p.rows.push(['Cash today', 'Spare after the next 14 days', 'Health', 'Lowest cash (12 months)', 'Net worth', 'Unplanned spending / year']);
  p.rows.push([m.nowInfo.cash, m.nowInfo.spare, bad ? '⚠ ' + bad + ' check(s) need you' : '✅ All good', low, m.nowInfo.worth,
    m.unplannedYearRow ? "='" + VW.HABITS + "'!F" + m.unplannedYearRow : '']);
  vwStyle(p, 3, 4, 0, 6, { color: VW.C.GREY, bg: VW.C.SUB });
  vwStyle(p, 4, 5, 0, 6, { size: 16, bold: true, color: VW.C.NAVY, bg: VW.C.SUB, wrap: true });
  vwNumFmt(p, 4, 5, 0, 2, VW_CAD); vwNumFmt(p, 4, 5, 4, 6, VW_CAD);
  p.rows.push([]);
  vwBand(p, 6, 6, '👉 DO NOW');
  p.rows.push(['✔ Done?', 'What', 'When', 'Seen in the bank? (automatic)', 'Status', '', 'key']);
  vwHead(p, 7, 5);
  var rows = vwTickRows(m), r0 = p.rows.length;
  if (!rows.length) p.rows.push(['', 'Nothing to do right now 🎉']);
  rows.forEach(function (t) {
    var r = p.rows.length + 1;
    p.rows.push([t.ticked, t.what, t.when, t.seen,
      '=IF(LEFT(D' + r + ',1)="✅",D' + r + ',IF(LEFT(D' + r + ',1)="⚠",D' + r + ',IF(A' + r + ',"🟡 You said done — waiting for the bank to show it","⏳ To do")))', '', t.key]);
  });
  var r1 = p.rows.length;
  if (rows.length) {
    p.checks.push({ r0: r0, r1: r1, c: 0 });
    p.rules.push({ r0: r0, r1: r1, c: 4, starts: '✅', bg: VW.C.GOOD }, { r0: r0, r1: r1, c: 4, starts: '🟡', bg: VW.C.WARN },
      { r0: r0, r1: r1, c: 4, starts: '⚠', bg: VW.C.BAD }, { r0: r0, r1: r1, c: 4, starts: '⏳', bg: VW.C.SUB });
  }
  p.rows.push([]);
  var h = p.rows.length;
  vwBand(p, h, 6, 'HOW "DONE" WORKS');
  p.rows.push(['1. Do it (transfer / payment), then tick ✔ here → 🟡 "You said done — waiting for the bank".']);
  p.rows.push(['2. Upload statements (or type a balance on Assets & Debts). When the sheet sees it → ✅ "Verified".']);
  p.rows.push(['3. Ticked but not seen after ' + VW.TICK_WAIT_DAYS + ' days → ⚠ "Not in the bank yet — check" (Health shows it too).']);
  p.rows.push(['4. Nothing counts as paid just because you ticked it — the bank has the last word.']);
  p.rows.push([]);
  vwBand(p, p.rows.length, 6, 'WHERE TO LOOK');
  p.rows.push(['📒 Ledger — every payment past and future, folded, attention first  ·  🗂 Summary — month by month, India in ₹  ·  🧠 Habits — planned vs unplanned']);
  p.rows.push(['🔮 Forecast — 12 months ahead  ·  🩺 Health — can you trust the numbers  ·  Now / Money map — balances and money moves  ·  Commitments, Expected payments, Payees — the lists you edit']);
  vwStyle(p, h + 1, p.rows.length, 0, 1, { color: '#3c4043' });
  p.widths = [150, 440, 130, 300, 380, 190];   // column G (key) is hidden
  return p;
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

/** The new pages first, in reading order. */
function vwArrangeTabs(ss) {
  [VW.HOME, VW.LEDGER, VW.SUMMARY, VW.HABITS, VW.FORECAST, VW.HEALTH].forEach(function (name, i) {
    var sh = getTab(ss, name);
    if (!sh) return;
    ss.setActiveSheet(sh);
    ss.moveActiveSheet(i + 1);
  });
  var home = getTab(ss, VW.HOME);
  if (home) ss.setActiveSheet(home);
}

/** Save what the rebuild learned: ticks and limits (called after a successful render). */
function vwSaveState(m) {
  var props = PropertiesService.getScriptProperties();
  if (m.ticksOut) props.setProperty('vw_ticks', JSON.stringify(m.ticksOut));
  if (m.limitsOut) props.setProperty('vw_limits', JSON.stringify(m.limitsOut));
}

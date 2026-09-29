/**
 * Plan.gs — Phase 2 "Trim it": where the money goes, what is still to pay,
 * and where it is being wasted. Everything here is read from the sheet and
 * rebuilt by the script; nothing needs running by hand.
 *
 *   Commitments tab   the one list of everything that recurs: bills, loans,
 *                     subscriptions, fees, income. Seeded on first run,
 *                     new recurring charges are appended automatically.
 *                     The only thing you ever do here: set Decision to
 *                     Keep or Cancel.
 *   Dashboard tab     written by refreshDashboard(). Never edit it — every
 *                     refresh clears and rewrites it.
 *
 * When it refreshes (no trigger to install, no new permissions):
 *   - after every upload that went in          (Pipeline.gs runBatch)
 *   - once a day, on the first Inbox poll      (Pipeline.gs pollInbox)
 *   - when you edit the Commitments tab        (onEdit below)
 *   - Finance menu › Refresh dashboard
 *
 * Emails: the Friday reminder gains a "due this week" section, and on the
 * 1st of each month a review of the month just ended is sent.
 *
 * The analysis (planAnalyse and everything above the "Sheet side" line) is
 * pure: plain arrays in, a plain object out, so it can be run outside Apps
 * Script against a CSV export.
 */


/* ---------------------------------------------------------------------------
   Settings
   --------------------------------------------------------------------------- */

var PLAN = {
  VERSION    : '2026-09-29.3',   // bump on every change to force a rebuild on the next poll
  TAB_DASH   : 'Dashboard',
  TAB_COMMIT : 'Commitments',

  COMMIT_COLS: ['Name', 'Match', 'Amount', 'Currency', 'Frequency', 'Due', 'Account',
                'Category', 'Decision', 'Decided on', 'Ends', 'Notes'],
  FREQUENCIES: ['Monthly', 'Weekly', 'Biweekly', 'Quarterly', 'Half-yearly', 'Yearly', 'One-off'],
  DECISIONS  : ['Keep', 'Cancel', 'Review'],

  /**
   * Category -> group, first match wins. A group decides where a row counts:
   * Income is money in; Moved (card payments, own transfers, reversals) is
   * left out of every total, because the same money already shows on the
   * other account; the rest is money out.
   */
  GROUPS: [
    [/^(creditcard|transfer|transfer to india|owner draw|reversal)$/i, 'Moved between your accounts'],
    [/^investment/i,                                                     'Saved / invested'],
    [/^construction/i,                                                   'House construction'],
    // Money lent and money paid back net off in one group, so a friend
    // repaying you does not look like income.
    [/^(loan to |loan repayment to me)/i,                                'Lent out'],
    [/^(business income|salary|income|government benefit|tax refund|interest|rewards|transfer in)$/i, 'Income'],
    [/^(rent|loan|utilities|phone|insurance)$/i,                         'Bills & loans'],
    [/^(groceries|fuel|transit|medical|household)$/i,                    'Essentials'],
    [/^subscription/i,                                                   'Subscriptions'],
    [/^(bank fees|fees|interest paid)$/i,                                'Fees & charges'],
    [/^(eating out|coffee|alcohol|convenience|shopping|cash|misc|entertainment)$/i, 'Lifestyle'],
    [/^business$/i,                                                      'Business costs'],
    [/^(|unknown - check)$/i,                                            'Not labelled yet']
  ],
  GROUP_ORDER: ['Income', 'Bills & loans', 'Essentials', 'Lifestyle', 'Subscriptions', 'Fees & charges',
                'Business costs', 'Other', 'Not labelled yet', 'House construction', 'Lent out',
                'Saved / invested', 'Moved between your accounts'],
  // Not "living costs": big one-off project, money lent, money saved.
  NOT_LIVING : ['Income', 'Moved between your accounts', 'House construction', 'Lent out', 'Saved / invested'],
  // Where the "wasting money" lens looks.
  WASTE_GROUPS: ['Lifestyle', 'Subscriptions', 'Fees & charges'],

  MONTHS_SHOWN   : 4,     // columns in "Where your money goes" (current month included)
  STALE_DAYS     : 14,    // an account this many days behind gets the upload banner
  HABIT_MIN      : 5,    // purchases at one place in 30 days before it counts as a habit
  PRICE_UP       : 0.05,  // a bill paid 5% above its listed amount is flagged
  REVIEW_BY_DAY  : 7      // monthly review goes out on the first poll of days 1..7
};

/**
 * First-run contents of the Commitments tab: the Month Ahead recurring list
 * plus the fees, bills and income visible in the Aug–Sep 2026 statements.
 * Used once, when the tab does not exist yet; after that the tab is the
 * source and this list is never read again.
 * Decision is pre-set only where there is no real choice (rent, loans,
 * income) or you already decided (Shipments Free Info: "cancel!").
 */
var PLAN_SEED = [
  // Name, Match, Amount, Currency, Frequency, Due, Account, Category, Decision, Decided on, Ends, Notes
  ['Insight Global pay',        'INSIGHT GLOBAL',               6338.26, 'CAD', 'Biweekly', '2026-09-16', 'TD',          'Income',       'Keep',   '', '', '2 weeks × 37.5 h × $84.51. The 16 Sep deposit ($7,162.24) also carried 2 × $411.99 HST, owed to CRA and not counted here. If pay is weekly, set Frequency Weekly, Due Wednesday, Amount 3169.13.'],
  ['Ontario Trillium Benefit',  'Trillium',                     62.33,   'CAD', 'Monthly', 10,          'CIBC',         'Income',       'Keep',   '', '', ''],
  ['Rent — Swapna',             'SWAPNA',                       1600,    'CAD', 'Monthly', 1,           'RBC',          'Rent',         'Keep',   '', '', ''],
  ['Kotak Mahindra loan EMI',   'Kotak',                        39388.3, 'INR', 'Monthly', 5,           'HDFC Savings', 'Loan',         'Keep',   '', '2027-09-01', 'Do not prepay — runs out 1 Sep 2027, frees ~$580/month.'],
  ['HDFC home loan EMI',        'ACH D- HDFC BANK',             38064,   'INR', 'Monthly', 5,           'HDFC Savings', 'Loan',         'Keep',   '', '2049-04-01', ''],
  ['Electricity (India)',       'ELECTRICITY',                  1818,    'INR', 'Monthly', 6,           'HDFC Savings', 'Utilities',    'Keep',   '', '', 'Autopay'],
  ['Jio',                       'JIO',                          1714.82, 'INR', 'Monthly', 1,           'HDFC Savings', 'Phone',        '',       '', '', 'Which plan is this — still needed?'],
  ['Lucky Mobile',              'LUCKY MOBILE',                 28.25,   'CAD', 'Monthly', 8,           'Neo',          'Phone',        '',       '', '', ''],
  ['Anthropic Claude',          'ANTHROPIC',                    158.2,   'CAD', 'Monthly', 4,           'Neo',          'Subscription', '',       '', '', ''],
  ['LinkedIn Premium',          'LINKEDIN',                     80.7,    'CAD', 'Monthly', 24,          'Neo',          'Subscription', '',       '', '', ''],
  ['Shipments Free Info',       'SHIPMENTSFREEINFO',            27.18,   'CAD', 'Monthly', 12,          'Neo',          'Subscription', 'Cancel', '', '', 'Marked "cancel!" in Month Ahead — check it stopped.'],
  ['Google Workspace',          'GOOGLE \\*WORKSPACE',          6.21,    'CAD', 'Monthly', 1,           'Neo',          'Subscription', '',       '', '', ''],
  ['YouTube Premium',           'YOUTUBE',                      299,     'INR', 'Monthly', 3,           'HDFC Regalia', 'Subscription', '',       '', '', ''],
  ['Wealthsimple contribution', 'Wealthsimple',                 100,     'CAD', 'Monthly', 31,          'CIBC',         'Investment',   'Keep',   '', '', 'Money saved, not spent.'],
  ['RBC monthly fee',           'RBC monthly fee|^MONTHLY FEE', 16.95,   'CAD', 'Monthly', 2,           'RBC',          'Bank fees',    '',       '', '', 'A no-fee account would save ~$200/yr.'],
  ['CIBC monthly fee',          'SERVICE CHARGE',               16.95,   'CAD', 'Monthly', 31,          'CIBC',         'Bank fees',    '',       '', '', 'CIBC is being closed — this stops when it is.'],
  ['TD plan fee',               'PLAN FEE',                     2.52,    'CAD', 'Monthly', 31,          'TD',           'Bank fees',    '',       '', '', '']
];


/**
 * Added on 29 Sep 2026 from Notion › Finance › Payments, which the first seed
 * missed. Appended once to an existing Commitments tab (rows whose Name is
 * already there are skipped), then never again — deleting one is permanent.
 */
var PLAN_ADD_V3 = [
  ['JioFiber (India)', '*', 706.82, 'INR', 'Monthly', 20, 'HDFC Savings', 'Phone', '', '', '', 'From Month Ahead. Paid by UPI — matched on the amount. Still needed alongside Jio?']
];

var PLAN_ADD_V2 = [
  ['Rent — India',               '*',     9000,  'INR', 'Monthly', 17,           'HDFC Savings', 'Rent',         'Keep', '', '', 'Paid by PhonePe to the landlord — the bank line has no name, so it is matched on the amount (₹9,000). July was paid ~24th; August is not in the HDFC statement — check PhonePe.'],
  ['belairdirect car insurance', 'BELAIR', 218,  'CAD', 'Monthly', 7,            '',             'Insurance',    '',     '', '', 'From Notion Payments. Not seen in any statement yet — which account pays it? Put that in Account.'],
  ['POP sheeting installation',  '*',     70000, 'INR', 'One-off', '2026-09-21', 'HDFC Savings', 'Construction', 'Keep', '', '', 'Due when the sheets go up. Matched on the amount.'],
  ['Give money to Manvi',        'MANVI', 2000,  'CAD', 'One-off', '',           '',             'Other',        'Keep', '', '', 'From Notion Payments — no date set.'],
  ['Gold ornament',              'GOLD|JEWEL', 1300, 'CAD', 'One-off', '',       '',             'Shopping',     '',     '', '', 'From Notion Payments — a planned purchase, not a bill. Keep or Cancel?']
];


/* ---------------------------------------------------------------------------
   Pure helpers (no Apps Script services)
   --------------------------------------------------------------------------- */

function pDate(s)        { return new Date(s + 'T00:00:00Z'); }
function pIso(d)         { return d.toISOString().slice(0, 10); }
function pAddDays(s, n)  { var d = pDate(s); d.setUTCDate(d.getUTCDate() + n); return pIso(d); }
function pDaysBetween(a, b) { return Math.round((pDate(b) - pDate(a)) / 86400000); }   // b − a
function pMonthAdd(ym, n) {
  var y = +ym.slice(0, 4), m = +ym.slice(5, 7) - 1 + n;
  y += Math.floor(m / 12); m = ((m % 12) + 12) % 12;
  return y + '-' + ('0' + (m + 1)).slice(-2);
}
function pLastDay(ym)    { return new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 0)).getUTCDate(); }
function pMonthName(ym)  { return ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][+ym.slice(5, 7) - 1] + ' ' + ym.slice(0, 4); }
function pR(n)           { return Math.round(n * 100) / 100; }

/** A cell that holds a date (Date object or text) as 'yyyy-mm-dd', or ''. */
function pCellIso(v) {
  if (v instanceof Date) {
    return v.getFullYear() + '-' + ('0' + (v.getMonth() + 1)).slice(-2) + '-' + ('0' + v.getDate()).slice(-2);
  }
  var s = String(v || '').trim();
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : '';
}

/** Case-insensitive regex from a Match cell; a broken pattern falls back to a literal. */
function pRegex(pat) {
  try { return new RegExp(pat, 'i'); }
  catch (e) { return new RegExp(String(pat).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'); }
}

function planGroup(cat, cad) {
  for (var i = 0; i < PLAN.GROUPS.length; i++) {
    if (PLAN.GROUPS[i][0].test(cat)) {
      var g = PLAN.GROUPS[i][1];
      // An "income" category with money going out (paying interest) is a cost.
      if (g === 'Income' && cad < 0) return 'Other';
      return g;
    }
  }
  return 'Other';
}

var P_WEEKDAYS = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

/** Every due date of a commitment between from and to (inclusive), as ISO strings. */
function planDueDates(c, from, to) {
  var out = [], f = String(c.freq || 'Monthly').toLowerCase(), d, s;
  var end = c.ends && c.ends < to ? c.ends : to;
  if (end < from) return out;

  if (f === 'weekly' || f === 'biweekly') {
    var step = f === 'weekly' ? 7 : 14;
    if (c.dueIso) {
      s = c.dueIso;                                      // a date = the first payment
    } else {
      var wd = P_WEEKDAYS[String(c.due).toLowerCase().slice(0, 3)];
      if (wd === undefined) wd = 1;
      s = pAddDays(from, (wd - pDate(from).getUTCDay() + 7) % 7);
    }
    for (; s <= end; s = pAddDays(s, step)) if (s >= from) out.push(s);
    return out;
  }

  if (f === 'one-off') {
    if (c.dueIso && c.dueIso >= from && c.dueIso <= end) out.push(c.dueIso);
    return out;
  }

  // A date in Due is the first payment and sets the cycle; a day number
  // (Monthly) repeats every month.
  var every = { monthly: 1, quarterly: 3, 'half-yearly': 6, yearly: 12 }[f] || 1;
  var day = c.dueIso ? +c.dueIso.slice(8, 10) : (parseInt(c.due, 10) || 1);
  var m = c.dueIso ? c.dueIso.slice(0, 7) : pMonthAdd(from.slice(0, 7), -1);
  for (; m <= end.slice(0, 7); m = pMonthAdd(m, every)) {
    d = m + '-' + ('0' + Math.min(day, pLastDay(m))).slice(-2);
    if (d >= from && d <= end && (!c.dueIso || d >= c.dueIso)) out.push(d);
  }
  return out;
}

/** How far before/after a due date a payment still counts for it. */
function planWindow(freq) {
  var f = String(freq || '').toLowerCase();
  if (f === 'weekly')   return { before: 3, after: 3 };
  if (f === 'biweekly') return { before: 5, after: 8 };
  return { before: 10, after: 20 };
}

/** Does an account name belong to what a commitment's Account cell says ("Neo", "HDFC Savings")? */
function planAcctMatches(cell, acctName) {
  var words = String(cell || '').toLowerCase().split(/[^a-z0-9]+/).filter(function (w) {
    return w.length >= 2 && ['card', 'chequing', 'account', 'savings'].indexOf(w) === -1;
  });
  if (!words.length) return false;
  var name = String(acctName).toLowerCase();
  var extra = /savings/i.test(cell) ? name.indexOf('savings') !== -1 : true;
  return extra && words.every(function (w) { return name.indexOf(w) !== -1; });
}


/* ---------------------------------------------------------------------------
   Reading the two tabs into plain objects
   --------------------------------------------------------------------------- */

/** Transactions rows (no header) -> transaction objects. */
function planReadTx(values, fx) {
  var out = [];
  values.forEach(function (r) {
    var date = pCellIso(r[1]);
    var amt = Number(r[6]);
    if (!date || isNaN(amt) || !amt) return;
    var cur = String(r[7] || 'CAD');
    var cad = r[8] === '' || r[8] === null || isNaN(Number(r[8])) ? amt * (fx[cur] || 0) : Number(r[8]);
    var cat = String(r[9] || '').trim();
    out.push({
      date: date, month: date.slice(0, 7), acct: String(r[3] || ''), desc: String(r[4] || ''),
      payee: String(r[5] || '').trim(), amt: amt, cur: cur, cad: pR(cad), cat: cat,
      status: String(r[11] || ''), group: planGroup(cat, cad)
    });
  });
  out.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
  return out;
}

/** Commitments rows (no header) -> commitment objects. Row numbers are 1-based sheet rows. */
function planReadCommitments(values, fx) {
  var out = [];
  values.forEach(function (r, i) {
    var name = String(r[0] || '').trim();
    if (!name) return;
    var cur = String(r[3] || 'CAD').trim().toUpperCase();
    var amount = Math.abs(Number(r[2]) || 0);
    var cat = String(r[7] || '').trim();
    var dueIso = pCellIso(r[5]);
    out.push({
      row: i + 2, name: name, match: String(r[1] || '').trim() || name, re: pRegex(String(r[1] || '').trim() || name),
      amount: amount, cur: cur, cad: pR(amount * (fx[cur] || 0)), freq: String(r[4] || 'Monthly').trim(),
      due: dueIso ? '' : String(r[5] === null || r[5] === undefined ? '' : r[5]).trim(), dueIso: dueIso,
      acct: String(r[6] || '').trim(), cat: cat, group: planGroup(cat, 1),
      decision: String(r[8] || '').trim(), decidedOn: pCellIso(r[9]), ends: pCellIso(r[10]),
      notes: String(r[11] || '')
    });
  });
  out.forEach(function (c) {
    c.income = c.group === 'Income';
    // Match "*": the bank line does not name the payee (PhonePe, autopay
    // mandates), so match on the amount alone, within 1%.
    c.anyDesc = c.match === '*';
  });
  return out;
}

/** Monthly cost of a commitment in CAD. */
function planMonthly(c) {
  var per = { weekly: 52 / 12, biweekly: 26 / 12, monthly: 1, quarterly: 1 / 3, 'half-yearly': 1 / 6, yearly: 1 / 12, 'one-off': 0 };
  var k = per[String(c.freq).toLowerCase()];
  return pR(c.cad * (k === undefined ? 1 : k));
}


/* ---------------------------------------------------------------------------
   The analysis
   --------------------------------------------------------------------------- */

/**
 * txValues / commitValues: the rows under each tab's header.
 * opts: { today: 'yyyy-mm-dd', fx: CFG.FX_TO_CAD }
 */
function planAnalyse(txValues, commitValues, opts) {
  var today = opts.today, fx = opts.fx;
  var thisMonth = today.slice(0, 7), lastMonth = pMonthAdd(thisMonth, -1);
  var all = planReadTx(txValues, fx);
  var tx = all.filter(function (t) { return t.status !== 'Reversal pair'; });
  var commits = planReadCommitments(commitValues, fx);
  var M = { today: today, thisMonth: thisMonth, lastMonth: lastMonth, txCount: all.length };

  // ---- data coverage -----------------------------------------------------
  var lastByAcct = {}, firstByAcct = {};
  all.forEach(function (t) {
    if (!lastByAcct[t.acct] || t.date > lastByAcct[t.acct]) lastByAcct[t.acct] = t.date;
    if (!firstByAcct[t.acct] || t.date < firstByAcct[t.acct]) firstByAcct[t.acct] = t.date;
  });
  M.accounts = Object.keys(lastByAcct).sort().map(function (a) {
    return { name: a, last: lastByAcct[a], behind: pDaysBetween(lastByAcct[a], today) };
  });
  M.dataThrough = all.length ? all[all.length - 1].date : '';
  var firstMonth = all.length ? all[0].month : thisMonth;

  // Latest (and earliest) date the statements cover for a commitment's account.
  function coverage(acctCell, first) {
    var best = '';
    Object.keys(lastByAcct).forEach(function (a) {
      if (acctCell && !planAcctMatches(acctCell, a)) return;
      var v = first ? firstByAcct[a] : lastByAcct[a];
      if (!best || (first ? v < best : v > best)) best = v;
    });
    if (!best && acctCell) return coverage('', first);
    return best;
  }

  // ---- match commitments to payments ------------------------------------
  var used = {};                 // tx index -> commitment name
  var from = pAddDays(thisMonth + '-01', -45 - 31), to = pAddDays(today, 35);
  M.dues = [];
  commits.forEach(function (c) {
    var win = planWindow(c.freq);
    var cands = [];
    tx.forEach(function (t, i) {
      if (c.income ? t.cad <= 0 : t.cad >= 0) return;
      if (c.anyDesc) {
        if (!c.amount || Math.abs(Math.abs(t.amt) - c.amount) > Math.max(1, c.amount * 0.01)) return;
        // Same amount but already labelled as something else: not this one.
        if (t.group !== 'Not labelled yet' && t.group !== c.group) return;
      } else if (!c.re.test(t.desc + ' | ' + t.payee)) return;
      if (c.acct && !planAcctMatches(c.acct, t.acct) && Object.keys(lastByAcct).some(function (a) { return planAcctMatches(c.acct, a); })) return;
      cands.push(i);
    });
    c.hits = cands;
    c.lastPaid = cands.length ? tx[cands[cands.length - 1]] : null;

    planDueDates(c, from, to).forEach(function (d) {
      var lo = pAddDays(d, -win.before), hi = pAddDays(d, win.after), best = -1, bestScore = 1e18;
      cands.forEach(function (i) {
        if (used[i]) return;
        var t = tx[i];
        if (t.date < lo || t.date > hi) return;
        var score = Math.abs(pDaysBetween(d, t.date)) * 1000 + (c.amount ? Math.abs(Math.abs(t.amt) - c.amount) : 0);
        if (score < bestScore) { bestScore = score; best = i; }
      });
      var due = { name: c.name, date: d, cad: c.cad, amount: c.amount, cur: c.cur, income: c.income,
                  acct: c.acct, decision: c.decision, freq: c.freq, row: c.row, notes: c.notes };
      if (best >= 0) {
        used[best] = c.name;
        var t = tx[best];
        due.state = 'paid'; due.paidOn = t.date; due.paidAmt = Math.abs(t.amt); due.paidCad = Math.abs(t.cad);
        if (c.amount && !c.income && Math.abs(t.amt) > c.amount * (1 + PLAN.PRICE_UP) + 1) due.up = pR(Math.abs(t.amt) - c.amount);
      } else if (d > today) {
        due.state = 'upcoming'; due.inDays = pDaysBetween(today, d);
      } else if (!coverage(c.acct, true) || coverage(c.acct, true) > d) {
        return;                                        // before the first statement: nothing to say
      } else {
        var cov = coverage(c.acct);
        // With no Account, a missing payment may just be on an account that
        // is not uploaded, so it is never called missed.
        if (cov && cov >= hi && c.acct) due.state = 'missed';
        else if (pDaysBetween(d, today) <= 5) { due.state = 'due'; if (cov < d) due.coverage = cov; }
        else { due.state = 'unseen'; due.coverage = cov; }
      }
      M.dues.push(due);
    });

    // A one-off with no date: owed until a matching payment shows up.
    if (/^one-off$/i.test(c.freq) && !c.dueIso && c.decision !== 'Cancel' && !cands.length) {
      M.dues.push({ name: c.name, date: '', cad: c.cad, amount: c.amount, cur: c.cur, income: c.income,
                    acct: c.acct, decision: c.decision, freq: c.freq, row: c.row, notes: c.notes, state: 'nodate' });
    }
  });
  M.dues.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });

  // ---- where the money goes ---------------------------------------------
  var months = [];
  for (var k = PLAN.MONTHS_SHOWN - 1; k >= 0; k--) {
    var mm = pMonthAdd(thisMonth, -k);
    if (mm >= firstMonth) months.push(mm);
  }
  // Full months with data, for averages: before this month, from the first month with data.
  var fullMonths = [];
  for (var j = 1; j <= 3; j++) { var fm = pMonthAdd(thisMonth, -j); if (fm >= firstMonth) fullMonths.push(fm); }
  M.months = months; M.fullMonths = fullMonths;

  var cats = {};   // group -> cat -> month -> CAD (money out positive, income positive)
  tx.forEach(function (t) {
    var g = t.group, c = t.cat || '(no category)';
    var v = g === 'Income' ? t.cad : -t.cad;
    cats[g] = cats[g] || {};
    cats[g][c] = cats[g][c] || {};
    cats[g][c][t.month] = pR((cats[g][c][t.month] || 0) + v);
  });
  M.cats = cats;

  function groupMonth(g, m) {
    var s = 0; Object.keys(cats[g] || {}).forEach(function (c) { s += cats[g][c][m] || 0; }); return pR(s);
  }
  function living(m) {
    var s = 0;
    Object.keys(cats).forEach(function (g) { if (PLAN.NOT_LIVING.indexOf(g) === -1) s += groupMonth(g, m); });
    return pR(s);
  }
  function flow(m) {
    var inn = groupMonth('Income', m), liv = living(m), house = groupMonth('House construction', m);
    var other = groupMonth('Lent out', m) + groupMonth('Saved / invested', m);
    return { inn: inn, living: liv, house: house, other: pR(other), net: pR(inn - liv - house - other) };
  }
  M.groupMonth = groupMonth;
  M.flowThis = flow(thisMonth);
  M.flowLast = fullMonths.length ? flow(lastMonth) : null;
  if (fullMonths.length) {
    var avg = { inn: 0, living: 0, house: 0, other: 0, net: 0 };
    fullMonths.forEach(function (m) { var f = flow(m); Object.keys(avg).forEach(function (key) { avg[key] += f[key]; }); });
    Object.keys(avg).forEach(function (key) { avg[key] = pR(avg[key] / fullMonths.length); });
    M.flowAvg = avg;
  }

  // Top payees this month and last month (money out, excluding moves).
  function topPayees(m, n) {
    var by = {};
    tx.forEach(function (t) {
      if (t.month !== m || t.group === 'Moved between your accounts' || t.group === 'Income') return;
      var p = t.payee && t.payee !== 'Needs labelling' ? t.payee : t.desc.slice(0, 40);
      by[p] = by[p] || { payee: p, cad: 0, n: 0, cat: t.cat };
      by[p].cad = pR(by[p].cad - t.cad); by[p].n++;
    });
    return Object.keys(by).map(function (p) { return by[p]; })
      .filter(function (x) { return x.cad > 0; })
      .sort(function (a, b) { return b.cad - a.cad; }).slice(0, n);
  }
  M.topThis = topPayees(thisMonth, 10);
  M.topLast = fullMonths.length ? topPayees(lastMonth, 10) : [];

  // ---- this month's plan -------------------------------------------------
  var monthEnd = thisMonth + '-' + ('0' + pLastDay(thisMonth)).slice(-2);
  var mDues = M.dues.filter(function (d) { return d.date >= thisMonth + '-01' && d.date <= monthEnd && d.decision !== 'Cancel'; });
  var expectedIn = 0, committed = 0, remainingOut = 0, remainingIn = 0;
  mDues.forEach(function (d) {
    if (d.income) { expectedIn += d.cad; if (d.state !== 'paid') remainingIn += d.cad; }
    else { committed += d.cad; if (d.state !== 'paid') remainingOut += d.cad; }
  });
  // Everyday = living costs not covered by a commitment, averaged over full months.
  var everyday = 0;
  if (fullMonths.length) {
    fullMonths.forEach(function (m) {
      var s = 0;
      tx.forEach(function (t, i) {
        if (t.month !== m || used[i] || PLAN.NOT_LIVING.indexOf(t.group) !== -1) return;
        s -= t.cad;
      });
      everyday += s;
    });
    everyday = pR(everyday / fullMonths.length);
  }
  M.outlook = {
    expectedIn: pR(expectedIn), committed: pR(committed), everyday: everyday,
    leftOver: pR(expectedIn - committed - everyday),
    house: M.flowAvg ? M.flowAvg.house : 0,
    remainingOut: pR(remainingOut), remainingIn: pR(remainingIn)
  };
  M.outlook.leftAfterHouse = pR(M.outlook.leftOver - M.outlook.house);

  // ---- credit cards: spent since the last payment -------------------------
  M.cards = [];
  Object.keys(lastByAcct).forEach(function (a) {
    if (!/mastercard|visa|regalia|card/i.test(a)) return;
    var rows = tx.filter(function (t) { return t.acct === a; });
    var lastPay = null;
    rows.forEach(function (t) { if (t.cad > 0 && /creditcard/i.test(t.cat)) lastPay = t; });
    var spent = 0;
    rows.forEach(function (t) {
      if (lastPay && t.date <= lastPay.date) return;
      if (t.group === 'Moved between your accounts') return;
      spent -= t.cad;
    });
    M.cards.push({ acct: a, since: lastPay ? lastPay.date : (rows[0] ? rows[0].date : ''), lastPay: lastPay, spent: pR(spent), through: lastByAcct[a] });
  });

  // ---- where you are wasting money ---------------------------------------
  var W = {};
  W.undecided = commits.filter(function (c) { return !c.income && (!c.decision || /^review$/i.test(c.decision)); })
    .map(function (c) {
      var oneOff = /^one-off$/i.test(c.freq);
      return { name: c.name, row: c.row, monthly: oneOff ? 'one-off' : planMonthly(c), yearly: oneOff ? c.cad : pR(planMonthly(c) * 12),
               lastPaid: c.lastPaid ? c.lastPaid.date : '', notes: (oneOff ? 'One-off. ' : '') + c.notes };
    })
    .sort(function (a, b) { return b.yearly - a.yearly; });
  W.undecidedYearly = pR(W.undecided.reduce(function (s, x) { return s + x.yearly; }, 0));

  W.stillCharging = [];
  commits.forEach(function (c) {
    if (c.decision !== 'Cancel' || !c.decidedOn) return;
    c.hits.forEach(function (i) {
      var t = tx[i];
      if (t.date > pAddDays(c.decidedOn, 2)) W.stillCharging.push({ name: c.name, date: t.date, cad: Math.abs(t.cad), decidedOn: c.decidedOn });
    });
  });
  W.cancelledSaving = pR(commits.filter(function (c) { return c.decision === 'Cancel'; })
    .reduce(function (s, c) { return s + planMonthly(c) * 12; }, 0));

  W.priceUp = M.dues.filter(function (d) { return d.up && d.paidOn >= pAddDays(today, -62); });

  var since90 = pAddDays(M.dataThrough || today, -90), since30 = pAddDays(M.dataThrough || today, -30);
  var fees = {};
  tx.forEach(function (t) {
    if (t.date <= since90 || t.cad >= 0) return;
    if (t.group !== 'Fees & charges' && !/\b(INTEREST CHARGE|FINANCE CHARGE|LATE (PAYMENT )?FEE|OVERLIMIT|NSF|ANNUAL FEE)\b/i.test(t.desc)) return;
    var p = t.payee || t.desc.slice(0, 40);
    fees[p] = fees[p] || { payee: p, cad: 0, n: 0, desc: t.desc };
    fees[p].cad = pR(fees[p].cad - t.cad); fees[p].n++;
  });
  var feeDays = Math.max(30, Math.min(90, pDaysBetween(all.length ? all[0].date : today, M.dataThrough || today)));
  // A fee on the Commitments list is annualised from its listed amount;
  // anything else from the rate seen in the data.
  W.fees = Object.keys(fees).map(function (p) {
    var f = fees[p];
    var c = commits.filter(function (x) { return !x.anyDesc && x.re.test(f.desc + ' | ' + p); })[0];
    f.yearly = c ? pR(planMonthly(c) * 12) : pR(f.cad * 365 / feeDays);
    return f;
  })
    .sort(function (a, b) { return b.cad - a.cad; });
  W.feesYearly = pR(W.fees.reduce(function (s, f) { return s + f.yearly; }, 0));

  var habits = {};
  tx.forEach(function (t) {
    if (t.date <= since30 || t.group !== 'Lifestyle' || t.cad >= 0) return;
    var p = t.payee && t.payee !== 'Needs labelling' ? t.payee : t.desc.slice(0, 30);
    habits[p] = habits[p] || { payee: p, cat: t.cat, n: 0, cad: 0 };
    habits[p].n++; habits[p].cad = pR(habits[p].cad - t.cad);
  });
  W.habits = Object.keys(habits).map(function (p) { var h = habits[p]; h.yearly = pR(h.cad * 365 / 30); return h; })
    .filter(function (h) { return h.n >= PLAN.HABIT_MIN; })
    .sort(function (a, b) { return b.yearly - a.yearly; });

  W.lifestyle = Object.keys(cats['Lifestyle'] || {}).map(function (c) {
    var lm = fullMonths.length ? (cats['Lifestyle'][c][lastMonth] || 0) : 0;
    return { cat: c, thisM: cats['Lifestyle'][c][thisMonth] || 0, lastM: lm, yearly: pR(lm * 12) };
  }).sort(function (a, b) { return b.yearly - a.yearly || b.thisM - a.thisM; });
  W.lifestyleYearly = pR(W.lifestyle.reduce(function (s, x) { return s + x.yearly; }, 0));
  M.waste = W;

  // ---- recurring charges not on the list yet ----------------------------
  // A payee charged in 2+ different months, at most twice a month, at a
  // steady amount (within 25% of the median), in a spending group.
  var byPayee = {};
  tx.forEach(function (t, i) {
    if (used[i] || t.cad >= 0) return;
    if (['Moved between your accounts', 'House construction', 'Lent out', 'Essentials', 'Income', 'Not labelled yet'].indexOf(t.group) !== -1) return;
    if (!t.payee || t.payee === 'Needs labelling') return;
    if (commits.some(function (c) { return !c.anyDesc && c.re.test(t.desc + ' | ' + t.payee); })) return;
    (byPayee[t.payee] = byPayee[t.payee] || []).push(t);
  });
  M.detected = [];
  Object.keys(byPayee).forEach(function (p) {
    var rows = byPayee[p], perMonth = {};
    rows.forEach(function (t) { perMonth[t.month] = (perMonth[t.month] || 0) + 1; });
    var ms = Object.keys(perMonth);
    if (ms.length < 2 || ms.some(function (m) { return perMonth[m] > 2; })) return;
    var amts = rows.map(function (t) { return Math.abs(t.amt); }).sort(function (a, b) { return a - b; });
    var med = amts[Math.floor(amts.length / 2)];
    if (amts.some(function (a) { return Math.abs(a - med) > med * 0.25; })) return;
    var days = rows.map(function (t) { return +t.date.slice(8, 10); }).sort(function (a, b) { return a - b; });
    var last = rows[rows.length - 1];
    M.detected.push([p, p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), med, last.cur, 'Monthly', days[Math.floor(days.length / 2)],
                     last.acct, last.cat, 'Review', '', '', 'Found automatically on ' + today + ' — charged in ' + ms.length + ' months.']);
  });

  // Decisions made since the last refresh get today's date.
  M.decidedFill = commits.filter(function (c) { return c.decision && !/^review$/i.test(c.decision) && !c.decidedOn; })
    .map(function (c) { return c.row; });

  // ---- data health -------------------------------------------------------
  var unl = {};
  var nUnl = 0;
  tx.forEach(function (t) {
    if (t.group !== 'Not labelled yet' && t.payee !== 'Needs labelling') return;
    nUnl++;
    var k2 = t.desc.replace(/[0-9]{4,}/g, '').slice(0, 45);
    unl[k2] = unl[k2] || { desc: k2, n: 0, cad: 0 };
    unl[k2].n++; unl[k2].cad = pR(unl[k2].cad - t.cad);
  });
  M.unlabelled = { count: nUnl, top: Object.keys(unl).map(function (k3) { return unl[k3]; })
    .sort(function (a, b) { return Math.abs(b.cad) - Math.abs(a.cad); }).slice(0, 8) };

  // Phase 2 progress: every non-income commitment has a decision.
  var outs = commits.filter(function (c) { return !c.income; });
  M.progress = { total: outs.length, decided: outs.length - W.undecided.length };
  return M;
}


/* ---------------------------------------------------------------------------
   Labels shared by the sheet and the emails
   --------------------------------------------------------------------------- */

function planDueStatus(d) {
  if (d.state === 'nodate')   return '📌 Owed — no date set';
  if (d.state === 'paid')     return (d.income ? '✅ Received ' : '✅ Paid ') + d.paidOn + (d.up ? '  ⚠ ' + d.up + ' more than listed' : '');
  if (d.state === 'upcoming') return d.inDays === 0 ? '⏳ Due today' : '⏳ Due in ' + d.inDays + ' day' + (d.inDays === 1 ? '' : 's');
  if (d.state === 'due')      return (d.income ? '⏳ Expected — not in yet' : '⏳ Due — not seen yet') +
                                     (d.coverage ? ' (' + (d.acct || 'account') + ' data ends ' + d.coverage + ')' : '');
  if (d.state === 'missed')   return d.income ? '🔴 Not received' : '🔴 Not paid (statements cover this date)';
  if (!d.acct) return '❔ Not seen in any statement — set Account on the Commitments tab';
  return '❔ Can\'t tell yet — ' + d.acct + ' data ends ' + (d.coverage || '—') + ', upload it';
}

function planMoney(n) {
  var s = Math.abs(n).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (n < 0 ? '−$' : '$') + s;
}


/* ===========================================================================
   Sheet side (Apps Script services from here on)
   =========================================================================== */

/**
 * Rebuild the Dashboard. ss is optional (onEdit passes its own, because a
 * simple trigger may not open a spreadsheet by id).
 * quick = true skips appending newly detected commitments.
 */
function refreshDashboard(ss, quick) {
  ss = ss || SpreadsheetApp.openById(CFG.SHEET_ID);
  var commitSh = planCommitmentsTab(ss);
  var tx = getTab(ss, CFG.TAB_TX);
  var txVals = tx && tx.getLastRow() > 1 ? tx.getRange(2, 1, tx.getLastRow() - 1, CFG.COLS.length).getValues() : [];
  var today = Utilities.formatDate(new Date(), CFG_TZ(), 'yyyy-MM-dd');

  if (!quick) {
    planAddOnce(commitSh, 'plan_seed_v2', PLAN_ADD_V2);
    planAddOnce(commitSh, 'plan_seed_v3', PLAN_ADD_V3);
    planTidyTabs(ss);
  }
  var cv = planCommitValues(commitSh);
  var M = planAnalyse(txVals, cv, { today: today, fx: CFG.FX_TO_CAD });

  // Write back to Commitments: decision dates, then newly found recurring charges.
  var changed = false;
  M.decidedFill.forEach(function (row) { commitSh.getRange(row, 10).setValue(today); changed = true; });
  if (!quick && M.detected.length) {
    commitSh.getRange(commitSh.getLastRow() + 1, 1, M.detected.length, PLAN.COMMIT_COLS.length).setValues(M.detected);
    changed = true;
  }
  if (changed) M = planAnalyse(txVals, planCommitValues(commitSh), { today: today, fx: CFG.FX_TO_CAD });

  planRender(ss, M);
  return M;
}

/**
 * Once: put the tabs you use first and hide the ones you never need to open.
 * Hidden tabs keep working (the script still writes _Runs, _Issues,
 * _Balances); right-click any tab bar › Show to see them again. Month Ahead
 * and Summary are superseded by the Dashboard; Sheet4 is hidden only if empty.
 */
function planTidyTabs(ss) {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('plan_tidy_v1')) return;
  var order = [PLAN.TAB_DASH, PLAN.TAB_COMMIT, CFG.TAB_TX, CFG.TAB_PAYEES];
  order.forEach(function (name, i) {
    var sh = getTab(ss, name);
    if (!sh) return;
    ss.setActiveSheet(sh);
    ss.moveActiveSheet(i + 1);
  });
  ['Month Ahead', 'Summary', CFG.TAB_RUNS, CFG.TAB_ISSUES, CFG.TAB_BALANCES, 'Sheet4'].forEach(function (name) {
    var sh = getTab(ss, name);
    if (!sh || sh.isSheetHidden()) return;
    if (name === 'Sheet4' && sh.getLastRow() > 0) return;
    sh.hideSheet();
  });
  ss.setActiveSheet(getTab(ss, PLAN.TAB_DASH));
  props.setProperty('plan_tidy_v1', new Date().toISOString());
}

/** Append rows to Commitments once per key, skipping names already on the tab. */
function planAddOnce(sh, key, rows) {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty(key)) return;
  var have = {};
  planCommitValues(sh).forEach(function (r) { have[String(r[0]).trim().toLowerCase()] = true; });
  var add = rows.filter(function (r) { return !have[String(r[0]).trim().toLowerCase()]; });
  if (add.length) sh.getRange(sh.getLastRow() + 1, 1, add.length, PLAN.COMMIT_COLS.length).setValues(add);
  props.setProperty(key, new Date().toISOString());
}

function planCommitValues(sh) {
  var last = sh.getLastRow();
  return last > 1 ? sh.getRange(2, 1, last - 1, PLAN.COMMIT_COLS.length).getValues() : [];
}

/** The Commitments tab, created and seeded on first use. */
function planCommitmentsTab(ss) {
  var sh = getTab(ss, PLAN.TAB_COMMIT);
  if (sh) return sh;
  sh = ss.insertSheet(PLAN.TAB_COMMIT);
  sh.getRange(1, 1, 1, PLAN.COMMIT_COLS.length).setValues([PLAN.COMMIT_COLS])
    .setFontWeight('bold').setBackground('#f1f3f4');
  var seed = PLAN_SEED.concat(PLAN_ADD_V2, PLAN_ADD_V3);
  sh.getRange(2, 1, seed.length, PLAN.COMMIT_COLS.length).setValues(seed);
  sh.setFrozenRows(1);
  sh.getRange('B:B').setNumberFormat('@');
  var rows = sh.getMaxRows() - 1;
  sh.getRange(2, 5, rows, 1).setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInList(PLAN.FREQUENCIES, true).setAllowInvalid(false).build());
  sh.getRange(2, 9, rows, 1).setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInList(PLAN.DECISIONS, true).setAllowInvalid(true).build());
  sh.getRange(2, 3, rows, 1).setNumberFormat('#,##0.00');
  [200, 190, 90, 70, 90, 90, 110, 110, 80, 90, 90, 380].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  sh.getRange('A1').setNote(
    'Everything that recurs: bills, loans, subscriptions, fees and income.\n\n' +
    'Match: text (or a regex) found in the bank description or payee.\n' +
    'Due: day of month (Monthly), weekday (Weekly), or a date (Yearly, One-off, Biweekly anchor).\n' +
    'Account: which account pays it, e.g. RBC, Neo, HDFC Savings.\n' +
    'Decision: Keep or Cancel — this is the Phase 2 decision. Blank = still to decide.\n' +
    'Rows are added automatically when a new recurring charge appears. Add one-off payments you owe as One-off.');
  sh.getRange('I1').setNote('Keep or Cancel. The dashboard lists everything without a decision as "waiting for you".');
  return sh;
}


/* ---- rendering ---------------------------------------------------------- */

var P_W = 8;   // dashboard width in columns

function planRender(ss, M) {
  var sh = getTab(ss, PLAN.TAB_DASH);
  if (!sh) { sh = ss.insertSheet(PLAN.TAB_DASH, 0); }
  var out = [], fmt = { title: [], head: [], money: [], money2: [], red: [], amber: [], grey: [], green: [], bold: [], note: [] };

  function row(cells, style) {
    var r = cells.slice(0, P_W);
    while (r.length < P_W) r.push('');
    out.push(r);
    var n = out.length;
    if (style) (Array.isArray(style) ? style : [style]).forEach(function (s) { fmt[s].push('A' + n + ':' + String.fromCharCode(64 + P_W) + n); });
    return n;
  }
  function money(n, cols, two) {   // cols: 1-based column numbers holding money on row n
    cols.forEach(function (c) { fmt[two ? 'money2' : 'money'].push(String.fromCharCode(64 + c) + n); });
  }
  function gap() { row([]); }
  function title(t) { gap(); row([t], 'title'); }

  var ts = Utilities.formatDate(new Date(), CFG_TZ(), 'yyyy-MM-dd HH:mm');
  row(['💰 Finance — where you stand'], 'title');
  row(['Rebuilt ' + ts + ' · statements up to ' + (M.dataThrough || '—') +
       ' · updates itself after every upload and every morning. Don\'t edit this tab — decide things on the Commitments tab.'], 'note');

  // ---- what to upload: stale statements hide everything below ---------------
  var stale = M.accounts.filter(function (a) { return a.behind > PLAN.STALE_DAYS; });
  if (stale.length) {
    gap();
    var nb = row(['⚠ Upload statements to see the real picture: ' + stale.map(function (a) {
      var blind = M.dues.filter(function (d) { return d.state === 'unseen' && d.acct && planAcctMatches(d.acct, a.name); }).length;
      return a.name + ' (' + a.behind + ' days' + (blind ? ', ' + blind + ' payments unconfirmed' : '') + ')';
    }).join(' · ')], 'bold');
    fmt.amber.push('A' + nb + ':H' + nb);
  }

  // ---- at a glance -------------------------------------------------------
  title('At a glance (CAD)');
  row(['', 'Money in', 'Living costs', 'House construction', 'Lent (net) / saved', 'Net'], 'head');
  function flowRow(label, f) { var n = row([label, f.inn, f.living, f.house, f.other, f.net]); money(n, [2, 3, 4, 5, 6]); if (f.net < 0) fmt.red.push('F' + n); }
  flowRow(pMonthName(M.thisMonth) + ' so far', M.flowThis);
  if (M.flowLast) flowRow(pMonthName(M.lastMonth), M.flowLast);
  if (M.flowAvg && M.fullMonths.length > 1) flowRow('Average of last ' + M.fullMonths.length + ' months', M.flowAvg);
  var p = M.progress;
  var n0 = row(['Phase 2 progress', p.decided + ' of ' + p.total + ' recurring costs decided',
                '', M.waste.undecided.length ? M.waste.undecided.length + ' waiting for Keep/Cancel (' + planMoney(M.waste.undecidedYearly) + '/yr)' : 'All decided ✅'], 'bold');
  if (M.waste.undecided.length) fmt.amber.push('A' + n0 + ':H' + n0);

  // ---- this month's plan ---------------------------------------------------
  title('This month\'s plan — ' + pMonthName(M.thisMonth));
  var o = M.outlook;
  [['Expected in', o.expectedIn, 'Income rows on the Commitments tab due this month'],
   ['Committed bills & loans', -o.committed, 'Every Keep/undecided commitment due this month'],
   ['Everyday spending', -o.everyday, 'Average of the last ' + M.fullMonths.length + ' full month(s), bills excluded'],
   ['Left over', o.leftOver, ''],
   ['House construction pace', -o.house, 'Monthly average — a project, not a living cost'],
   ['Left over after the house', o.leftAfterHouse, ''],
   ['Still to pay this month', -o.remainingOut, 'Commitments not seen paid yet'],
   ['Still to come in this month', o.remainingIn, '']
  ].forEach(function (x, i) {
    var n = row([x[0], x[1], x[2]], i === 3 || i === 5 ? 'bold' : null);
    money(n, [2]);
    if ((i === 3 || i === 5) && x[1] < 0) fmt.red.push('A' + n + ':B' + n);
    if ((i === 3 || i === 5) && x[1] >= 0) fmt.green.push('A' + n + ':B' + n);
  });

  // ---- still to pay --------------------------------------------------------
  title('🧾 Still to pay — needs you now, then the next 14 days');
  row(['Due', 'What', 'Amount (CAD)', 'Amount', 'Status', 'Account', 'Note'], 'head');
  var monthStart = M.thisMonth + '-01';
  var prevStart = pMonthAdd(M.thisMonth, -1) + '-01';
  var live = M.dues.filter(function (d) { return d.state !== 'paid' && d.decision !== 'Cancel'; });
  var now = live.filter(function (d) {
    return d.state === 'nodate' || d.state === 'due' ||
           (d.state === 'missed' && d.date >= prevStart) ||
           (d.state === 'upcoming' && d.inDays <= 14);
  });
  if (!now.length) row(['Nothing due in the next 14 days.']);
  now.forEach(function (d) {
    var n = row([d.date, (d.income ? '⬇ ' : '') + d.name, d.cad, d.amount + ' ' + d.cur, planDueStatus(d), d.acct, d.notes]);
    money(n, [3], true);
    if (d.state === 'missed') fmt.red.push('A' + n + ':H' + n);
    else if (d.state === 'due' || d.state === 'nodate' || d.inDays <= 7) fmt.amber.push('A' + n + ':H' + n);
  });
  // Payments the statements cannot confirm yet: one line per account, not one per bill.
  var blind = {};
  live.forEach(function (d) {
    if (d.state !== 'unseen' || d.date < prevStart) return;
    var k = d.acct || '(no account set)';
    (blind[k] = blind[k] || { names: [], cad: 0, cov: d.coverage }).names.push(d.name + ' ' + d.date.slice(5));
    blind[k].cad += d.cad;
  });
  Object.keys(blind).forEach(function (k) {
    var b = blind[k];
    var n = row(['❔ Can\'t confirm yet', k + (b.cov && k !== '(no account set)' ? ' — statements stop ' + b.cov : ''), pR(b.cad), '',
                 b.names.length + ' payment(s): ' + b.names.join(', ')], 'grey');
    money(n, [3], true);
  });
  var later = live.filter(function (d) { return d.state === 'upcoming' && d.inDays > 14 && !d.income; });
  if (later.length) {
    var nl = row(['Later', later.length + ' more bill(s) in 15–35 days', pR(later.reduce(function (s2, d) { return s2 + d.cad; }, 0)), '',
                  later.map(function (d) { return d.name; }).filter(function (x, i, a) { return a.indexOf(x) === i; }).join(', ')], 'note');
    money(nl, [3], true);
  }
  if (M.cards.length) {
    gap();
    row(['Credit card', 'Spent since last payment', 'Last payment', 'Data up to'], 'head');
    M.cards.forEach(function (c) {
      var n = row([c.acct, c.spent, c.lastPay ? c.lastPay.date + ' (' + planMoney(c.lastPay.cad) + ')' : 'none seen', c.through]);
      money(n, [2], true);
    });
  }

  gap();
  row(['✅ Already paid / received this month'], 'bold');
  row(['Due', 'What', 'Paid (CAD)', 'Listed', 'Status'], 'head');
  var paid = M.dues.filter(function (d) { return d.state === 'paid' && d.date >= monthStart && d.date <= pAddDays(M.today, 0); });
  if (!paid.length) row(['None seen yet this month.']);
  paid.forEach(function (d) {
    var n = row([d.date, (d.income ? '⬇ ' : '') + d.name, d.paidCad, d.amount + ' ' + d.cur, planDueStatus(d)]);
    money(n, [3], true);
    if (d.up) fmt.amber.push('A' + n + ':H' + n);
  });

  // ---- waste ---------------------------------------------------------------
  var W = M.waste;
  title('🔥 Where you\'re wasting money');
  row(['1. Recurring costs waiting for your Keep / Cancel', '', 'Per month', 'Per year', 'Last charged', 'Note'], 'head');
  if (!W.undecided.length) row(['Every recurring cost has a decision ✅']);
  W.undecided.forEach(function (u) {
    var n = row([u.name, '', u.monthly, u.yearly, u.lastPaid || 'not seen', u.notes]);
    money(n, [3, 4], true);
  });
  if (W.undecided.length) { var nt = row(['Total you could still trim', '', pR(W.undecidedYearly / 12), W.undecidedYearly], 'bold'); money(nt, [3, 4]); }
  if (W.cancelledSaving) { var nc = row(['Already cancelled — saves', '', pR(W.cancelledSaving / 12), W.cancelledSaving], 'green'); money(nc, [3, 4]); }

  gap();
  row(['2. Cancelled but still charging'], 'head');
  if (!W.stillCharging.length) row(['Nothing — every cancelled item has stopped (or not charged since you decided).']);
  W.stillCharging.forEach(function (s) {
    var n = row([s.name, 'charged ' + s.date, s.cad, 'cancelled ' + s.decidedOn], 'red'); money(n, [3], true);
  });

  gap();
  row(['3. Bills that went up', '', 'Extra', 'On'], 'head');
  if (!W.priceUp.length) row(['None — every bill was paid at its listed amount.']);
  W.priceUp.forEach(function (d) { row([d.name, '', d.up + ' ' + d.cur, d.paidOn + ' (' + d.paidAmt + ' vs ' + d.amount + ')'], 'amber'); });

  gap();
  row(['4. Fees & charges (pure waste)', 'Times', 'Last 90 days', 'Per year'], 'head');
  if (!W.fees.length) row(['No fees seen.']);
  W.fees.forEach(function (f) { var n = row([f.payee, f.n, f.cad, f.yearly]); money(n, [3, 4], true); });
  if (W.fees.length) { var nf = row(['Fees per year at this rate', '', '', W.feesYearly], 'bold'); money(nf, [4]); }

  gap();
  row(['5. Small habits that add up (last 30 days of data)', 'Times', 'Spent', 'Per year', 'Category'], 'head');
  if (!W.habits.length) row(['No place visited ' + PLAN.HABIT_MIN + '+ times in 30 days.']);
  W.habits.forEach(function (h) { var n = row([h.payee, h.n, h.cad, h.yearly, h.cat]); money(n, [3, 4], true); });

  gap();
  row(['6. Lifestyle spending', '', pMonthName(M.thisMonth) + ' so far', M.fullMonths.length ? pMonthName(M.lastMonth) : '', 'Per year at last month\'s rate'], 'head');
  W.lifestyle.forEach(function (l) { var n = row([l.cat, '', l.thisM, l.lastM, l.yearly]); money(n, [3, 4, 5]); });
  if (W.lifestyle.length) { var nl = row(['All lifestyle', '', '', '', W.lifestyleYearly], 'bold'); money(nl, [5]); }

  // ---- where the money goes ------------------------------------------------
  title('📊 Where your money goes (CAD, net of refunds)');
  var withAvg = M.fullMonths.length > 1;
  var head = ['Group / category', ''].concat(M.months.map(pMonthName));
  if (withAvg) head.push('Avg of ' + M.fullMonths.length + ' full months');
  row(head.slice(0, P_W), 'head');
  PLAN.GROUP_ORDER.forEach(function (g) {
    if (!M.cats[g]) return;
    var gRow = [g, ''].concat(M.months.map(function (m) { return M.groupMonth(g, m); }));
    if (withAvg) gRow.push(pR(M.fullMonths.reduce(function (s, m) { return s + M.groupMonth(g, m); }, 0) / M.fullMonths.length));
    var n = row(gRow.slice(0, P_W), g === 'Moved between your accounts' ? 'grey' : 'bold');
    money(n, gRow.slice(2, P_W).map(function (_, i) { return i + 3; }));
    Object.keys(M.cats[g]).sort(function (a, b) {
      return (M.cats[g][b][M.lastMonth] || 0) + (M.cats[g][b][M.thisMonth] || 0) - (M.cats[g][a][M.lastMonth] || 0) - (M.cats[g][a][M.thisMonth] || 0);
    }).forEach(function (c) {
      var cRow = ['', c].concat(M.months.map(function (m) { return M.cats[g][c][m] || 0; }));
      if (withAvg) cRow.push(pR(M.fullMonths.reduce(function (s, m) { return s + (M.cats[g][c][m] || 0); }, 0) / M.fullMonths.length));
      var n2 = row(cRow.slice(0, P_W), g === 'Moved between your accounts' ? 'grey' : null);
      money(n2, cRow.slice(2, P_W).map(function (_, i) { return i + 3; }));
    });
  });
  row(['"Moved between your accounts" (card payments, own transfers, money sent to India) is shown for reference and left out of every total.'], 'note');

  title('Biggest payees');
  row(['' + pMonthName(M.thisMonth) + ' so far', 'Category', 'Spent', 'Times', '', M.fullMonths.length ? pMonthName(M.lastMonth) : '', 'Spent', 'Times'], 'head');
  for (var i = 0; i < Math.max(M.topThis.length, M.topLast.length); i++) {
    var a = M.topThis[i], b = M.topLast[i];
    var n3 = row([a ? a.payee : '', a ? a.cat : '', a ? a.cad : '', a ? a.n : '', '', b ? b.payee : '', b ? b.cad : '', b ? b.n : '']);
    money(n3, [3, 7], true);
  }

  // ---- data health ---------------------------------------------------------
  title('🧹 Data health');
  row(['Account', 'Latest transaction', 'Days behind'], 'head');
  M.accounts.forEach(function (a) {
    var n = row([a.name, a.last, a.behind]);
    if (a.behind > 14) fmt.amber.push('A' + n + ':C' + n);
  });
  gap();
  row([M.unlabelled.count + ' transaction(s) have no payee/category yet — they count under "Not labelled yet". Add a Payees pattern, then Finance › Re-label everything.'], M.unlabelled.count ? 'amber' : 'note');
  M.unlabelled.top.forEach(function (u) { var n = row([u.desc, u.n + '×', u.cad]); money(n, [3], true); });

  // ---- write ---------------------------------------------------------------
  sh.clear();
  sh.getRange(1, 1, out.length, P_W).setValues(out);
  function apply(list, fn) { if (list.length) fn(sh.getRangeList(list)); }
  apply(fmt.money,  function (r) { r.setNumberFormat('$#,##0;[Red]-$#,##0'); });
  apply(fmt.money2, function (r) { r.setNumberFormat('$#,##0.00;[Red]-$#,##0.00'); });
  apply(fmt.head,   function (r) { r.setFontWeight('bold').setBackground('#f1f3f4'); });
  apply(fmt.bold,   function (r) { r.setFontWeight('bold'); });
  apply(fmt.title,  function (r) { r.setFontWeight('bold').setFontSize(12).setBackground('#e8f0fe'); });
  apply(fmt.note,   function (r) { r.setFontColor('#5f6368').setFontStyle('italic'); });
  apply(fmt.red,    function (r) { r.setBackground('#fce8e6'); });
  apply(fmt.amber,  function (r) { r.setBackground('#fef7e0'); });
  apply(fmt.grey,   function (r) { r.setFontColor('#80868b'); });
  apply(fmt.green,  function (r) { r.setBackground('#e6f4ea'); });
  [260, 190, 120, 120, 280, 120, 110, 110].forEach(function (w, c) { sh.setColumnWidth(c + 1, w); });
  sh.setFrozenRows(2);
  SpreadsheetApp.flush();
}


/* ---- automatic refresh ---------------------------------------------------- */

/**
 * Called from every Inbox poll. Cheap unless it is the first poll of the
 * day: then it rebuilds the dashboard (due dates move with the calendar),
 * and in the first days of a month it sends last month's review.
 */
function planDaily() {
  var props = PropertiesService.getScriptProperties();
  var today = Utilities.formatDate(new Date(), CFG_TZ(), 'yyyy-MM-dd');
  // Keyed on the code version too, so a deploy that bumps PLAN.VERSION
  // rebuilds on the next poll instead of the next morning.
  var stamp = today + '|' + PLAN.VERSION;
  if (props.getProperty('plan_day') === stamp) return;
  props.setProperty('plan_day', stamp);
  var M = refreshDashboard();
  var month = today.slice(0, 7);
  if (+today.slice(8, 10) <= PLAN.REVIEW_BY_DAY && props.getProperty('plan_review') !== month) {
    props.setProperty('plan_review', month);
    sendMonthlyReview(M);
  }
}

/** Simple trigger: a Keep/Cancel decision shows on the dashboard straight away. */
function onEdit(e) {
  try {
    if (!e || !e.range || e.range.getSheet().getName() !== PLAN.TAB_COMMIT) return;
    refreshDashboard(e.source, true);
  } catch (err) {
    // A simple trigger has no one to report to; the daily refresh catches up.
  }
}


/* ---- emails ----------------------------------------------------------------- */

function planDashUrl(ss) {
  var sh = getTab(ss || SpreadsheetApp.openById(CFG.SHEET_ID), PLAN.TAB_DASH);
  return sheetUrl() + (sh ? '#gid=' + sh.getSheetId() : '');
}

/** "Due this week" block for the Friday reminder. */
function planDigestHtml(M) {
  var soon = M.dues.filter(function (d) {
    return d.state !== 'paid' && d.decision !== 'Cancel' &&
           ((d.state === 'missed' && d.date >= pAddDays(M.today, -14)) || d.state === 'due' || (d.state === 'upcoming' && d.inDays <= 7));
  });
  var h = ['<h3 style="margin:18px 0 6px">🧾 Money due this week</h3>'];
  if (!soon.length) h.push('<p>Nothing due in the next 7 days.</p>');
  else {
    h.push('<table cellpadding="6" style="border-collapse:collapse;font-size:13px">');
    soon.forEach(function (d) {
      h.push('<tr style="border-top:1px solid #e0e0e0' + (d.state === 'missed' ? ';background:#fce8e6' : '') + '"><td>' + esc(d.date) +
             '</td><td>' + esc(d.name) + '</td><td align="right">' + esc(d.amount + ' ' + d.cur) + '</td><td>' + esc(planDueStatus(d)) + '</td></tr>');
    });
    h.push('</table>');
  }
  if (M.waste.undecided.length) {
    h.push('<p>' + M.waste.undecided.length + ' recurring cost(s) still need a Keep/Cancel decision — ' +
           planMoney(M.waste.undecidedYearly) + ' a year between them.</p>');
  }
  if (M.waste.stillCharging.length) h.push('<p style="color:#c5221f">⚠ ' + M.waste.stillCharging.length + ' charge(s) from something you cancelled.</p>');
  h.push('<p>' + button(planDashUrl(), 'Open the dashboard') + '</p>');
  return h.join('\n');
}

/** First days of each month: how last month went. */
function sendMonthlyReview(M) {
  if (!M.flowLast) return;
  var f = M.flowLast, W = M.waste;
  var rows = [];
  PLAN.GROUP_ORDER.forEach(function (g) {
    if (!M.cats[g] || g === 'Moved between your accounts' || g === 'Income') return;
    var v = M.groupMonth(g, M.lastMonth);
    if (v) rows.push('<tr style="border-top:1px solid #e0e0e0"><td>' + esc(g) + '</td><td align="right">' + planMoney(v) + '</td></tr>');
  });
  var h = ['<div style="font-family:Arial,sans-serif;font-size:14px;color:#202124">',
    '<p><b>' + esc(pMonthName(M.lastMonth)) + '</b>: in ' + planMoney(f.inn) + ', living costs ' + planMoney(f.living) +
    ', house ' + planMoney(f.house) + ', lent/saved ' + planMoney(f.other) + ' → <b>net ' + planMoney(f.net) + '</b>.</p>',
    '<table cellpadding="6" style="border-collapse:collapse;font-size:13px">' + rows.join('') + '</table>',
    '<h3 style="margin:18px 0 6px">🔥 Worth trimming</h3><ul>'];
  if (W.undecided.length) h.push('<li>' + W.undecided.length + ' recurring cost(s) with no decision: ' + planMoney(W.undecidedYearly) + '/yr</li>');
  if (W.feesYearly) h.push('<li>Bank fees: ' + planMoney(W.feesYearly) + '/yr</li>');
  W.habits.slice(0, 3).forEach(function (x) { h.push('<li>' + esc(x.payee) + ': ' + x.n + ' times in 30 days — ' + planMoney(x.yearly) + '/yr</li>'); });
  W.stillCharging.forEach(function (x) { h.push('<li style="color:#c5221f">' + esc(x.name) + ' charged ' + esc(x.date) + ' after you cancelled it</li>'); });
  W.priceUp.forEach(function (x) { h.push('<li>' + esc(x.name) + ' went up by ' + x.up + ' ' + esc(x.cur) + '</li>'); });
  h.push('</ul>');
  var o = M.outlook;
  h.push('<p><b>' + esc(pMonthName(M.thisMonth)) + ' plan:</b> expected in ' + planMoney(o.expectedIn) + ', bills ' + planMoney(o.committed) +
         ', everyday ' + planMoney(o.everyday) + ' → left over ' + planMoney(o.leftOver) + ' (' + planMoney(o.leftAfterHouse) + ' after the house).</p>');
  h.push(planDigestHtml(M));
  h.push('</div>');
  MailApp.sendEmail({ to: notifyAddress(), subject: '📊 ' + pMonthName(M.lastMonth) + ' review — net ' + planMoney(f.net), htmlBody: h.join('\n') });
}


/** A failure in a background refresh, recorded where the pipeline records its own. */
function planIssue(what, err) {
  try {
    appendRows(getTab(SpreadsheetApp.openById(CFG.SHEET_ID), CFG.TAB_ISSUES),
               [[new Date(), 'Plan.gs', '', what, '', String(err && err.stack || err)]]);
  } catch (e) {
    Logger.log(what + ': ' + err);
  }
}

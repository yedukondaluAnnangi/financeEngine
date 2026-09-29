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
  VERSION    : '2026-09-29.13',   // bump on every change to force a rebuild on the next poll
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
 * Upkeep: make sure every formula is in place and every input is complete.
 * Nothing on the Dashboard is calculated here — the sheet does that live.
 *   - Commitments: one-time additions, decision dates, newly spotted
 *     recurring charges (Review), formulas on every row
 *   - Categories: any category not listed yet, currency rates
 *   - Dashboard and _Calc: rewritten when the code version changes
 * ss is optional. quick = true skips the one-time additions and detection.
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
    planPayeesOnce(ss);
  }
  // The script still reads the data for two jobs a formula cannot do:
  // dating a new decision, and spotting a new recurring charge.
  var M = planAnalyse(txVals, planCommitValues(commitSh), { today: today, fx: CFG.FX_TO_CAD });
  M.decidedFill.forEach(function (row) { commitSh.getRange(row, 10).setValue(today); });
  if (!quick && M.detected.length) {
    commitSh.getRange(commitSh.getLastRow() + 1, 1, M.detected.length, PLAN.COMMIT_COLS.length).setValues(M.detected);
  }

  var cats = txVals.map(function (r) { return r[9]; })
    .concat(planCommitValues(commitSh).map(function (r) { return r[7]; }));
  planInstallFormulas(ss, commitSh, cats);
  SpreadsheetApp.flush();
}

/**
 * Once: put the tabs you use first and hide the ones you never need to open.
 * Hidden tabs keep working (the script still writes _Runs, _Issues,
 * _Balances); right-click any tab bar › Show to see them again. Month Ahead
 * and Summary are superseded by the Dashboard; Sheet4 is hidden only if empty.
 */
function planTidyTabs(ss) {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('plan_tidy_v2')) return;
  var order = [PLAN.TAB_DASH, PLAN.TAB_COMMIT, CFG.TAB_TX, CFG.TAB_PAYEES, 'Categories'];
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
  props.setProperty('plan_tidy_v2', new Date().toISOString());
}

/**
 * Once: Payees rows the labelling needs for Commitments added on 29 Sep.
 * A PhonePe line does not name who was paid, so the India rent is told apart
 * by its amount; the row must sit above the generic "UPI-PHONEPE" catch-all
 * because the first matching row wins. It labels new uploads; past rows are
 * left alone so no hand-made label is overwritten.
 */
function planPayeesOnce(ss) {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('plan_payees_v1')) return;
  var sh = getTab(ss, CFG.TAB_PAYEES);
  if (!sh) return;
  var vals = sh.getRange(1, 1, sh.getLastRow(), 4).getValues();
  var have = vals.some(function (r) { return String(r[1]) === 'Rent — India'; });
  if (!have) {
    var at = -1;
    vals.forEach(function (r, i) { if (at < 0 && String(r[0]).trim() === 'UPI-PHONEPE' && r[3] === '') at = i + 1; });
    if (at > 0) {
      sh.insertRowBefore(at);
      sh.getRange(at, 1, 1, 4).setValues([['UPI-PHONEPE', 'Rent — India', 'Rent', 9000]]);
    }
  }
  props.setProperty('plan_payees_v1', new Date().toISOString());
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


/* ---- automatic upkeep ---------------------------------------------------------- */

/**
 * Called from every Inbox poll. Cheap unless it is the first poll of the
 * day (or the first after a deploy): then it runs the upkeep, and in the
 * first days of a month it sends last month's review.
 */
function planDaily() {
  var props = PropertiesService.getScriptProperties();
  var today = Utilities.formatDate(new Date(), CFG_TZ(), 'yyyy-MM-dd');
  // Keyed on the code version too, so a deploy that bumps PLAN.VERSION
  // runs the upkeep on the next poll instead of the next morning.
  var stamp = today + '|' + PLAN.VERSION;
  if (props.getProperty('plan_day') === stamp) return;
  props.setProperty('plan_day', stamp);
  var ss = SpreadsheetApp.openById(CFG.SHEET_ID);
  refreshDashboard(ss);
  var month = today.slice(0, 7);
  if (+today.slice(8, 10) <= PLAN.REVIEW_BY_DAY && props.getProperty('plan_review') !== month) {
    props.setProperty('plan_review', month);
    SpreadsheetApp.flush();
    sendMonthlyReview(ss);
  }
}

/**
 * Simple trigger. A row you add or change on Commitments gets its formulas
 * at once, and a Keep/Cancel decision gets today's date in "Decided on".
 * Everything else on the Dashboard recalculates by itself.
 */
function onEdit(e) {
  try {
    if (!e || !e.range) return;
    var sh = e.range.getSheet();
    if (sh.getName() !== PLAN.TAB_COMMIT) return;
    var r0 = Math.max(2, e.range.getRow()), r1 = e.range.getLastRow();
    if (e.range.getColumn() > PLAN.COMMIT_COLS.length) return;   // a formula column: nothing to do
    var today = Utilities.formatDate(new Date(), CFG_TZ(), 'yyyy-MM-dd');
    var rows = [];
    for (var r = r0; r <= r1; r++) {
      rows.push(r);
      var v = sh.getRange(r, 9, 1, 2).getValues()[0];      // Decision, Decided on
      if (v[0] && !/^review$/i.test(v[0]) && !v[1]) sh.getRange(r, 10).setValue(today);
    }
    fxCommitFormulas(sh, rows);
  } catch (err) {
    // A simple trigger has no one to report to; the daily upkeep catches up.
  }
}


/* ---- emails: numbers read from the sheet, not recalculated ------------------------- */

function planDashUrl(ss) {
  var sh = getTab(ss || SpreadsheetApp.openById(CFG.SHEET_ID), PLAN.TAB_DASH);
  return sheetUrl() + (sh ? '#gid=' + sh.getSheetId() : '');
}

/** Commitments rows with their live formula columns, as objects. */
function planCommitRows(ss) {
  var sh = getTab(ss, PLAN.TAB_COMMIT);
  if (!sh || sh.getLastRow() < 2) return [];
  var w = PLAN.COMMIT_COLS.length + FX.COMMIT_CALC.length;
  return sh.getRange(2, 1, sh.getLastRow() - 1, w).getDisplayValues().map(function (r) {
    return { name: r[0], amount: r[2], cur: r[3], acct: r[6], decision: r[8], perYear: r[14],
             cycle: r[17], next: r[18], status: r[19], kind: r[22], inDays: r[25] === '' ? null : Number(r[25]) };
  }).filter(function (c) { return c.name; });
}

/** "Due this week" block for the Friday reminder. */
function planDigestHtml(ss) {
  var rows = planCommitRows(ss);
  // Same wording as the Dashboard: what needs you is shown with the date it
  // was due; anything else reads "in N days · last paid ...".
  var soon = rows.filter(function (c) {
    return c.decision !== 'Cancel' &&
           (/^(🔴|⏳|📌|⚠)/.test(c.status) || (c.inDays !== null && c.inDays <= 7 && !/^(Ended|✂)/.test(c.status)));
  }).map(function (c) {
    var attention = /^(🔴|⏳|📌|⚠)/.test(c.status);
    var when = c.inDays === 0 ? 'today' : c.inDays === 1 ? 'tomorrow' : 'in ' + c.inDays + ' days';
    var last = /^✅/.test(c.status) ? ' · last ' + c.status.replace(/^✅ (Paid|Received) /, function (m, w) { return w.toLowerCase() + ' '; })
             : /^❔/.test(c.status) ? ' · last cycle unconfirmed' : '';
    return { name: c.name, amount: c.amount, cur: c.cur, status: attention ? c.status : '🗓 ' + when + last,
             date: attention ? (c.cycle || c.next || '') : c.next, attention: attention };
  }).sort(function (a, b) { return (b.attention - a.attention) || (a.date < b.date ? -1 : a.date > b.date ? 1 : 0); });
  var h = ['<h3 style="margin:18px 0 6px">🧾 Money due this week</h3>'];
  if (!soon.length) h.push('<p>Nothing due in the next 7 days.</p>');
  else {
    h.push('<table cellpadding="6" style="border-collapse:collapse;font-size:13px">');
    soon.forEach(function (c) {
      h.push('<tr style="border-top:1px solid #e0e0e0' + (/^(🔴|⚠)/.test(c.status) ? ';background:#fce8e6' : c.attention ? ';background:#fef7e0' : '') + '"><td>' +
             esc(c.date || '') + '</td><td>' + esc(c.name) + '</td><td align="right">' + esc(c.amount + ' ' + c.cur) +
             '</td><td>' + esc(c.status) + '</td></tr>');
    });
    h.push('</table>');
  }
  var undecided = rows.filter(function (c) { return c.kind === 'Out' && (!c.decision || /^review$/i.test(c.decision)); });
  if (undecided.length) h.push('<p>' + undecided.length + ' recurring cost(s) still need a Keep/Cancel decision.</p>');
  h.push('<p>' + button(planDashUrl(ss), 'Open the dashboard') + '</p>');
  return h.join('\n');
}

/** First days of each month: last month, straight from the Dashboard's formulas. */
function sendMonthlyReview(ss) {
  var sh = getTab(ss, PLAN.TAB_DASH);
  if (!sh) return;
  var glance = sh.getRange('A8:F8').getDisplayValues()[0];           // last month
  var groups = sh.getRange('A137:F152').getDisplayValues();          // by group, last four months
  var head = groups[0];
  var col = head.indexOf(Utilities.formatDate(new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1), CFG_TZ(), 'yyyy-MM'));
  // Where the money went: spending groups only (income is in the sentence, after HST).
  var rows = groups.slice(1).filter(function (r) { return r[0] && r[0] !== 'Income' && col > 0 && r[col]; })
    .map(function (r) { return '<tr style="border-top:1px solid #e0e0e0"><td>' + esc(r[0]) + '</td><td align="right">' + esc(r[col]) + '</td></tr>'; });
  var plan = sh.getRange('A12:B19').getDisplayValues();
  var h = ['<div style="font-family:Arial,sans-serif;font-size:14px;color:#202124">',
    '<p><b>' + esc(glance[0]) + '</b>: in ' + esc(glance[1]) + ', living costs ' + esc(glance[2]) + ', house ' + esc(glance[3]) +
    ', lent/saved ' + esc(glance[4]) + ' → <b>net ' + esc(glance[5]) + '</b>.</p>',
    '<table cellpadding="6" style="border-collapse:collapse;font-size:13px">' + rows.join('') + '</table>',
    '<p><b>This month:</b> ' + plan.map(function (p) { return esc(p[0]) + ' ' + esc(p[1]); }).join(' · ') + '</p>',
    planDigestHtml(ss), '</div>'];
  MailApp.sendEmail({ to: notifyAddress(), subject: '📊 ' + glance[0] + ' review — net ' + glance[5], htmlBody: h.join('\n') });
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

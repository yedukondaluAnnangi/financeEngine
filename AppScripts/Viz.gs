/**
 * Viz.gs — the picture: Overview (tiles + charts), Trends (category × month
 * heatmap) and Accounts (one row per account). The Dashboard stays the to-do
 * list; these tabs are for seeing where the money goes.
 *
 * Same rule as the Dashboard: every number is a live formula over _Calc, so
 * nothing here goes stale between refreshes. The script only lays the
 * formulas out (when PLAN.VERSION changes) and re-draws the charts on every
 * refresh, because a chart's range has to match how many months there are.
 *
 *   _Viz       (hidden) the small tables the charts read: one row per month,
 *              one row per group, one row per day of the month.
 *   Overview   six tiles, five charts, a trend line per spending group.
 *   Trends     every spending category down the side, the last 12 months
 *              across, shaded by size, with a sparkline per row.
 *   Accounts   statements up to, days behind, this month in / out, last
 *              known balance, six-month spending sparkline.
 */

var VZ = {
  TAB_VIZ: '_Viz',
  TAB_OVERVIEW: 'Overview',
  TAB_TRENDS: 'Trends',
  TAB_ACCOUNTS: 'Accounts',
  TAB_LABEL: 'To label',
  MONTHS: 12,                    // the most months any chart or table shows
  CAT_ROWS: 96,                  // Trends: room for this many categories
  ACCT_ROWS: 20,                 // Accounts: room for this many accounts
  // Spending groups, in Dashboard order: everything except Income and Moved.
  GROUPS: ['Bills & loans', 'Essentials', 'Lifestyle', 'Subscriptions', 'Fees & charges', 'Business costs',
           'Other', 'Not labelled yet', 'House construction', 'Lent out', 'Saved / invested'],
  C: { in: '#1e8e3e', living: '#d93025', house: '#f9ab00', net: '#1a73e8', lent: '#9334e6',
       cad: '#d93025', inr: '#ff6d01', ink: '#202124', grey: '#5f6368', tile: '#f8f9fa', band: '#e8f0fe' }
};

var VZ_HST = 'Categories!$F$8';


/* ---- _Viz: the chart data ----------------------------------------------------- */

/**
 * Layout (all formulas):
 *   A1:I13   months — key, label, in (after HST), living, house, lent+saved,
 *            net, spending in CAD accounts, spending in INR accounts
 *   K1:Y12   groups — name, this month, last month, then one column per month
 *            (N1:Y1 carry the month keys)
 *   AA1:AC32 days 1–31 — cumulative living costs, this month and last month
 *   AE1:AF11 top 10 categories over the last 3 months (living + house)
 */
function vzVizTab(ss) {
  var sh = getTab(ss, VZ.TAB_VIZ) || ss.insertSheet(VZ.TAB_VIZ);
  sh.clear();
  // SUMIFS does not loop over an array of criteria inside ARRAYFORMULA (it
  // quietly uses the first one), so every per-row sum here goes through MAP.
  var perMonth = function (body) { return '=MAP($A2:$A13,LAMBDA(k,IF(k="","",' + body + ')))'; };
  var sumJ = function (j) { return 'SUMIFS(_Calc!$L:$L,_Calc!$B:$B,k,_Calc!$J:$J,"' + j + '")'; };
  var spendIn = function (cur) {
    return 'SUMIFS(_Calc!$L:$L,_Calc!$B:$B,k,_Calc!$G:$G,"' + cur + '",_Calc!$J:$J,"Living")+' +
           'SUMIFS(_Calc!$L:$L,_Calc!$B:$B,k,_Calc!$G:$G,"' + cur + '",_Calc!$J:$J,"House")';
  };
  sh.getRange('A1:I1').setValues([['Month', 'Month ', 'Money in (after HST)', 'Living costs', 'House construction',
                                   'Lent / saved', 'Net', 'Spent in Canada (CAD)', 'Spent in India (CAD)']]);
  // From the first month with data up to this month, at most VZ.MONTHS of them.
  sh.getRange('A2').setFormula('=ARRAYFORMULA(LET(t,DATE(YEAR(TODAY()),MONTH(TODAY()),1),lo,MIN(_Calc!A2:A),' +
    'f,IF(lo=0,t,DATE(YEAR(lo),MONTH(lo),1)),n,MAX(1,MIN(' + VZ.MONTHS + ',DATEDIF(f,t,"M")+1)),' +
    'd,DATE(YEAR(t),MONTH(t)+SEQUENCE(n,1,1-n),1),HSTACK(TEXT(d,"yyyy-mm"),TEXT(d,"mmm yy"))))');
  sh.getRange('C2').setFormula(perMonth(sumJ('Income') + '-SUMIFS(_Calc!$H:$H,_Calc!$I:$I,"Business income",_Calc!$B:$B,k)*' +
                               VZ_HST + '/(1+' + VZ_HST + ')'));
  sh.getRange('D2').setFormula(perMonth(sumJ('Living')));
  sh.getRange('E2').setFormula(perMonth(sumJ('House')));
  sh.getRange('F2').setFormula(perMonth(sumJ('Lent') + '+' + sumJ('Saved')));
  sh.getRange('G2').setFormula('=ARRAYFORMULA(IF($A2:$A13="","",C2:C13-D2:D13-E2:E13-F2:F13))');
  sh.getRange('H2').setFormula(perMonth(spendIn('CAD')));
  sh.getRange('I2').setFormula(perMonth(spendIn('INR')));

  // Groups × months. Negative totals (a refund month) are drawn as zero in the donut.
  sh.getRange('K1:M1').setValues([['Group', 'This month', 'Last month']]);
  sh.getRange(2, 11, VZ.GROUPS.length, 1).setValues(VZ.GROUPS.map(function (g) { return [g]; }));
  var gr = 'K2:K' + (VZ.GROUPS.length + 1);
  var byGroup = function (mk) {
    return '=MAP(' + gr + ',LAMBDA(g,LET(v,SUMIFS(_Calc!$L:$L,_Calc!$K:$K,g,_Calc!$B:$B,' + mk + '),IF(v<0,0,v))))';
  };
  sh.getRange('L2').setFormula(byGroup('TEXT(TODAY(),"yyyy-mm")'));
  sh.getRange('M2').setFormula(byGroup('TEXT(EDATE(TODAY(),-1),"yyyy-mm")'));
  sh.getRange('N1').setFormula('=TRANSPOSE(A2:A13)');
  sh.getRange('N2').setFormula('=MAKEARRAY(' + VZ.GROUPS.length + ',' + VZ.MONTHS + ',LAMBDA(i,j,LET(g,INDEX(' + gr + ',i),k,INDEX(N1:Y1,1,j),' +
    'IF(OR(g="",k=""),"",SUMIFS(_Calc!$L:$L,_Calc!$K:$K,g,_Calc!$B:$B,k)))))');

  // Spending pace: running total of living costs by day of the month.
  sh.getRange('AA1:AC1').setValues([['Day', 'This month', 'Last month']]);
  sh.getRange('AA2').setFormula('=SEQUENCE(31)');
  var start0 = 'EOMONTH(TODAY(),-1)+1', start1 = 'EOMONTH(TODAY(),-2)+1';
  sh.getRange('AB2').setFormula('=MAP(AA2:AA32,LAMBDA(dy,IF(dy>DAY(TODAY()),NA(),SUMIFS(_Calc!$L:$L,_Calc!$J:$J,"Living",' +
    '_Calc!$A:$A,">="&' + start0 + ',_Calc!$A:$A,"<"&(' + start0 + '+dy)))))');
  sh.getRange('AC2').setFormula('=MAP(AA2:AA32,LAMBDA(dy,IF(dy>DAY(EOMONTH(TODAY(),-1)),NA(),SUMIFS(_Calc!$L:$L,_Calc!$J:$J,"Living",' +
    '_Calc!$A:$A,">="&' + start1 + ',_Calc!$A:$A,"<"&(' + start1 + '+dy)))))');

  // Top categories, last 3 months including this one.
  sh.getRange('AE1').setFormula('=IFERROR(QUERY(_Calc!A2:M,"select I, sum(L) where (J = \'Living\' or J = \'House\') and I <> \'\' and B >= \'"&' +
    'TEXT(EDATE(TODAY(),-2),"yyyy-mm")&"\' group by I order by sum(L) desc limit 10 label I \'Category\', sum(L) \'Last 3 months\'",0),' +
    '{"Category","Last 3 months";"(no spending yet)",0})');

  if (!sh.isSheetHidden()) sh.hideSheet();
  return sh;
}

/** How many months the _Viz month table holds right now. */
function vzMonthCount(ss) {
  var sh = getTab(ss, VZ.TAB_VIZ);
  if (!sh) return 0;
  return sh.getRange('A2:A13').getValues().filter(function (r) { return r[0] !== ''; }).length;
}


/* ---- Overview ------------------------------------------------------------------- */

function vzOverviewTab(ss) {
  var sh = getTab(ss, VZ.TAB_OVERVIEW) || ss.insertSheet(VZ.TAB_OVERVIEW, 0);
  sh.getCharts().forEach(function (c) { sh.removeChart(c); });
  sh.clear();
  sh.clearConditionalFormatRules();
  sh.getRange('A1:L200').breakApart();
  thClearBands(sh);
  for (var c = 1; c <= 12; c++) sh.setColumnWidth(c, c === 1 || c === 7 ? 190 : 105);
  thPage(sh, 12);

  sh.getRange('A1').setValue('📈 Overview — your money at a glance').setFontSize(18).setFontWeight('bold').setFontColor(VZ.C.ink);
  sh.getRange('A2').setFormula('="Live · "&TEXT(NOW(),"ddd d mmm yyyy, HH:mm")&" · all amounts in CAD · INR converted at the rate on the Categories tab"')
    .setFontColor(VZ.C.grey);
  sh.getRange('A3').setFormula('=Dashboard!A3').setFontColor(VZ.C.grey).setFontStyle('italic');

  // Tiles: label / big number / comparison, two columns each.
  var D = 'Dashboard!';
  var tiles = [
    ['Money in this month (after HST)', '=' + D + 'B7', '="Last month "&TEXT(' + D + 'B8,"$#,##0")', VZ.C.in],
    ['Living costs this month',         '=' + D + 'C7', '="Last month "&TEXT(' + D + 'C8,"$#,##0")', VZ.C.living],
    ['House construction this month',   '=' + D + 'D7', '="Last month "&TEXT(' + D + 'D8,"$#,##0")', VZ.C.house],
    ['Net this month',                  '=' + D + 'F7', '="Last month "&TEXT(' + D + 'F8,"$#,##0;-$#,##0")', VZ.C.net],
    ['Kept of what came in',            '=IF(' + D + 'B7>0,' + D + 'F7/' + D + 'B7,"—")',
                                        '=IF(' + D + 'B8>0,"Last month "&TEXT(' + D + 'F8/' + D + 'B8,"0%"),"")', VZ.C.net],
    ['Still to pay this month',         '=-' + D + 'B18', '="Still to come in "&TEXT(' + D + 'B19,"$#,##0")', VZ.C.living]
  ];
  tiles.forEach(function (t, i) {
    var col = 1 + i * 2;
    [5, 6, 7].forEach(function (r) { sh.getRange(r, col, 1, 2).merge(); });
    sh.getRange(5, col).setValue(t[0]).setFontColor(VZ.C.grey).setFontSize(9);
    sh.getRange(6, col).setFormula(t[1]).setFontSize(20).setFontWeight('bold').setFontColor(t[3])
      .setNumberFormat(i === 4 ? '0%' : '$#,##0;-$#,##0');
    sh.getRange(7, col).setFormula(t[2]).setFontColor(VZ.C.grey).setFontSize(9);
    sh.getRange(5, col, 3, 2).setBackground(VZ.C.tile).setHorizontalAlignment('left')
      .setBorder(true, true, true, true, false, false, '#dadce0', SpreadsheetApp.BorderStyle.SOLID);
  });
  sh.setRowHeight(6, 38);

  // Per-group trend table, to the right of the third row of charts.
  var r0 = 43, g0 = 7;
  sh.getRange(r0, g0, 1, 6).setValues([['Spending group', 'This month', 'Last month', 'Avg / month', 'Trend', 'Share this month']])
    .setFontWeight('bold').setBackground(TH.NAVY).setFontColor('#ffffff');
  VZ.GROUPS.forEach(function (g, i) {
    var r = r0 + 1 + i, vr = i + 2;
    sh.getRange(r, g0).setValue(g);
    sh.getRange(r, g0 + 1).setFormula('=SUMIFS(_Calc!$L:$L,_Calc!$K:$K,$G' + r + ',_Calc!$B:$B,TEXT(TODAY(),"yyyy-mm"))');
    sh.getRange(r, g0 + 2).setFormula('=SUMIFS(_Calc!$L:$L,_Calc!$K:$K,$G' + r + ',_Calc!$B:$B,TEXT(EDATE(TODAY(),-1),"yyyy-mm"))');
    sh.getRange(r, g0 + 3).setFormula('=IFERROR(AVERAGE(FILTER(_Viz!N' + vr + ':Y' + vr + ',_Viz!N$1:Y$1<>"")),0)');
    sh.getRange(r, g0 + 4).setFormula('=IFERROR(SPARKLINE(FILTER(_Viz!N' + vr + ':Y' + vr + ',_Viz!N$1:Y$1<>""),' +
      '{"charttype","column";"color","' + VZ.C.net + '";"negcolor","' + VZ.C.in + '"}),"")');
    sh.getRange(r, g0 + 5).setFormula('=IF(H' + r + '<=0,"",SPARKLINE(H' + r + ',{"charttype","bar";"max",MAX(1,MAX(H$' + (r0 + 1) +
      ':H$' + (r0 + VZ.GROUPS.length) + '));"color1","' + VZ.C.house + '"}))');
  });
  var gEnd = r0 + VZ.GROUPS.length;
  thBand(sh.getRange(r0 + 1, g0, VZ.GROUPS.length, 6), false);
  sh.getRange(r0 + 1, g0, VZ.GROUPS.length, 1).setFontWeight('bold');
  sh.getRange(r0 + 1, g0 + 1, VZ.GROUPS.length, 3).setNumberFormat('$#,##0;[Red]-$#,##0');
  sh.getRange(gEnd + 1, g0).setValue('Total').setFontWeight('bold');
  ['H', 'I', 'J'].forEach(function (L, i) {
    sh.getRange(gEnd + 1, g0 + 1 + i).setFormula('=SUM(' + L + (r0 + 1) + ':' + L + gEnd + ')').setNumberFormat('$#,##0').setFontWeight('bold');
  });
  sh.getRange(gEnd + 3, g0).setValue('Trend = one bar per month, oldest on the left. Green bars are months where money came back (a refund or a repayment).')
    .setFontColor(VZ.C.grey).setFontStyle('italic').setFontSize(9);

  // How to read it, under the charts.
  var how = [
    'How to read this page',
    '• Tiles: this month so far. "Kept of what came in" = net ÷ money in.',
    '• Money in vs out: green = money in after HST, red = living costs, yellow = house; the blue line is what was left (net).',
    '• Where it went: this month\'s spending by group. Card payments and transfers between your own accounts are left out.',
    '• Top categories: the ten biggest over the last 3 months — where trimming pays most.',
    '• Spending pace: living costs added up day by day. Blue above grey = spending faster than last month.',
    '• Canada vs India: what was spent from CAD accounts vs INR accounts, all in CAD.',
    '• More: Trends (every category, month by month) · Accounts (is every account up to date) · Dashboard (what to pay).'
  ];
  sh.getRange(62, 1, how.length, 1).setValues(how.map(function (h) { return [h]; })).setFontColor(VZ.C.grey);
  sh.getRange(62, 1).setFontWeight('bold').setFontColor(VZ.C.ink);
  vzOverviewDetails(sh);
  sh.setFrozenRows(3);
  return sh;
}

/**
 * Under the charts: the payments behind each tile. Left column A–F, right
 * column G–L, fixed rows so the tile links (vzOverviewLinks) can jump to them.
 *   plan    how you need to spend — plan vs so far   | how much you have
 *   due     still to pay this month                  | money in this month
 *   spend   living costs by payee                    | house construction
 */
var VZ_DETAIL = { plan: 72, due: 83, spend: 103, rows: { due: 15, spend: 25 } };

function vzOverviewDetails(sh) {
  var D = 'Dashboard!', CM = 'Commitments!', m0 = 'TEXT(TODAY(),"yyyy-mm")';
  var money = '$#,##0.00;[Red]-$#,##0.00';
  var section = function (r, c, text) {
    sh.getRange(r, c, 1, 6).setBackground(TH.SECTION).setFontColor('#ffffff').setFontWeight('bold').setFontSize(12);
    sh.getRange(r, c).setValue(text);
    sh.setRowHeight(r, 28);
  };
  var head = function (r, c, list) {
    sh.getRange(r, c, 1, list.length).setValues([list]);
    thColHead(sh.getRange(r, c, 1, 6));
  };
  var band = function (r, c, n) { thBand(sh.getRange(r, c, n, 6), false); };

  // ---- How you need to spend (left) ----
  var P = VZ_DETAIL.plan, pr = P + 2;
  section(P, 1, '🧭 How you need to spend — this month\'s plan');
  head(P + 1, 1, ['', 'Plan', 'So far', 'Still to go', 'How it is worked out']);
  var billsSoFar = 'SUMIFS(' + CM + 'V2:V,' + CM + 'W2:W,"Out",' + CM + 'X2:X,"<>House")';
  var plan = [
    ['Money in', '=' + D + 'B12', '=' + D + 'B7', 'Pay and benefits due this month (Commitments); so far = what landed, after HST'],
    ['Bills & loans', '=-' + D + 'B13', '=' + billsSoFar, 'Every bill and loan due this month; so far = the ones seen paid'],
    ['Everyday spending', '=-' + D + 'B14', '=MAX(0,' + D + 'C7-' + billsSoFar + ')', 'Last month\'s pace; so far = living costs minus bills'],
    ['House construction', '=-' + D + 'B16', '=' + D + 'D7', 'Last month\'s pace, or what is due if larger'],
    ['Left over', '=' + D + 'B17', '=' + D + 'B7-' + D + 'C7-' + D + 'D7', 'Money in minus everything above'],
    ['HST to set aside', '=-' + D + 'B20', '', 'Collected this year, owed to CRA — not yours to spend']
  ];
  plan.forEach(function (p, i) {
    var r = pr + i;
    sh.getRange(r, 1).setValue(p[0]).setFontWeight('bold');
    sh.getRange(r, 2).setFormula(p[1]);
    if (p[2]) sh.getRange(r, 3).setFormula(p[2]);
    if (i < 5) sh.getRange(r, 4).setFormula(i === 0 || i === 4 ? '=B' + r + '-C' + r : '=MAX(0,B' + r + '-C' + r + ')');
    sh.getRange(r, 5).setValue(p[3]).setFontColor(TH.GREY).setFontSize(9);
  });
  band(pr, 1, plan.length);
  sh.getRange(pr, 2, plan.length, 3).setNumberFormat('$#,##0;[Red]-$#,##0');
  sh.getRange(pr + 4, 1, 1, 4).setBackground(TH.GOOD_BG).setFontWeight('bold');

  // ---- How much you have (right) ----
  var BSV = "'" + BS.TAB_VIEW + "'!";
  section(P, 7, '🏦 How much you have — cash and bank');
  head(P + 1, 7, ['Account', 'As of', 'Balance', 'Currency', 'CAD']);
  sh.getRange(pr, 7).setFormula('=IFERROR(ARRAY_CONSTRAIN(FILTER({' + BSV + 'A12:A39,' + BSV + 'D12:D39,' + BSV + 'E12:E39,' + BSV + 'F12:F39,' +
    BSV + 'G12:G39},' + BSV + 'B12:B39="Cash & bank"),5,5),"No balances yet — type them on Assets & Debts")');
  band(pr, 7, 5);
  sh.getRange(pr + 5, 7).setValue('Total cash').setFontWeight('bold');
  sh.getRange(pr + 5, 11).setFormula('=SUM(K' + pr + ':K' + (pr + 4) + ')').setFontWeight('bold').setNumberFormat('$#,##0');
  sh.getRange(pr + 5, 7, 1, 6).setBackground(TH.GOOD_BG);
  sh.getRange(pr + 6, 7).setFormula('=IFERROR("No balance on file: "&TEXTJOIN(", ",TRUE,FILTER(Accounts!A4:A23,Accounts!I4:I23="—",' +
    'NOT(REGEXMATCH(Accounts!A4:A23,"(?i)mastercard|visa|regalia|credit"))))&" — type today\'s balance on Assets & Debts","")')
    .setFontColor(TH.GREY).setFontSize(9);
  sh.getRange(pr, 9, 5, 1).setNumberFormat('#,##0.00');
  sh.getRange(pr, 11, 5, 1).setNumberFormat('$#,##0.00');

  // ---- Still to pay this month (left) ----
  var S = VZ_DETAIL.due, sr = S + 2, sn = VZ_DETAIL.rows.due;
  section(S, 1, '🧾 Still to pay this month — every bill not seen paid yet');
  head(S + 1, 1, ['What', 'Due', 'CAD', 'Account', 'Status']);
  sh.getRange(sr, 1).setFormula('=IFERROR(ARRAY_CONSTRAIN(SORT(FILTER({' + CM + 'A2:A,ARRAYFORMULA(IF(' + CM + 'R2:R="",' + CM + 'S2:S,' +
    CM + 'R2:R)),' + CM + 'Y2:Y,' + CM + 'G2:G,' + CM + 'T2:T},' + CM + 'A2:A<>"",' + CM + 'W2:W="Out",' + CM + 'I2:I<>"Cancel",' +
    CM + 'Y2:Y>0),2,TRUE),' + sn + ',5),"✅ Nothing left to pay this month")');
  band(sr, 1, sn);
  sh.getRange(sr + sn, 1).setValue('Total still to pay').setFontWeight('bold');
  sh.getRange(sr + sn, 3).setFormula('=SUM(C' + sr + ':C' + (sr + sn - 1) + ')').setFontWeight('bold').setNumberFormat('$#,##0');
  sh.getRange(sr + sn, 1, 1, 6).setBackground(TH.BAD_BG);
  sh.getRange(sr, 2, sn, 1).setNumberFormat('ddd d mmm');
  sh.getRange(sr, 3, sn, 1).setNumberFormat(money);

  // ---- Money in this month (right) ----
  section(S, 7, '💵 Money in this month');
  head(S + 1, 7, ['From', 'Date', 'CAD', 'Account']);
  sh.getRange(sr, 7).setFormula('=IFERROR(ARRAY_CONSTRAIN(QUERY(_Calc!A2:M,"select E, A, H, C where B = \'"&' + m0 +
    '&"\' and J = \'Income\' order by A desc label E \'\', A \'\', H \'\', C \'\'",0),' + sn + ',4),"Nothing in yet this month")');
  band(sr, 7, sn);
  sh.getRange(sr + sn, 7).setValue('Total in (HST included)').setFontWeight('bold');
  sh.getRange(sr + sn, 9).setFormula('=SUMIFS(_Calc!H:H,_Calc!B:B,' + m0 + ',_Calc!J:J,"Income")').setFontWeight('bold').setNumberFormat('$#,##0');
  sh.getRange(sr + sn, 7, 1, 6).setBackground(TH.GOOD_BG);
  sh.getRange(sr, 8, sn, 1).setNumberFormat('ddd d mmm');
  sh.getRange(sr, 9, sn, 1).setNumberFormat(money);

  // ---- Living costs by payee (left) ----
  var L = VZ_DETAIL.spend, lr = L + 2, ln = VZ_DETAIL.rows.spend;
  section(L, 1, '🛒 Living costs this month — where it went, by payee');
  head(L + 1, 1, ['Payee', 'Category', 'Times', 'CAD', 'Share']);
  sh.getRange(lr, 1).setFormula('=IFERROR(ARRAY_CONSTRAIN(QUERY(_Calc!A2:M,"select E, I, count(L), sum(L) where B = \'"&' + m0 +
    '&"\' and J = \'Living\' group by E, I order by sum(L) desc label count(L) \'\', sum(L) \'\'",0),' + ln + ',4),"No living costs yet this month")');
  var share = [];
  for (var r = lr; r < lr + ln; r++) {
    share.push(['=IF(NOT(ISNUMBER(D' + r + ')),"",IF(D' + r + '<=0,"",SPARKLINE(D' + r + ',{"charttype","bar";"max",MAX(1,MAX(D$' + lr +
                ':D$' + (lr + ln - 1) + '));"color1","' + VZ.C.living + '"})))']);
  }
  sh.getRange(lr, 5, ln, 1).setFormulas(share);
  band(lr, 1, ln);
  sh.getRange(lr + ln, 1).setValue('Total living costs').setFontWeight('bold');
  sh.getRange(lr + ln, 4).setFormula('=' + D + 'C7').setFontWeight('bold').setNumberFormat('$#,##0');
  sh.getRange(lr + ln, 1, 1, 6).setBackground(TH.BAD_BG);
  sh.getRange(lr, 4, ln, 1).setNumberFormat(money);
  sh.getRange(lr + ln + 1, 1).setValue('The top ' + ln + ' payees are listed; the total counts them all. Every category, month by month: the Trends tab.')
    .setFontColor(TH.GREY).setFontSize(9);

  // ---- House construction (right) ----
  section(L, 7, '🏗 House construction — this month');
  head(L + 1, 7, ['Paid to', 'Date', 'What', 'CAD']);
  sh.getRange(lr, 7).setFormula('=IFERROR(ARRAY_CONSTRAIN(QUERY(_Calc!A2:M,"select E, A, I, L where B = \'"&' + m0 +
    '&"\' and J = \'House\' order by L desc label E \'\', A \'\', I \'\', L \'\'",0),' + ln + ',4),"No house payments yet this month")');
  band(lr, 7, ln);
  sh.getRange(lr + ln, 7).setValue('This month').setFontWeight('bold');
  sh.getRange(lr + ln, 10).setFormula('=' + D + 'D7').setFontWeight('bold').setNumberFormat('$#,##0');
  sh.getRange(lr + ln, 7, 1, 6).setBackground(TH.WARN_BG);
  sh.getRange(lr + ln + 1, 7).setValue('Spent on the house so far, all months').setFontWeight('bold');
  sh.getRange(lr + ln + 1, 10).setFormula('=SUMIFS(_Calc!L:L,_Calc!J:J,"House")').setFontWeight('bold').setNumberFormat('$#,##0');
  sh.getRange(lr, 8, ln, 1).setNumberFormat('ddd d mmm');
  sh.getRange(lr, 10, ln, 1).setNumberFormat(money);
}

/** Links to the other tabs, written once their ids are known. */
function vzOverviewLinks(ss) {
  var sh = getTab(ss, VZ.TAB_OVERVIEW);
  if (!sh) return;
  var link = function (name, label) {
    var t = getTab(ss, name);
    return t ? 'HYPERLINK("#gid=' + t.getSheetId() + '","' + label + '")' : '"' + label + '"';
  };
  sh.getRange('H1').setFormula('=' + link(BS.TAB_VIEW, '🏛 Net worth →')).setFontWeight('bold');
  sh.getRange('I1').setFormula('=' + link(PLAN.TAB_DASH, '🧾 What to pay →')).setFontWeight('bold');
  sh.getRange('J1').setFormula('=' + link(VZ.TAB_TRENDS, '📊 Trends →')).setFontWeight('bold');
  sh.getRange('K1').setFormula('=' + link(VZ.TAB_ACCOUNTS, '🏦 Accounts →')).setFontWeight('bold');
  sh.getRange('L1').setFormula('=' + link(PLAN.TAB_COMMIT, '🔁 Commitments →')).setFontWeight('bold');
  // Under each tile: jump to the payments behind it.
  var here = function (row, label) { return '=HYPERLINK("#gid=' + sh.getSheetId() + '&range=A' + row + '","' + label + '")'; };
  [[1, VZ_DETAIL.due, '▼ money in'], [3, VZ_DETAIL.spend, '▼ living costs'], [5, VZ_DETAIL.spend, '▼ house payments'],
   [7, VZ_DETAIL.plan, '▼ the plan'], [9, VZ_DETAIL.plan, '▼ the plan'], [11, VZ_DETAIL.due, '▼ what is left to pay']]
    .forEach(function (t) {
      sh.getRange(8, t[0], 1, 2).merge();
      sh.getRange(8, t[0]).setFormula(here(t[1], t[2])).setFontSize(9);
    });
}

/** Re-draw the five charts so their ranges match the months on record. */
function vzOverviewCharts(ss) {
  var sh = getTab(ss, VZ.TAB_OVERVIEW), viz = getTab(ss, VZ.TAB_VIZ);
  if (!sh || !viz) return;
  sh.getCharts().forEach(function (c) { sh.removeChart(c); });
  var n = Math.max(1, vzMonthCount(ss));
  var W = 625, H = 330;
  var base = function (type, row, col, title) {
    return sh.newChart().setChartType(type).setPosition(row, col, col === 1 ? 0 : 5, 0)
      .setHiddenDimensionStrategy(Charts.ChartHiddenDimensionStrategy.SHOW_BOTH)
      .setNumHeaders(1).setOption('title', title).setOption('width', W).setOption('height', H)
      .setOption('titleTextStyle', { fontSize: 13, bold: true, color: VZ.C.ink })
      .setOption('legend', { position: 'bottom' });
  };

  sh.insertChart(base(Charts.ChartType.COMBO, 9, 1, 'Money in vs out — month by month')
    .addRange(viz.getRange(1, 2, n + 1, 4)).addRange(viz.getRange(1, 7, n + 1, 1))
    .setOption('seriesType', 'bars')
    .setOption('series', { 3: { type: 'line', lineWidth: 3, pointSize: 6 } })
    .setOption('colors', [VZ.C.in, VZ.C.living, VZ.C.house, VZ.C.net])
    .setOption('vAxis', { format: '$#,##0' }).build());

  sh.insertChart(base(Charts.ChartType.PIE, 9, 7, 'Where it went — this month so far')
    .addRange(viz.getRange(1, 11, VZ.GROUPS.length + 1, 2))
    .setOption('pieHole', 0.45).setOption('pieSliceText', 'percentage')
    .setOption('legend', { position: 'right' }).build());

  sh.insertChart(base(Charts.ChartType.BAR, 26, 1, 'Top 10 categories — last 3 months')
    .addRange(viz.getRange('AE1:AF11'))
    .setOption('colors', [VZ.C.living]).setOption('legend', { position: 'none' })
    .setOption('hAxis', { format: '$#,##0' }).build());

  sh.insertChart(base(Charts.ChartType.LINE, 26, 7, 'Spending pace — living costs, running total')
    .addRange(viz.getRange('AA1:AC32'))
    .setOption('colors', [VZ.C.net, '#9aa0a6']).setOption('lineWidth', 3)
    .setOption('hAxis', { title: 'Day of the month' }).setOption('vAxis', { format: '$#,##0' }).build());

  sh.insertChart(base(Charts.ChartType.COLUMN, 43, 1, 'Canada vs India — spending by month (CAD)')
    .addRange(viz.getRange(1, 2, n + 1, 1)).addRange(viz.getRange(1, 8, n + 1, 2))
    .setOption('isStacked', true).setOption('colors', [VZ.C.cad, VZ.C.inr])
    .setOption('vAxis', { format: '$#,##0' }).build());
}


/* ---- Trends --------------------------------------------------------------------- */

function vzTrendsTab(ss) {
  var sh = getTab(ss, VZ.TAB_TRENDS) || ss.insertSheet(VZ.TAB_TRENDS);
  sh.clear();
  sh.clearConditionalFormatRules();
  var last = 4 + VZ.CAT_ROWS;                         // last data row
  thClearBands(sh);
  thPage(sh, 17);
  sh.getRange('A1').setValue('📊 Trends — every spending category, month by month (CAD)');
  sh.getRange('A2').setValue('Darker red = more money. The Trend column is one bar per month, oldest on the left. ' +
    'Card payments and transfers between your accounts are left out; income is on the Overview.').setFontColor(VZ.C.grey);

  // Row 3 holds the month keys the sums use (hidden); row 4 the readable labels.
  sh.getRange('C3').setFormula('=TRANSPOSE(_Viz!A2:A13)');
  sh.getRange('A4:B4').setValues([['Group', 'Category']]);
  sh.getRange('C4').setFormula('=TRANSPOSE(_Viz!B2:B13)');
  sh.getRange('O4:Q4').setValues([['Total', 'Avg / month', 'Trend']]);
  sh.getRange(4, 1, 1, 17).setFontWeight('bold').setBackground(TH.NAVY).setFontColor('#ffffff');

  // Every spending category, in Dashboard group order. Unlabelled rows show as "(not labelled)".
  sh.getRange('A5').setFormula('=IFERROR(LET(u,UNIQUE(FILTER({_Calc!K2:K,ARRAYFORMULA(IF(_Calc!I2:I="","(not labelled)",_Calc!I2:I))},' +
    '_Calc!A2:A<>"",_Calc!J2:J<>"Moved",_Calc!J2:J<>"Income")),' +
    'ARRAY_CONSTRAIN(SORT(u,IFERROR(MATCH(INDEX(u,,1),' + fxOrder() + ',0),99),TRUE,INDEX(u,,2),TRUE),' + VZ.CAT_ROWS + ',2)),"")');
  sh.getRange('C5').setFormula('=MAKEARRAY(' + VZ.CAT_ROWS + ',' + VZ.MONTHS + ',LAMBDA(i,j,LET(cat,INDEX(B5:B' + last + ',i),k,INDEX(C3:N3,1,j),' +
    'IF(OR(cat="",k=""),"",SUMIFS(_Calc!$L:$L,_Calc!$I:$I,IF(cat="(not labelled)","",cat),_Calc!$B:$B,k,' +
    '_Calc!$J:$J,"<>Moved",_Calc!$J:$J,"<>Income")))))');
  sh.getRange('O5').setFormula('=BYROW(C5:N' + last + ',LAMBDA(r,IF(COUNT(r)=0,"",SUM(r))))');
  sh.getRange('P5').setFormula('=BYROW(C5:N' + last + ',LAMBDA(r,IF(COUNT(r)=0,"",SUM(r)/COUNT(r))))');
  var spark = [];
  for (var r = 5; r <= last; r++) {
    spark.push(['=IF(B' + r + '="","",IFERROR(SPARKLINE(FILTER(C' + r + ':N' + r + ',C$3:N$3<>""),' +
                '{"charttype","column";"color","' + VZ.C.net + '";"negcolor","' + VZ.C.in + '"}),""))']);
  }
  sh.getRange(5, 17, VZ.CAT_ROWS, 1).setFormulas(spark);

  thBand(sh.getRange(5, 1, VZ.CAT_ROWS, 17), false);
  sh.getRange(5, 3, VZ.CAT_ROWS, 14).setNumberFormat('$#,##0;-$#,##0;""');
  sh.getRange(5, 1, VZ.CAT_ROWS, 1).setFontColor(VZ.C.grey);
  sh.getRange(5, 15, VZ.CAT_ROWS, 1).setFontWeight('bold');
  sh.setRowHeight(4, 30);
  sh.getRange(4, 3, 1, 15).setHorizontalAlignment('center');
  sh.hideRows(3);
  sh.setFrozenRows(4);
  sh.setFrozenColumns(2);
  sh.setColumnWidth(1, 150); sh.setColumnWidth(2, 190);
  for (var c = 3; c <= 16; c++) sh.setColumnWidth(c, 78);
  sh.setColumnWidth(17, 130);

  // Heatmap over the month columns; the 95th percentile keeps one big month from washing out the rest.
  var heat = SpreadsheetApp.newConditionalFormatRule().setRanges([sh.getRange(5, 3, VZ.CAT_ROWS, VZ.MONTHS)])
    .setGradientMinpointWithValue('#ffffff', SpreadsheetApp.InterpolationType.NUMBER, '0')
    .setGradientMaxpointWithValue('#e67c73', SpreadsheetApp.InterpolationType.PERCENTILE, '95').build();
  // A faint line where a new group starts.
  var band = SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=AND($A5<>"",$A5<>$A4)')
    .setRanges([sh.getRange(5, 1, VZ.CAT_ROWS, 2)]).setBold(true).setFontColor(VZ.C.ink).build();
  sh.setConditionalFormatRules([heat, band]);
  return sh;
}


/* ---- Accounts ------------------------------------------------------------------- */

function vzAccountsTab(ss) {
  var sh = getTab(ss, VZ.TAB_ACCOUNTS) || ss.insertSheet(VZ.TAB_ACCOUNTS);
  sh.clear();
  sh.clearConditionalFormatRules();
  var n = VZ.ACCT_ROWS, A = 'A4:A' + (3 + n);
  thClearBands(sh);
  thPage(sh, 12);
  sh.getRange('A1').setValue('🏦 Accounts — is everything up to date?');
  thBand(sh.getRange(4, 1, n, 12), false);
  sh.setRowHeight(3, 34);
  sh.getRange('A2').setValue('Statements up to = the newest transaction on file. Over ' + FX.STALE_DAYS +
    ' days behind turns red: upload that account to the Inbox. Balances are in the account\'s own currency, from the last statement that carried one.')
    .setFontColor(VZ.C.grey);
  sh.getRange('A3:L3').setValues([['Account', 'Currency', 'First on file', 'Statements up to', 'Days behind', 'Transactions',
    'In this month (CAD)', 'Out this month (CAD)', 'Last known balance', 'Balance as of', 'Spending, last 6 months', 'Status']])
    .setFontWeight('bold').setBackground(TH.NAVY).setFontColor('#ffffff');

  var by = function (body) { return '=BYROW(' + A + ',LAMBDA(a,IF(a="","",' + body + ')))'; };
  var m0 = 'TEXT(TODAY(),"yyyy-mm")';
  sh.getRange('A4').setFormula('=IFERROR(ARRAY_CONSTRAIN(SORT(UNIQUE(FILTER(_Calc!C2:C,_Calc!C2:C<>""))),' + n + ',1),"")');
  sh.getRange('B4').setFormula(by('IFERROR(INDEX(FILTER(_Calc!G2:G,_Calc!C2:C=a),1),"")'));
  sh.getRange('C4').setFormula(by('MINIFS(_Calc!A2:A,_Calc!C2:C,a)'));
  sh.getRange('D4').setFormula(by('MAXIFS(_Calc!A2:A,_Calc!C2:C,a)'));
  sh.getRange('E4').setFormula(by('TODAY()-MAXIFS(_Calc!A2:A,_Calc!C2:C,a)'));
  sh.getRange('F4').setFormula(by('COUNTIF(_Calc!C2:C,a)'));
  sh.getRange('G4').setFormula(by('SUMIFS(_Calc!H2:H,_Calc!C2:C,a,_Calc!B2:B,' + m0 + ',_Calc!H2:H,">0")'));
  sh.getRange('H4').setFormula(by('-SUMIFS(_Calc!H2:H,_Calc!C2:C,a,_Calc!B2:B,' + m0 + ',_Calc!H2:H,"<0")'));
  sh.getRange('I4').setFormula(by('IFERROR(INDEX(SORT(FILTER({ARRAYFORMULA(TEXT(_Balances!D2:D,"yyyy-mm-dd")),_Balances!E2:E},_Balances!C2:C=a),1,FALSE),1,2),"—")'));
  sh.getRange('J4').setFormula(by('IFERROR(INDEX(SORT(FILTER(ARRAYFORMULA(TEXT(_Balances!D2:D,"yyyy-mm-dd")),_Balances!C2:C=a),1,FALSE),1,1),"")'));
  var spark = [];
  for (var r = 4; r < 4 + n; r++) {
    spark.push(['=IF(A' + r + '="","",IFERROR(SPARKLINE(MAKEARRAY(1,6,LAMBDA(i,j,-SUMIFS(_Calc!$H:$H,_Calc!$C:$C,A' + r +
                ',_Calc!$B:$B,TEXT(EDATE(TODAY(),j-6),"yyyy-mm"),_Calc!$H:$H,"<0",_Calc!$J:$J,"<>Moved"))),' +
                '{"charttype","column";"color","' + VZ.C.living + '"}),""))']);
  }
  sh.getRange(4, 11, n, 1).setFormulas(spark);
  sh.getRange('L4').setFormula(by('IF(TODAY()-MAXIFS(_Calc!A2:A,_Calc!C2:C,a)>' + FX.STALE_DAYS + ',"⚠ Upload a new statement","✅ Up to date")'));

  sh.getRange(4, 3, n, 2).setNumberFormat('yyyy-mm-dd');
  sh.getRange(4, 5, n, 2).setNumberFormat('0');
  sh.getRange(4, 7, n, 2).setNumberFormat('$#,##0.00');
  sh.getRange(4, 9, n, 1).setNumberFormat('#,##0.00');
  [210, 75, 100, 115, 90, 95, 130, 130, 130, 105, 170, 190].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  var stale = sh.getRange(4, 1, n, 12);
  sh.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=AND(ISNUMBER($E4),$E4>' + FX.STALE_DAYS + ')')
      .setRanges([stale]).setBackground('#fce8e6').build(),
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=AND(ISNUMBER($E4),$E4<=' + FX.STALE_DAYS + ')')
      .setRanges([sh.getRange(4, 12, n, 1)]).setBackground('#e6f4ea').build()
  ]);
  sh.setFrozenRows(3);
  sh.setFrozenColumns(1);
  return sh;
}


/* ---- To label: transactions no Payees pattern matched ---------------------------- */

function vzToLabelTab(ss) {
  var sh = getTab(ss, VZ.TAB_LABEL) || ss.insertSheet(VZ.TAB_LABEL);
  sh.clear();
  thClearBands(sh);
  thPage(sh, 12);
  // The bank text without the " | Needs labelling" payee _Calc appends.
  var desc = 'ARRAYFORMULA(REGEXREPLACE(_Calc!D2:D," [|] [^|]*$",""))';
  sh.getRange('A1').setValue('🏷 To label — transactions with no category yet');
  sh.getRange('A2').setValue('No row on the Payees tab matched these bank descriptions, so they have no category and count as plain living costs. ' +
    'Fix: add a Payees row (PATTERN = a word from the description, PAYEE, DEFAULT CATEGORY), then Finance › Re-label unlabelled rows.')
    .setFontColor(TH.GREY).setWrap(false);
  sh.getRange('A3').setFormula('=COUNTIF(_Calc!K2:K,"Not labelled yet")&" transaction(s) · "&TEXT(-SUMIFS(_Calc!H2:H,_Calc!K2:K,"Not labelled yet"),"$#,##0.00;-$#,##0.00")&" net out (CAD)"')
    .setFontWeight('bold').setFontColor(TH.NAVY);

  sh.getRange('A5').setValue('Same text, grouped — one Payees row fixes each line');
  sh.getRange('A5:E5').setBackground(TH.SECTION).setFontColor('#ffffff').setFontWeight('bold');
  sh.getRange('A6').setFormula('=IFERROR(QUERY({' + desc + ',_Calc!C2:C,_Calc!H2:H,_Calc!A2:A,_Calc!K2:K},' +
    '"select Col1, Col2, count(Col3), sum(Col3), max(Col4) where Col5 = \'Not labelled yet\' group by Col1, Col2 order by count(Col3) desc, sum(Col3) asc ' +
    'label Col1 \'Description\', Col2 \'Account\', count(Col3) \'Times\', sum(Col3) \'Total (CAD)\', max(Col4) \'Last seen\'",0),"✅ Nothing to label")');
  sh.getRange('G5').setValue('Every one, newest first');
  sh.getRange('G5:L5').setBackground(TH.SECTION).setFontColor('#ffffff').setFontWeight('bold');
  sh.getRange('G6:L6').setValues([['Date', 'Account', 'Description', 'Amount', 'Currency', 'CAD']]);
  thColHead(sh.getRange('G6:L6'));
  sh.getRange('G7').setFormula('=IFERROR(SORT(FILTER({_Calc!A2:A,_Calc!C2:C,' + desc + ',_Calc!F2:F,_Calc!G2:G,_Calc!H2:H},' +
    '_Calc!K2:K="Not labelled yet"),1,FALSE),"")');
  thColHead(sh.getRange('A6:E6'));
  thBand(sh.getRange(7, 1, 200, 5), false);
  thBand(sh.getRange(7, 7, 200, 6), false);
  sh.getRange('C7:C206').setNumberFormat('0');
  sh.getRange('D7:D206').setNumberFormat('$#,##0.00;[Red]-$#,##0.00');
  sh.getRange('E7:E206').setNumberFormat('yyyy-mm-dd');
  sh.getRange('G7:G206').setNumberFormat('yyyy-mm-dd');
  sh.getRange('J7:J206').setNumberFormat('#,##0.00');
  sh.getRange('L7:L206').setNumberFormat('$#,##0.00;[Red]-$#,##0.00');
  [330, 190, 60, 110, 100, 20, 95, 190, 330, 100, 70, 100].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  sh.setFrozenRows(6);
  return sh;
}


/**
 * Hidden _Peek: the To label groups laid out across row 1, one per cell, so a
 * reader that only samples the first rows of each tab (the Drive connector)
 * can see them all. Read-only helper; nothing depends on it.
 */
function vzPeekTab(ss) {
  var sh = getTab(ss, '_Peek') || ss.insertSheet('_Peek');
  sh.clear();
  var desc = 'ARRAYFORMULA(REGEXREPLACE(_Calc!D2:D," [|] [^|]*$",""))';
  sh.getRange('A1').setFormula('=IFERROR(TRANSPOSE(BYROW(QUERY({' + desc + ',_Calc!C2:C,_Calc!H2:H,_Calc!K2:K,_Calc!B2:B},' +
    '"select Col1, Col2, count(Col3), sum(Col3), min(Col5), max(Col5) where Col4 = \'Not labelled yet\' group by Col1, Col2 order by sum(Col3) asc ' +
    'label count(Col3) \'\', sum(Col3) \'\', min(Col5) \'\', max(Col5) \'\'",0),' +
    'LAMBDA(r,LEFT(INDEX(r,1,1),48)&" ¦ "&LEFT(INDEX(r,1,2),12)&" ¦ x"&INDEX(r,1,3)&" ¦ "&ROUND(INDEX(r,1,4),2)&" ¦ "&INDEX(r,1,5)&".."&INDEX(r,1,6)))),"none")');
  if (!sh.isSheetHidden()) sh.hideSheet();
}


/* ---- putting it together -------------------------------------------------------- */

/** Tabs in the order you use them; filter row on Transactions. */
function vzArrange(ss) {
  [VZ.TAB_OVERVIEW, BS.TAB_VIEW, PLAN.TAB_DASH, PLAN.TAB_COMMIT, CFG.TAB_TX, VZ.TAB_TRENDS, VZ.TAB_ACCOUNTS,
   BS.TAB_INPUT, VZ.TAB_LABEL, CFG.TAB_PAYEES, FX.CATS]
    .forEach(function (name, i) {
      var sh = getTab(ss, name);
      if (!sh) return;
      ss.setActiveSheet(sh);
      ss.moveActiveSheet(i + 1);
    });
  var tx = getTab(ss, CFG.TAB_TX);
  if (tx && !tx.getFilter() && tx.getLastRow() > 1) tx.getRange(1, 1, tx.getLastRow(), CFG.COLS.length).createFilter();
  if (tx) tx.setFrozenRows(1);
  ss.setActiveSheet(getTab(ss, VZ.TAB_OVERVIEW));
}

/** Rebuild the three tabs (on a version change). */
function vzInstall(ss) {
  vzVizTab(ss);
  vzOverviewTab(ss);
  vzTrendsTab(ss);
  vzAccountsTab(ss);
  bsInstall(ss);
  vzToLabelTab(ss);
  vzPeekTab(ss);
  thPayees(ss);
  thCategories(ss);
  vzOverviewLinks(ss);
  vzArrange(ss);
}

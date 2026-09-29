/**
 * Formulas.gs — the Dashboard is spreadsheet formulas, not script output.
 *
 * Every number you see is calculated by the sheet itself, live, from the
 * Transactions, Commitments and Categories tabs. Recalculates the moment a
 * row lands or you change a cell; TODAY() moves due dates along by itself.
 * The script's only job is to put the formulas in place and keep them right:
 *
 *   _Calc        (hidden) one ARRAYFORMULA that normalises Transactions:
 *                real dates, month key, CAD with the sign flipped for money
 *                out, and what each row counts as (from Categories).
 *   Categories   Category → Group → Counts as (Income, Living, House, Lent,
 *                Saved, Moved), plus the currency rates. Yours to edit; the
 *                script only appends categories it has not seen yet.
 *   Commitments  columns A–L are yours; M–Z are formulas, one row each:
 *                CAD, per month, per year, last paid, due dates, status,
 *                due / paid / still owed this month.
 *   Dashboard    labels and formulas at fixed rows, reading the three above.
 *
 * planInstallFormulas() rewrites them when PLAN.VERSION changes or a piece
 * is missing; planRowFormulas() is re-applied to every Commitments row on
 * each daily refresh and to the edited row on every edit.
 */

var FX = {
  CALC: '_Calc',
  CATS: 'Categories',
  COUNTS: ['Income', 'Living', 'House', 'Lent', 'Saved', 'Moved'],
  // Commitments: first formula column (M) and the headers from there on.
  COMMIT_CALC_COL: 13,
  COMMIT_CALC: ['CAD each', 'Per month (CAD)', 'Per year (CAD)', 'Last paid', 'Last amount',
                'This cycle due', 'Next due', 'Status', 'Due this month (CAD)', 'Paid this month (CAD)',
                'In / Out', 'Counts as', 'Still owed this month (CAD)', 'Days to next'],
  STALE_DAYS: 14
};

/** Group → what it counts as on the Dashboard. */
function fxCountsFor(group) {
  return { 'Income': 'Income', 'House construction': 'House', 'Lent out': 'Lent',
           'Saved / invested': 'Saved', 'Moved between your accounts': 'Moved' }[group] || 'Living';
}


/* ---- _Calc ------------------------------------------------------------------ */

var FX_CALC_HEAD = ['Date', 'Month', 'Account', 'Text', 'Payee', 'Amount', 'Currency', 'CAD',
                    'Category', 'Counts as', 'Group', 'Flow', 'Status'];

function fxCalcFormula() {
  var T = 'Transactions!';
  var date = 'IF(ISNUMBER(' + T + 'B2:B),' + T + 'B2:B,IFERROR(DATEVALUE(' + T + 'B2:B)))';
  var counts = 'IF(' + T + 'L2:L="Reversal pair","Moved",IF(' + T + 'J2:J="","Living",' +
               'IFERROR(VLOOKUP(' + T + 'J2:J,Categories!A2:C,3,0),"Living")))';
  var group = 'IF(' + T + 'J2:J="","Not labelled yet",IFERROR(VLOOKUP(' + T + 'J2:J,Categories!A2:C,2,0),"Other"))';
  return '=ARRAYFORMULA(IF(' + T + 'A2:A="",,{' +
    date + ',' +
    'TEXT(' + date + ',"yyyy-mm"),' +
    T + 'D2:D,' +
    T + 'E2:E&" | "&' + T + 'F2:F,' +
    T + 'F2:F,' +
    T + 'G2:G,' +
    T + 'H2:H,' +
    T + 'I2:I,' +
    T + 'J2:J,' +
    counts + ',' +
    group + ',' +
    'IF(' + counts + '="Income",' + T + 'I2:I,-' + T + 'I2:I),' +
    T + 'L2:L}))';
}

function fxCalcTab(ss) {
  var sh = getTab(ss, FX.CALC) || ss.insertSheet(FX.CALC);
  sh.getRange(1, 1, 1, FX_CALC_HEAD.length).setValues([FX_CALC_HEAD]);
  sh.getRange('A2').setFormula(fxCalcFormula());
  sh.getRange('A:A').setNumberFormat('yyyy-mm-dd');
  if (!sh.isSheetHidden()) sh.hideSheet();
  return sh;
}


/* ---- Categories --------------------------------------------------------------- */

/**
 * Create the tab on first use; afterwards only append categories that appear
 * in Transactions or Commitments but not here, and keep the currency rates
 * equal to CFG.FX_TO_CAD. Your edits to Group / Counts as are never touched.
 */
function fxCategoriesTab(ss, extraCats) {
  var sh = getTab(ss, FX.CATS);
  if (!sh) {
    sh = ss.insertSheet(FX.CATS);
    sh.getRange(1, 1, 1, 3).setValues([['Category', 'Group', 'Counts as']]).setFontWeight('bold').setBackground('#f1f3f4');
    sh.getRange(1, 5, 1, 2).setValues([['Currency', 'To CAD']]).setFontWeight('bold').setBackground('#f1f3f4');
    sh.setFrozenRows(1);
    [190, 200, 90, 20, 80, 80].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
    sh.getRange('A1').setNote('Every category used on Transactions or Commitments.\n\n' +
      'Group: how the Dashboard groups it.\nCounts as: Income, Living, House, Lent, Saved or Moved ' +
      '(Moved = between your own accounts; left out of every total).\n\n' +
      'Change a row and the Dashboard follows at once. New categories are added here automatically.');
    ss.setActiveSheet(sh);
    ss.moveActiveSheet(Math.min(5, ss.getNumSheets()));
  }
  sh.getRange(2, 3, sh.getMaxRows() - 1, 1).setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInList(FX.COUNTS, true).setAllowInvalid(false).build());

  var have = {};
  var last = sh.getLastRow();
  if (last > 1) sh.getRange(2, 1, last - 1, 1).getValues().forEach(function (r) { have[String(r[0]).trim()] = true; });
  var add = [];
  (extraCats || []).forEach(function (c) {
    c = String(c || '').trim();
    if (!c || have[c]) return;
    have[c] = true;
    var g = planGroup(c, /^(business income|salary|income|government benefit|tax refund|interest|rewards|transfer in)$/i.test(c) ? 1 : -1);
    add.push([c, g, fxCountsFor(g)]);
  });
  if (add.length) {
    add.sort(function (a, b) { return a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : a[0] < b[0] ? -1 : 1; });
    sh.getRange(sh.getLastRow() + 1, 1, add.length, 3).setValues(add);
  }

  // HST charged on top of business income: owed to CRA, not yours. Yours to change.
  sh.getRange('E8').setValue('HST on business income').setFontWeight('bold');
  if (sh.getRange('F8').getValue() === '') sh.getRange('F8').setValue(0.13).setNumberFormat('0%');
  sh.getRange('E9').setValue('Deposits in category "Business income" include it; the Dashboard takes it out.').setFontColor('#5f6368');

  // Currency rates: always equal to Config.gs.
  var rates = Object.keys(CFG.FX_TO_CAD).map(function (k) { return [k, CFG.FX_TO_CAD[k]]; });
  sh.getRange(2, 5, Math.max(rates.length, 5), 2).clearContent();
  sh.getRange(2, 5, rates.length, 2).setValues(rates);
  return sh;
}


/* ---- Commitments: one row of formulas ---------------------------------------- */

/** The "this transaction belongs to row r" condition, as an array expression over _Calc. */
function fxMatch(r) {
  var C = '_Calc!';
  return '(' + C + '$A$2:$A<>"")*(' + C + '$M$2:$M<>"Reversal pair")*' +
    // Match "*": the bank line has no name — same amount (within 1%), and not
    // a row already labelled as some other group.
    'IF($B' + r + '="*",(ABS(ABS(' + C + '$F$2:$F)-$C' + r + ')<=MAX(1,$C' + r + '*0.01))*' +
      '(((' + C + '$K$2:$K="Not labelled yet")+(' + C + '$K$2:$K=IFERROR(VLOOKUP($H' + r + ',Categories!$A:$B,2,0),"")))>0),' +
      'IFERROR(REGEXMATCH(' + C + '$D$2:$D,"(?i)"&$B' + r + '),FALSE))*' +
    'IF($G' + r + '="",1,IFERROR(REGEXMATCH(' + C + '$C$2:$C,"(?i)"&$G' + r + '),FALSE))*' +
    'IF($W' + r + '="In",' + C + '$H$2:$H>0,' + C + '$H$2:$H<0)';
}

/** Account coverage: the latest (or earliest) statement date for this row's Account. */
function fxCoverage(r, fn) {
  return 'IFERROR(ARRAYFORMULA(' + fn + '(FILTER(_Calc!$A$2:$A,_Calc!$A$2:$A<>"",' +
         'IF($G' + r + '="",TRUE,IFERROR(REGEXMATCH(_Calc!$C$2:$C,"(?i)"&$G' + r + '),FALSE))))),0)';
}

var FX_WD = '{"Sun","Mon","Tue","Wed","Thu","Fri","Sat"}';

/** Formulas for Commitments columns M..Z on sheet row r. */
function planRowFormulas(r) {
  var blank = 'IF($A' + r + '="","",';
  var ok = fxMatch(r);
  var common = 'f,$E' + r + ',d,$F' + r + ',isD,AND(ISNUMBER(d),d>31),k,IF(isD,DAY(d),IF(ISNUMBER(d),d,1)),' +
               'step,SWITCH(f,"Quarterly",3,"Half-yearly",6,"Yearly",12,1),';
  var dayIn = function (m) {   // due day k clamped to month m (a date inside that month)
    return 'DATE(YEAR(' + m + '),MONTH(' + m + '),MIN(k,DAY(EOMONTH(' + m + ',0))))';
  };

  var M = '=' + blank + '$C' + r + '*IFERROR(VLOOKUP($D' + r + ',Categories!$E:$F,2,0),1))';
  var N = '=' + blank + 'IF($E' + r + '="One-off","",$M' + r + '*SWITCH($E' + r + ',"Weekly",52/12,"Biweekly",26/12,"Quarterly",1/3,"Half-yearly",1/6,"Yearly",1/12,1)))';
  var O = '=' + blank + 'IF($E' + r + '="One-off",$M' + r + ',$N' + r + '*12))';
  var P = '=' + blank + 'IFERROR(ARRAYFORMULA(MAX(FILTER(_Calc!$A$2:$A,' + ok + '))),""))';
  var Q = '=IF($P' + r + '="","",IFERROR(ARRAYFORMULA(INDEX(FILTER(ABS(_Calc!$F$2:$F),' + ok + ',_Calc!$A$2:$A=$P' + r + '),1)),""))';

  // This cycle's due date: the latest due date on or before today ("" if the first is still ahead).
  var R = '=' + blank + 'LET(t,TODAY(),' + common +
    'c,SWITCH(f,' +
      '"Weekly",IF(isD,IF(t<d,"",d+7*INT((t-d)/7)),t-MOD(WEEKDAY(t)-IFERROR(MATCH(LEFT(d,3),' + FX_WD + ',0),2),7)),' +
      '"Biweekly",IF(isD,IF(t<d,"",d+14*INT((t-d)/14)),""),' +
      '"One-off",IF(AND(isD,d<=t),d,""),' +
      'IF(AND(isD,t<d),"",LET(ma,IF(isD,EDATE(DATE(YEAR(d),MONTH(d),1),step*INT(DATEDIF(DATE(YEAR(d),MONTH(d),1),DATE(YEAR(t),MONTH(t),1),"M")/step)),DATE(YEAR(t),MONTH(t),1)),' +
        'ca,' + dayIn('ma') + ',' +
        'IF(ca<=t,ca,LET(mb,EDATE(ma,-step),' + dayIn('mb') + '))))),' +
    'IF(c="","",IF(AND(isD,c<d),"",c))))';

  // Next due date after this cycle (or the first one, if none yet); blank past Ends.
  var S = '=' + blank + 'LET(t,TODAY(),c,$R' + r + ',' + common +
    'n,SWITCH(f,' +
      '"Weekly",IF(c="",IF(isD,d,t+MOD(IFERROR(MATCH(LEFT(d,3),' + FX_WD + ',0),2)-WEEKDAY(t),7)),c+7),' +
      '"Biweekly",IF(c="",IF(isD,d,""),c+14),' +
      '"One-off",IF(AND(isD,d>t),d,""),' +
      'IF(c="",IF(isD,d,""),LET(mb,EDATE(DATE(YEAR(c),MONTH(c),1),step),' + dayIn('mb') + '))),' +
    'IF(AND($K' + r + '<>"",n<>"",n>$K' + r + '),"",n)))';

  var T = '=' + blank + 'LET(t,TODAY(),c,$R' + r + ',lp,$P' + r + ',dec,$I' + r + ',inc,$W' + r + '="In",f,$E' + r + ',' +
    'wb,SWITCH(f,"Weekly",3,"Biweekly",5,10),wa,SWITCH(f,"Weekly",3,"Biweekly",8,20),' +
    'cov,' + fxCoverage(r, 'MAX') + ',first,' + fxCoverage(r, 'MIN') + ',' +
    'IF(AND($K' + r + '<>"",$K' + r + '<t),"Ended",' +
    'IF(dec="Cancel",IF(AND(lp<>"",$J' + r + '<>"",lp>$J' + r + '+2),"⚠ Charged after cancel ("&TEXT(lp,"mmm d")&")","✂ Cancelled"),' +
    'IF(AND(f="One-off",$F' + r + '=""),IF(lp<>"","✅ Paid "&TEXT(lp,"mmm d"),"📌 Owed — no date set"),' +
    'IF(c="",IF($S' + r + '="","—","⏳ First due "&TEXT($S' + r + ',"mmm d")),' +
    'IF(AND(lp<>"",lp>=c-wb),IF(inc,"✅ Received ","✅ Paid ")&TEXT(lp,"mmm d"),' +
    'IF(first>c,"— before first statement",' +
    'IF($G' + r + '="","❔ Not seen — set Account",' +
    'IF(cov>=c+wa,IF(inc,"🔴 Not received ","🔴 Not paid ")&TEXT(c,"mmm d"),' +
    'IF(t-c<=5,"⏳ Due "&TEXT(c,"mmm d"),' +
    '"❔ Can\'t tell — "&$G' + r + '&IF(cov=0," has no statements yet"," data ends "&TEXT(cov,"mmm d")))))))))))))';

  // Money due this calendar month: how many due dates fall in it × CAD each.
  var U = '=IF(OR($A' + r + '="",$I' + r + '="Cancel"),0,IFERROR(ARRAYFORMULA(LET(t,TODAY(),s,DATE(YEAR(t),MONTH(t),1),e,EOMONTH(t,0),' + common +
    'days,SEQUENCE(DAY(e),1,s),valid,IF(isD,days>=d,TRUE)*IF($K' + r + '="",TRUE,days<=$K' + r + '),' +
    'n,SWITCH(f,' +
      '"Weekly",SUM(IF(isD,MOD(days-d,7)=0,WEEKDAY(days)=IFERROR(MATCH(LEFT(d,3),' + FX_WD + ',0),2))*valid),' +
      '"Biweekly",IF(isD,SUM((MOD(days-d,14)=0)*valid),0),' +
      '"One-off",IF(isD,SUM((days=d)*1),0),' +
      'SUM((DAY(days)=MIN(k,DAY(e)))*valid*IF(isD,IFERROR(MOD(DATEDIF(DATE(YEAR(d),MONTH(d),1),s,"M"),step)=0,FALSE),TRUE))),' +
    'n*$M' + r + ')),0))';
  var V = '=IF($A' + r + '="",0,IFERROR(ARRAYFORMULA(SUM(FILTER(ABS(_Calc!$H$2:$H),' + ok + ',_Calc!$B$2:$B=TEXT(TODAY(),"yyyy-mm")))),0))';
  var W = '=' + blank + 'IF(IFERROR(VLOOKUP($H' + r + ',Categories!$A:$C,3,0),"")="Income","In","Out"))';
  var X = '=' + blank + 'IFERROR(VLOOKUP($H' + r + ',Categories!$A:$C,3,0),"Living"))';
  var Y = '=' + blank + 'IF($I' + r + '="Cancel",0,MAX(0,$U' + r + '-$V' + r + ')))';
  var Z = '=IF(OR($A' + r + '="",$S' + r + '=""),"",$S' + r + '-TODAY())';
  return [M, N, O, P, Q, R, S, T, U, V, W, X, Y, Z];
}

/** Write headers, formulas and formats for Commitments M..Z on the given rows (all rows if none given). */
function fxCommitFormulas(sh, rows) {
  var c0 = FX.COMMIT_CALC_COL, w = FX.COMMIT_CALC.length;
  sh.getRange(1, c0, 1, w).setValues([FX.COMMIT_CALC]).setFontWeight('bold').setBackground('#e8f0fe');
  var last = sh.getLastRow();
  if (last < 2) return;
  if (!rows) { rows = []; for (var r = 2; r <= last; r++) rows.push(r); }
  rows.forEach(function (r) { sh.getRange(r, c0, 1, w).setFormulas([planRowFormulas(r)]); });
  var n = last - 1;
  sh.getRange(2, c0, n, 3).setNumberFormat('$#,##0.00');            // M N O
  sh.getRange(2, c0 + 3, n, 1).setNumberFormat('yyyy-mm-dd');       // P
  sh.getRange(2, c0 + 4, n, 1).setNumberFormat('#,##0.00');         // Q
  sh.getRange(2, c0 + 5, n, 2).setNumberFormat('yyyy-mm-dd');       // R S
  sh.getRange(2, c0 + 8, n, 2).setNumberFormat('$#,##0.00');        // U V
  sh.getRange(2, c0 + 12, n, 1).setNumberFormat('$#,##0.00');       // Y
  sh.getRange(2, c0 + 13, n, 1).setNumberFormat('0');               // Z
}


/* ---- Dashboard --------------------------------------------------------------- */

var FX_M0 = 'TEXT(TODAY(),"yyyy-mm")';
// The order groups appear in, matching PLAN.GROUP_ORDER.
function fxOrder() { return '{"' + PLAN.GROUP_ORDER.join('";"') + '"}'; }
/** A QUERY result with its header row kept on top and the rest sorted by group order, then by column 2. */
function fxSortedQuery(q) {
  return 'LET(q,' + q + ',b,CHOOSEROWS(q,SEQUENCE(ROWS(q)-1,1,2)),' +
         'VSTACK(CHOOSEROWS(q,1),SORT(b,IFERROR(MATCH(INDEX(b,,1),' + fxOrder() + ',0),99),TRUE,INDEX(b,,2),TRUE)))';
}
var FX_M1 = 'TEXT(EDATE(TODAY(),-1),"yyyy-mm")';
var CM = 'Commitments!';
var FX_HST = 'Categories!$F$8';
/** The HST share of business income matching the given extra SUMIFS criteria. */
function fxHst(crit) {
  return '(SUMIFS(_Calc!$H:$H,_Calc!$I:$I,"Business income"' + crit + ')*' + FX_HST + '/(1+' + FX_HST + '))';
}

/**
 * The Dashboard layout: [row, col, value-or-formula, style]. Lists spill into
 * a fixed number of reserved rows (ARRAY_CONSTRAIN) so they never collide.
 */
function fxDashboardCells() {
  var cells = [], styles = { title: [], head: [], note: [], bold: [], money: [], money2: [], date: [] };
  function put(r, c, v, st) { cells.push([r, c, v]); if (st) (Array.isArray(st) ? st : [st]).forEach(function (s) { styles[s].push([r, c]); }); }
  function title(r, t) { put(r, 1, t, 'title'); }
  function head(r, list) { list.forEach(function (h, i) { put(r, i + 1, h, 'head'); }); }

  put(1, 1, '💰 Finance — where you stand', 'title');
  put(2, 1, '=" Live · "&TEXT(NOW(),"yyyy-mm-dd HH:mm")&" · every number here is a formula over Transactions, Commitments and Categories. Decide things on Commitments; regroup categories on Categories."', 'note');

  // Upload banner: accounts whose statements are more than FX.STALE_DAYS behind.
  put(3, 1, '=IFERROR("⚠ Upload statements to see the real picture: "&TEXTJOIN(" · ",TRUE,' +
            'FILTER(A244:A252&" ("&C244:C252&" days)",ISNUMBER(C244:C252),C244:C252>' + FX.STALE_DAYS + ')),' +
            '"✅ Every account is up to date")', 'bold');

  // At a glance
  title(5, 'At a glance (CAD)');
  head(6, ['', 'Money in (after HST)', 'Living costs', 'House construction', 'Lent (net) / saved', 'Net']);
  [[7, FX_M0, '=TEXT(TODAY(),"mmm yyyy")&" so far"'], [8, FX_M1, '=TEXT(EDATE(TODAY(),-1),"mmm yyyy")']].forEach(function (x) {
    var r = x[0], m = x[1];
    var sum = function (k) { return 'SUMIFS(_Calc!$L:$L,_Calc!$B:$B,' + m + ',_Calc!$J:$J,"' + k + '")'; };
    put(r, 1, x[2]);
    put(r, 2, '=' + sum('Income') + '-' + fxHst(',_Calc!$B:$B,' + m), 'money');
    put(r, 3, '=' + sum('Living'), 'money');
    put(r, 4, '=' + sum('House'), 'money');
    put(r, 5, '=' + sum('Lent') + '+' + sum('Saved'), 'money');
    put(r, 6, '=B' + r + '-C' + r + '-D' + r + '-E' + r, ['money', 'bold']);
  });
  var und = '(COUNTIFS(' + CM + 'W2:W,"Out",' + CM + 'I2:I,"")+COUNTIFS(' + CM + 'W2:W,"Out",' + CM + 'I2:I,"Review"))';
  var undYr = '(SUMIFS(' + CM + 'O2:O,' + CM + 'W2:W,"Out",' + CM + 'I2:I,"")+SUMIFS(' + CM + 'O2:O,' + CM + 'W2:W,"Out",' + CM + 'I2:I,"Review"))';
  put(9, 1, 'Phase 2 progress', 'bold');
  put(9, 2, '=(COUNTIFS(' + CM + 'W2:W,"Out")-' + und + ')&" of "&COUNTIFS(' + CM + 'W2:W,"Out")&" recurring costs decided"', 'bold');
  put(9, 4, '=IF(' + und + '=0,"All decided ✅",' + und + '&" waiting for Keep/Cancel ("&TEXT(' + undYr + ',"$#,##0")&"/yr)")', 'bold');

  // This month's plan
  title(11, '="This month\'s plan — "&TEXT(TODAY(),"mmmm yyyy")');
  var sumC = function (col, crit) { return 'SUMIFS(' + CM + col + '2:' + col + ',' + crit + ')'; };
  var plan = [
    ['Expected in', '=' + sumC('U', CM + 'W2:W,"In"'), 'Income on Commitments due this month'],
    ['Committed bills & loans', '=-' + sumC('U', CM + 'W2:W,"Out",' + CM + 'I2:I,"<>Cancel"'), 'Every Keep / undecided commitment due this month'],
    ['Everyday spending', '=-MAX(0,SUMIFS(_Calc!$L:$L,_Calc!$B:$B,' + FX_M1 + ',_Calc!$J:$J,"Living")-' + sumC('N', CM + 'X2:X,"Living",' + CM + 'W2:W,"Out",' + CM + 'I2:I,"<>Cancel"') + ')', 'Last month\'s living costs minus the bills above'],
    ['Left over', '=B12+B13+B14', ''],
    ['House construction pace', '=-SUMIFS(_Calc!$L:$L,_Calc!$B:$B,' + FX_M1 + ',_Calc!$J:$J,"House")', 'Last month — a project, not a living cost'],
    ['Left over after the house', '=B15+B16', ''],
    ['Still to pay this month', '=-' + sumC('Y', CM + 'W2:W,"Out"'), 'Due this month and not seen paid yet'],
    ['Still to come in this month', '=' + sumC('Y', CM + 'W2:W,"In"'), '']
  ];
  plan.push(['HST collected this year — owed to CRA', '=-' + fxHst(',_Calc!$A:$A,">="&DATE(YEAR(TODAY()),1,1)'),
            'Already left out of "Money in" above; set it aside. Rate on the Categories tab.']);
  plan.forEach(function (p, i) {
    var r = 12 + i;
    put(r, 1, p[0], i === 3 || i === 5 ? 'bold' : null);
    put(r, 2, p[1], i === 3 || i === 5 ? ['money', 'bold'] : 'money');
    put(r, 3, p[2], 'note');
  });

  // Still to pay: anything needing attention, plus everything due in the next 14 days.
  title(21, '🧾 Still to pay — needs you now, then the next 14 days');
  head(22, ['Due', 'What', 'CAD', 'Amount', 'Status', 'Days to next', 'Account', 'Note']);
  // key 0 = needs you (missed, charged after cancel), 1 = due now / owed, 2 = just upcoming.
  var key = 'IF(REGEXMATCH(' + CM + 'T2:T,"^(🔴|⚠)"),0,IF(REGEXMATCH(' + CM + 'T2:T,"^(⏳|📌)"),1,2))';
  var when = 'IF(' + key + '<2,IF(' + CM + 'R2:R="",' + CM + 'S2:S,' + CM + 'R2:R),' + CM + 'S2:S)';
  var what = 'IF(' + key + '<2,' + CM + 'T2:T,"🗓 "&IF(' + CM + 'Z2:Z=0,"today",IF(' + CM + 'Z2:Z=1,"tomorrow","in "&' + CM + 'Z2:Z&" days"))&' +
             'IF(LEFT(' + CM + 'T2:T,1)="✅"," · last "&SUBSTITUTE(SUBSTITUTE(' + CM + 'T2:T,"✅ Paid ","paid "),"✅ Received ","received "),' +
             'IF(LEFT(' + CM + 'T2:T,1)="❔"," · last cycle unconfirmed","")))';
  put(23, 1, '=IFERROR(ARRAY_CONSTRAIN(CHOOSECOLS(SORT(FILTER(ARRAYFORMULA({' + when + ',' + CM + 'A2:A,' + CM + 'M2:M,' +
             CM + 'C2:C&" "&' + CM + 'D2:D,' + what + ',' + CM + 'Z2:Z,' + CM + 'G2:G,' + CM + 'L2:L,' + key + '}),' +
             CM + 'A2:A<>"",' + CM + 'I2:I<>"Cancel",' +
             'REGEXMATCH(' + CM + 'T2:T,"^(🔴|⏳|📌|⚠)")+IFERROR((' + CM + 'Z2:Z<=14)*(' + CM + 'Z2:Z<>"")*(1-REGEXMATCH(' + CM + 'T2:T,"^(Ended|✂)")),0)),' +
             '9,TRUE,1,TRUE),1,2,3,4,5,6,7,8),20,8),"Nothing due in the next 14 days")');
  styles.date.push([23, 1, 20, 1]); styles.money2.push([23, 3, 20, 1]);

  // Payments the statements cannot confirm yet, one line per account.
  title(44, '❔ Can\'t confirm yet — upload these accounts\' statements');
  var qAcc = 'IF(' + CM + 'G2:G="","(no account set)",' + CM + 'G2:G)';
  var blind = 'LEFT(' + CM + 'T2:T,1)="❔"';
  put(45, 1, '=IFERROR(ARRAY_CONSTRAIN(UNIQUE(FILTER(ARRAYFORMULA(' + qAcc + '),' + blind + ')),6,1),"Nothing — every due payment is accounted for")');
  put(45, 2, '=BYROW(A45:A50,LAMBDA(a,IF(OR(a="",LEFT(a,7)="Nothing"),"",TEXTJOIN(", ",TRUE,FILTER(' + CM + 'A2:A,' + blind + ',ARRAYFORMULA(' + qAcc + ')=a)))))');
  put(45, 3, '=BYROW(A45:A50,LAMBDA(a,IF(OR(a="",LEFT(a,7)="Nothing"),"",SUM(FILTER(' + CM + 'M2:M,' + blind + ',ARRAYFORMULA(' + qAcc + ')=a)))))');
  styles.money2.push([45, 3, 6, 1]);

  // Credit cards: what has been spent since the last payment.
  title(52, 'Credit cards');
  head(53, ['Card', 'Spent since last payment', 'Last payment', 'Statements up to']);
  put(54, 1, '=IFERROR(ARRAY_CONSTRAIN(FILTER(UNIQUE(FILTER(_Calc!C2:C,_Calc!C2:C<>"")),REGEXMATCH(UNIQUE(FILTER(_Calc!C2:C,_Calc!C2:C<>"")),"(?i)mastercard|visa|regalia|credit")),4,1),"")');
  var lastPay = 'MAXIFS(_Calc!A2:A,_Calc!C2:C,a,_Calc!I2:I,"Creditcard",_Calc!H2:H,">0")';
  put(54, 2, '=BYROW(A54:A57,LAMBDA(a,IF(a="","",-SUMIFS(_Calc!H2:H,_Calc!C2:C,a,_Calc!A2:A,">"&' + lastPay + ',_Calc!J2:J,"<>Moved"))))');
  put(54, 3, '=BYROW(A54:A57,LAMBDA(a,IF(a="","",IF(' + lastPay + '=0,"none seen",' + lastPay + '))))');
  put(54, 4, '=BYROW(A54:A57,LAMBDA(a,IF(a="","",MAXIFS(_Calc!A2:A,_Calc!C2:C,a))))');
  styles.money2.push([54, 2, 4, 1]); styles.date.push([54, 3, 4, 2]);

  // Paid this month
  title(59, '✅ Paid / received this month');
  head(60, ['Paid on', 'What', 'Paid (CAD)', 'Listed amount']);
  put(61, 1, '=IFERROR(ARRAY_CONSTRAIN(SORT(FILTER({' + CM + 'P2:P,' + CM + 'A2:A,' + CM + 'V2:V,' + CM + 'C2:C&" "&' + CM + 'D2:D},' +
             CM + 'P2:P<>"",TEXT(' + CM + 'P2:P,"yyyy-mm")=' + FX_M0 + '),1,TRUE),15,4),"None seen yet this month")');
  styles.date.push([61, 1, 15, 1]); styles.money2.push([61, 3, 15, 1]);

  // Where you're wasting money
  title(77, '🔥 Where you\'re wasting money');
  head(78, ['1. Recurring costs waiting for Keep / Cancel', 'Per month', 'Per year', 'Last paid', 'Note']);
  put(79, 1, '=IFERROR(ARRAY_CONSTRAIN(SORT(FILTER({' + CM + 'A2:A,' + CM + 'N2:N,' + CM + 'O2:O,' + CM + 'P2:P,' + CM + 'L2:L},' +
             CM + 'A2:A<>"",' + CM + 'W2:W="Out",(' + CM + 'I2:I="")+(' + CM + 'I2:I="Review")),3,FALSE),15,5),"Every recurring cost has a decision ✅")');
  styles.money2.push([79, 2, 15, 2]); styles.date.push([79, 4, 15, 1]);
  put(94, 1, 'Total you could still trim', 'bold');
  put(94, 3, '=' + undYr, ['money', 'bold']);
  put(95, 1, 'Already cancelled — saves per year');
  put(95, 3, '=SUMIFS(' + CM + 'O2:O,' + CM + 'I2:I,"Cancel")', 'money');

  head(97, ['2. Cancelled but still charging', 'Status']);
  put(98, 1, '=IFERROR(ARRAY_CONSTRAIN(FILTER({' + CM + 'A2:A,' + CM + 'T2:T},LEFT(' + CM + 'T2:T,1)="⚠"),4,2),"Nothing — every cancelled item has stopped")');

  var since90 = 'TEXT(TODAY()-90,"yyyy-mm-dd")';
  head(103, ['3. Fees & charges (pure waste)', 'Times', 'Last 90 days', 'Per year']);
  put(104, 1, '=IFERROR(ARRAY_CONSTRAIN(QUERY(_Calc!A2:M,"select E, count(H), sum(L) where K = \'Fees & charges\' and A > date \'"&' + since90 + '&"\' group by E order by sum(L) desc label count(H) \'\', sum(L) \'\'",0),8,3),"No fees in the last 90 days")');
  put(104, 4, '=ARRAYFORMULA(IF(ISNUMBER(C104:C111),IFERROR(VLOOKUP(A104:A111,' + CM + 'A2:O,15,0),' +
              'C104:C111*365/MAX(30,MIN(90,MAX(_Calc!A2:A)-MIN(_Calc!A2:A)+1))),""))');
  styles.money2.push([104, 3, 8, 2]);

  var since30 = 'TEXT(MAX(_Calc!A2:A)-30,"yyyy-mm-dd")';
  head(113, ['4. Small habits (5+ times in the last 30 days of statements)', 'Times', 'Spent', 'Per year', 'Category']);
  put(114, 1, '=IFERROR(ARRAY_CONSTRAIN(QUERY(QUERY(_Calc!A2:M,"select E, count(H), sum(L), I where K = \'Lifestyle\' and A > date \'"&' + since30 + '&"\' group by E, I label count(H) \'\', sum(L) \'\'",0),' +
              '"select Col1, Col2, Col3, Col3*365/30, Col4 where Col2 >= 5 order by Col3 desc label Col3*365/30 \'\'",0),8,5),"No habits — nothing bought 5+ times in 30 days")');
  styles.money2.push([114, 3, 8, 2]);

  head(123, ['5. Lifestyle spending by category']);
  put(124, 1, '=IFERROR(ARRAY_CONSTRAIN(QUERY(_Calc!A1:M,"select I, sum(L) where K = \'Lifestyle\' and (B = \'"&' + FX_M1 + '&"\' or B = \'"&' + FX_M0 + '&"\') group by I pivot B",1),10,3),"No lifestyle spending")');
  put(124, 5, '=ARRAYFORMULA(IF(ROW(B124:B133)=124,"Per year at "&TEXT(EDATE(TODAY(),-1),"mmm")&"\'s rate",IF(ISNUMBER(B124:B133),B124:B133*12,"")))');
  styles.money.push([125, 2, 9, 4]);

  // Where the money goes: live pivots over the last four months.
  var from4 = 'TEXT(EDATE(TODAY(),-3),"yyyy-mm")';
  title(136, '📊 Where your money goes — by group (CAD, money out positive)');
  put(137, 1, '=IFERROR(ARRAY_CONSTRAIN(' + fxSortedQuery('QUERY(_Calc!A1:M,"select K, sum(L) where J <> \'Moved\' and B >= \'"&' + from4 + '&"\' group by K pivot B",1)') + ',16,6),"No data")');
  styles.money.push([138, 2, 15, 5]);
  title(155, '📊 By category');
  put(156, 1, '=IFERROR(ARRAY_CONSTRAIN(' + fxSortedQuery('QUERY(_Calc!A1:M,"select K, I, sum(L) where J <> \'Moved\' and B >= \'"&' + from4 + '&"\' group by K, I pivot B",1)') + ',70,7),"No data")');
  styles.money.push([157, 3, 69, 5]);
  put(227, 1, 'Card payments, own transfers and money sent to India count as "Moved" (Categories tab) and are left out of every total.', 'note');

  // Biggest payees
  title(229, 'Biggest payees');
  put(230, 1, '=TEXT(TODAY(),"mmm yyyy")&" so far"', 'head');
  put(230, 5, '=TEXT(EDATE(TODAY(),-1),"mmm yyyy")', 'head');
  var payees = function (m) {
    return '=IFERROR(ARRAY_CONSTRAIN(QUERY(_Calc!A2:M,"select E, sum(L), count(L) where B = \'"&' + m + '&"\' and J <> \'Moved\' and J <> \'Income\' group by E order by sum(L) desc limit 10 label sum(L) \'\', count(L) \'\'",0),10,3),"No spending")';
  };
  put(231, 1, payees(FX_M0)); put(231, 5, payees(FX_M1));
  styles.money2.push([231, 2, 10, 1]); styles.money2.push([231, 6, 10, 1]);

  // Data health
  title(242, '🧹 Data health');
  put(243, 1, '=IFERROR(ARRAY_CONSTRAIN(QUERY(_Calc!A1:M,"select C, max(A) where C is not null group by C label max(A) \'Latest transaction\'",1),10,2),"")');
  put(243, 3, '=ARRAYFORMULA(IF(ROW(B243:B252)=243,"Days behind",IF(ISNUMBER(B243:B252),TODAY()-B243:B252,"")))');
  styles.date.push([244, 2, 9, 1]);
  put(254, 1, '=COUNTIFS(_Calc!K2:K,"Not labelled yet")&" transaction(s) have no category yet — add a Payees pattern, then Finance › Re-label everything."', 'note');

  return { cells: cells, styles: styles };
}

function fxDashboardTab(ss) {
  var sh = getTab(ss, PLAN.TAB_DASH);
  if (!sh) sh = ss.insertSheet(PLAN.TAB_DASH, 0);
  sh.clear();
  sh.clearConditionalFormatRules();
  var d = fxDashboardCells();
  d.cells.forEach(function (c) {
    var rg = sh.getRange(c[0], c[1]);
    if (typeof c[2] === 'string' && c[2].charAt(0) === '=') rg.setFormula(c[2]); else rg.setValue(c[2]);
  });
  var W = 8;
  function rng(p) { return sh.getRange(p[0], p[1], p[2] || 1, p[3] || 1); }
  d.styles.title.forEach(function (p) { sh.getRange(p[0], 1, 1, W).setFontWeight('bold').setFontSize(12).setBackground('#e8f0fe'); });
  d.styles.head.forEach(function (p) { rng(p).setFontWeight('bold').setBackground('#f1f3f4'); });
  d.styles.note.forEach(function (p) { rng(p).setFontColor('#5f6368').setFontStyle('italic'); });
  d.styles.bold.forEach(function (p) { rng(p).setFontWeight('bold'); });
  d.styles.money.forEach(function (p) { rng(p).setNumberFormat('$#,##0;[Red]-$#,##0'); });
  d.styles.money2.forEach(function (p) { rng(p).setNumberFormat('$#,##0.00;[Red]-$#,##0.00'); });
  d.styles.date.forEach(function (p) { rng(p).setNumberFormat('yyyy-mm-dd'); });

  // Status colours, wherever they appear.
  var all = sh.getRange('A1:H260');
  var rule = function (txt, bg, fg) {
    var b = SpreadsheetApp.newConditionalFormatRule().whenTextStartsWith(txt).setRanges([all]);
    if (bg) b.setBackground(bg);
    if (fg) b.setFontColor(fg);
    return b.build();
  };
  sh.setConditionalFormatRules([
    rule('🔴', '#fce8e6'), rule('⚠', '#fce8e6'), rule('⏳', '#fef7e0'), rule('📌', '#fef7e0'),
    rule('❔', null, '#80868b'), rule('✅', '#e6f4ea')
  ]);
  [230, 180, 110, 120, 240, 110, 110, 260].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  sh.setFrozenRows(3);
  return sh;
}

/** Commitments status colours (column T). */
function fxCommitColours(sh) {
  var rg = sh.getRange('T2:T');
  var rule = function (txt, bg, fg) {
    var b = SpreadsheetApp.newConditionalFormatRule().whenTextStartsWith(txt).setRanges([rg]);
    if (bg) b.setBackground(bg);
    if (fg) b.setFontColor(fg);
    return b.build();
  };
  sh.setConditionalFormatRules([rule('🔴', '#fce8e6'), rule('⚠', '#fce8e6'), rule('⏳', '#fef7e0'),
                                rule('📌', '#fef7e0'), rule('❔', null, '#80868b'), rule('✅', '#e6f4ea')]);
}

/**
 * Put every formula in place. Cheap parts (Categories, Commitments rows) run
 * on every call; the Dashboard and _Calc are rewritten only when the code
 * version changed or the Dashboard's first formula is missing.
 */
function planInstallFormulas(ss, commitSh, cats) {
  if (ss.getSpreadsheetTimeZone() !== CFG_TZ()) ss.setSpreadsheetTimeZone(CFG_TZ());
  fxCategoriesTab(ss, cats);
  var props = PropertiesService.getScriptProperties();
  var dash = getTab(ss, PLAN.TAB_DASH);
  var fresh = props.getProperty('fx_version') !== PLAN.VERSION || !dash || !dash.getRange('A3').getFormula() || !getTab(ss, FX.CALC);
  if (fresh) {
    fxCalcTab(ss);
    fxDashboardTab(ss);
    fxCommitColours(commitSh);
    props.setProperty('fx_version', PLAN.VERSION);
  }
  fxCommitFormulas(commitSh);
}

/**
 * BalanceSheet.gs — what you own, what you owe, and the difference.
 *
 *   Assets & Debts   (yours) one row per thing no statement can tell the
 *                    script: investments, a loan's outstanding balance, a car,
 *                    gold, a chequing balance whose CSV carries none. Created
 *                    once with suggested rows and empty amounts; never cleared.
 *   Balance Sheet    (the script's, rebuilt) everything it can work out by
 *                    itself plus your rows, totals, net worth, charts, and the
 *                    loan payments still to come.
 *   _NetWorth        (hidden) one row per day: total assets, debts, net worth,
 *                    written by the daily upkeep so the chart has a history.
 *
 * Worked out automatically:
 *   - bank balances: the last closing balance a statement carried (_Balances)
 *   - the house: construction spending so far, at cost
 *   - money lent: net of repayments, when positive
 *   - credit cards: spent since the last payment (Dashboard › Credit cards)
 *   - HST collected this year, owed to CRA (Dashboard)
 * A row you add with the same name as an automatic one replaces it.
 */

var BS = {
  TAB_INPUT: 'Assets & Debts',
  TAB_VIEW: 'Balance Sheet',
  TAB_LOG: '_NetWorth',
  COLS: ['Name', 'Asset or Debt', 'Class', 'Currency', 'Current value', 'Amount invested', 'As of', 'Notes'],
  // Column letters of the Assets & Debts tab (I = CAD, a formula). Amount invested is filled in by
  // the script for Wealthsimple, gold and the house (from your transactions); type it for the rest.
  C: { value: 'E', invested: 'F', asof: 'G', notes: 'H', cad: 'I' },
  ASSET_CLASSES: ['Cash & bank', 'Investments', 'Retirement', 'Property', 'Vehicle', 'Money owed to you', 'Other asset'],
  DEBT_CLASSES: ['Home loan', 'Personal loan', 'Credit card', 'Tax owed', 'Money you owe', 'Other debt'],
  ROWS: 28,                 // room in each list on the Balance Sheet
  HOUSE: 'House + land (India)',
  SEED: [
    ['Wealthsimple', 'Asset', 'Investments', 'CAD', '', '', '', 'Total value from the Wealthsimple app.'],
    ['RBC Chequing ••1324', 'Asset', 'Cash & bank', 'CAD', '', '', '', 'Its CSV has no balance — type today\'s balance from the RBC app.'],
    ['CIBC Chequing 73-83096', 'Asset', 'Cash & bank', 'CAD', '', '', '', 'Its CSV has no balance — type today\'s balance from the CIBC app.'],
    ['Cash in hand', 'Asset', 'Cash & bank', 'CAD', '', '', '', 'Optional.'],
    ['Car', 'Asset', 'Vehicle', 'CAD', '', '', '', 'Optional: what it would sell for today.'],
    ['Gold / jewellery', 'Asset', 'Other asset', 'INR', '', '', '', 'Optional: today\'s value.'],
    ['HDFC home loan — balance owed', 'Debt', 'Home loan', 'INR', '', '', '', 'Outstanding principal from the HDFC loan statement (not EMIs × months).'],
    ['Kotak Mahindra loan — balance owed', 'Debt', 'Personal loan', 'INR', '', '', '', 'Outstanding principal from the Kotak loan statement.']
  ]
};

var BS_RATE = function (cur) { return 'IFERROR(VLOOKUP(' + cur + ',Categories!$E:$F,2,0),1)'; };


/* ---- Assets & Debts: your input tab ---------------------------------------------- */

function bsInputTab(ss) {
  var sh = getTab(ss, BS.TAB_INPUT);
  if (!sh) {
    sh = ss.insertSheet(BS.TAB_INPUT);
    sh.getRange(1, 1, 1, BS.COLS.length).setValues([BS.COLS]);
    sh.getRange(2, 1, BS.SEED.length, BS.COLS.length).setValues(BS.SEED);
  }
  var rows = sh.getMaxRows() - 1;
  sh.getRange('I1').setFormula('={"CAD";ARRAYFORMULA(IF(E2:E="","",E2:E*' + BS_RATE('D2:D') + '))}');
  var list = function (vals) { return SpreadsheetApp.newDataValidation().requireValueInList(vals, true).setAllowInvalid(true).build(); };
  sh.getRange(2, 2, rows, 1).setDataValidation(list(['Asset', 'Debt']));
  sh.getRange(2, 3, rows, 1).setDataValidation(list(BS.ASSET_CLASSES.concat(BS.DEBT_CLASSES)));
  sh.getRange(2, 4, rows, 1).setDataValidation(list(Object.keys(CFG.FX_TO_CAD)));
  sh.getRange(2, 7, rows, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireDate().setAllowInvalid(true).build());
  sh.getRange(2, 5, rows, 2).setNumberFormat('#,##0.00');
  sh.getRange(2, 7, rows, 1).setNumberFormat('yyyy-mm-dd');
  sh.getRange(2, 9, rows, 1).setNumberFormat('$#,##0.00');

  thClearBands(sh);
  sh.getRange(1, 1, rows + 1, 9).setFontFamily(TH.FONT).setVerticalAlignment('middle');
  thBand(sh.getRange(1, 1, rows + 1, 9), true);
  thHeader(sh.getRange(1, 1, 1, 8));
  thHeader(sh.getRange(1, 9), TH.CALC_HEAD);
  sh.setRowHeight(1, 32);
  sh.getRange(2, 1, rows, 1).setFontWeight('bold');
  sh.getRange(2, 8, rows, 1).setFontColor(TH.GREY);
  sh.getRange(2, 9, rows, 1).setFontColor(TH.CALC_INK);
  sh.setConditionalFormatRules([
    // An amount still to fill in.
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=AND($A2<>"",$E2="")')
      .setRanges([sh.getRange(2, 5, rows, 1), sh.getRange(2, 7, rows, 1)]).setBackground(TH.INPUT).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('Debt').setRanges([sh.getRange(2, 2, rows, 1)])
      .setFontColor(TH.BAD).setBold(true).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('Asset').setRanges([sh.getRange(2, 2, rows, 1)])
      .setFontColor(TH.GOOD).setBold(true).build()
  ]);
  [270, 110, 130, 80, 120, 120, 100, 420, 120].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  sh.getRange('E1').setNote('What it is worth today, in its own currency. For a loan or card: what you owe.');
  sh.getRange('F1').setNote('What you put in (your cost). Filled in automatically from your transactions for Wealthsimple, ' +
    'gold / jewellery and the house; type it for anything else. Current value − amount invested = your gain or loss.');
  sh.setFrozenRows(1);
  sh.getRange('A1').setNote('Yours to edit. One row per thing you own or owe that no bank statement shows.\n\n' +
    'Current value in the item\'s own currency, always positive (a debt is entered as what you owe).\n' +
    'As of: when you checked it — the Balance Sheet flags anything older than 60 days.\n' +
    'A row named like an automatic one (e.g. "TD Business Chequing") replaces the automatic figure.\n' +
    'Leave Amount blank and the row is simply left out.');
  return sh;
}


/* ---- Balance Sheet: the view ------------------------------------------------------- */

/**
 * Columns A–G: Item | Class | Where from | As of | Amount | Currency | CAD.
 * Assets list at row 12, debts at row 12 + ROWS + 4.
 */
function bsViewTab(ss) {
  var sh = getTab(ss, BS.TAB_VIEW) || ss.insertSheet(BS.TAB_VIEW);
  sh.getCharts().forEach(function (c) { sh.removeChart(c); });
  sh.clear();
  sh.clearConditionalFormatRules();
  thClearBands(sh);
  sh.getRange('A1:N200').breakApart();
  thPage(sh, 14);
  [270, 130, 150, 95, 120, 75, 120, 20, 150, 110, 20, 120, 120, 120].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });

  var IN = "'" + BS.TAB_INPUT + "'!", N = BS.ROWS;
  var a0 = 12, aEnd = a0 + N - 1, aTot = aEnd + 1;
  var d0 = aTot + 4, dEnd = d0 + N - 1, dTot = dEnd + 1;
  var mine = function (kind) {   // your rows of one kind, with an amount
    return 'IFERROR(FILTER({' + IN + 'A2:A,' + IN + 'C2:C,ARRAYFORMULA(IF(' + IN + 'A2:A<>"","You entered","")),' +
           'ARRAYFORMULA(IF(' + IN + 'G2:G="","",TEXT(' + IN + 'G2:G,"yyyy-mm-dd"))),' + IN + 'E2:E,' + IN + 'D2:D,' + IN + 'I2:I},' +
           IN + 'B2:B="' + kind + '",' + IN + 'E2:E<>"",' +
           // a typed bank balance is already in the bank rows (via Now)
           'ISNA(MATCH(' + IN + 'A2:A,{' + pgAccounts().banks.map(function (b) { return '"' + b.name + '"'; }).join(';') + '},0))),{"","","","","","",""})';
  };
  var notMine = function (nameExpr) {  // drop an automatic row you entered yourself
    return 'ISNA(MATCH(' + nameExpr + ',FILTER(' + IN + 'A2:A,' + IN + 'E2:E<>""),0))';
  };
  var latest = 'TEXT(MAX(_Calc!A2:A),"yyyy-mm-dd")';

  sh.getRange('A1').setValue('🏛 Balance sheet — what you own and what you owe');
  sh.getRange('A2').setFormula('="Live · "&TEXT(NOW(),"ddd d mmm yyyy")&" · all in CAD · bank balances come from the last statement that carried one; ' +
    'everything else from the Assets & Debts tab"').setFontColor(TH.GREY).setFontStyle('italic');
  sh.getRange('A3').setFormula('=LET(n,COUNTIFS(' + IN + 'A2:A,"<>",' + IN + 'E2:E,""),old,COUNTIFS(' + IN + 'E2:E,"<>",' + IN + 'G2:G,"<"&TODAY()-60),' +
    'IF(n+old=0,"✅ Every item has a recent value",IF(n>0,"✍ "&n&" item(s) on Assets & Debts have no amount yet","")&IF(AND(n>0,old>0)," · ","")&' +
    'IF(old>0,"⏰ "&old&" value(s) older than 60 days — update them","")))').setFontColor(TH.NAVY).setFontWeight('bold');

  // Tiles.
  var tiles = [['What you own', '=G' + aTot, TH.GOOD], ['What you owe', '=G' + dTot, TH.BAD],
               ['Net worth', '=G' + aTot + '-G' + dTot, TH.NAVY]];
  tiles.forEach(function (t, i) {
    var cols = i === 2 ? 3 : 2;
    var col = [1, 3, 5][i];
    [5, 6, 7].forEach(function (r) { sh.getRange(r, col, 1, cols).merge(); });
    sh.getRange(5, col).setValue(t[0]).setFontColor(TH.GREY).setFontSize(9);
    sh.getRange(6, col).setFormula(t[1]).setFontSize(22).setFontWeight('bold').setFontColor(t[2]).setNumberFormat('$#,##0;-$#,##0');
    sh.getRange(5, col, 3, cols).setBackground('#f8f9fa')
      .setBorder(true, true, true, true, false, false, '#dadce0', SpreadsheetApp.BorderStyle.SOLID);
  });
  sh.getRange(7, 1).setFormula('=COUNTIF(B' + a0 + ':B' + aEnd + ',"?*")&" item(s)"').setFontColor(TH.GREY).setFontSize(9);
  sh.getRange(7, 3).setFormula('=COUNTIF(B' + d0 + ':B' + dEnd + ',"?*")&" item(s)"').setFontColor(TH.GREY).setFontSize(9);
  sh.getRange(7, 5).setFormula('=IFERROR(LET(h,FILTER(' + BS.TAB_LOG + '!A2:D,' + BS.TAB_LOG + '!A2:A<>""),f,INDEX(h,1,4),' +
    '"Since "&TEXT(INDEX(h,1,1),"d mmm yyyy")&": "&TEXT((G' + aTot + '-G' + dTot + ')-f,"+$#,##0;-$#,##0")),"History starts today")')
    .setFontColor(TH.GREY).setFontSize(9);
  sh.setRowHeight(6, 44);

  var section = function (r, text) {
    sh.getRange(r, 1, 1, 7).setBackground(TH.SECTION).setFontColor('#ffffff').setFontWeight('bold').setFontSize(12);
    sh.getRange(r, 1).setValue(text);
    sh.setRowHeight(r, 28);
  };
  var head = ['Item', 'Class', 'Where from', 'As of', 'Amount', 'Currency', 'CAD'];

  // Assets.
  section(a0 - 2, '🟢 What you own');
  sh.getRange(a0 - 1, 1, 1, 7).setValues([head]);
  thColHead(sh.getRange(a0 - 1, 1, 1, 7));
  // Bank balances come from the Now tab — statement or typed balance, rolled forward with every
  // later transaction — so this tab and Now never show two numbers for one account.
  var L = pgNowRows(pgAccounts().banks.length), NOW = "'" + PG.TAB_NOW + "'!";
  var nowA = NOW + 'A' + L.b0 + ':A' + L.bEnd, nowB = NOW + 'B' + L.b0 + ':B' + L.bEnd, nowC = NOW + 'C' + L.b0 + ':C' + L.bEnd;
  var bank = 'LET(k,FILTER(HSTACK(' + nowA + ',' + nowB + ',' + nowC + '),' + nowA + '<>"",ISNUMBER(' + nowB + ')),acc,INDEX(k,,1),amt,INDEX(k,,2),' +
    'cur,MAP(acc,LAMBDA(x,IFERROR(INDEX(FILTER(_Calc!G2:G,_Calc!C2:C=x),1),"CAD"))),' +
    'HSTACK(acc,MAP(acc,LAMBDA(x,"Cash & bank")),MAP(acc,LAMBDA(x,"Balance + later transactions")),' +
    'MAP(INDEX(k,,3),LAMBDA(d,IF(ISNUMBER(d),TEXT(d,"yyyy-mm-dd"),""))),amt,cur,' +
    'MAP(amt,cur,LAMBDA(v,c,v*' + BS_RATE('c') + '))))';
  // Until its value is typed on Assets & Debts (a row with this name), the house counts at what it cost.
  // Its cost = Amount invested on the house row (house payments + the India cash beyond the parents'
  // share, worked out by the script); before that number exists, the house categories in _Calc.
  var hRow = 'FILTER(' + IN + BS.C.invested + '2:' + BS.C.invested + ',' + IN + 'A2:A="' + BS.HOUSE + '",' + IN + BS.C.invested + '2:' + BS.C.invested + '<>"")';
  var hCur = 'INDEX(FILTER(' + IN + 'D2:D,' + IN + 'A2:A="' + BS.HOUSE + '"),1)';
  var house = 'LET(v,IFERROR(INDEX(' + hRow + ',1)*' + BS_RATE(hCur) + ',SUMIFS(_Calc!$L:$L,_Calc!$J:$J,"House")),n,"' + BS.HOUSE + '",' +
    'IF(AND(v>0,' + notMine('n') + '),{n,"Property","Your transactions",' + latest + ',v,"CAD",v},{"","","","","","",""}))';
  var lent = 'LET(v,SUMIFS(_Calc!$L:$L,_Calc!$J:$J,"Lent"),n,"Money lent to others (net)",' +
    'IF(AND(v>0,' + notMine('n') + '),{n,"Money owed to you","Your transactions",' + latest + ',v,"CAD",v},{"","","","","","",""}))';
  sh.getRange(a0, 1).setFormula('=IFERROR(ARRAY_CONSTRAIN(LET(lst,VSTACK(IFERROR(' + bank + ',{"","","","","","",""}),' + house + ',' + lent + ',' + mine('Asset') + '),' +
    'SORT(FILTER(lst,INDEX(lst,,1)<>""),7,FALSE)),' + N + ',7),"Nothing yet — add what you own on the Assets & Debts tab")');
  sh.getRange(aTot, 1).setValue('Total you own').setFontWeight('bold');
  sh.getRange(aTot, 7).setFormula('=SUM(G' + a0 + ':G' + aEnd + ')').setFontWeight('bold');

  // Debts.
  section(d0 - 2, '🔴 What you owe');
  sh.getRange(d0 - 1, 1, 1, 7).setValues([head]);
  thColHead(sh.getRange(d0 - 1, 1, 1, 7));
  var cards = 'LET(c,Dashboard!A54:A57,v,Dashboard!B54:B57,k,FILTER(HSTACK(c,v),c<>"",ISNUMBER(v),v>0),' +
    'n,INDEX(k,,1),x,INDEX(k,,2),f,MAP(n,LAMBDA(z,' + notMine('z') + ')),kk,FILTER(HSTACK(n,x),f),nm,INDEX(kk,,1),xs,INDEX(kk,,2),' +
    'HSTACK(nm,MAP(nm,LAMBDA(z,"Credit card")),MAP(nm,LAMBDA(z,"Spent since last payment")),' +
    'MAP(nm,LAMBDA(z,TEXT(MAXIFS(_Calc!A2:A,_Calc!C2:C,z),"yyyy-mm-dd"))),xs,MAP(nm,LAMBDA(z,"CAD")),xs))';
  var hst = 'LET(v,-Dashboard!B20,n,"HST owed to CRA (collected this year)",IF(AND(ISNUMBER(v),v>0,' + notMine('n') + '),' +
    '{n,"Tax owed","Dashboard",' + latest + ',v,"CAD",v},{"","","","","","",""}))';
  sh.getRange(d0, 1).setFormula('=IFERROR(ARRAY_CONSTRAIN(LET(lst,VSTACK(IFERROR(' + cards + ',{"","","","","","",""}),' + hst + ',' + mine('Debt') + '),' +
    'SORT(FILTER(lst,INDEX(lst,,1)<>""),7,FALSE)),' + N + ',7),"Nothing owed — or nothing entered yet on Assets & Debts")');
  sh.getRange(dTot, 1).setValue('Total you owe').setFontWeight('bold');
  sh.getRange(dTot, 7).setFormula('=SUM(G' + d0 + ':G' + dEnd + ')').setFontWeight('bold');

  // Net worth line.
  var nw = dTot + 2;
  sh.getRange(nw, 1, 1, 7).setBackground(TH.NAVY).setFontColor('#ffffff').setFontWeight('bold').setFontSize(13);
  sh.getRange(nw, 1).setValue('Net worth = what you own − what you owe');
  sh.getRange(nw, 7).setFormula('=G' + aTot + '-G' + dTot);
  sh.setRowHeight(nw, 32);

  // Loans: payments still to come (cash, interest included — not the balance owed).
  var l0 = nw + 3;
  section(l0 - 1, '📅 Loans — payments still to come');
  sh.getRange(l0, 1, 1, 7).setValues([['Loan', 'Per payment (CAD)', 'Ends', 'Payments left', 'Still to pay (CAD)', '', 'Note']]);
  thColHead(sh.getRange(l0, 1, 1, 7));
  var C = 'Commitments!';
  sh.getRange(l0 + 1, 1).setFormula('=IFERROR(LET(k,FILTER({' + C + 'A2:A,' + C + 'M2:M,' + C + 'K2:K},' + C + 'H2:H="Loan",' + C + 'K2:K<>"",' + C + 'I2:I<>"Cancel"),' +
    'rem,MAP(INDEX(k,,3),LAMBDA(e,MAX(0,IFERROR(DATEDIF(TODAY(),e,"M"),0)))),' +
    'HSTACK(INDEX(k,,1),INDEX(k,,2),INDEX(k,,3),rem,rem*INDEX(k,,2),MAP(rem,LAMBDA(z,"")),' +
    'MAP(rem,LAMBDA(z,"Total cash, interest included — not the balance owed")))),"No loans with an end date on Commitments")');
  sh.getRange(l0 + 1, 2, 6, 1).setNumberFormat('$#,##0.00');
  sh.getRange(l0 + 1, 3, 6, 1).setNumberFormat('yyyy-mm-dd');
  sh.getRange(l0 + 1, 5, 6, 1).setNumberFormat('$#,##0');
  sh.getRange(l0 + 1, 7, 6, 1).setFontColor(TH.GREY).setFontStyle('italic');

  // Assets by class, for the donut (I:J, beside the lists).
  sh.getRange('I10').setValue('By class').setFontWeight('bold').setFontColor(TH.NAVY);
  sh.getRange('I11').setFormula('=IFERROR(QUERY({B' + a0 + ':B' + aEnd + ',G' + a0 + ':G' + aEnd + '},"select Col1, sum(Col2) where Col2 > 0 group by Col1 ' +
    'order by sum(Col2) desc label Col1 \'Class\', sum(Col2) \'CAD\'",0),{"Class","CAD";"(nothing yet)",0})');
  thColHead(sh.getRange('I11:J11'));
  sh.getRange('J12:J30').setNumberFormat('$#,##0');

  // Formats and zebra rows.
  [[a0, aEnd], [d0, dEnd]].forEach(function (p) {
    thBand(sh.getRange(p[0], 1, p[1] - p[0] + 1, 7), false);
    sh.getRange(p[0], 4, p[1] - p[0] + 1, 1).setHorizontalAlignment('center');
    sh.getRange(p[0], 5, p[1] - p[0] + 1, 1).setNumberFormat('#,##0.00');
    sh.getRange(p[0], 7, p[1] - p[0] + 1, 1).setNumberFormat('$#,##0.00').setFontWeight('bold');
    sh.getRange(p[0], 3, p[1] - p[0] + 1, 1).setFontColor(TH.GREY);
  });
  sh.getRange(aTot, 1, 1, 7).setBackground(TH.GOOD_BG).setFontColor(TH.GOOD);
  sh.getRange(dTot, 1, 1, 7).setBackground(TH.BAD_BG).setFontColor(TH.BAD);
  [aTot, dTot].forEach(function (r) { sh.getRange(r, 7).setNumberFormat('$#,##0'); });
  sh.getRange(nw, 7).setNumberFormat('$#,##0;-$#,##0');
  // A value you entered more than 60 days ago.
  sh.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=AND($C' + a0 + '="You entered",$D' + a0 + '<>"",DATEVALUE($D' + a0 + ')<TODAY()-60)')
      .setRanges([sh.getRange(a0, 4, N, 1), sh.getRange(d0, 4, N, 1)]).setBackground(TH.WARN_BG).build()
  ]);
  sh.setFrozenRows(3);
  return { sh: sh, aTot: aTot, dTot: dTot, chartRow: a0 - 2, histRow: d0 - 2 };
}


/* ---- Net worth history ---------------------------------------------------------------- */

function bsLogTab(ss) {
  var sh = getTab(ss, BS.TAB_LOG);
  if (!sh) {
    sh = ss.insertSheet(BS.TAB_LOG);
    sh.getRange('A1:D1').setValues([['Date', 'What you own', 'What you owe', 'Net worth']]);
    sh.hideSheet();
  }
  return sh;
}

/** Once a day: today's totals into _NetWorth (today's row is replaced, not added twice). */
function bsSnapshot(ss) {
  var view = getTab(ss, BS.TAB_VIEW), log = bsLogTab(ss);
  if (!view) return;
  SpreadsheetApp.flush();
  var lay = bsLayout();
  var own = Number(view.getRange(lay.aTot, 7).getValue()) || 0;
  var owe = Number(view.getRange(lay.dTot, 7).getValue()) || 0;
  var today = Utilities.formatDate(new Date(), CFG_TZ(), 'yyyy-MM-dd');
  var last = log.getLastRow();
  var row = [[today, own, owe, own - owe]];
  if (last > 1 && Utilities.formatDate(new Date(log.getRange(last, 1).getValue()), CFG_TZ(), 'yyyy-MM-dd') === today) {
    log.getRange(last, 1, 1, 4).setValues(row);
  } else {
    log.getRange(last + 1, 1, 1, 4).setValues(row);
  }
}

/** Row numbers of the Balance Sheet totals (same arithmetic as bsViewTab). */
function bsLayout() {
  var a0 = 12, aTot = a0 + BS.ROWS, d0 = aTot + 4, dTot = d0 + BS.ROWS;
  return { a0: a0, aTot: aTot, d0: d0, dTot: dTot };
}

/** The donut and the net worth line; re-drawn each refresh as history grows. */
function bsCharts(ss) {
  var sh = getTab(ss, BS.TAB_VIEW), log = getTab(ss, BS.TAB_LOG);
  if (!sh) return;
  sh.getCharts().forEach(function (c) { sh.removeChart(c); });
  var lay = bsLayout();
  var classes = Math.max(2, sh.getRange('I11:I30').getValues().filter(function (r) { return r[0] !== ''; }).length);
  sh.insertChart(sh.newChart().setChartType(Charts.ChartType.PIE)
    .addRange(sh.getRange(11, 9, classes, 2)).setNumHeaders(1)
    .setPosition(lay.a0 + 8, 9, 0, 0)
    .setOption('title', 'What you own, by class').setOption('pieHole', 0.45).setOption('width', 430).setOption('height', 300)
    .setOption('legend', { position: 'right' }).setOption('titleTextStyle', { fontSize: 13, bold: true, color: TH.NAVY })
    .setOption('colors', ['#1e8e3e', '#1a73e8', '#f9ab00', '#9334e6', '#12b5cb', '#e8710a', '#80868b']).build());
  if (log && log.getLastRow() >= 2) {
    sh.insertChart(sh.newChart().setChartType(Charts.ChartType.LINE)
      .addRange(log.getRange(1, 1, log.getLastRow(), 4)).setNumHeaders(1)
      .setHiddenDimensionStrategy(Charts.ChartHiddenDimensionStrategy.SHOW_BOTH)
      .setPosition(lay.d0 - 2, 9, 0, 0)
      .setOption('title', 'Net worth over time').setOption('width', 430).setOption('height', 300)
      .setOption('colors', [TH.GOOD, TH.BAD, TH.NAVY]).setOption('lineWidth', 3).setOption('pointSize', 5)
      .setOption('legend', { position: 'bottom' }).setOption('vAxis', { format: '$#,##0' })
      .setOption('titleTextStyle', { fontSize: 13, bold: true, color: TH.NAVY }).build());
  }
}

/** Build both tabs (on a version change). */
function bsInstall(ss) {
  bsInputTab(ss);
  bsLogTab(ss);
  bsViewTab(ss);
}

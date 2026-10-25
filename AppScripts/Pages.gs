/**
 * Pages.gs — the two pages to open first, split by how far ahead they look.
 *
 *   Now          short term, check weekly: cash in each account, what has to
 *                be paid in the next weeks and from which account, which
 *                account runs short and where to move money from, card
 *                balances, what was paid this month, statements to upload.
 *   Big picture  long term, check monthly: net worth, loans, month by month,
 *                where the money goes, the house, HST, where you could save.
 *
 * Both are formulas over the tabs that already hold the data (Commitments,
 * _Calc, _Balances, Assets & Debts, Dashboard, Balance Sheet), so they are
 * live like everything else. Rebuilt with the Dashboard on a version change.
 */

var PG = {
  TAB_NOW: 'Now',
  TAB_BIG: 'Big picture',
  MOVE_DAYS: 14,          // money moves look this far ahead
  LIST_DAYS: 30,          // the payment list looks this far ahead
  LIST_ROWS: 30,
  STALE_DAYS: 7           // statements older than this are asked for
};

var PG_CM = 'Commitments!';
var PG_AD = "'Assets & Debts'!";

function pgRate(cur) { return 'IFERROR(VLOOKUP("' + cur + '",Categories!$E:$F,2,0),1)'; }
function pgSym(cur) { return cur === 'INR' ? '₹' : '$'; }
function pgFmt(cur) { return cur === 'INR' ? '"₹"#,##0;[Red]-"₹"#,##0' : '$#,##0;[Red]-$#,##0'; }

/** Bank accounts (money you hold) and cards (with the account that pays them), from Config. */
function pgAccounts() {
  var seen = {}, banks = [], cards = [];
  CFG.ACCOUNTS.forEach(function (a) {
    if (seen[a.key]) return;
    seen[a.key] = true;
    var b = CFG.BANKS[a.key] || {};
    if (b.quiet) return;
    if (b.payFrom || /mastercard|visa|regalia|credit/i.test(a.name)) {
      var payer = CFG.ACCOUNTS.filter(function (x) { return x.key === b.payFrom; })[0];
      cards.push({ name: a.name, payFrom: payer ? payer.name : '' });
    } else {
      banks.push({ name: a.name, cur: a.currency, hst: !!b.holdsHst });
    }
  });
  return { banks: banks, cards: cards };
}

/** A vertical sheet array literal of strings. */
function pgList(xs) { return '{' + xs.map(function (x) { return '"' + x + '"'; }).join(';') + '}'; }

function pgSection(sh, r, text, cols) {
  sh.getRange(r, 1, 1, cols).setBackground(TH.SECTION).setFontColor('#ffffff').setFontWeight('bold').setFontSize(12);
  sh.getRange(r, 1).setValue(text);
  sh.setRowHeight(r, 28);
}

function pgHead(sh, r, list) {
  sh.getRange(r, 1, 1, list.length).setValues([list]);
  thColHead(sh.getRange(r, 1, 1, list.length)).setWrap(true);
}

function pgNote(rg) { return rg.setFontColor(TH.GREY).setFontStyle('italic').setFontSize(9); }

function pgFresh(ss, name) {
  var sh = getTab(ss, name) || ss.insertSheet(name, 0);
  sh.getCharts().forEach(function (c) { sh.removeChart(c); });
  sh.clear();
  sh.clearConditionalFormatRules();
  thClearBands(sh);
  return sh;
}


/* ---- Now -------------------------------------------------------------------------- */

function pgNowTab(ss) {
  var sh = pgFresh(ss, PG.TAB_NOW);
  var W = 11;
  thPage(sh, W);
  [210, 105, 95, 110, 105, 105, 105, 105, 110, 105, 340].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });

  var acc = pgAccounts(), banks = acc.banks, cards = acc.cards;
  var BK = pgList(banks.map(function (b) { return b.name; }));
  var BC = pgList(banks.map(function (b) { return b.cur; }));
  var CD = pgList(cards.length ? cards.map(function (c) { return c.name; }) : ['-']);
  var PY = pgList(cards.length ? cards.map(function (c) { return c.payFrom; }) : ['-']);

  // Row plan.
  var m0 = 6, b0 = m0 + 2, bEnd = b0 + banks.length - 1, bTot = bEnd + 1;
  var c0 = bTot + 4, cEnd = c0 + 3;                                  // cards: 4 rows
  var l0 = cEnd + 4, lEnd = l0 + PG.LIST_ROWS - 1;                   // payment list
  var p0 = lEnd + 4, pEnd = p0 + 14;                                 // paid this month (header in the copy)
  var u0 = pEnd + 4;                                                 // statements to upload
  var LA = '$A$' + l0 + ':$A$' + lEnd, LB = '$B$' + l0 + ':$B$' + lEnd, LD = '$D$' + l0 + ':$D$' + lEnd, LG = '$G$' + l0 + ':$G$' + lEnd;
  var within = '"<="&(TODAY()+' + PG.MOVE_DAYS + ')';

  sh.getRange('A1').setValue('📅 Now — what to pay, from where, and what to move');
  pgNote(sh.getRange('A2').setFormula('="Live · "&TEXT(NOW(),"ddd d mmm yyyy HH:mm")&" · short term: today and the next ' + PG.LIST_DAYS +
    ' days. The long view is on the Big picture tab."'));
  sh.getRange('A3').setFormula('=Dashboard!A3').setFontWeight('bold').setFontColor(TH.NAVY);
  sh.getRange('A4').setFormula('="👉 Cash in your accounts: "&TEXT(D' + bTot + ',"$#,##0")&"  ·  spare after the next ' + PG.MOVE_DAYS + ' days: "&TEXT(J' + bTot + ',"$#,##0;-$#,##0")' +
    '&"  ·  "&COUNTIF(K' + b0 + ':K' + bEnd + ',"⚠*")&" account(s) need money moved in"' +
    '&"  ·  "&COUNTIF(' + LG + ',"🔴*")&" overdue"' +
    '&IF(COUNTIF(K' + b0 + ':K' + bEnd + ',"✍*")>0,"  ·  "&COUNTIF(K' + b0 + ':K' + bEnd + ',"✍*")&" balance(s) missing","")');
  sh.getRange(4, 1, 1, W).setBackground('#fff4ce').setFontColor(TH.NAVY).setFontWeight('bold').setFontSize(12)
    .setBorder(true, false, true, false, false, false, '#f9ab00', SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
  sh.setRowHeight(4, 32);

  // 1. Money in each account and what to move.
  pgSection(sh, m0, '💵 Your money now — and what to move before the next ' + PG.MOVE_DAYS + ' days of payments', W);
  pgHead(sh, m0 + 1, ['Account', 'Balance', 'As of', 'Balance (CAD)', '+ Coming in', '− To pay', '− Card bills', '− HST to keep',
                      'Spare', 'Spare (CAD)', 'What to do']);
  banks.forEach(function (b, i) {
    var r = b0 + i, nm = '"' + b.name + '"', rate = pgRate(b.cur), sym = pgSym(b.cur);
    sh.getRange(r, 1).setValue(b.name);
    // Balance: the newer of the last statement balance and what you typed on Assets & Debts.
    sh.getRange(r, 2).setFormula('=ARRAYFORMULA(LET(st,IFERROR(SORT(FILTER({TEXT(_Balances!D2:D,"yyyy-mm-dd"),_Balances!E2:E},_Balances!C2:C=' + nm + '),1,FALSE),""),' +
      'sd,IFERROR(DATEVALUE(INDEX(st,1,1)),""),sv,IFERROR(VALUE(INDEX(st,1,2)),""),' +
      'mv,IFERROR(INDEX(FILTER(' + PG_AD + 'E2:E,' + PG_AD + 'A2:A=' + nm + ',' + PG_AD + 'E2:E<>""),1),""),' +
      'md,IFERROR(INDEX(FILTER(' + PG_AD + 'F2:F,' + PG_AD + 'A2:A=' + nm + ',' + PG_AD + 'E2:E<>""),1),""),' +
      'IF(AND(mv<>"",OR(sv="",AND(ISNUMBER(md),md>=sd))),HSTACK(mv,IF(md="","typed",md)),IF(sv="",HSTACK("",""),HSTACK(sv,sd)))))');
    sh.getRange(r, 4).setFormula('=IF(B' + r + '="","",B' + r + '*' + rate + ')');
    // Income on Commitments landing here in the window (weekly pay counted per payday).
    var z = PG_CM + 'Z2:Z200', e = PG_CM + 'E2:E200';
    sh.getRange(r, 5).setFormula('=SUMPRODUCT(ARRAYFORMULA((' + PG_CM + 'G2:G200<>"")*ISNUMBER(SEARCH(' + PG_CM + 'G2:G200,' + nm + '))*(' + PG_CM + 'W2:W200="In")*(' + PG_CM + 'I2:I200<>"Cancel")*' +
      'IFERROR((' + z + '<>"")*(' + z + '<=' + PG.MOVE_DAYS + ')*IF(' + e + '="Weekly",INT((' + PG.MOVE_DAYS + '-' + z + ')/7)+1,IF(' + e + '="Biweekly",INT((' + PG.MOVE_DAYS + '-' + z + ')/14)+1,1))*' + PG_CM + 'M2:M200,0)))/' + rate);
    sh.getRange(r, 6).setFormula('=SUMIFS(' + LD + ',' + LA + ',' + nm + ',' + LB + ',' + within + ')');
    var mine = cards.filter(function (c) { return c.payFrom === b.name; });
    sh.getRange(r, 7).setFormula(mine.length
      ? '=(' + mine.map(function (c) { return 'SUMIFS(Dashboard!$B$54:$B$57,Dashboard!$A$54:$A$57,"' + c.name + '")'; }).join('+') + ')/' + rate
      : '=0');
    sh.getRange(r, 8).setFormula(b.hst ? '=MAX(0,-Dashboard!$B$20)/' + rate : '=0');
    sh.getRange(r, 9).setFormula('=IF(B' + r + '="","",B' + r + '+E' + r + '-F' + r + '-G' + r + '-H' + r + ')');
    sh.getRange(r, 10).setFormula('=IF(I' + r + '="","",I' + r + '*' + rate + ')');
    var lead = b.cur === 'CAD' ? 1 : 3;     // money sent abroad takes a few days
    sh.getRange(r, 11).setFormula('=IF(B' + r + '="","✍ Type today\'s balance on the Assets & Debts tab",' +
      'IF(I' + r + '>=0,"✅ Enough — ' + sym + '"&TEXT(I' + r + ',"#,##0")&" spare",' +
      'LET(best,IFERROR(INDEX(SORT(FILTER({$A$' + b0 + ':$A$' + bEnd + ',$J$' + b0 + ':$J$' + bEnd + '},ISNUMBER($J$' + b0 + ':$J$' + bEnd + '),$J$' + b0 + ':$J$' + bEnd + '>0),2,FALSE),1,1),"another account"),' +
      'first,MINIFS(' + LB + ',' + LA + ',' + nm + ',' + LB + ',' + within + '),by,IF(first=0,TODAY(),MAX(TODAY(),first-' + lead + ')),' +
      '"⚠ Short ' + sym + '"&TEXT(-I' + r + ',"#,##0")&" → move about "&TEXT(-J' + r + ',"$#,##0")&" from "&best&" by "&TEXT(by,"ddd d mmm"))))');
    sh.getRange(r, 2).setNumberFormat(pgFmt(b.cur));
    sh.getRange(r, 5, 1, 5).setNumberFormat(pgFmt(b.cur));
  });
  sh.getRange(b0, 3, banks.length, 1).setNumberFormat('d mmm').setHorizontalAlignment('center');
  sh.getRange(b0, 4, banks.length + 1, 1).setNumberFormat('$#,##0');
  sh.getRange(b0, 10, banks.length + 1, 1).setNumberFormat('$#,##0;[Red]-$#,##0').setFontWeight('bold');
  sh.getRange(b0, 11, banks.length, 1).setWrap(true);
  thBand(sh.getRange(b0, 1, banks.length, W), false);
  sh.getRange(bTot, 1).setValue('Total');
  sh.getRange(bTot, 4).setFormula('=SUM(D' + b0 + ':D' + bEnd + ')');
  sh.getRange(bTot, 10).setFormula('=SUM(J' + b0 + ':J' + bEnd + ')');
  sh.getRange(bTot, 11).setValue('Spare across all accounts, after everything due in the next ' + PG.MOVE_DAYS + ' days');
  sh.getRange(bTot, 1, 1, W).setBackground(TH.GOOD_BG).setFontWeight('bold');
  pgNote(sh.getRange(bTot + 1, 1).setValue('Balance = the last statement that carried one, or what you typed on Assets & Debts (the newer wins); ' +
    'payments since its date are not in it yet. Card bills = spent since the card\'s last payment, counted against the account that pays the card. ' +
    'HST you collected is kept aside in the account it lands in.'));

  // 2. Credit cards.
  pgSection(sh, c0 - 2, '💳 Credit cards — pay these off in full by the statement due date', W);
  pgHead(sh, c0 - 1, ['Card', 'Spent since last payment (CAD)', 'Last payment', 'Statements up to', 'Paid from']);
  sh.getRange(c0, 1).setFormula('={Dashboard!A54:D57}');
  var sw = cards.map(function (c) { return '"' + c.name + '","' + c.payFrom + '"'; }).join(',');
  sh.getRange(c0, 5).setFormula('=BYROW(A' + c0 + ':A' + cEnd + ',LAMBDA(c,IF(c="","",' + (sw ? 'IFERROR(SWITCH(c,' + sw + '),"")' : '""') + ')))');
  sh.getRange(c0, 2, 4, 1).setNumberFormat('$#,##0.00');
  sh.getRange(c0, 3, 4, 2).setNumberFormat('d mmm');
  thBand(sh.getRange(c0, 1, 4, 5), false);

  // 3. Every payment in the next weeks, grouped by the account it comes out of.
  pgSection(sh, l0 - 2, '🧾 To pay — overdue first, then the next ' + PG.LIST_DAYS + ' days, by the account the money comes out of', W);
  pgHead(sh, l0 - 1, ['Comes out of', 'Due', 'What', 'Amount (that account\'s money)', 'Currency', 'CAD', 'Status', 'Charged to card']);
  var blank8 = 'MAKEARRAY(1,8,LAMBDA(i,j,""))';
  sh.getRange(l0, 1).setFormula('=IFERROR(ARRAY_CONSTRAIN(ARRAYFORMULA(LET(' +
    'n,' + PG_CM + 'A2:A200,g,' + PG_CM + 'G2:G200,st,' + PG_CM + 'T2:T200,z,' + PG_CM + 'Z2:Z200,r,' + PG_CM + 'R2:R200,s,' + PG_CM + 'S2:S200,' +
    'cad,' + PG_CM + 'M2:M200,dec,' + PG_CM + 'I2:I200,io,' + PG_CM + 'W2:W200,' +
    'own,MAP(g,LAMBDA(x,IF(x="","(no account set)",IFERROR(INDEX(FILTER(' + BK + ',ISNUMBER(SEARCH(x,' + BK + '))),1),' +
      'IFERROR(INDEX(FILTER(' + PY + ',ISNUMBER(SEARCH(x,' + CD + '))),1),"(no account set)"))))),' +
    'via,MAP(g,LAMBDA(x,IF(x="","",IF(IFERROR(ROWS(FILTER(' + BK + ',ISNUMBER(SEARCH(x,' + BK + ')))),0)>0,"",IFERROR(INDEX(FILTER(' + CD + ',ISNUMBER(SEARCH(x,' + CD + '))),1),""))))),' +
    'cur,MAP(own,LAMBDA(o,IFERROR(INDEX(FILTER(' + BC + ',' + BK + '=o),1),"CAD"))),' +
    'amt,MAP(cad,cur,LAMBDA(v,c,IF(ISNUMBER(v),v/IFERROR(VLOOKUP(c,Categories!$E:$F,2,0),1),""))),' +
    'ok,(n<>"")*(dec<>"Cancel")*(io="Out"),' +
    'late,ok*REGEXMATCH(st,"^(🔴|⏳ Due|📌)"),' +
    'soon,ok*IFERROR((z<>"")*(z<=' + PG.LIST_DAYS + '),0)*(1-REGEXMATCH(st,"^(Ended|✂)")),' +
    'when,IF(z=0,"🗓 today",IF(z=1,"🗓 tomorrow","🗓 in "&z&" days")),' +
    'a,IFERROR(FILTER(HSTACK(own,IF(r="",TODAY(),r),n,amt,cur,cad,st,via),late),' + blank8 + '),' +
    'b,IFERROR(FILTER(HSTACK(own,s,n,amt,cur,cad,when,via),soon),' + blank8 + '),' +
    'all,VSTACK(a,b),k,FILTER(all,INDEX(all,,3)<>""),' +
    'SORT(k,1,TRUE,2,TRUE))),' + PG.LIST_ROWS + ',8),"Nothing to pay in the next ' + PG.LIST_DAYS + ' days ✅")');
  sh.getRange(l0, 2, PG.LIST_ROWS, 1).setNumberFormat('ddd d mmm');
  sh.getRange(l0, 4, PG.LIST_ROWS, 1).setNumberFormat('#,##0.00');
  sh.getRange(l0, 6, PG.LIST_ROWS, 1).setNumberFormat('$#,##0.00');
  thBand(sh.getRange(l0, 1, PG.LIST_ROWS, 8), false);

  // 4. Paid this month (the Dashboard's list, header included).
  pgSection(sh, p0 - 2, '✅ Paid / received this month', W);
  sh.getRange(p0 - 1, 1).setFormula('={Dashboard!A60:D75}');
  thColHead(sh.getRange(p0 - 1, 1, 1, 4));
  sh.getRange(p0, 1, 15, 1).setNumberFormat('ddd d mmm');
  sh.getRange(p0, 3, 15, 1).setNumberFormat('$#,##0.00');
  thBand(sh.getRange(p0, 1, 15, 4), false);

  // 5. Statements to upload.
  pgSection(sh, u0 - 2, '📥 Statements to upload — older than ' + PG.STALE_DAYS + ' days', W);
  pgHead(sh, u0 - 1, ['Account', 'Latest transaction', 'Days behind']);
  sh.getRange(u0 - 1, 4).setFormula('=HYPERLINK("' + inboxUrl() + '","📂 Open the Inbox folder")');
  sh.getRange(u0, 1).setFormula('=IFERROR(FILTER({Dashboard!A244:A252,Dashboard!B244:B252,Dashboard!C244:C252},ISNUMBER(Dashboard!C244:C252),' +
    'Dashboard!C244:C252>' + PG.STALE_DAYS + ',ISNA(MATCH(Dashboard!A244:A252,' + fxQuietAccounts() + ',0))),"✅ Every account has statements from the last ' + PG.STALE_DAYS + ' days")');
  sh.getRange(u0, 2, 9, 1).setNumberFormat('d mmm yyyy');

  var all = sh.getRange(1, 1, u0 + 10, W);
  var rule = function (txt, bg, fg) {
    var b = SpreadsheetApp.newConditionalFormatRule().whenTextStartsWith(txt).setRanges([all]);
    if (bg) b.setBackground(bg);
    if (fg) b.setFontColor(fg);
    return b.build();
  };
  sh.setConditionalFormatRules([rule('🔴', TH.BAD_BG), rule('⚠', TH.BAD_BG), rule('⏳', TH.WARN_BG), rule('📌', TH.WARN_BG),
                                rule('✍', TH.WARN_BG), rule('✅', TH.GOOD_BG)]);
  sh.setFrozenRows(4);
  return sh;
}


/* ---- Big picture ---------------------------------------------------------------- */

function pgBigTab(ss) {
  var sh = pgFresh(ss, PG.TAB_BIG);
  var W = 8;
  thPage(sh, W);
  [260, 130, 130, 140, 130, 120, 130, 200].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  var lay = bsLayout(), BSV = "'" + BS.TAB_VIEW + "'!";

  sh.getRange('A1').setValue('📈 Big picture — the long view');
  pgNote(sh.getRange('A2').setFormula('="Live · "&TEXT(NOW(),"ddd d mmm yyyy")&" · long term: worth, loans, months, the house, tax. What to pay this week is on the Now tab."'));

  // 1. Net worth.
  pgSection(sh, 4, '🏛 Net worth', W);
  var tiles = [['What you own', '=' + BSV + 'G' + lay.aTot, TH.GOOD], ['What you owe', '=' + BSV + 'G' + lay.dTot, TH.BAD],
               ['Net worth', '=' + BSV + 'G' + lay.aTot + '-' + BSV + 'G' + lay.dTot, TH.NAVY]];
  tiles.forEach(function (t, i) {
    sh.getRange(5, i + 1).setValue(t[0]).setFontColor(TH.GREY).setFontSize(9);
    sh.getRange(6, i + 1).setFormula(t[1]).setFontSize(20).setFontWeight('bold').setFontColor(t[2]).setNumberFormat('$#,##0;-$#,##0');
  });
  sh.getRange(5, 4).setValue('Change').setFontColor(TH.GREY).setFontSize(9);
  sh.getRange(6, 4).setFormula('=' + BSV + 'E7').setFontColor(TH.NAVY).setWrap(true);
  sh.setRowHeight(6, 40);
  pgNote(sh.getRange(7, 1).setFormula('="Item by item: Balance Sheet tab. "&' + BSV + 'A3'));

  // 2. Loans.
  pgSection(sh, 9, '🏦 Loans', W);
  pgHead(sh, 10, ['Loan', 'EMI', 'Currency', 'Per month (CAD)', 'Ends', 'Payments left', 'Still to pay (CAD)', 'Balance owed (CAD)']);
  sh.getRange(11, 1).setFormula('=IFERROR(ARRAY_CONSTRAIN(LET(k,FILTER({' + PG_CM + 'A2:A,' + PG_CM + 'C2:C,' + PG_CM + 'D2:D,' + PG_CM + 'N2:N,' + PG_CM + 'K2:K},' +
    PG_CM + 'H2:H="Loan",' + PG_CM + 'I2:I<>"Cancel",' + PG_CM + 'A2:A<>""),' +
    'nm,INDEX(k,,1),e,INDEX(k,,5),pm,INDEX(k,,4),' +
    'left,MAP(e,LAMBDA(x,IF(x="","",MAX(0,IFERROR(DATEDIF(TODAY(),x,"M")+1,0))))),' +
    'owed,MAP(nm,LAMBDA(x,IFERROR(INDEX(FILTER(' + PG_AD + 'H2:H,ISNUMBER(SEARCH(REGEXEXTRACT(x,"^\\S+\\s+\\S+"),' + PG_AD + 'A2:A)),' + PG_AD + 'B2:B="Debt",' + PG_AD + 'E2:E<>""),1),"✍ add on Assets & Debts"))),' +
    'HSTACK(nm,INDEX(k,,2),INDEX(k,,3),pm,IF(e="","no end date",e),left,MAP(left,pm,LAMBDA(l,p,IF(l="","",l*p))),owed)),6,8),"No loans on Commitments")');
  sh.getRange(11, 2, 6, 1).setNumberFormat('#,##0');
  sh.getRange(11, 4, 6, 1).setNumberFormat('$#,##0');
  sh.getRange(11, 5, 6, 1).setNumberFormat('mmm yyyy');
  sh.getRange(11, 7, 6, 2).setNumberFormat('$#,##0');
  thBand(sh.getRange(11, 1, 6, W), false);
  pgNote(sh.getRange(17, 1).setValue('Still to pay = payments left × EMI, interest included. Balance owed comes from the loan statement — type it on Assets & Debts.'));

  // 3. Month by month.
  pgSection(sh, 19, '📆 Month by month — the last 6 months (CAD)', W);
  pgHead(sh, 20, ['Month', 'Money in (after HST)', 'Living costs', 'House construction', 'Lent / saved', 'Kept (net)']);
  for (var k = 5; k >= 0; k--) {
    var r = 21 + (5 - k), m = 'TEXT(EDATE(TODAY(),-' + k + '),"yyyy-mm")';
    var sum = function (what) { return 'SUMIFS(_Calc!$L:$L,_Calc!$B:$B,' + m + ',_Calc!$J:$J,"' + what + '")'; };
    // Months before the first statement stay blank instead of showing $0.
    var had = 'IF(' + m + '<TEXT(MIN(_Calc!$A$2:$A),"yyyy-mm"),"",';
    sh.getRange(r, 1).setFormula('=TEXT(EDATE(TODAY(),-' + k + '),"mmm yyyy")' + (k === 0 ? '&" (so far)"' : ''));
    sh.getRange(r, 2).setFormula('=' + had + sum('Income') + '-' + fxHst(',_Calc!$B:$B,' + m) + ')');
    sh.getRange(r, 3).setFormula('=' + had + sum('Living') + ')');
    sh.getRange(r, 4).setFormula('=' + had + sum('House') + ')');
    sh.getRange(r, 5).setFormula('=' + had + sum('Lent') + '+' + sum('Saved') + ')');
    sh.getRange(r, 6).setFormula('=IF(B' + r + '="","",B' + r + '-C' + r + '-D' + r + '-E' + r + ')').setFontWeight('bold');
  }
  sh.getRange(27, 1).setValue('Average of the full months with income');
  ['B', 'C', 'D', 'E', 'F'].forEach(function (c) {
    sh.getRange(27, c.charCodeAt(0) - 64).setFormula('=IFERROR(AVERAGEIFS(' + c + '21:' + c + '25,$B21:$B25,">0"),0)');
  });
  sh.getRange(27, 1, 1, 6).setFontWeight('bold').setBackground(TH.HEAD);
  sh.getRange(21, 2, 7, 5).setNumberFormat('$#,##0;[Red]-$#,##0');
  thBand(sh.getRange(21, 1, 6, 6), false);

  // 4. Where the money goes (the Dashboard's pivot).
  pgSection(sh, 29, '📊 Where your money goes — by group (CAD)', W);
  sh.getRange(30, 1).setFormula('={Dashboard!A137:F152}');
  thColHead(sh.getRange(30, 1, 1, 6));
  sh.getRange(31, 2, 15, 5).setNumberFormat('$#,##0;[Red]-$#,##0');
  thBand(sh.getRange(31, 1, 15, 6), false);
  pgNote(sh.getRange(46, 1).setValue('Category by category: Dashboard › By category. Trends tab for charts.'));

  // 5. The house.
  pgSection(sh, 48, '🏠 House construction', W);
  var house = 'SUMIFS(_Calc!$L:$L,_Calc!$J:$J,"House"';
  [['Spent so far', '=' + house + ')'],
   ['This year', '=' + house + ',_Calc!$A:$A,">="&DATE(YEAR(TODAY()),1,1))'],
   ['Average per month, last 3 full months', '=(' + house + ',_Calc!$A:$A,">="&EDATE(EOMONTH(TODAY(),-1)+1,-3),_Calc!$A:$A,"<="&EOMONTH(TODAY(),-1)))/3']
  ].forEach(function (x, i) {
    sh.getRange(49 + i, 1).setValue(x[0]);
    sh.getRange(49 + i, 2).setFormula(x[1]).setNumberFormat('$#,##0').setFontWeight('bold');
  });
  pgHead(sh, 53, ['What it went on', 'Total so far']);
  sh.getRange(54, 1).setFormula('=IFERROR(ARRAY_CONSTRAIN(QUERY(_Calc!A2:M,"select I, sum(L) where J = \'House\' group by I order by sum(L) desc label sum(L) \'\'",0),12,2),"Nothing yet")');
  sh.getRange(54, 2, 12, 1).setNumberFormat('$#,##0');
  thBand(sh.getRange(54, 1, 12, 2), false);

  // 6. HST.
  pgSection(sh, 67, '🧾 HST — sales tax you collect on your pay (not your money)', W);
  [['Collected this year — owed to CRA', '=MAX(0,-Dashboard!B20)'],
   ['Collected this month', '=' + fxHst(',_Calc!$B:$B,' + FX_M0)],
   ['Average per month this year', '=MAX(0,-Dashboard!B20)/MAX(1,COUNTUNIQUE(FILTER(_Calc!B2:B,_Calc!I2:I="Business income",_Calc!A2:A>=DATE(YEAR(TODAY()),1,1))))']
  ].forEach(function (x, i) {
    sh.getRange(68 + i, 1).setValue(x[0]);
    sh.getRange(68 + i, 2).setFormula(x[1]).setNumberFormat('$#,##0').setFontWeight('bold');
  });
  pgNote(sh.getRange(71, 1).setValue('HST = 13% on top of your business income. It lands with your pay in TD Business; the Now tab keeps it aside there. Pay it to CRA when you file.'));

  // 7. Where you could save.
  pgSection(sh, 73, '🔥 Where you could save (per year)', W);
  [['Recurring costs waiting for your Keep / Cancel', '=Dashboard!C94'],
   ['Bank and card fees', '=SUM(Dashboard!D104:D111)'],
   ['Small habits (5+ times a month)', '=SUM(Dashboard!D114:D121)'],
   ['Already saved by cancelling', '=Dashboard!C95']
  ].forEach(function (x, i) {
    sh.getRange(74 + i, 1).setValue(x[0]);
    sh.getRange(74 + i, 2).setFormula(x[1]).setNumberFormat('$#,##0').setFontWeight('bold');
  });
  sh.getRange(77, 1, 1, 2).setFontColor(TH.GOOD);
  pgNote(sh.getRange(78, 1).setValue('Item by item: Dashboard › 🔥 Where you\'re wasting money. Decide Keep / Cancel on Commitments.'));

  sh.setFrozenRows(2);
  return sh;
}

/** Build both pages (on a version change). */
function pgInstall(ss) {
  pgNowTab(ss);
  pgBigTab(ss);
}

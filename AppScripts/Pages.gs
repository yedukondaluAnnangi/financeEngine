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
  TAB_MAP: 'Money map',
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
      var funder = CFG.ACCOUNTS.filter(function (x) { return x.key === b.fundedFrom; })[0];
      banks.push({ name: a.name, cur: a.currency, hst: !!b.holdsHst, fundedFrom: funder ? funder.name : '' });
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

/** Row plan of the Now tab for nb bank accounts (the Money map reads the same rows). */
function pgNowRows(nb) {
  var m0 = 6, b0 = m0 + 2, bEnd = b0 + nb - 1, bTot = bEnd + 1;
  var c0 = bTot + 4, cEnd = c0 + 3;                                  // cards: 4 rows
  var l0 = cEnd + 4, lEnd = l0 + PG.LIST_ROWS - 1;                   // payment list
  var p0 = lEnd + 4, pEnd = p0 + 14;                                 // paid this month (header in the copy)
  return { m0: m0, b0: b0, bEnd: bEnd, bTot: bTot, c0: c0, cEnd: cEnd, l0: l0, lEnd: lEnd, p0: p0, pEnd: pEnd, u0: pEnd + 4 };
}

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

  var R = pgNowRows(banks.length);
  var m0 = R.m0, b0 = R.b0, bEnd = R.bEnd, bTot = R.bTot, c0 = R.c0, cEnd = R.cEnd, l0 = R.l0, lEnd = R.lEnd, p0 = R.p0, pEnd = R.pEnd, u0 = R.u0;
  var LA = '$A$' + l0 + ':$A$' + lEnd, LB = '$B$' + l0 + ':$B$' + lEnd, LD = '$D$' + l0 + ':$D$' + lEnd, LG = '$G$' + l0 + ':$G$' + lEnd;
  var within = '"<="&(TODAY()+' + PG.MOVE_DAYS + ')';

  sh.getRange('A1').setValue('📅 Now — what to pay, from where, and what to move');
  pgNote(sh.getRange('A2').setFormula('="Live · "&TEXT(NOW(),"ddd d mmm yyyy HH:mm")&" · short term: today and the next ' + PG.LIST_DAYS +
    ' days. The long view is on Forecast and Net worth."'));
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
    // Balance: the newer of the last statement balance and what you typed on Assets & Debts,
    sh.getRange(r, 2).setFormula('=ARRAYFORMULA(LET(st,IFERROR(SORT(FILTER({TEXT(_Balances!D2:D,"yyyy-mm-dd"),_Balances!E2:E},_Balances!C2:C=' + nm + '),1,FALSE),""),' +
      'sd,IFERROR(DATEVALUE(INDEX(st,1,1)),""),sv,IFERROR(VALUE(INDEX(st,1,2)),""),' +
      'mv,IFERROR(INDEX(FILTER(' + PG_AD + 'E2:E,' + PG_AD + 'A2:A=' + nm + ',' + PG_AD + 'E2:E<>""),1),""),' +
      'md,IFERROR(INDEX(FILTER(' + PG_AD + BS.C.asof + '2:' + BS.C.asof + ',' + PG_AD + 'A2:A=' + nm + ',' + PG_AD + 'E2:E<>""),1),""),' +
      // Then roll it forward: every transaction on this account after that date.
      'um,AND(mv<>"",OR(sv="",AND(ISNUMBER(md),md>=sd))),v,IF(um,mv,sv),d,IF(um,md,sd),' +
      'last,MAXIFS(_Calc!$A$2:$A,_Calc!$C$2:$C,' + nm + '),' +
      'IF(v="",HSTACK("",""),IF(NOT(ISNUMBER(d)),HSTACK(v,"typed"),' +
      'HSTACK(v+SUMIFS(_Calc!$F$2:$F,_Calc!$C$2:$C,' + nm + ',_Calc!$A$2:$A,">"&d),MAX(d,last))))))');
    sh.getRange(r, 4).setFormula('=IF(B' + r + '="","",B' + r + '*' + rate + ')');
    // Income on Commitments landing here in the window (weekly pay counted per payday).
    var z = PG_CM + 'Z2:Z200', e = PG_CM + 'E2:E200';
    sh.getRange(r, 5).setFormula('=SUMPRODUCT(ARRAYFORMULA((' + PG_CM + 'G2:G200<>"")*ISNUMBER(SEARCH(' + PG_CM + 'G2:G200,' + nm + '))*(' + PG_CM + 'W2:W200="In")*(' + PG_CM + 'I2:I200<>"Cancel")*(' + PG_CM + 'I2:I200<>"Later")*' +
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
    // Money moves only along fundedFrom routes (TD → RBC → HDFC). L = CAD this account must
    // receive: its own shortfall plus what it passes on to the accounts it funds, less its spare.
    // M = when it must arrive: before its own first payment, and a day before a dependant's.
    var deps = [];
    banks.forEach(function (x, j) { if (x.fundedFrom === b.name) deps.push({ r: b0 + j, name: x.name }); });
    var depNeed = deps.length ? '(' + deps.map(function (x) { return 'N(L' + x.r + ')'; }).join('+') + ')' : '0';
    var depNames = deps.length
      ? 'TEXTJOIN(", ",TRUE,' + deps.map(function (x) { return 'IF(N(L' + x.r + ')>0,"' + x.name + '","")'; }).join(',') + ')' : '""';
    sh.getRange(r, 12).setFormula('=IF(J' + r + '="","",MAX(0,' + depNeed + '-J' + r + '))');
    sh.getRange(r, 13).setFormula('=IF(N(L' + r + ')=0,"",LET(first,MINIFS(' + LB + ',' + LA + ',' + nm + ',' + LB + ',' + within + ',' + LB + ',">="&TODAY()),' +
      'MAX(TODAY(),MIN(IF(first=0,2958465,first-' + lead + ')' +
      deps.map(function (x) { return ',IF(N(L' + x.r + ')>0,M' + x.r + '-1,2958465)'; }).join('') + '))))');
    sh.getRange(r, 12, 1, 2).setNumberFormats([['$#,##0', 'ddd d mmm']]);
    sh.getRange(r, 11).setFormula('=IF(B' + r + '="","✍ Type today\'s balance on the Assets & Debts tab",' +
      'IF(N(L' + r + ')=0,LET(out,' + depNeed + '/' + rate + ',' +
      '"✅ Enough — ' + sym + '"&TEXT(I' + r + '-out,"#,##0")&" spare"&IF(out>0," after sending "&TEXT(' + depNeed + ',"$#,##0")&" to "&' + depNames + ',"")),' +
      (b.fundedFrom
        ? '"⚠ "&IF(I' + r + '<0,"Short ' + sym + '"&TEXT(-I' + r + ',"#,##0"),"")&IF(' + depNeed + '>0,IF(I' + r + '<0," + ","")&TEXT(' + depNeed + ',"$#,##0")&" to pass on to "&' + depNames + ',"")' +
          '&" → move about "&TEXT(L' + r + ',"$#,##0")&" from ' + b.fundedFrom + ' by "&TEXT(M' + r + ',"ddd d mmm")))'
        : '"⚠ Short "&TEXT(L' + r + ',"$#,##0")&" — no account is set to top this one up"))'));
    sh.getRange(r, 2).setNumberFormat(pgFmt(b.cur));
    sh.getRange(r, 5, 1, 5).setNumberFormat(pgFmt(b.cur));
  });
  sh.getRange(b0, 3, banks.length, 1).setNumberFormat('d mmm').setHorizontalAlignment('center');
  sh.getRange(b0, 4, banks.length + 1, 1).setNumberFormat('$#,##0');
  sh.getRange(b0, 10, banks.length + 1, 1).setNumberFormat('$#,##0;[Red]-$#,##0').setFontWeight('bold');
  sh.getRange(b0, 11, banks.length, 1).setWrap(true);
  // L / M: the transfer helpers behind "What to do" (read by the Money map and Today).
  sh.getRange(m0 + 1, 12, 1, 2).setValues([['Move in (CAD)', 'Move by']]);
  sh.hideColumns(12, 2);
  thBand(sh.getRange(b0, 1, banks.length, W), false);
  sh.getRange(bTot, 1).setValue('Total');
  sh.getRange(bTot, 4).setFormula('=SUM(D' + b0 + ':D' + bEnd + ')');
  sh.getRange(bTot, 10).setFormula('=SUM(J' + b0 + ':J' + bEnd + ')');
  sh.getRange(bTot, 11).setValue('Spare across all accounts, after everything due in the next ' + PG.MOVE_DAYS + ' days');
  sh.getRange(bTot, 1, 1, W).setBackground(TH.GOOD_BG).setFontWeight('bold');
  pgNote(sh.getRange(bTot + 1, 1).setValue('Balance = the last statement that carried one, or what you typed on Assets & Debts (the newer wins), ' +
    'plus every transaction uploaded since that date — type a balance once and it keeps itself current. Card bills = spent since the card\'s last payment, counted against the account that pays the card. ' +
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
  pgSection(sh, l0 - 2, '🧾 To pay — by date: overdue first, then the next ' + PG.LIST_DAYS + ' days (column A = the account the money comes out of)', W);
  pgHead(sh, l0 - 1, ['Comes out of', 'Due', 'What', 'Amount (that account\'s money)', 'Currency', 'CAD', 'Status', 'Charged to card', 'Kind']);
  var blank8 = 'MAKEARRAY(1,9,LAMBDA(i,j,""))';
  sh.getRange(l0, 1).setFormula('=IFERROR(ARRAY_CONSTRAIN(ARRAYFORMULA(LET(' +
    'n,' + PG_CM + 'A2:A200,g,' + PG_CM + 'G2:G200,st,' + PG_CM + 'T2:T200,z,' + PG_CM + 'Z2:Z200,r,' + PG_CM + 'R2:R200,s,' + PG_CM + 'S2:S200,' +
    'cad,' + PG_CM + 'M2:M200,dec,' + PG_CM + 'I2:I200,io,' + PG_CM + 'W2:W200,' +
    'ownOf,LAMBDA(x,IF(x="","(no account set)",IFERROR(INDEX(FILTER(' + BK + ',ISNUMBER(SEARCH(x,' + BK + '))),1),' +
      'IFERROR(INDEX(FILTER(' + PY + ',ISNUMBER(SEARCH(x,' + CD + '))),1),"(no account set)")))),' +
    'curOf,LAMBDA(o,IFERROR(INDEX(FILTER(' + BC + ',' + BK + '=o),1),"CAD")),' +
    'own,MAP(g,ownOf),' +
    'via,MAP(g,LAMBDA(x,IF(x="","",IF(IFERROR(ROWS(FILTER(' + BK + ',ISNUMBER(SEARCH(x,' + BK + ')))),0)>0,"",IFERROR(INDEX(FILTER(' + CD + ',ISNUMBER(SEARCH(x,' + CD + '))),1),""))))),' +
    'cur,MAP(own,curOf),' +
    'amt,MAP(cad,cur,LAMBDA(v,c,IF(ISNUMBER(v),v/IFERROR(VLOOKUP(c,Categories!$E:$F,2,0),1),""))),' +
    // Kind = the category's group (Bills & loans, House construction, …), for the Money map.
    'grp,MAP(' + PG_CM + 'H2:H200,LAMBDA(x,IF(x="","Other",IFERROR(VLOOKUP(x,Categories!$A:$B,2,0),"Other")))),' +
    'ok,(n<>"")*(dec<>"Cancel")*(dec<>"Later")*(io="Out"),' +
    'late,ok*REGEXMATCH(st,"^(🔴|⏳ Due|📌)"),' +
    'soon,ok*IFERROR((z<>"")*(z<=' + PG.LIST_DAYS + '),0)*(1-REGEXMATCH(st,"^(Ended|✂)")),' +
    'when,IF(z=0,"🗓 today",IF(z=1,"🗓 tomorrow","🗓 in "&z&" days")),' +
    'a,IFERROR(FILTER(HSTACK(own,IF(r="",TODAY(),r),n,amt,cur,cad,st,via,grp),late),' + blank8 + '),' +
    'b,IFERROR(FILTER(HSTACK(own,s,n,amt,cur,cad,when,via,grp),soon),' + blank8 + '),' +
    // Expected payments you approved (Expected tab), until a matching payment shows up.
    'en,' + EX_REF + 'D2:D300,ed,' + EX_REF + 'G2:G300,em,' + EX_REF + 'M2:M300,' +
    'eown,MAP(' + EX_REF + 'H2:H300,ownOf),ecur,MAP(eown,curOf),' +
    'eamt,MAP(em,ecur,LAMBDA(v,c,IF(ISNUMBER(v),v/IFERROR(VLOOKUP(c,Categories!$E:$F,2,0),1),""))),' +
    'c,IFERROR(FILTER(HSTACK(eown,IF(ed="",TODAY(),ed),en,eamt,ecur,em,IF(ROW(en),"🗒 Expected — you approved"),IF(ROW(en),""),IF(ROW(en),"Expected payments")),' +
      'en<>"",' + EX_REF + 'K2:K300="Approve",LEFT(' + EX_REF + 'N2:N300,1)<>"💸",IF(ed="",TRUE,ed<=TODAY()+' + PG.LIST_DAYS + ')),' + blank8 + '),' +
    'all,VSTACK(a,b,c),k,FILTER(all,INDEX(all,,3)<>""),' +
    // By date: the most urgent first.
    'SORT(k,2,TRUE,1,TRUE))),' + PG.LIST_ROWS + ',9),"Nothing to pay in the next ' + PG.LIST_DAYS + ' days ✅")');
  sh.getRange(l0, 2, PG.LIST_ROWS, 1).setNumberFormat('ddd d mmm');
  sh.getRange(l0, 4, PG.LIST_ROWS, 1).setNumberFormat('#,##0.00');
  sh.getRange(l0, 6, PG.LIST_ROWS, 1).setNumberFormat('$#,##0.00');
  thBand(sh.getRange(l0, 1, PG.LIST_ROWS, 9), false);

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
    'owed,MAP(nm,LAMBDA(x,IFERROR(INDEX(FILTER(' + PG_AD + BS.C.cad + '2:' + BS.C.cad + ',ISNUMBER(SEARCH(REGEXEXTRACT(x,"^\\S+\\s+\\S+"),' + PG_AD + 'A2:A)),' + PG_AD + 'B2:B="Debt",' + PG_AD + 'E2:E<>""),1),"✍ add on Assets & Debts"))),' +
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

  // 8. Business expenses, for the tax return.
  var y0 = 'DATE(YEAR(TODAY()),1,1)';
  pgSection(sh, 80, '💼 Business expenses — for your tax return (this year)', W);
  pgHead(sh, 81, ['Category', 'This year (CAD)', 'Transactions']);
  sh.getRange(82, 1).setFormula('=IFERROR(ARRAY_CONSTRAIN(QUERY(_Calc!A2:M,"select I, sum(L), count(L) where K = \'Business costs\' and A >= date \'"&TEXT(' + y0 + ',"yyyy-mm-dd")&"\' ' +
    'group by I order by sum(L) desc label sum(L) \'\', count(L) \'\'",0),10,3),"No business expenses yet this year")');
  sh.getRange(82, 2, 10, 1).setNumberFormat('$#,##0.00');
  thBand(sh.getRange(82, 1, 10, 3), false);
  sh.getRange(92, 1).setValue('Total business expenses this year');
  sh.getRange(92, 2).setFormula('=SUMIFS(_Calc!$L:$L,_Calc!$K:$K,"Business costs",_Calc!$A:$A,">="&' + y0 + ')').setNumberFormat('$#,##0.00');
  sh.getRange(92, 1, 1, 3).setFontWeight('bold').setBackground(TH.HEAD);
  pgNote(sh.getRange(93, 1).setValue('Every transaction: Transactions tab › filter Category for "Business". ' +
    'A category counts here when its Group on the Categories tab is "Business costs" — name new ones "Business - <kind>".'));

  // 9. Every recurring payment, grouped by kind.
  pgSection(sh, 96, '🔁 Every recurring payment — grouped by kind (decide Keep / Cancel / Later on Commitments)', W);
  pgHead(sh, 97, ['Kind', 'Payment', 'Amount', 'Currency', 'How often', 'Account', 'Per month (CAD)', 'Status']);
  sh.getRange(98, 1).setFormula('=IFERROR(ARRAY_CONSTRAIN(ARRAYFORMULA(LET(' +
    'grp,MAP(' + PG_CM + 'H2:H200,LAMBDA(x,IF(x="","Other",IFERROR(VLOOKUP(x,Categories!$A:$B,2,0),"Other")))),' +
    'k,FILTER({grp,' + PG_CM + 'A2:A200,' + PG_CM + 'C2:C200,' + PG_CM + 'D2:D200,' + PG_CM + 'E2:E200,' + PG_CM + 'G2:G200,' + PG_CM + 'N2:N200,' + PG_CM + 'T2:T200},' +
      PG_CM + 'A2:A200<>"",' + PG_CM + 'W2:W200="Out",' + PG_CM + 'E2:E200<>"One-off",' + PG_CM + 'I2:I200<>"Cancel"),' +
    'SORT(k,1,TRUE,7,FALSE))),40,8),"No recurring payments on Commitments")');
  sh.getRange(98, 3, 40, 1).setNumberFormat('#,##0.00');
  sh.getRange(98, 7, 40, 1).setNumberFormat('$#,##0.00');
  thBand(sh.getRange(98, 1, 40, 8), false);
  sh.getRange(138, 1).setValue('Total per month (parked ones left out)');
  sh.getRange(138, 7).setFormula('=SUMIFS(' + PG_CM + 'N2:N200,' + PG_CM + 'W2:W200,"Out",' + PG_CM + 'E2:E200,"<>One-off",' + PG_CM + 'I2:I200,"<>Cancel",' + PG_CM + 'I2:I200,"<>Later")').setNumberFormat('$#,##0');
  sh.getRange(138, 1, 1, 8).setFontWeight('bold').setBackground(TH.HEAD);

  sh.setFrozenRows(2);
  return sh;
}

/* ---- Money map ------------------------------------------------------------------ */

/**
 * One card per bank account, side by side, read from the Now tab:
 *   balance now → money coming in (+), payments by kind (−), card bills, HST
 *   to keep, transfers in (⬅) and out (➡) → what is left after 14 days.
 * Plain cells, so the colours say it: green in, red out, blue between your
 * accounts. Payments with no account set are listed underneath.
 */
var PG_MAP_ITEMS = 10;   // rows per card for the in / out lines

function pgMapTab(ss) {
  var sh = pgFresh(ss, PG.TAB_MAP);
  sh.getRange('A1:Z80').breakApart();
  var acc = pgAccounts(), banks = acc.banks, R = pgNowRows(banks.length), N = "'" + PG.TAB_NOW + "'!";
  var W = 1 + banks.length * 3;
  thPage(sh, W + 1);
  var rng = function (col, a, b) { return N + '$' + col + '$' + a + ':$' + col + '$' + b; };
  var r0 = 5, rNow = 6, i0 = 7, iEnd = i0 + PG_MAP_ITEMS - 1, rAfter = iEnd + 1, rDo = rAfter + 1;
  var fmtOf = function (cur) { return cur === 'INR' ? '+"₹"#,##0;-"₹"#,##0;"₹"0' : '+$#,##0;-$#,##0;$0'; };
  var balFmt = function (cur) { return cur === 'INR' ? '"₹"#,##0;-"₹"#,##0' : '$#,##0;-$#,##0'; };

  sh.getRange('B1').setValue('🌳 Money map — your accounts now, and after the next ' + PG.MOVE_DAYS + ' days')
    .setFontSize(18).setFontWeight('bold').setFontColor(TH.NAVY);
  pgNote(sh.getRange('B2').setValue('Green = money coming in · red = payments, grouped by kind · blue = money to move between your accounts. ' +
    'Numbers come from the Now tab; a "?" means type today\'s balance on Assets & Debts.'));
  sh.setRowHeight(1, 36);

  // The whole picture in one line.
  sh.getRange(3, 2, 1, W - 1).merge().setFormula('="💰 All your accounts:  now "&TEXT(' + N + 'D' + R.bTot + ',"$#,##0")&' +
    '"     →     after the next ' + PG.MOVE_DAYS + ' days "&TEXT(' + N + 'J' + R.bTot + ',"$#,##0;-$#,##0")')
    .setFontSize(13).setFontWeight('bold').setFontColor('#ffffff').setBackground(TH.NAVY)
    .setHorizontalAlignment('center').setVerticalAlignment('middle');
  sh.setRowHeight(3, 40);

  var rules = [];
  banks.forEach(function (b, i) {
    var c = 2 + i * 3, r = R.b0 + i, nm = b.name, rate = pgRate(b.cur);
    var L = sh.getRange(i0, c, PG_MAP_ITEMS, 1), A = sh.getRange(i0, c + 1, PG_MAP_ITEMS, 1);
    var labA1 = L.getA1Notation(), amtA1 = A.getA1Notation();

    sh.getRange(r0, c, 1, 2).merge().setValue(nm).setBackground(TH.NAVY).setFontColor('#ffffff').setFontWeight('bold')
      .setFontSize(10).setHorizontalAlignment('center').setVerticalAlignment('middle').setWrap(true);
    sh.getRange(rNow, c).setValue('Now');
    sh.getRange(rNow, c + 1).setFormula('=IF(' + N + 'B' + r + '="","?",' + N + 'B' + r + ')').setNumberFormat(balFmt(b.cur));
    sh.getRange(rNow, c, 1, 2).setBackground('#e8f0fe').setFontWeight('bold').setFontSize(11).setFontColor(TH.NAVY);

    // In / out lines, biggest first within each kind.
    var nowK = N + 'K' + r, blank = '{"",""}';
    // ARRAYFORMULA: "− "&INDEX(q,,1) on its own would keep only the first line.
    sh.getRange(i0, c).setFormula('=IFERROR(ARRAY_CONSTRAIN(ARRAYFORMULA(LET(' +
      'inc,IF(' + N + 'E' + r + '>0,HSTACK("+ Coming in",' + N + 'E' + r + '),' + blank + '),' +
      'mvin,IF(LEFT(' + nowK + ',1)="⚠",HSTACK("⬅ Move in "&REGEXEXTRACT(' + nowK + ',"(from .*)"),N(' + N + 'L' + r + ')/' + rate + '),' + blank + '),' +
      'q,QUERY({' + rng('A', R.l0, R.lEnd) + ',' + rng('I', R.l0, R.lEnd) + ',' + rng('D', R.l0, R.lEnd) + ',' + rng('B', R.l0, R.lEnd) + '},' +
        '"select Col2, sum(Col3) where Col1 = \'' + nm + '\' and Col4 <= date \'"&TEXT(TODAY()+' + PG.MOVE_DAYS + ',"yyyy-mm-dd")&"\' ' +
        'group by Col2 order by sum(Col3) desc label sum(Col3) \'\'",0),' +
      'pay,IFERROR(HSTACK("− "&INDEX(q,,1),-INDEX(q,,2)),' + blank + '),' +
      'crd,IF(' + N + 'G' + r + '>0,HSTACK("− Card bills",-' + N + 'G' + r + '),' + blank + '),' +
      'hst,IF(' + N + 'H' + r + '>0,HSTACK("− HST to keep for CRA",-' + N + 'H' + r + '),' + blank + '),' +
      'k,IFERROR(FILTER({' + rng('A', R.b0, R.bEnd) + ',' + rng('L', R.b0, R.bEnd) + '},LEFT(' + rng('K', R.b0, R.bEnd) + ',1)="⚠",' +
        'ISNUMBER(SEARCH("from ' + nm + '",' + rng('K', R.b0, R.bEnd) + '))),NA()),' +
      'mvout,IFERROR(HSTACK("➡ Send to "&INDEX(k,,1),-INDEX(k,,2)/' + rate + '),' + blank + '),' +
      'all,VSTACK(inc,mvin,pay,crd,hst,mvout),FILTER(all,INDEX(all,,1)<>""))),' + PG_MAP_ITEMS + ',2),"")');
    A.setNumberFormat(fmtOf(b.cur)).setHorizontalAlignment('right');
    L.setWrap(true);
    sh.getRange(i0, c, PG_MAP_ITEMS, 2).setFontSize(9);

    // After the payments and the transfers.
    sh.getRange(rAfter, c).setValue('After ' + PG.MOVE_DAYS + ' days');
    sh.getRange(rAfter, c + 1).setFormula('=IF(' + N + 'B' + r + '="","?",' + N + 'I' + r + '+SUMIF(' + labA1 + ',"⬅*",' + amtA1 + ')+SUMIF(' + labA1 + ',"➡*",' + amtA1 + '))')
      .setNumberFormat(balFmt(b.cur));
    sh.getRange(rAfter, c, 1, 2).setFontWeight('bold').setFontSize(11);
    sh.getRange(rDo, c, 1, 2).merge().setFormula('=' + nowK).setWrap(true).setFontSize(9).setFontColor(TH.GREY).setVerticalAlignment('top');
    sh.setRowHeight(rDo, 48);
    sh.getRange(r0, c, rDo - r0 + 1, 2).setBorder(true, true, true, true, false, false, '#c5cbd6', SpreadsheetApp.BorderStyle.SOLID);
    // Narrow enough that four cards fit a laptop screen.
    sh.setColumnWidth(c, 160);
    sh.setColumnWidth(c + 1, 88);
    sh.setColumnWidth(c + 2, 10);

    var after = sh.getRange(rAfter, c, 1, 2), afterA1 = sh.getRange(rAfter, c + 1).getA1Notation();
    rules.push(SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=AND(ISNUMBER(' + afterA1 + '),' + afterA1 + '>=0)')
      .setBackground(TH.GOOD_BG).setFontColor(TH.GOOD).setRanges([after]).build());
    rules.push(SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=AND(ISNUMBER(' + afterA1 + '),' + afterA1 + '<0)')
      .setBackground(TH.BAD_BG).setFontColor(TH.BAD).setRanges([after]).build());
  });
  sh.setColumnWidth(1, 10);

  // Line colours across all cards: by the first character of the label.
  var items = sh.getRange(i0, 2, PG_MAP_ITEMS, W - 1);
  var line = function (ch, bg, fg) {
    // The label cell of this card's line; spacer columns stay white.
    return SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=AND(MOD(COLUMN()-2,3)<2,LEFT(INDEX($A' + i0 + ':$Z' + iEnd + ',ROW()-' + (i0 - 1) +
      ',COLUMN()-MOD(COLUMN()-2,3)),1)="' + ch + '")').setBackground(bg).setFontColor(fg).setRanges([items]).build();
  };
  rules.push(line('+', '#e6f4ea', '#137333'), line('−', '#fdecea', '#b3261e'), line('⬅', '#e3f2fd', '#0b57d0'), line('➡', '#e3f2fd', '#0b57d0'));

  // Credit cards, a second row of cards: what is owed, what will be charged to
  // the card in the next days, and the account that pays it off.
  var cards = acc.cards, k0 = rDo + 3, kNow = k0 + 1, j0 = k0 + 2, jN = 6, jEnd = j0 + jN - 1, kAfter = jEnd + 1, kDo = kAfter + 1;
  cards.forEach(function (cd, j) {
    var c = 2 + j * 3, nm = cd.name;
    var J = sh.getRange(j0, c + 1, jN, 1), jl = sh.getRange(j0, c, jN, 1).getA1Notation(), ja = J.getA1Notation();
    sh.getRange(k0, c, 1, 2).merge().setValue('💳 ' + nm).setBackground('#5b3fa0').setFontColor('#ffffff').setFontWeight('bold')
      .setFontSize(10).setHorizontalAlignment('center').setVerticalAlignment('middle').setWrap(true);
    sh.getRange(kNow, c).setValue('Owed since last payment');
    sh.getRange(kNow, c + 1).setFormula('=IFERROR(INDEX(Dashboard!$B$54:$B$57,MATCH("' + nm + '",Dashboard!$A$54:$A$57,0)),0)').setNumberFormat('$#,##0');
    sh.getRange(kNow, c, 1, 2).setBackground('#efe9fb').setFontWeight('bold').setFontSize(11).setFontColor('#3c2a78');
    sh.getRange(j0, c).setFormula('=IFERROR(ARRAY_CONSTRAIN(ARRAYFORMULA(LET(' +
      'q,QUERY({' + rng('C', R.l0, R.lEnd) + ',' + rng('F', R.l0, R.lEnd) + ',' + rng('H', R.l0, R.lEnd) + ',' + rng('B', R.l0, R.lEnd) + '},' +
        '"select Col1, sum(Col2) where Col3 = \'' + nm + '\' and Col4 <= date \'"&TEXT(TODAY()+' + PG.MOVE_DAYS + ',"yyyy-mm-dd")&"\' ' +
        'group by Col1 order by sum(Col2) desc label sum(Col2) \'\'",0),' +
      'HSTACK("− "&INDEX(q,,1),-INDEX(q,,2)))),' + jN + ',2),"")');
    J.setNumberFormat('+$#,##0;-$#,##0;$0').setHorizontalAlignment('right');
    sh.getRange(j0, c, jN, 2).setFontSize(9);
    sh.getRange(kAfter, c).setValue('To pay off (' + PG.MOVE_DAYS + ' days)');
    sh.getRange(kAfter, c + 1).setFormula('=' + sh.getRange(kNow, c + 1).getA1Notation() + '-SUMIF(' + jl + ',"−*",' + ja + ')').setNumberFormat('$#,##0');
    sh.getRange(kAfter, c, 1, 2).setFontWeight('bold').setFontSize(11).setBackground('#efe9fb').setFontColor('#3c2a78');
    sh.getRange(kDo, c, 1, 2).merge().setValue(cd.payFrom ? 'Paid off from ' + cd.payFrom : 'Which account pays this card? (Config payFrom)')
      .setWrap(true).setFontSize(9).setFontColor(TH.GREY).setVerticalAlignment('top');
    sh.setRowHeight(kDo, 36);
    sh.getRange(k0, c, kDo - k0 + 1, 2).setBorder(true, true, true, true, false, false, '#c9bfe6', SpreadsheetApp.BorderStyle.SOLID);
  });
  if (cards.length) {
    var cItems = sh.getRange(j0, 2, jN, cards.length * 3);
    rules.push(SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=AND(MOD(COLUMN()-2,3)<2,LEFT(INDEX($A' + j0 + ':$Z' + jEnd + ',ROW()-' + (j0 - 1) +
      ',COLUMN()-MOD(COLUMN()-2,3)),1)="−")').setBackground('#fdecea').setFontColor('#b3261e').setRanges([cItems]).build());
  }
  sh.setConditionalFormatRules(rules);

  // Payments with no account set.
  var n0 = (cards.length ? kDo : rDo) + 3;
  pgSection(sh, n0, '❔ Payments with no account set — say which account pays them (Commitments › Account)', W);
  sh.getRange(n0 + 1, 2).setFormula('=IFERROR(ARRAY_CONSTRAIN(FILTER({' + rng('C', R.l0, R.lEnd) + ',' + rng('B', R.l0, R.lEnd) + ',' + rng('F', R.l0, R.lEnd) + '},' +
    rng('A', R.l0, R.lEnd) + '="(no account set)"),6,3),"None ✅")');
  sh.getRange(n0 + 1, 3, 6, 1).setNumberFormat('ddd d mmm');
  sh.getRange(n0 + 1, 4, 6, 1).setNumberFormat('$#,##0.00');
  sh.setFrozenRows(3);
  return sh;
}

/** The old org chart is gone; remove it if a sheet still has one. */
function pgMapChart(ss) {
  var sh = getTab(ss, PG.TAB_MAP);
  if (sh) sh.getCharts().forEach(function (c) { sh.removeChart(c); });
}

/** Build the pages (on a version change). */
function pgInstall(ss) {
  pgNowTab(ss);
  // Big picture was replaced by Net worth, Forecast and Summary (deleted 30 Oct 2026).
  // The Money map was replaced by Today's account view (deleted 27 Oct 2026).
}

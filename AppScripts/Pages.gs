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
    'all,VSTACK(a,b),k,FILTER(all,INDEX(all,,3)<>""),' +
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


/* ---- Money map ------------------------------------------------------------------ */

/**
 * One card per bank account, side by side, read from the Now tab:
 *   balance now → money coming in (+), payments by kind (−), card bills, HST
 *   to keep, transfers in (⬅) and out (➡) → what is left after 14 days.
 * Plain cells, so the colours say it: green in, red out, blue between your
 * accounts. Payments with no account set are listed underneath.
 */
var PG_MAP_ITEMS = 10;   // rows per card for the in / out lines



/** Build the pages (on a version change). */
function pgInstall(ss) {
  pgNowTab(ss);
  // Big picture was replaced by Net worth, Forecast and Summary (deleted 30 Oct 2026).
  // The Money map was replaced by Today's account view (deleted 27 Oct 2026).
}

/**
 * Expected.gs — payments promised in chats and emails, before they happen.
 *
 * Claude reads your WhatsApp and Gmail (in a session, when you ask) and adds
 * one row per payment it finds. You stay in charge of what counts:
 *
 *   Stage (J, Claude)     Suggested = mentioned, you have not said you'll pay
 *                         Expected  = you said in the chat/mail that you'll pay
 *   Your decision (K)     Approve = plan for it: it joins the Now tab's list and
 *                         money moves; Reject = ignore it
 *   Status (N, formula)   the above in words, and "💸 Paid" once a payment of
 *                         that amount (±3%) leaves the account on/after the date
 *                         it was found — then it drops off the Now tab
 *
 * The tab is yours: created once, never cleared. Only the header, the CAD and
 * Status formulas, and the dropdowns are put back on a rebuild.
 */

var EX = {
  TAB: 'Expected payments',
  ROWS: 300,
  COLS: ['Found on', 'Source', 'Chat / sender', 'What', 'Amount', 'Currency', 'Due', 'Pay from',
         'What was said', 'Stage', 'Your decision', 'Notes', 'CAD', 'Status'],
  STAGES: ['Suggested', 'Expected'],
  DECISIONS: ['Approve', 'Reject']
};
var EX_REF = "'" + EX.TAB + "'!";

function exInstall(ss) {
  var sh = getTab(ss, EX.TAB) || ss.insertSheet(EX.TAB);
  var N = EX.ROWS;
  sh.getRange(1, 1, 1, 12).setValues([EX.COLS.slice(0, 12)]);
  sh.getRange('M1').setFormula('={"CAD";ARRAYFORMULA(IF(E2:E' + N + '="","",E2:E' + N + '*IFERROR(VLOOKUP(F2:F' + N + ',Categories!$E:$F,2,0),1)))}');
  sh.getRange('N1').setFormula('={"Status";MAP(D2:D' + N + ',A2:A' + N + ',H2:H' + N + ',M2:M' + N + ',J2:J' + N + ',K2:K' + N + ',' +
    'LAMBDA(d,f,h,v,j,k,IF(d="","",LET(' +
      'pd,IFERROR(MIN(FILTER(_Calc!A2:A,_Calc!H2:H<0,ABS(ABS(_Calc!H2:H)-v)<=MAX(1,v*0.03),_Calc!A2:A>=IF(f="",0,f),' +
        'IF(h="",TRUE,ISNUMBER(SEARCH(h,_Calc!C2:C))))),0),' +
      'IF(k="Reject","❌ Rejected",IF(AND(ISNUMBER(v),pd>0),"💸 Paid "&TEXT(pd,"d mmm"),' +
      'IF(k="Approve","✅ Approved — on the Now tab",' +
      'IF(j="Expected","⏳ You said you\'d pay — approve or reject in column K","💡 Found — you haven\'t said you\'ll pay"))))))))}');

  var list = function (vals) { return SpreadsheetApp.newDataValidation().requireValueInList(vals, true).setAllowInvalid(true).build(); };
  var acc = pgAccounts();
  sh.getRange(2, 2, N - 1, 1).setDataValidation(list(['WhatsApp', 'Email', 'Other']));
  sh.getRange(2, 6, N - 1, 1).setDataValidation(list(Object.keys(CFG.FX_TO_CAD)));
  sh.getRange(2, 8, N - 1, 1).setDataValidation(list(acc.banks.map(function (b) { return b.name; })
    .concat(acc.cards.map(function (c) { return c.name; }))));
  sh.getRange(2, 10, N - 1, 1).setDataValidation(list(EX.STAGES));
  sh.getRange(2, 11, N - 1, 1).setDataValidation(list(EX.DECISIONS));

  // Look: navy header, green headers over formula columns, your column in yellow.
  sh.setFrozenRows(1);
  thHeader(sh.getRange(1, 1, 1, 12));
  thHeader(sh.getRange(1, 13, 1, 2), TH.CALC_HEAD);
  sh.getRange(2, 11, N - 1, 1).setBackground(TH.INPUT).setFontWeight('bold');
  sh.getRange(2, 1, N - 1, 1).setNumberFormat('d mmm yyyy');
  sh.getRange(2, 7, N - 1, 1).setNumberFormat('d mmm yyyy');
  sh.getRange(2, 5, N - 1, 1).setNumberFormat('#,##0.00');
  sh.getRange(2, 13, N - 1, 1).setNumberFormat('$#,##0.00').setFontColor(TH.CALC_INK);
  sh.getRange(2, 9, N - 1, 1).setWrap(true).setFontColor(TH.GREY);
  [95, 85, 150, 210, 95, 70, 95, 170, 300, 90, 105, 200, 95, 290].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  sh.getRange('K1').setNote('Approve = plan for it (it joins the Now tab). Reject = ignore it. Claude never fills this column.');
  sh.getRange('J1').setNote('Set by Claude from your chats and mails. Suggested = mentioned; Expected = you said you will pay.');

  var all = sh.getRange(2, 14, N - 1, 1);
  var rule = function (txt, bg) { return SpreadsheetApp.newConditionalFormatRule().whenTextStartsWith(txt).setBackground(bg).setRanges([all]).build(); };
  sh.setConditionalFormatRules([rule('⏳', TH.WARN_BG), rule('✅', TH.GOOD_BG), rule('💸', '#e8f0fe'), rule('❌', '#f1f3f4')]);
  return sh;
}

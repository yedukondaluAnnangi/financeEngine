/**
 * Theme.gs — one look for every tab the script owns or decorates.
 *
 * Navy header rows, a darker band for section titles, light zebra rows,
 * no gridlines on report tabs. Only formats are touched here, never values,
 * so it is safe on tabs you type into (Commitments, Payees, Categories,
 * Assets & Debts). Runs on the rebuild that follows a PLAN.VERSION change.
 */

var TH = {
  NAVY: '#1a2b4c',          // header rows
  SECTION: '#24477f',       // section titles on report tabs
  HEAD: '#dfe6f3',          // column headers inside a section
  BAND: '#f5f7fb',          // every other row
  CALC_HEAD: '#2f6f62',     // headers of formula columns (don't type here)
  CALC_INK: '#37474f',
  INPUT: '#fffbe6',         // cells waiting for you to type
  GREY: '#5f6368',
  GOOD: '#188038', GOOD_BG: '#e6f4ea',
  BAD: '#c5221f', BAD_BG: '#fce8e6',
  WARN_BG: '#fef7e0',
  FONT: 'Roboto'
};

function thClearBands(sh) {
  sh.getBandings().forEach(function (b) { b.remove(); });
}

/** Zebra rows on a block; the first row of the block is a header when header = true. */
function thBand(range, header) {
  var b = range.applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY, !!header, false);
  b.setFirstRowColor('#ffffff').setSecondRowColor(TH.BAND);
  if (header) b.setHeaderRowColor(TH.NAVY);
  return b;
}

function thHeader(range, bg) {
  return range.setBackground(bg || TH.NAVY).setFontColor('#ffffff').setFontWeight('bold')
    .setVerticalAlignment('middle').setWrap(true);
}

function thColHead(range) {
  return range.setBackground(TH.HEAD).setFontColor(TH.NAVY).setFontWeight('bold').setVerticalAlignment('middle');
}

/** A report tab's title row: big navy text, white page, Roboto. */
function thPage(sh, cols) {
  sh.setHiddenGridlines(true);
  sh.getRange(1, 1, sh.getMaxRows(), cols).setFontFamily(TH.FONT);
  sh.setRowHeight(1, 36);
  sh.getRange(1, 1).setFontSize(18).setFontWeight('bold').setFontColor(TH.NAVY).setVerticalAlignment('middle');
}


/* ---- Dashboard ------------------------------------------------------------------ */

/**
 * Zebra rows over each list on the Dashboard. The row numbers follow
 * fxDashboardCells; they are fixed because the monthly email reads them.
 */
var TH_DASH_BLOCKS = [
  [6, 3, 6], [11, 10, 3], [22, 21, 8], [45, 6, 3], [53, 5, 4], [60, 16, 4], [78, 16, 5],
  [97, 5, 2], [103, 9, 4], [113, 9, 5], [124, 10, 5], [137, 16, 6], [156, 71, 7], [230, 11, 7], [243, 10, 3]
];

function thDashboard(sh) {
  thClearBands(sh);
  thPage(sh, 8);
  TH_DASH_BLOCKS.forEach(function (b) { thBand(sh.getRange(b[0], 1, b[1], b[2]), false); });
  sh.getRange('A2').setFontColor(TH.GREY).setFontStyle('italic').setFontSize(9);
  sh.getRange('A3:H3').setFontColor(TH.NAVY);
  sh.getRange('A4:H4').setBackground('#fff4ce').setFontColor(TH.NAVY)
    .setBorder(true, false, true, false, false, false, '#f9ab00', SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
  sh.setRowHeight(4, 30);
  sh.getRange('B7:F8').setFontSize(12).setFontWeight('bold');
  sh.getRange('A15:C15').setBackground(TH.GOOD_BG);
  sh.getRange('A17:C17').setBackground(TH.GOOD_BG);
}


/* ---- Commitments ----------------------------------------------------------------- */

function thCommitments(sh) {
  thClearBands(sh);
  var lastCol = FX.COMMIT_CALC_COL + FX.COMMIT_CALC.length - 1, rows = sh.getMaxRows();
  sh.getRange(1, 1, rows, lastCol).setFontFamily(TH.FONT).setVerticalAlignment('middle');
  thBand(sh.getRange(1, 1, rows, lastCol), true);
  thHeader(sh.getRange(1, 1, 1, PLAN.COMMIT_COLS.length));
  thHeader(sh.getRange(1, FX.COMMIT_CALC_COL, 1, FX.COMMIT_CALC.length), TH.CALC_HEAD);
  sh.setRowHeight(1, 44);
  sh.getRange(2, FX.COMMIT_CALC_COL, rows - 1, FX.COMMIT_CALC.length).setFontColor(TH.CALC_INK);
  sh.getRange(2, 1, rows - 1, 1).setFontWeight('bold');
  sh.getRange(2, 12, rows - 1, 1).setWrap(false).setFontColor(TH.GREY);
  sh.getRange('M1').setNote('Columns M onward (green headers) are formulas — don\'t type there. Yours are A–L (navy).');
  sh.setFrozenRows(1);
  sh.setFrozenColumns(1);
}

/** Conditional colours on Commitments: status, decision, in/out, due soon, finished rows. */
function thCommitRules(sh) {
  var n = sh.getMaxRows() - 1;
  var col = function (c) { return sh.getRange(2, c, n, 1); };
  var all = sh.getRange(2, 1, n, FX.COMMIT_CALC_COL + FX.COMMIT_CALC.length - 1);
  var R = function () { return SpreadsheetApp.newConditionalFormatRule(); };
  var starts = function (txt, bg, fg) {
    var b = R().whenTextStartsWith(txt).setRanges([col(20)]);
    if (bg) b.setBackground(bg);
    if (fg) b.setFontColor(fg);
    return b.build();
  };
  sh.setConditionalFormatRules([
    // A cancelled or ended row fades out.
    R().whenFormulaSatisfied('=AND($A2<>"",OR($I2="Cancel",LEFT($T2,5)="Ended"))').setRanges([all]).setFontColor('#9aa0a6').build(),
    starts('🔴', TH.BAD_BG, TH.BAD), starts('⚠', TH.BAD_BG, TH.BAD), starts('⏳', TH.WARN_BG), starts('📌', TH.WARN_BG),
    starts('❔', null, '#80868b'), starts('✅', TH.GOOD_BG, TH.GOOD),
    R().whenTextEqualTo('Keep').setRanges([col(9)]).setBackground(TH.GOOD_BG).setFontColor(TH.GOOD).setBold(true).build(),
    R().whenTextEqualTo('Cancel').setRanges([col(9)]).setBackground(TH.BAD_BG).setFontColor(TH.BAD).setBold(true).build(),
    R().whenTextEqualTo('Review').setRanges([col(9)]).setBackground(TH.WARN_BG).setBold(true).build(),
    // Still to decide: a cost with no decision yet.
    R().whenFormulaSatisfied('=AND($A2<>"",$I2="",$W2="Out")').setRanges([col(9)]).setBackground(TH.INPUT).build(),
    R().whenTextEqualTo('In').setRanges([col(23)]).setFontColor(TH.GOOD).setBold(true).build(),
    R().whenFormulaSatisfied('=AND(ISNUMBER($Z2),$Z2>=0,$Z2<=3)').setRanges([col(26)]).setBackground('#fde7d3').setBold(true).build(),
    R().whenNumberGreaterThan(0).setRanges([col(25)]).setBold(true).build()
  ]);
}


/* ---- Payees and Categories (your tabs: formats only) ---------------------------------- */

function thPayees(ss) {
  var sh = getTab(ss, CFG.TAB_PAYEES);
  if (!sh) return;
  thClearBands(sh);
  var rows = sh.getMaxRows();
  sh.getRange(1, 1, rows, 4).setFontFamily(TH.FONT);
  thBand(sh.getRange(1, 1, rows, 4), true);
  thHeader(sh.getRange(1, 1, 1, 4));
  sh.getRange(2, 1, rows - 1, 1).setFontFamily('Roboto Mono').setFontColor(TH.CALC_INK);
  sh.getRange(2, 2, rows - 1, 1).setFontWeight('bold');
  sh.setFrozenRows(1);
  [300, 230, 170, 110].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  if (!sh.getRange('D1').getValue()) sh.getRange('D1').setValue('Amount (optional)');
  sh.getRange('A1').setNote('PATTERN: a regex matched against the bank description. First matching row wins, so specific rows go above general ones.\n' +
    'PAYEE: the clean name shown everywhere.\nDEFAULT CATEGORY: sets the group (see Categories).\nAmount: only match when the amount is this (e.g. a PhonePe rent).');
}

function thCategories(ss) {
  var sh = getTab(ss, FX.CATS);
  if (!sh) return;
  thClearBands(sh);
  var rows = sh.getMaxRows();
  sh.getRange(1, 1, rows, 6).setFontFamily(TH.FONT);
  thBand(sh.getRange(1, 1, rows, 3), true);
  thHeader(sh.getRange(1, 1, 1, 3));
  thHeader(sh.getRange(1, 5, 1, 2), TH.CALC_HEAD);
  sh.getRange('E8:F8').setBackground(TH.INPUT).setFontWeight('bold');
  sh.getRange('E2:F6').setBackground('#f8f9fa');
  sh.getRange(2, 1, rows - 1, 1).setFontWeight('bold');
  sh.setFrozenRows(1);
}

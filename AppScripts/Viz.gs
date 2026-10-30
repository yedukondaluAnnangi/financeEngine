/**
 * Viz.gs — what is left of the old picture tabs: the upkeep that runs after a code version change.
 * The pages you read are built in Views.gs.
 */

/** Tab order (Views.gs), and the filter and frozen header on Transactions. */
function vzArrange(ss) {
  vwArrangeTabs(ss);
  var tx = getTab(ss, CFG.TAB_TX);
  if (tx && !tx.getFilter() && tx.getLastRow() > 1) tx.getRange(1, 1, tx.getLastRow(), CFG.COLS.length).createFilter();
  if (tx) tx.setFrozenRows(1);
}

/** After a code version change. */
function vzInstall(ss) {
  bsInstall(ss);
  thPayees(ss);
  thCategories(ss);
  vzArrange(ss);
}

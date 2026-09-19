/**
 * Config.gs — all the knobs in one place.
 * Change things here, never inside the parsers.
 */

var CFG = {

  // ---- Where things live -------------------------------------------------
  SHEET_ID  : '181KUuScXZcuhMXYQ141nU-rXA748vQp_VS3BFFmoFdE',
  INBOX_ID  : '1ePMFfxj8oDxl7Zk9D4wi5dLdn9I0KLi_',   // drop statements here
  DONE_NAME : 'Processed',      // subfolder, created automatically
  FAIL_NAME : 'Failed',         // subfolder, created automatically

  // ---- Tabs --------------------------------------------------------------
  TAB_TX     : 'Transactions',
  TAB_PAYEES : 'Payees',
  TAB_RUNS   : '_Runs',         // audit log, created automatically
  TAB_ISSUES : '_Issues',       // parse warnings, created automatically

  // ---- Behaviour ---------------------------------------------------------
  MOVE_WHEN_DONE : true,   // move files out of the inbox after ingest
  WRITE_LABELS   : true,   // script fills Payee + Category
  STRICT_BALANCE : false,  // true = reject a statement whose balance chain breaks
  DRY_RUN        : false,  // true = parse and report, write nothing

  // ---- FX ----------------------------------------------------------------
  // One flat rate applied to every rupee row. A single number you understand
  // beats a lookup you don't.
  INR_TO_CAD : 0.0162,

  // ---- Column order. Must match the Transactions header row. -------------
  COLS : ['Transaction ID','Date','Month','Account','Description','Payee',
          'Amount','Currency','Amount CAD','Category','Notion Task','Status'],

  /**
   * Account fingerprints. First rule whose `test` appears in the file wins,
   * so put specific ones above general ones.
   *
   *   parser     reads the text of a PDF
   *   rowParser  reads the rows of a spreadsheet or CSV
   *
   * An account can have either or both. HDFC savings has both because the
   * PDF is password-protected and the spreadsheet is not — see the note
   * under HDFC_SAV below.
   *
   * Note the ordering trap: the savings statement contains the card number
   * 4351 inside a narration line, so the savings fingerprints must sit above
   * the card's.
   */
  ACCOUNTS : [
    { test: 'neofinancial.com',       key: 'NEO_CARD',  name: 'Neo Mastercard ••0141',  currency: 'CAD', parser: 'parseNeo' },
    { test: 'RoyalBankofCanada',      key: 'RBC_CHQ',   name: 'RBC Chequing ••1324',    currency: 'CAD', parser: 'parseRbc' },
    { test: 'Royal Bank of Canada',   key: 'RBC_CHQ',   name: 'RBC Chequing ••1324',    currency: 'CAD', parser: 'parseRbc' },
    { test: 'CIBC Account Statement', key: 'CIBC_CHQ',  name: 'CIBC Chequing 73-83096', currency: 'CAD', parser: 'parseCibc' },
    { test: 'CIBCAccountStatement',   key: 'CIBC_CHQ',  name: 'CIBC Chequing 73-83096', currency: 'CAD', parser: 'parseCibc' },

    // HDFC savings. Download this one as Excel or Delimited from netbanking,
    // NOT as PDF: HDFC password-protects the PDF, and Drive cannot convert an
    // encrypted file, so the PDF route fails with a Bad Request every time.
    // The spreadsheet carries withdrawal and deposit in separate columns,
    // which is also more reliable than anything read out of a PDF.
    { test: '50100230407203',         key: 'HDFC_SAV',  name: 'HDFC Savings ••7203',    currency: 'INR', parser: 'parseHdfcSavings', rowParser: 'parseHdfcSavingsRows' },
    { test: 'Statementofaccount',     key: 'HDFC_SAV',  name: 'HDFC Savings ••7203',    currency: 'INR', parser: 'parseHdfcSavings', rowParser: 'parseHdfcSavingsRows' },
    { test: 'Statement of account',   key: 'HDFC_SAV',  name: 'HDFC Savings ••7203',    currency: 'INR', parser: 'parseHdfcSavings', rowParser: 'parseHdfcSavingsRows' },

    { test: 'Regalia',                key: 'HDFC_CARD', name: 'HDFC Regalia ••4351',    currency: 'INR', parser: 'parseHdfcCard' },
    { test: '4351',                   key: 'HDFC_CARD', name: 'HDFC Regalia ••4351',    currency: 'INR', parser: 'parseHdfcCard' }
  ],

  MONTHS : {JAN:0,FEB:1,MAR:2,APR:3,MAY:4,JUN:5,JUL:6,AUG:7,SEP:8,OCT:9,NOV:10,DEC:11}
};
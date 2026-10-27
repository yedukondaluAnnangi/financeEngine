/**
 * Config.gs — all the knobs in one place.
 * Change things here, never inside the parsers.
 */

var CFG = {

  // ---- Where things live -------------------------------------------------
  SHEET_ID  : '181KUuScXZcuhMXYQ141nU-rXA748vQp_VS3BFFmoFdE',
  INBOX_ID  : '19M7pY_-V_5hcwfQ--gdq-B9j5ZPcVKXj',   // Bankstatements › Inbox — you upload here
  OUTBOX_ID : '1ePMFfxj8oDxl7Zk9D4wi5dLdn9I0KLi_',   // Bankstatements › Outbox — the script's side
  STAGING_NAME : 'Staging',     // Outbox subfolders, created automatically
  DONE_NAME    : 'Processed',
  FAIL_NAME    : 'Failed',
  IGNORED_NAME : 'Ignored',

  // ---- Tabs --------------------------------------------------------------
  TAB_TX       : 'Transactions',
  TAB_PAYEES   : 'Payees',
  TAB_RUNS     : '_Runs',       // audit log, created automatically
  TAB_ISSUES   : '_Issues',     // parse warnings, created automatically
  TAB_BALANCES : '_Balances',   // closing balance per account per file, created automatically

  // ---- Behaviour ---------------------------------------------------------
  WRITE_LABELS   : true,   // script fills Payee + Category
  DRY_RUN        : false,  // true = check and email, write and move nothing

  // ---- Automation --------------------------------------------------------
  // pollInbox runs every POLL_MINUTES. It does nothing, and sends nothing,
  // while the Inbox is empty or a file arrived less than SETTLE_MINUTES ago
  // (so a multi-file upload is handled as one batch).
  POLL_MINUTES   : 5,
  SETTLE_MINUTES : 2,
  MAX_RETRIES    : 3,       // transient errors (Drive hiccups) before a batch counts as failed
  REMINDER       : { weekday: 'FRIDAY', hour: 6 },   // upload reminder email
  REMINDER_TEST  : '2026-09-19',   // change to any new value to get one test reminder on the next poll; '' = off

  // Files that are never ingested and never fail a batch; moved to Outbox › Ignored.
  // Wealthsimple is tracked in Notion (Finance › Investments), not the sheet.
  IGNORE : [/^monthly-statements-.*\.zip$/i, /wealthsimple/i],

  /**
   * What the weekly reminder lists, one entry per account key.
   *   accepts   file types the checks allow for this account
   *   cadence   'any-date' = download any date range (CSV banks)
   *             'statement' = only closed statements exist (PDF cards)
   *   quiet     true = an account with no activity; never asked for
   *   payFrom   (cards) the account whose money pays this card off — the Now tab
   *             counts the card's bill against that account
   *   holdsHst  the account the HST you collect lands in; the Now tab keeps it aside there
   *   fundedFrom (banks) the account that tops this one up when it runs short. Money only
   *             moves along these routes (TD → RBC → HDFC); an account asks its funder for
   *             its own shortfall plus whatever it must pass on to the accounts it funds.
   * Login links are the banks' public sign-in pages. Edit freely.
   */
  BANKS : {
    NEO_CARD : { accepts: ['pdf', 'csv'], cadence: 'any-date',
                 login: 'https://member.neofinancial.com/',
                 howTo: 'Card › Transactions › Download CSV (or the monthly statement PDF). Keep the default file name.',
                 payFrom: 'RBC_CHQ' },
    RBC_CHQ  : { accepts: ['csv', 'pdf'], cadence: 'any-date',
                 login: 'https://secure.royalbank.com/statics/login-service-ui/index#/full/signin?LANGUAGE=ENGLISH',
                 howTo: 'Chequing ••1324 › Download transactions › CSV. Keep "download-transactions.csv".',
                 fundedFrom: 'TD_BUS' },
    CIBC_CHQ : { accepts: ['csv'], cadence: 'any-date',
                 login: 'https://www.cibconline.cibc.com/ebm-resources/online-banking/client/index.html#/auth/signon',
                 howTo: 'Chequing 73-83096 › Download transactions › CSV. Rename so the name ends in 096.csv.',
                 fundedFrom: 'RBC_CHQ' },
    CIBC_680 : { accepts: ['csv'], cadence: 'any-date',
                 login: 'https://www.cibconline.cibc.com/ebm-resources/online-banking/client/index.html#/auth/signon',
                 howTo: 'Account ••680 › Download transactions › CSV. Rename so the name ends in 680.csv.',
                 // No activity on this account: left out of the upload banner and the weekly reminder.
                 quiet: true },
    CIBC_CARD: { accepts: ['csv'], cadence: 'any-date',
                 login: 'https://www.cibconline.cibc.com/ebm-resources/online-banking/client/index.html#/auth/signon',
                 howTo: 'Credit card ••4181 › Download transactions › CSV. Any file name — the card number inside identifies it.',
                 payFrom: 'CIBC_CHQ' },
    TD_BUS   : { accepts: ['csv'], cadence: 'any-date',
                 login: 'https://easyweb.td.com/',
                 howTo: 'Business Chequing › Download › CSV. Keep "accountactivity.csv".',
                 holdsHst: true },
    TD_INV   : { accepts: ['csv'], cadence: 'any-date',
                 login: 'https://easyweb.td.com/',
                 howTo: 'Business Investor account ••2366 › Download › CSV. Rename so the name ends in 2366.csv.' },
    HDFC_SAV : { accepts: ['xls', 'xlsx', 'csv', 'txt'], cadence: 'any-date',
                 login: 'https://netbanking.hdfcbank.com/netbanking/',
                 howTo: 'Savings ••7203 › Account Statement › choose XLS (not PDF — it is password-protected).',
                 fundedFrom: 'RBC_CHQ' },
    HDFC_CARD: { accepts: ['pdf', 'xls', 'xlsx'], cadence: 'statement',
                 login: 'https://netbanking.hdfcbank.com/netbanking/',
                 howTo: 'Cards › Regalia ••4351 › Billed statement › XLS (or PDF).',
                 payFrom: 'HDFC_SAV' }
  },

  // ---- FX ----------------------------------------------------------------
  // One flat rate per currency, applied to every row in that currency.
  // A single number you understand beats a lookup you don't. A currency
  // missing here leaves Amount CAD blank and logs a note in _Issues.
  FX_TO_CAD : {
    CAD : 1,
    INR : 0.0148    // fallback only: the Categories tab uses Google Finance's live rate
  },

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
   * A rule matches by `test` (text anywhere in the file, file name included),
   * `file` (a regex on the file name only), or `cell` (a regex one whole
   * spreadsheet cell must match — for when the text also turns up elsewhere).
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
    // TD CSVs have no account number inside and both TD accounts download as
    // accountactivity.csv: rename the investor account's file to end in 2366.csv.
    // Above TD_BUS, whose rule matches any accountactivity file.
    { file: /2366\.csv$/i,            key: 'TD_INV',    name: 'TD Business Investor ••2366', currency: 'CAD', rowParser: 'parseTdRows' },
    // TD CSV has no bank name inside, so it is matched by TD's default file name.
    { test: 'accountactivity',        key: 'TD_BUS',    name: 'TD Business Chequing',   currency: 'CAD', rowParser: 'parseTdRows' },

    // CIBC credit card CSV: Date | Description | Debit | Credit | Card number.
    // The masked card number fills a cell of its own on every row. The
    // chequing download mentions the same number inside its "TO CARD"
    // transfer text, so it is matched as a whole cell, never as text.
    { cell: /^4505\*+4181$/,          key: 'CIBC_CARD', name: 'CIBC Credit Card ••4181', currency: 'CAD', rowParser: 'parseCibcRows' },

    // CIBC chequing CSVs carry no account number, and each account's file names the
    // other one in its transfer lines, so only the file name can tell them
    // apart. Rename the download to end in 096.csv or 680.csv.
    { file: /096\.csv$/i,             key: 'CIBC_CHQ',  name: 'CIBC Chequing 73-83096', currency: 'CAD', rowParser: 'parseCibcRows' },
    { file: /680\.csv$/i,             key: 'CIBC_680',  name: 'CIBC ••680',             currency: 'CAD', rowParser: 'parseCibcRows' },
    // RBC CSV names the account number on every row. Above the PDF rules.
    { test: '5101324',                key: 'RBC_CHQ',   name: 'RBC Chequing ••1324',    currency: 'CAD', parser: 'parseRbc', rowParser: 'parseRbcRows' },

    // Neo CSV has no bank name inside; its default file name does.
    { test: 'NeoWorldMastercard',     key: 'NEO_CARD',  name: 'Neo Mastercard ••0141',  currency: 'CAD', parser: 'parseNeo', rowParser: 'parseNeoRows' },
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

    { test: 'Regalia',                key: 'HDFC_CARD', name: 'HDFC Regalia ••4351',    currency: 'INR', parser: 'parseHdfcCard', rowParser: 'parseHdfcCardRows' },
    { test: '4351',                   key: 'HDFC_CARD', name: 'HDFC Regalia ••4351',    currency: 'INR', parser: 'parseHdfcCard', rowParser: 'parseHdfcCardRows' }
  ],

  MONTHS : {JAN:0,FEB:1,MAR:2,APR:3,MAY:4,JUN:5,JUL:6,AUG:7,SEP:8,OCT:9,NOV:10,DEC:11}
};
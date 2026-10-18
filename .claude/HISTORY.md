# Finance Engine — work history

A running log of what was built, fixed and learned, newest session first.
Every Claude session appends an entry here before it ends (see `.claude/CLAUDE.md`).

> This repository is **public**. Log the engineering — what changed, why, what
> broke — never personal figures: no income, balances, loan amounts, payee or
> landlord names, account numbers beyond what `Config.gs` already holds.

---

## 2026-10-18 — One theme for every tab; Balance Sheet and Assets & Debts

**Asked:** make Dashboard, Commitments, Trends and every other tab except
Transactions more attractive; add a balance sheet / assets view.

**Theme (`Theme.gs`, new):** navy header rows, darker section bands, zebra rows
(`applyRowBanding`), Roboto, hidden gridlines on report tabs.
- Dashboard: formats only (`thDashboard`, block rows in `TH_DASH_BLOCKS`) — cell
  positions unchanged because the monthly email reads fixed rows.
- Commitments: navy headers on your columns A–L, green on formula columns M–AA;
  colours for Decision (Keep/Cancel/Review/undecided), Status, In/Out, due in ≤3
  days, still owed; cancelled / ended rows fade (`thCommitRules`, replaces the old
  `fxCommitColours` body).
- Payees and Categories: header + zebra only (user tabs: values never touched);
  Payees D1 now labelled "Amount (optional)" (rows are read from row 2, safe).
- Overview, Trends, Accounts restyled with the same helpers.

**Balance sheet (`BalanceSheet.gs`, new):**
- `Assets & Debts` — user input tab, created once with suggested rows and blank
  amounts (investments, chequing balances whose CSV has none, loan balances owed,
  car, gold). Never cleared. Column H is a formula (CAD).
- `Balance Sheet` — rebuilt view: tiles (own / owe / net worth), assets and debts
  lists, by-class donut, net-worth line, loan payments still to come (cash incl.
  interest, explicitly *not* the balance owed). Automatic rows: last statement
  balances (`_Balances`), house construction at cost, money lent (net, if
  positive), card spend since last payment (Dashboard A54:B57), HST owed
  (Dashboard B20). A user row with the same name replaces the automatic one.
- `_NetWorth` (hidden) — one snapshot per day from `planDaily` (`bsSnapshot`).
- Verified: first snapshot reconciles by hand with the automatic rows.

**Gotcha (again):** LET names `a2`, `k2`, `n2`, `x2` are cell references and
`left` is a function name — caught in review before deploy, renamed.

**Open / for next time:**
- User to fill amounts on `Assets & Debts` (8 rows blank) — until then net worth
  is statements + house cost only.
- Still open from 2026-10-17: negative October India spending (a money-in row
  with a spending category), CIBC card payment Payees patterns, sheets-cli re-login.
- Repo is public and some earlier commit messages / `Plan.gs` notes contain pay
  figures — user was told; making the repo private is the clean fix.

Commit: `95f5a1b`.

---

## 2026-10-17 — Failed upload fixed; Overview / Trends / Accounts tabs

**Asked:** an Apps Script email said an upload failed — find and fix it; correct
the pay frequency (it is weekly, not biweekly); make the sheet good to look at.

**Upload failure (4 files, so the whole batch of 7 was held back — all or nothing):**
- `cibc (1).csv` was a CIBC **credit card** (••4181) the script did not know.
  Added `CIBC_CARD` in `Config.gs`, recognised by a new `cell:` rule type — a regex
  one whole spreadsheet cell must match (`PdfText.gs › detectAccount`). Needed
  because the chequing CSV mentions the same card number inside its
  "TO CARD …" transfer text, so a plain `test:` text match would misfile it.
  Read with the existing `parseCibcRows`.
- `cibc (2).csv` was CIBC chequing without the `096.csv` / `680.csv` name
  ending. CIBC CSVs carry no account number, so the rule stays; the error now
  says exactly which rename is needed (`Main.gs › looksLikeCibcChequing`).
- Two HDFC Regalia **billed statements arrived as `.xls`**; only a PDF parser
  existed. Added `Parser.gs › parseHdfcCardRows` (columns found by header text:
  `Date & Time | Description | REWARDS | AMT | Debit / Credit`; `Cr` = credit).
  Verified against the statement's own summary totals. `HDFC_CARD` now accepts xls/xlsx.
- Re-run: renamed the chequing file in Drive, moved all 7 from Outbox › Failed
  back to the Inbox; next poll ingested them. The XLS rows landed on the same
  Transaction IDs as the earlier PDF rows — no duplicates.

**Pay frequency:** the TD download shows one deposit every Friday; an earlier
double deposit had made it look biweekly. One-time upkeep step
`Plan.gs › planPayWeeklyOnce` (property `plan_pay_weekly_v1`) moved the
Commitments row to Weekly / Friday, only if it still held the old seed. Seed updated too.

**Bug found and fixed:** Commitments "Paid this / last month" (cols V, AA)
counted business-income deposits *with* HST while "Due" is *without* HST, so
"still to come in" was understated. Both now divide business income by (1 + HST rate).

**Visualisation (new `Viz.gs`):**
- `Overview` (first tab): 6 tiles, 5 charts (money in vs out by month, where it
  went this month, top 10 categories, day-by-day spending pace vs last month,
  Canada vs India spending), and a per-group table with sparklines.
- `Trends`: every spending category × last 12 months, heatmap + sparkline per row.
- `Accounts`: statements up to, days behind (red past 14), this month in/out,
  last known balance, 6-month spending sparkline.
- Hidden `_Viz` holds the small tables the charts read. All live formulas over `_Calc`.
- Tabs rebuilt when `PLAN.VERSION` changes; charts re-drawn on every refresh so
  their range follows the months on record. A failure there is logged to
  `_Issues` and never stops the Dashboard upkeep.
- Tab order: Overview, Dashboard, Commitments, Transactions, Trends, Accounts,
  Payees, Categories. Transactions got a filter row.

**Gotchas learned (cost two redeploys):**
- `SUMIFS` inside `ARRAYFORMULA` with an *array of criteria* silently uses only
  the first criterion → every month showed the same number. Use `MAP` / `BYROW`.
- A `LET` name like `m0` gives `#ERROR!` (Sheets reads it as a cell reference).
- The Google Drive connector's base64 download of a binary `.xls` came back a few
  bytes short; `xlrd` refused it. Parsing the BIFF records directly worked.

**Open / for next time:**
- October India spending shows negative: a money-in row on an INR account
  carries a spending category — fix it on Payees.
- New CIBC card's payment rows may need Payees patterns so they count as
  "Moved", not income/spending.
- `sheets-cli` OAuth token has expired (Testing-mode app, 7-day refresh tokens);
  re-login needs the user: `sheets-cli auth login --credentials ~/.sheets-cli/credentials.json`.
- Charts were verified by cell values only (no visual check possible from the CLI).

Commits: `befbd6a`, `af78871`, `d760a7d`, `9150a40`.

---

## 2026-09-28 / 29 — Phase 2: Dashboard and Commitments

- `Plan.gs` + `Formulas.gs`: self-updating `Dashboard` (live formulas over a
  hidden `_Calc` tab) and `Commitments` tab (one row per recurring bill /
  income; the user only sets Decision = Keep / Cancel).
- Refresh: after every ingest, first poll of the day, on Commitments edit, and
  on the first poll after a deploy that bumps `PLAN.VERSION`.
- Upload banner, still-to-pay list, HST taken out of money in (rate on the
  Categories tab), house construction kept out of living costs, Friday email
  "due this week", monthly review email (reads fixed Dashboard rows — keep the
  layout stable).

## 2026-09-18 / 19 — Phase 1: automatic ingest

- Parsers for RBC, CIBC, Neo, TD, HDFC savings and card (PDF + CSV/XLS).
- `Pipeline.gs`: 5-minute Inbox poll, batch checks (`Checks.gs` C1–C7), all-or-
  nothing writes, email per processed batch (none for empty polls), Friday upload
  reminder. Deterministic Transaction IDs for dedup.
- GitHub Action deploys `AppScripts/` to Apps Script on every push to `main`.

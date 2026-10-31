# Finance Engine — session handoff (31 Oct 2026)

Read this first when resuming, with `.claude/CLAUDE.md` and `.claude/HISTORY.md`.
**Public repo: no personal figures, payee names or places here.** Those are in the private
Google Doc in the user's Drive, title **"Finance Engine — private handoff (31 Oct 2026)"**
(search Drive for it; the same facts are in the sheet's rows and notes).

## 1. What the user wants
A personal + one-company finance system in one Google Sheet: **what do I do now, where did money
go, will I be OK, what do I own and owe, where can I improve** — fast, folded by meaning, nothing
duplicated, attention first, and it must not "leak". In their words Commitments should give
**financial discipline**: approved payments happen at any cost, unapproved ones are highlighted.

### Standing rules from the user
- **Transactions, Payees, Categories and the upload logic are "rock solid" — do not change them.**
  Page work must never affect ingestion. Only change labels when explicitly asked.
- Every collapsible group is **folded by default**. Attention items go on top. India in ₹, Canada in $, totals in CAD.
- Input tabs are unlocked (yellow); fact tabs are locked (blue; warning-only, an owner can't be hard-locked).
- A tick is never proof: "done" is verified from bank data.
- **Notion keeps only explanations / behaviour; all finance data lives in the sheet.**
- Money only moves along fixed routes (`Config BANKS.fundedFrom`): company → personal chequing → India savings
  (and → the chequing account being closed). All Canadian payments go through the personal chequing, all Indian ones through India savings.
- Commitments = payments the user must make, nothing else. Investments and asset purchases belong on Assets & Debts.
- The user prefers discussion on big design choices, plain language, and honest answers. Don't delete without a backup.

## 2. How it runs
- `.gs` in `AppScripts/`; push to `main` deploys via GitHub Action (`clasp push --force`). Check: `gh run list --limit 1`.
- Rebuild: bump `PLAN.VERSION` in `Plan.gs` (see the file); the 5-minute `pollInbox` trigger does the rest.
- Poll order: (1) upload if files are waiting, return; (2) `planDaily` upkeep (`refreshDashboard`), return if it worked;
  (3) `planPagesOnce` (Now), return if it worked; (4) `vwMaybeRefresh` (pages).
- Upload safety verified: in `runBatch` the dashboard refresh is the **last** step, after rows, file moves and email.
- Pages rebuild: after version change, new day, or any sheet edit (Drive last-updated newer than last build, at most every 10 min).
- `vwRefresh`: `vwTidyInputs` → read → model → render steps by priority `RENDER_ORDER`
  (`today, networth, finish, forecast, habits, money, finish`), 200 s budget, leftovers in property `vw_pending`.
  `finish` = write invested + plans, locks, tab order.

### Access for Claude
- `~/.bun/bin/sheets-cli.exe` (`read range`, `sheets list`); token `~/.sheets-cli/token.json` (spreadsheets, drive.readonly).
- Direct Sheets REST with a refreshed token (Node scripts) for batch writes. These scratch scripts are **not** in the repo.
- Connectors: Google Drive, Gmail, WhatsApp connector (2 extra Gmail accounts, 3 WhatsApp accounts), Notion.
- Claude can't click Run in Apps Script.

## 3. The sheet now
### Visible
| Tab | Type | Purpose |
|---|---|---|
| 🏠 Today | locked (✔ column open) | Banner, 4 tiles, Do-now ticks, each account's next 14 days with every line, cards, 8 health checks, 15–30 days |
| Commitments | yours | Must-pay list, sorted into titled sections, folded |
| 📒 Money | locked | 🔴 Needs you, then month ▸ country ▸ category ▸ sub-category ▸ payment |
| 🔮 Forecast | locked | 12 months + cash at month-end; holiday-aware pay |
| 🏛 Net worth | locked | Own by class ▸ institution ▸ account; owe by bank; invested / gain; loans; business expenses this year |
| Assets & Debts | yours | Balances typed; sections Cash, Investments, Commodities, Real estate, Debts |
| 🧠 Habits | locked (limit column G open) | Planned vs unplanned spending, limits |
| Transactions | raw, warning lock | Do not touch |
| Payees | yours | Labelling rules. Do not change logic |


### Hidden engine (keep)
`Now` (balance roll-forward, money moves; Today and Assets & Debts read it), `Dashboard` (card owed, HST, monthly email),
`Balance Sheet` (totals; Net worth reads it), `Categories` (groups, live FX, HST rate, parents' cash share), `_Calc`, `_NetWorth`, `_Balances`, `_Runs`, `_Issues`.

### Deleted, with a frozen-values backup spreadsheet in Drive
Home, Health, Money map, Overview, Trends, Accounts, To label, `_Peek`, `_Viz`, Month Ahead, old Summary, Sheet4, an unrelated car comparison, Big picture.
Title: "Finance Engine — deleted tabs backup (27 Oct 2026)".

### Commitments columns
A–L input (Name, Match, Amount, Currency, Frequency, Due, Account, Category, Decision, Decided on, Ends, Notes) ·
M–AA formulas, folded except S, T (AA "Paid last month" is read by the Dashboard: **never write there**) ·
AB last paid (date · amount) · AC How it's paid (dropdown) · AD Claude's suggestion ·
AE 📅 When to pay & why (script) · AF–AH card limit, statement close day, target.
- Decision: Keep = approved; Cancel; Later; blank/Review = orange row, counted on Today.
- Lead days by how paid: e-Transfer 2, bill payment 3, Remitly 4, cheque 5, UPI/cash 0, auto-debit 1.
- Cards (category `Creditcard`): ① pay down before statement close so the reported balance stays under the target,
  ② pay statement in full before due date. Planned as `dir: Move` events: on to-do lists, never counted as spending.
- Payments found in WhatsApp/Gmail now go here as rows with a **blank Decision** (the user approves by choosing Keep), with the source in Notes.

### Assets & Debts columns
A Name · B Asset/Debt · C Class · D Currency · E Current value · F Amount invested · G As of · H Notes · I CAD (formula) ·
J Now in CAD (formula: bank → Now, card → Dashboard, house → invested) · K section total · L gain. Letters in `BS.C`.
- F is automatic for the house row (class Real estate: every category with Counts as = House) and gold / jewellery; per-account Wealthsimple is typed from the app.
- A typed balance beats a statement if newer, then rolls forward with later transactions (banks and cards).

### Section rows (Commitments, Assets & Debts)
A row with **blank column A** and its title in B; every reader skips it. `vwTidyInputs` sorts and folds in place after a deploy and at 02:00–05:59. New rows wait at the bottom.

### Key logic in `Views.gs`
- `vwModel`: one event list; `vwSplitIndiaCash` (India ATM cash: first monthly share from Categories = household, rest = house labour; in the pages only);
  `vwCardEvents`; `vwPairTransfers` (±8%, −2…+7 days, swap pass; unmatched after 7 days → Needs you; category "Transfer - untracked account" opts out).
- House is identified by Categories "Counts as = House", so the group name stays only in the sheet.
- Forecast: weekly hourly income loses Ontario statutory holidays (lag 11 days); house spending is never projected, only dated commitment rows; day-to-day = last 2 full months outside recurring categories.
- `_Calc` and Views convert foreign money at the live Categories rate (Google Finance), not the stored Amount CAD.

## 4. State when this was written
See the top entry of HISTORY.md (31 Oct 2026). Pages, sorting and folds verified live.

## 5. Known problems / to check first
1. Fixed 31 Oct: `vwWriteSections` overwrites first and clears only leftover rows below, so a failure cannot erase typed rows.
3. Column J on Assets & Debts: verify Debts rows and the house after rebuilds.
4. Commitment sections sort by group: a transit toll landed under Essentials; a penal charge under Fees. Fine, or re-label.
5. Habits rows: confirm limits survived the rebuilds (`vw_limits`, hidden key column).
6. Today has no ✔ state yet verified end to end: tick one item, confirm 🟡 then ✅.
7. Now's `Comes out of` list and Now column G count upcoming card charges; Today also adds them. Compare totals if a figure looks doubled.
8. `Plan.gs` comments and `PLAN_SEED` still mention old things; repo already holds a pay amount in `Plan.gs` from an earlier session, against the public-repo rule. Ask the user before rewriting history.

## 6. Open work
2. Assets & Debts: user fills Wealthsimple net deposits per account; gold when bought.
3. **Second JioFiber**: the user says there are two; only one exists in any data. Needs amount, due day, how paid.
4. **POP sheeting row**: choose A ₹ balance still owed, B fully paid, or C other (see private doc). Row still shows the full amount as overdue.
5. Orange rows to decide (see Commitments).
6. **Balance emails**: read bank alert emails automatically. Requires a Gmail read scope, so triggers stop until the user does Run → Allow in the editor. The user agreed in principle; wait for "ready" and set alert thresholds first. It gives balances, not transactions.
7. **Notion migration**: finance out of Notion, Finance Guard (scheduled Claude task, 6:20 AM/PM) reads the sheet instead. It still reads Notion and still sends instructions from there, so the two can disagree. Find the scheduled task config; don't delete Notion data without confirmation.
8. **House total cost**: upload pre-August India statements; Amount invested rises automatically. Sources are in the private doc and memory `house-cost-reconciliation`.
9. Buffers and a "safe to spend" figure (the India floor and personal chequing buffer are in the private doc); HST + corporate tax in Forecast (accountant's answer pending); estimate fixes: exclude one-off categories, 3-month average.
10. Monthly email still reads the Dashboard (`A8:F8`, `A12:B19`, `A137:F152` must stay fixed); review content against the new pages.
11. Company card: add when it moves to the business; move business subscriptions to it.

## 7. Gotchas
- Bash heredocs mangle backslashes and quotes in JS: use the Write/Edit tools for regexes; scan `.gs` for control characters after scripted edits. Files are CRLF on disk: normalise before string splicing.
- `setValues` turns "Sep 2026" / "Sat 31 Oct" into dates and a leading `'` doesn't stop it: set format `@` first (`vwTxt` does).
- A `Date` at UTC midnight shows the day before: use local noon.
- `setActiveSheet` un-hides a hidden tab. `copyTo` keeps the hidden flag. Rebuilt pages must re-hide.
- Apps Script timeouts log nothing and leave state half-done: keep work in small steps.
- Adjacent row groups at the same depth merge: keep a header row between them.
- `fxCategoriesTab` rewrites E2:F(rates) each refresh; user cells are lower (HST F8, parents' share F10).
- A column inserted on a typed tab: Sheets shifts existing formulas, but code-written formulas need new letters (`BS.C`).
- Deploy code before deleting tabs, or the old code rebuilds them.
- TD downloads are identical in name: the investor file must end in `2366.csv`; CIBC chequing must end in `096.csv`.
- Background shells may be killed under memory pressure. `sheets list` uses the key `name`, not `title`.
- Never put a formula on an Assets & Debts section row in E that depends on J or K: J1 reads E2:E, so it is circular and shows #REF! here and on Now.

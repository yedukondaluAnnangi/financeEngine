# Finance Engine — work history

A running log of what was built, fixed and learned, newest session first.
Every Claude session appends an entry here before it ends (see `.claude/CLAUDE.md`).

> This repository is **public**. Log the engineering — what changed, why, what
> broke — never personal figures: no income, balances, loan amounts, payee or
> landlord names, account numbers beyond what `Config.gs` already holds.

---


## 31 Oct 2026 — folded totals, then a gap sweep ("least time, most information")
**Asked:** folded rows must show totals; go through the sheet, find what wastes time, fix it.
**Changed:** folded rows on Money, Net worth, Today coming-up, Commitments, Assets & Debts show aggregates. Do now no longer lists bank fees; a missing auto-debit says Check, not Pay; due today is not overdue. Transfer pairing takes one arrival from two accounts. Net worth: an account alone at its bank is indented as its own bank. Assets & Debts owe includes HST so it agrees with Net worth. Forecast starts after HST held and opens with a one-line verdict; Habits too; limits only prompt on unplanned rows; new items show "new" not 0. Tidy keeps day-of-month Due cells numeric.
**Data:** pay row was Biweekly again (bank and its note say weekly): set Weekly, flagged to the user. Due cells had 1900 date formats: script read the wrong day. Investor transfers labelled with a new Payees rule. Ledger, Summary, Expected payments backed up to the deleted-tabs file and deleted; no formula referenced them.
**Bugs:** vwWriteSections cleared before writing (fixed). Invested vs value mixed currencies on the house (fixed).
**Gotcha:** getValues returns a Date for a number with a date format; serial 1 reads as day 31.
**Rebuild stall (found with a temporary trace, since removed):** the sort of Commitments and Assets & Debts hit the 6-minute limit before recording that it ran, so every poll repeated it and the pages never built. It now runs once per deploy, one tab per poll, marked before the work. Pages wait if Now reads no cash. A new deploy or day clears leftover page steps. A formula on an Assets & Debts section row in E was circular (J reads E) and showed #REF!; the script now writes a plain number there.
**Gotcha:** a build takes about five polls after a version bump: upkeep, Now, sort Commitments, sort Assets, pages. Do not read a slow rebuild as a failure before then, and do not bump the version again meanwhile, since that restarts it. A code change that needs no rebuild should not bump it.
**Open:** one parked house row, second JioFiber, orange rows, one unmatched transfer, one unlabelled bill payment, pre-Oct investor statement, whether the electricity auto-debit stopped, balance emails, Notion / Finance Guard.

## 2026-10-30 — Money page, folded input tabs, clean-up; handoff written

**Changed** (`618d6d0`): 📒 Money replaces Ledger + Summary, Commitments and Assets & Debts sorted into titled sections and folded in place, undecided payments become Commitments rows (Expected tab + code removed), unused page builders deleted. Upload code untouched.

**Open:** see `.claude/HANDOFF.md`, the full state and next steps. First: confirm Money finished, then delete Ledger, Summary, Expected payments after backup.

---

## 2026-10-27 — gap audit across tabs, first round of fixes

**Asked:** list every gap between the tabs (44 found: transfers, balances, Commitments
matching, labels, rates, duplicate tabs, forecast blind spots), then fix them; ask only
for one-time facts; make it automatic from now on; can balances be fetched automatically?

**Changed** (`bb96b47`, VERSION 2026-10-27.2):
- **One INR rate.** Categories F = `GOOGLEFINANCE("CURRENCY:INRCAD")` (Config fallback, now
  0.0148). `_Calc` H/L, `planReadTx` (Dashboard) and Views convert foreign rows with it, not
  the ingest-time Amount CAD. Found because a Remitly transfer's INR arrival was ~9% above
  the CAD that left — the old fixed rate was stale. Month Ahead's rate cell now points here.
- **Transfer matching** (`vwPairTransfers`): own-account moves paired out↔in across accounts
  (±8%, −2…+7 days, swap pass for same-day look-alikes). Unmatched after 7 days → Ledger
  Needs-you "↔" and Health #5. Category "Transfer - untracked account" opts a row out.
- **Forecast:** weekly income whose Commitments note says "N h" loses Ontario statutory
  holidays in the week a payday covers (lag 11 days, from the Thanksgiving short pay).
- Balance Sheet + Accounts read bank balances from Now (rolled forward) — no second number.
- Now: the donor account's "Enough" text subtracts what it is asked to send.
- STALE_DAYS = 7 on Formulas / Plan / Pages / Views (one meaning of "up to date").
- Sheet data: two Commitments prices, 3 categories (Car lease, Personal care, Transfer -
  untracked account), 15 Payees rules, 17 rows labelled.

**Gotchas:** a heredoc-fed JS template turned `\b` into a literal backspace character in a
regex — scan `.gs` files for control characters after scripted edits.

**Then (answers from the user, mail and WhatsApp):** `88fc67f` Config TD_INV (business
investor account, file rule `/2366\.csv$/` above TD_BUS — both TD downloads share a name).
Sheet data only: loan EMI amounts/match corrected, a bounced EMI and a bounced lease debit
marked "Reversal pair" so the bounce shows as unpaid, lease added (Biweekly, first date sets
the cycle), the car-insurance row merged into the monthly family-support row (one transfer
covers both — two rows matched the same payment), Expected rows rejected / updated, Payees
rule for the loan's PhonePe merchant id (amount-free), domain purchases → Business - software.
**Gotcha:** the Bash tool strips `\` from heredoc JS even in quoted heredocs — write regexes
without backslashes (`[0-9]`) in scripted sheet edits, or use the Edit tool.

**Later still:** `bb0a053` an open house budget (one-off, Decision Later, house category) is
listed under the Forecast and removes house spending from the day-to-day estimate.
`0e87beb` Commitments AA "How it's paid" (dropdown, PLAN.HOW) + AB "Claude's suggestion",
formula columns M–R / U–Z folded (`planHowColumns`, idempotent via getColumnGroupDepth);
Home skips Auto-debit / Card / Direct deposit / Bank fee unless overdue; one tab order in
`vwArrangeTabs`, old tabs hidden once (`vw_hidden_v1`). **Gotcha:** `setActiveSheet` on a
hidden tab un-hides it — the old `vzArrange` would have undone any hiding.

**Locks** (`c14be67`): `vwProtectAll` — warning-only protections (an owner can never be hard-locked), fact tabs whole-sheet with input columns left open (Home A, Habits G), input tabs only on formula/Claude columns; tab colours blue / yellow / grey. Card balances typed on Assets & Debts roll forward as owed (`5ec7b0a`, Dashboard B54). Proposed next: 4 read tabs (Today = Home+Now+Money map+Health, Money = Ledger+Summary, Future = Forecast+Big picture+Balance Sheet, Habits) + 3 input tabs.

**🏠 Today** (`c4ec888`, `6261fdf`): one page = banner + 4 tiles + Do-now ticks (shared with Home via key column H) + each account's 14 days with every line (moves, payments + how paid, HST, card bills folded to card charges) + cards + health + 15–30 days. Renderer gained merges/heights. **Bugs:** (1) Commitments AA is a formula column (`Paid last month`, read by the Dashboard) — the How column had been put there; moved to AC/AD (`PLAN.HOW_COL` 29), sheet widened to 30 cols. (2) Seven pages + locks passed the 6-minute limit silently (stopped mid-locks, tab order never ran, retried every poll) — now rendered by priority within `VW.TIME_BUDGET_MS`, remainder in `vw_pending`. (3) "TD" matched both TD accounts — shortest matching name wins; Commitments TD rows set to the full name (Now uses SEARCH).

**Clean-up** (`<this>`): routes TD → RBC → HDFC (`Config BANKS.fundedFrom`, Now hidden L/M = CAD to receive + by when; `5af3362`). 13 replaced/unrelated tabs deleted after a frozen-values backup spreadsheet was made (backup ID kept in the user's Drive, not here); builders for Overview/Trends/Accounts/To label/_Peek/_Viz/Money map/Home/Health no longer called (`vzInstall`, `pgInstall`, RENDER_ORDER), and a missing Overview no longer forces a full Dashboard rebuild. Kept hidden: Now, Balance Sheet, Categories, Dashboard, _Calc, _Balances, _Runs, _Issues, _NetWorth. **Gotcha:** sheets copied with copyTo keep their hidden flag — a backup file of only hidden tabs cannot delete its placeholder sheet.

**Commitments = the plan** (`3e5401c`, 29 Oct): AB last paid (date · amount, one ARRAYFORMULA; AB had stale text from the first How attempt — cleared before the formula can spill), AE "📅 when to pay & why" written by the Views finish step only when changed (send-by from how it is paid: e-Transfer 2 d, bill payment 3, Remitly 4; auto-debits name the account to fund + covered/short from Today's math), cards as Commitments rows (category Creditcard, AF limit, AG close day, AH target): pay-down before the close (reported balance ≤ target) + statement before the due date, both as planned dir-Move events (never counted as spending; card bills already are), unapproved (Decision blank/Review) rows orange + counted on Today. Card facts migrated from the Notion Credit Cards DB. User decision: Notion keeps only explanations; finance data lives in the sheet.

**Assets & Debts redesign** (`c3e6da2`, `52d06cb`, `4a14a3e`): F "Amount invested" after E "Current value" (As of/Notes/CAD → G/H/I; every reader uses `BS.C`). Invested is summed by the script for the house (every category whose Counts as is House — never a group name, so the group can carry its real name in the sheet only) and for a single Wealthsimple row; per-account Wealthsimple is typed. India ATM cash: the first share a month (Categories "Parents' cash per month") is the parents' household, the rest house labour — split in the Views model only, Transactions untouched; the Balance Sheet values the house at Amount invested. New 🏛 Net worth page: assets by class › institution › account, debts by bank, value / invested / gain. Commitments holds payments only (savings, planned purchases and the house budget removed; budget kept as a note). **Gotcha:** the split must edit `m.ev` in place — vwModel keeps pushing to the same array after it.

**Open:** user answers pending (second TD account, PhonePe = Kotak?, car-insurance match,
lease, home insurance, decisions, loan balances, HST schedule, house budget, old tabs,
Notion, Gmail balance reading needs a new OAuth scope → one manual re-authorisation).

---

## 2026-10-26 — demo sheets, then the attention-first pages in the real sheet

**Asked:** one place to see everything (high level → detail), folded, attention first;
"done" must be verified by the bank; Transactions raw; India in ₹ with CAD totals;
actual vs planned months clearly marked; planned vs unplanned spending to change habits.
Two demo spreadsheets were built first (scratchpad scripts, REST API, static snapshot),
the user approved demo v2 ("build it").

**Built** `AppScripts/Views.gs` (`3282ed0`, VERSION 2026-10-26.1): six script-written pages,
placed first — 🏠 Home, 📒 Ledger, 🗂 Summary, 🧠 Habits, 🔮 Forecast, 🩺 Health.
- Folding groups need a fixed row count, so these are **values, not formulas**, rebuilt by
  `vwMaybeRefresh` on a poll where `planDaily` did nothing (it now returns true when it
  worked): on a new day/version, or when Drive's `getLastUpdated()` of the sheet is newer
  than the last build (any edit → rebuild within ~10 min). Menu: Finance › Refresh Home….
- Each page is built on a fresh tab "<name> (building)" and swapped in, so old groups and
  formats never linger; formats go in as whole 2-D arrays (one call per property).
- One event model (`vwModel`): Transactions (past), Commitments due dates via
  `planDueDates` starting after what Commitments already shows paid, overdue / ❔ / ⚠ rows
  from Commitments' Status, Expected payments (💡 undecided, approved = planned), money
  moves parsed from the Now tab's "⚠ Short … move about $X from … by …" text.
- Home ticks: key per to-do (`cm|name|date`, `mv|account`, `ex|…`, `st|upload`) in a hidden
  column; read back on the next build into script property `vw_ticks`. A ticked item that
  no longer appears as due → "✅ Verified" (kept 7 days); still due after 3 days → ⚠.
  Habits limits persist the same way (`vw_limits`, hidden key column).
- Summary / Forecast estimate day-to-day spending per country as the last two full months
  outside recurring (non one-off) Commitments categories.
- Transactions gets a warning-only protection.

**Gotchas:** a `Date` at UTC midnight written to a Toronto sheet shows the day before — use
local noon. `setValues` turns "Sep 2026" / "Sat 31 Oct" into a date, and
a leading `'` does NOT stop it from Apps Script — set the cell's number format to `@`
*before* `setValues` (`44d0439`). A regex char class
`[=+\-@]` lost its backslash through heredoc + template literal and became the range `+-@`
(digits included) — put `-` last. Recursion trap: Health ↔ Home to-do both needed the
stale-account list → memoised `vwStale`. CRLF files: Node string splicing fails silently
to match; use the Edit tool.

**Open:** Notion finance migration (step 6 of the agreed plan); Cash log / To collect /
House project lists; transfer pairing check (Health #5 placeholder replaced by
"payments found in messages"); buffers + tax reserve % for a "safe to spend" figure;
old tabs still visible (user to decide hide/delete); unlabelled rows; the car-lease
payment is not on Commitments yet.

---

## 2026-10-25 (evening) — parked items, Expected payments tab, business grouping

**Asked:** park two items until savings are planned; a monthly family-support
payment; a tab Claude fills from WhatsApp / Gmail with payments the user promised,
approved by the user before they count; group personal subscriptions apart from
business costs for the tax return; why the Now tab seemed to ask for rent today.

**Changed:**
- `09c12ff` **Later** decision (PLAN.DECISIONS): status "⏸ Parked for later"; treated
  like Cancel for every money total (U, Y, Dashboard plan, Now list, Viz, Plan.gs JS)
  but not counted as a saving and not "waiting for a decision".
- `8ad1a14` **Expected.gs** — input tab "Expected payments": Stage (Claude: Suggested /
  Expected), Your decision (user: Approve / Reject), CAD + Status formulas. Status turns
  "💸 Paid" when a matching outflow (±3%) appears on/after Found on. Approved, unpaid rows
  join the Now list and money moves (third VSTACK set; owner/currency lambdas shared).
- `0bdb3d3` group "Subscriptions" → "Personal subscriptions"; `/^business($|s*-)/`
  → Business costs, so "Business - software / bank fees / advertising / registration &
  licences" all count. Big picture §8: this year's business expenses by category + total.
  Sheet data (sheets-cli, not code): Payees default categories, 22 Transactions rows,
  Commitments H, Categories rows.
- `1e13154` Now: "move by" date = next payment still ahead (an overdue one made it today).
- Sheet data: family-support row made monthly with an outgoing-only Match (incoming
  repayments from the same person would otherwise mark it paid); her incoming pattern
  narrowed on Payees, outgoing gets its own pattern → Household.

**Gotchas:** sheets-cli from Bash takes JSON `--values` fine; PowerShell 5.1 splits a
quoted argument containing spaces (`too many arguments`). Node `spawnSync` with an args
array is the reliable way to send many writes. Heredoc + JS template turns `\s` into
`s` — check regexes after scripted edits.

**Later that night:** Money map tab (`f40de8a`, Pages.gs `pgMapTab` / `pgMapChart`): org chart
from a formula node list (A:B hidden) — all accounts → each account (now → after 14 days) →
coming in, payments grouped by Kind (new 9th column on the Now list = category group), card
bills, HST, "⬅ move …". **Bug:** the version rebuild passed Apps Script's 6-minute limit and
stopped after the Now tab — no error is logged for a timeout, and `plan_day` is stamped first,
so it does not retry. Fix `7aab36a`: `planPagesOnce` builds Expected / Now / Big picture /
Money map on the *next* poll (own stamp `pg_day`, own `pg_version`). **Gotcha:** JS
`String.replace` treats `$'` in the replacement as "text after the match" — splice code
with slice/indexOf or a replacer function.

**Then:** Money map rebuilt as colour-coded cells, one card per account (`561cc51`, `6b2f721`,
fix `13bc831`): org charts allow one box colour only. Balances now **roll forward**
(`33c566d`): newest of statement / typed balance + every transaction after its date, so RBC
and CIBC (CSV has no balance) need a balance typed once. RBC seeded from the bank's
low-balance alert email (-55.45, dated the day before the 3 AM alert). Found: GM Financial
car-lease payment bounced NSF on Oct 22 — not on Commitments yet (asked user).
**Gotcha:** `"x "&INDEX(q,,1)` inside LET without ARRAYFORMULA keeps only the first row.

**Open:** first WhatsApp/Gmail scan done (6 rows, user to Approve/Reject); Neo card balance is understated (only spend since last payment is known); a TD "card / overdraft charge"
is still personal Bank fees (pattern shared across accounts); RBC/CIBC balances.

---

## 2026-10-25 (later) — Now and Big picture pages

**Asked:** what to pay, how much cash is on hand, which transfers to make and
from which account — and one page for short-term things, one for long-term.

**Built** `AppScripts/Pages.gs` (`d9970eb`, fix `43db08b`, VERSION 2026-10-25.3), two
formula pages placed first in the tab order (old tabs kept visible — user's choice):
- **Now**: per bank account balance (newest of `_Balances` and Assets & Debts), + income
  due in 14 days, − payments due in 14 days, − card bills (cards counted on the account
  that pays them), − HST to keep (on the `holdsHst` account) = spare, and a "move X from
  <account with most spare> by <date>" line when short. Then cards, the 30-day payment list
  grouped by paying account (overdue first, card-charged items show the card), paid this
  month, statements older than 7 days.
- **Big picture**: net worth tiles (Balance Sheet), loans (Commitments H = Loan; balance
  owed from Assets & Debts), last 6 months, group pivot (Dashboard copy), house totals by
  category, HST, savings summary.
- `Config.gs`: cards gain `payFrom`, TD gains `holdsHst`.
- Hooked into `planInstallFormulas` (fresh branch, own try/catch) and `vzArrange`.

**Gotchas:** a header cell starting with "=" (e.g. "= Spare") is read as a formula →
#NAME?. Local check: `$TMP/mock.js`-style vm run with a Proxy sheet mock that records
setFormula and checks paren balance — caught nothing here but cheap.

**Open:** RBC and CIBC balances must be typed on Assets & Debts for the Now tab to judge
those accounts; loan balances owed likewise. ATM cash in India inflates "small habits".

---

## 2026-10-25 — price changes on a bill were silent

**Asked:** a subscription dropped to a cheaper plan; why did the sheet not notice?

**Why:** Commitments matches a payment by text (Match column), so a cheaper charge
still counts as ✅ Paid. Amount is never updated from the data, and the only
amount check (`PLAN.PRICE_UP`) flagged rises, not drops, and only in the
Dashboard due list, not on the Commitments tab.

**Changed** (`0abc654`, VERSION 2026-10-25.1):
- Commitments Status (col T, `Formulas.gs`): an outgoing row that is paid but whose
  Last amount (Q) is more than 5% (min 1) away from Amount (C) now reads
  `✅ Paid <date> · ⚠ now X, Amount says Y`. Income rows are excluded (pay varies).
- `planAnalyse` sets `due.down` for drops; `planDueStatus` shows "less than listed".
- Updated the subscription's Amount on the sheet by hand (sheets-cli).

**Expect** the new flag also on: Google Workspace, TD plan fee, Manvi (partial) —
each needs its Amount confirmed by the user.

Also marked a cancelled subscription on Commitments (Decision = Cancel, Decided on =
today) — sheet data only, no code. Gotcha: PowerShell 5.1 strips the inner quotes of a
native argument, so sheets-cli `--values` text needs `\"`: `'[[\"a\",\"b\"]]'`.

---

## 2026-10-24 — sheets-cli logged in again; walked through every tab

**Asked:** can Claude reach the sheet; then explain each tab, where to see what
is due now / paid this month / coming later, and the current and future picture.

**Changed:** no code. The sheets-cli token had expired; the owner ran
`auth login` (the command needs the leading `&` in PowerShell and the
`--credentials` path). Reads work again. Explained the tabs from live reads:
Overview / Dashboard / Commitments / Month Ahead / Balance Sheet / Accounts.

**Seen:** most accounts' statements end 16 Oct (Neo 2 Oct, HDFC Regalia 12 Sep,
CIBC ••680 9 Sep), so many bills show "Can't tell" rather than paid. `Sheet4`
is empty; `CarInsurance` and `Summary` are old hand-made tabs the engine does
not build.

**Upload later that day:** 6 files; one CIBC chequing CSV was named `cibc.csv`
and would have failed the whole batch (chequing needs a name ending `096.csv`).
Renamed it in Drive before the poll; all 6 loaded. The Neo CSV route (unbilled
transactions) worked as designed. HDFC Savings XLS dated the 25th still ended
on the 16th (0 new rows).

**Quiet accounts (`ae2c1c7`):** `CFG.BANKS[key].quiet` (CIBC ••680, no
activity). `fxQuietAccounts()` builds a `{"name"}` literal; the Dashboard A3
banner and the Accounts status leave quiet accounts out, the weekly reminder
skips them. Accounts red rule now keys on the Status text (`⚠`), not days.
Verified live: banner "✅ Every account is up to date", ••680 shows 💤.

**Gotchas:**
- The W1 "Gap: no … data between" warning compares transaction dates, not the
  statement period, so a week without card use reads as a gap (HDFC Regalia
  13–19 Sep was one). Harmless; could use the statement period one day.
- TD exports every account as `accountactivity*.csv`; a second TD account
  (transfers into chequing) would be read as TD Business and fail C7, holding
  the batch. Moved that file out of the Inbox to the Bankstatements folder.

**Habits are not bills (`c117c5e`):** the recurring-charge detector in
`planAnalyse` had added cafés and convenience stores (charged in 2 months) as
Commitments rows. It now skips groups in `PLAN_NOT_BILLS` (Lifestyle added);
`planDropHabitRowsOnce` removed the 5 undecided "Found automatically" rows.
Verified live: they are gone, the Spay utility row stays.

**Explained (no change):** HST is deposit × 13/113, the same as pay × 13%;
Dashboard row 20 is the amount to keep aside. HDFC Savings "Can't tell"
items: home loan EMI bounced 5 Oct and was debited 14 Oct as "HL … DEBIT"
at a higher amount; Kotak goes through PhonePe with no name; electricity
via Bharat Connect; India rent paid as a double amount by NEFT. Match fixes
wait on the owner's answers.

**Open:** owner to confirm the four HDFC Savings payments, then update their
Match / Amount on Commitments; optional "Tax to keep aside" box; HDFC Savings
still ends 16 Oct; second TD account not tracked; set Account on the car insurance
row; decide whether to delete Sheet4 / CarInsurance / Summary; Month Ahead's
recurring list is missing car insurance, India rent and Wealthsimple.

---

## 2026-10-18 (later) — Labelling clean-up; payments behind each Overview tile

**Asked:** what "Not labelled yet" means; then: show the payments behind each
Overview number (living costs, still to pay, house), how much is in the
accounts, how money should be spent and how it was spent.

**Labelling:** 96 transactions had no category (own transfers and Remitly
arrivals were mixed into living costs — the cause of October's negative India
spending). New `To label` tab lists them. One-time upkeep steps in `Plan.gs`:
`planPayeesV2Once` (31 clear-cut Payees rows), `planPayeesV3Once` (owner's
answers: TD "SEND E-TFR" = owner draw, India UPI builders = construction,
Swapna UPI credits = CAD→INR exchange, Mills Motors = new category
"Car purchase" → Saved / invested), `planFillCategoriesOnce` (UPI rows get a
payee name at ingest with category "Unknown - check", which `relabelAll`
skips). 96 → 9 left (PhonePe ×3, Jade Institutes, ST399, Shelbys, Muthoot
interest ×2, a TD mobile deposit).

**Overview details (`Viz.gs › vzOverviewDetails`, rows 72–131):** plan vs so far,
cash and bank balances, still to pay this month (each bill), money in (each
deposit), living costs by payee (top 25), house payments this month + total
so far. Tile row 8 links jump to each list.

**Bugs this session:**
- Pushed a JS syntax error once (unescaped quotes in a QUERY string); a
  `node … | head` pipeline hid node's failure. Use `set -o pipefail` before
  chaining a test and a push. Live ~1 minute.
- `applyRowBanding` refused an overlap on the real sheet that a clean mock did
  not reproduce; `thBand` now removes any banding already on the range first and
  names the tab/range in its error.

**Verification trick:** hidden `_Peek` tab — row 1 the unlabelled groups, row 2
the first rows of each Overview detail list, row 3 the newest `_Issues` note in
80-char pieces. The Drive connector only samples the first rows of each tab.

**Open:** the 9 unlabelled rows; Assets & Debts amounts; sheets-cli re-login.

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

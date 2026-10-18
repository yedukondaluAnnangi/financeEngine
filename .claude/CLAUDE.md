# Finance Engine — instructions for every Claude session

## Start of session
1. Read `.claude/HISTORY.md` — what was built, what broke, what is still open.
   Pick up the **Open / for next time** items of the latest entry when relevant.
2. `git log --oneline -15` for anything committed since.

## End of session (always, before your final reply)
1. Add a new entry at the **top** of `.claude/HISTORY.md` (below the header):
   date, what was asked, what changed and why, bugs found, gotchas learned,
   open items, commit hashes.
2. Commit it with the work (or on its own) and **push to `main`**.

## Hard rules
- **This repo is public.** Never write personal financial data into the repo or
  commit messages: no income, balances, loan amounts, payee / landlord names,
  account numbers beyond what `AppScripts/Config.gs` already holds.
- A push to `main` that touches `AppScripts/` **deploys to Apps Script**
  automatically (GitHub Action, `clasp push --force`). Check with `gh run list --limit 1`.
- Claude cannot click Run in the Apps Script editor. To make the sheet rebuild,
  bump `PLAN.VERSION` in `Plan.gs`; the next 5-minute Inbox poll runs the upkeep.
- Keep the **Dashboard row layout** fixed: the monthly email reads
  `A8:F8`, `A12:B19`, `A137:F152`.
- Ingest is all-or-nothing per upload; failed batches land in Outbox › Failed ›
  `<timestamp>`. To retry, move the files back to the Inbox.

## How to check the result without the user
- Google Drive connector `read_file_content` on the sheet shows sample rows of
  every tab, including hidden `_Viz`, `_Calc`, `_Runs`, `_Issues`.
- Gmail connector: search `subject:"Finance Engine" newer_than:1d` for the batch email.
- Parsers can be tested locally: load the `.gs` files into Node's `vm` with a
  stub `Utilities.parseCsv` and call `parseRows(rows, fileName)`.

## Sheets formula gotchas (learned the hard way)
- `SUMIFS` with an array of criteria inside `ARRAYFORMULA` only uses the first
  one — use `MAP` / `BYROW` / `MAKEARRAY`.
- `LET` / `LAMBDA` names that look like cell references (`m0`, `a1`) → `#ERROR!`.

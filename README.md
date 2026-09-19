# financeEngine

Engine to convert everything from a bank statement to a Google Sheet.

[![Deploy to Apps Script](https://github.com/yedukondaluAnnangi/financeEngine/actions/workflows/deploy-apps-script.yml/badge.svg)](https://github.com/yedukondaluAnnangi/financeEngine/actions/workflows/deploy-apps-script.yml)
[![Validate](https://github.com/yedukondaluAnnangi/financeEngine/actions/workflows/validate.yml/badge.svg)](https://github.com/yedukondaluAnnangi/financeEngine/actions/workflows/validate.yml)

Drop statements into a Drive folder; the script parses them, converts INR to CAD,
labels payees, and appends rows to a spreadsheet — with an audit log and an
issues tab so a bad parse is visible rather than silent.

## Layout

| Path | What it holds |
|---|---|
| `AppScripts/Config.gs` | every knob: sheet and folder IDs, tabs, column order, account fingerprints |
| `AppScripts/Main.gs` | the entry points you actually run |
| `AppScripts/Parser.gs` | statement parsers |
| `AppScripts/PdfText.gs` | PDF and spreadsheet text extraction via Drive + Docs |
| `AppScripts/Ledger.gs` | dedup IDs, payee and category labelling, reversal flags |
| `AppScripts/appsscript.json` | manifest: runtime, time zone, scopes, Drive service |
| `.clasp.json` | binds the repo to the Apps Script project |
| `.github/workflows/` | validate on PRs, deploy on `main` |

## Entry points

Run these from the Apps Script editor, or let the Friday trigger do it.

| Function | Does |
|---|---|
| `ingestInbox()` | read every new statement in the inbox folder |
| `relabelAll()` | re-label past rows after adding patterns |
| `testOneFile()` | parse one file and log the result, writing nothing |
| `listTabs()` | print every tab name, brackets included, to catch stray spaces |
| `setUpSheets()` | create the housekeeping tabs |
| `installTrigger()` | run `ingestInbox` every Friday evening |

Set `CFG.DRY_RUN = true` in `Config.gs` to parse and report without writing.

## Deploying

Pushes to `main` that touch `AppScripts/` deploy themselves. Setup — one secret,
one variable, one Google account toggle — is in **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)**.

```bash
git clone https://github.com/yedukondaluAnnangi/financeEngine.git
cd financeEngine
npm install -g @google/clasp@3.4.1
clasp login
clasp status     # shows exactly what a deploy would push
```

Changes made in the Apps Script editor are overwritten by the next deploy. Run
`clasp pull` and commit before pushing anything else.

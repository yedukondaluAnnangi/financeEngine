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

## How it runs

Upload statements to Drive › Bankstatements › **Inbox**. Every 5 minutes `pollInbox`
checks it; once nothing new has landed for 2 minutes the upload is one batch:

1. moved to **Outbox › Staging**, every file parsed and checked (`Checks.gs`):
   account recognised, format allowed, rows valid, no future dates, the file's own
   balance chain, continuity with the last recorded balance (`_Balances`), and no
   clash with rows already in the sheet;
2. all pass → one write, files to **Outbox › Processed**, summary email;
   any fail → **nothing** written, files to **Outbox › Failed**, email with the reasons.

An empty Inbox sends nothing. Fridays at 6 AM a reminder lists each bank's login
link and the dates still missing from the sheet.

## Entry points

| Function | Does |
|---|---|
| `installTriggers()` | once: the 5-minute poll + Friday reminder |
| `processInboxNow()` | run the pipeline on the Inbox immediately |
| `dryRunInbox()` | check the Inbox and email the result, writing and moving nothing |
| `sendUploadReminder()` | send the reminder email now |
| `relabelEverything()` | re-apply the Payees tab to every row |
| `testOneFile()` | parse one file and log the result, writing nothing |
| `listTabs()` | print every tab name, brackets included, to catch stray spaces |

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

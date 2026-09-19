# Deployment

Every push to `main` that touches `AppScripts/` pushes the code into the Apps
Script project, cuts an immutable version, and repoints the deployment at it.

Target project: [`1jM9c2w…RamhLcd`](https://script.google.com/d/1jM9c2w_cCdCMTPfKakHOEkM2vB0SE17QAsNVHITAIVP9tCrceRamhLcd/edit)

```
push to main ──▶ validate ──▶ clasp push --force ──▶ clasp create-version ──▶ update-deployment
  (AppScripts/)   node --check   code into the         immutable snapshot      deployment now
                  on every .gs   project                for rollback           serves that version
```

## One-time setup

Three things, in this order. Nothing works until all three are done.

### 1. Turn on the Apps Script API for your Google account

Open <https://script.google.com/home/usersettings> and switch **Google Apps
Script API** to **on**. This is per-account, not per-project, and it is the
single most common reason a first run fails with `User has not enabled the Apps
Script API`.

### 2. Generate credentials and store them as a secret

On your own machine, where a browser can open:

```bash
npm install -g @google/clasp@3.4.1
clasp login
```

Sign in as the account that owns the script. That writes a token file:

| OS | Path |
|---|---|
| macOS / Linux | `~/.clasprc.json` |
| Windows | `%USERPROFILE%\.clasprc.json` |

Copy the **entire** file — outer braces included — into a repository secret
named `CLASPRC_JSON`:

**Settings → Secrets and variables → Actions → Secrets → New repository secret**

It looks roughly like this (values elided):

```json
{
  "tokens": {
    "default": {
      "type": "authorized_user",
      "client_id": "…apps.googleusercontent.com",
      "client_secret": "…",
      "refresh_token": "1//…",
      "access_token": "ya29.…",
      "expiry_date": 1789000000000
    }
  }
}
```

The `refresh_token` is what keeps CI working; the short-lived `access_token`
is refreshed on every run.

> This token can read and write your Drive. Keep it in the secret, never in a
> commit — `.gitignore` already excludes `.clasprc.json`.

### 3. First run, then pin the deployment ID

Push to `main` (or use **Actions → Deploy to Apps Script → Run workflow**). With
no deployment ID configured, the job creates one and prints it. Copy that ID into
a repository **variable** named `APPS_SCRIPT_DEPLOYMENT_ID`:

**Settings → Secrets and variables → Actions → Variables → New repository variable**

From then on each run updates that same deployment instead of piling up new ones.

## What is configured where

| Name | Kind | Required | Purpose |
|---|---|---|---|
| `CLASPRC_JSON` | secret | yes | OAuth token from `clasp login` |
| `APPS_SCRIPT_DEPLOYMENT_ID` | variable | after run 1 | which deployment to update |
| `scriptId` | `.clasp.json` | yes | the target project |
| `rootDir` | `.clasp.json` | yes | `AppScripts` — only this folder is pushed |

## Running it by hand

**Actions → Deploy to Apps Script → Run workflow** takes two inputs:

- **description** — labels the version and deployment.
- **push_only** — pushes code and skips the version and deployment. Useful while
  iterating, since it does not burn version numbers.

## The manifest

`AppScripts/appsscript.json` is part of the deploy, and `clasp push --force`
**overwrites the manifest already in the project**. It declares:

- `runtimeVersion: V8` and `timeZone: America/Toronto`
- the **Drive advanced service** (v3) — `PdfText.gs` calls `Drive.Files` directly
  to convert PDFs via Docs, and the script throws a clear error without it
- OAuth scopes for Sheets, Drive, Docs, and script triggers

If someone changes settings in the editor — adds a service, changes the time
zone — those changes are lost on the next deploy unless they are also committed
here. Pull them back down first:

```bash
clasp pull          # then commit the manifest diff
```

## Rolling back

Versions are immutable, so a rollback is just repointing the deployment:

```bash
clasp list-versions
clasp update-deployment "$APPS_SCRIPT_DEPLOYMENT_ID" --versionNumber 7 --description "rollback to 7"
```

## When a run fails

| Message | Cause |
|---|---|
| `User has not enabled the Apps Script API` | step 1 above was skipped |
| `invalid_grant` / `Could not read API credentials` | the secret is stale — run `clasp login` again and replace `CLASPRC_JSON` |
| `Request contains an invalid argument` on deploy | the deployment ID in the variable no longer exists; clear the variable and let the run create a fresh one |
| `Project contents must include a manifest` | `AppScripts/appsscript.json` is missing or was ignored |
| `Syntax error` in Validate | a `.gs` file does not parse; the deploy never ran |

## Working locally

```bash
clasp status            # exactly which files a push would send
clasp push              # push without forcing the manifest
clasp pull              # bring editor-side changes back into the repo
clasp open-script       # open the project in the browser
```

`clasp` reads `.clasp.json` from the repo root, so run these from there, not
from inside `AppScripts/`.

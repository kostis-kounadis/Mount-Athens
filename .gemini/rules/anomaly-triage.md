# Anomaly Triage & Self-Healing Scraper Guidelines for AI Agents

Whenever working on or triaging scrapers in **Mount Athens**, AI agents (including Antigravity Remote Agents executing in cloud VMs or local agents via Remote Control) MUST follow this structured diagnostic and repair protocol.

---

## 1. System Architecture & Pipeline Context

The project is an Astro static site that aggregates upcoming excursions from Athenian alpine clubs without a database.
The data pipeline runs sequentially:
1. `_input/link-config.json`: Club URLs and source endpoints.
2. `scripts/fetch-raw.js`: Crawls live web pages / APIs into `_input/*.html` and records SHA-256 hashes (`src/data/content-hashes.json`).
3. `scripts/extract-text.js`: Converts HTML to plain text files in `_input/*.txt`.
4. `scripts/parse-events.js`: High-precision regex, Cheerio DOM selectors, and WordPress REST API parsers producing `src/data/events.json`.
5. `scripts/detect-anomalies.js`: Compares results against `src/data/health-baseline.json`. If a club drops drastically or yields 0 events after a content change, it creates `src/data/anomaly_report.md` which GitHub Actions posts as an issue.
6. `src/data/health-baseline.json`: Persistent baseline of healthy events per club. When an anomaly occurs, that club's baseline is frozen at the last known healthy state so bad data does not become the new normal.

---

## 2. Step-by-Step Triage & Self-Healing Protocol

When invoked to fix a scraping anomaly:

### Step 1: Diagnose Root Cause
* Read `src/data/anomaly_report.md` (or the referenced GitHub Issue) to determine the affected club(s).
* Check `src/data/status.json` and `_input/fetch-status.json` to verify HTTP fetch status:
  - Did the club block requests (HTTP 403, Cloudflare bot challenge)?
  - Did the URL change or redirect (HTTP 404, 301)?
  - Did the page structure change (HTTP 200, but parser extracted 0 events)?
* Check `_input/<club_slug>.html` or `_input/<club_slug>.txt` to observe recent layout changes.

### Step 2: Re-fetch or Isolate Payloads
* Run `npm run fetch-raw` (or inspect existing `_input/` files) to obtain the latest raw HTML/JSON.
* Compare the new HTML structure with what the club's function in `scripts/parse-events.js` expects.

### Step 3: Implement Targeted Fixes in `scripts/parse-events.js`
* Locate the club's dedicated parser:
  - **ΑΟΣ**: `parseAos()`
  - **ΕΟΣ Αθηνών**: `parseEosAthinon()` & `parseEosAthinonExoterikoy()`
  - **ΕΟΣ Αχαρνών**: `parseEosAcharnon()`
  - **ΕΟΣ Ηλιούπολης**: `parseEosh()`
  - **ΕΠΟΣ Φυλής**: `parseEposFilis()`
  - **ΠΟΑ**: `parsePoa()`
  - **ΦΟΝΙ**: `parseFoni()`
  - **ΦΟΠ**: `parseFop()`
* **Scraper Invariants (Do Not Break):**
  - **Greek Accent Insensitivity**: Always use `normalizeGreek()` for matching titles, keywords, and months.
  - **Difficulty Extraction (`Β.Δ.`)**: Extract and normalize difficulty when available using `normalizeDifficulty()`.
  - **School Course Filtering**: Exclude training courses (`Σχολή` / `Σχολές` via `isSchoolTitle`) while preserving trips open to graduates (`Απόφοιτοι`).
  - **Date Normalization**: Ensure start and end dates follow `YYYY-MM-DD` and correctly resolve cross-month, cross-year, or Greek holiday patterns.
  - **Isolation**: Keep modifications localized to the failing club; never introduce brittle global regexes that risk regressing other clubs.

### Step 4: Verification Gate (Mandatory)
Before committing, you MUST run:
```bash
# 1. Re-parse and check anomalies
npm run scrape:parse

# 2. Run standalone anomaly detector
npm run test:anomalies
```
Confirm:
1. The target club's status returns to `✅ Healthy`.
2. Total upcoming events align with or exceed `health-baseline.json`.
3. `src/data/anomaly_report.md` is automatically removed by the script (indicating 0 critical alerts).
4. No other club suffered an unintended regression.

Then verify static site compilation:
```bash
npm run build
```
The build MUST finish with 0 errors.

### Step 5: Git & Pull Request Hygiene
* Create a dedicated fix branch: `fix/scraper-<club-slug>` (e.g., `fix/scraper-aos`).
* Update `CHANGELOG.md` under `[Unreleased]` -> `Fixed` detailing the fix (e.g. `Fixed ΑΟΣ calendar parser after website table layout redesign`).
* Commit changes with a descriptive message following Conventional Commits (e.g., `fix(aos): update excursion card Cheerio selector`).
* If working as a Remote Agent, open a GitHub Pull Request targeting `main` referencing the anomaly issue (e.g. `Resolves #42`). Include before/after event counts in the PR summary.

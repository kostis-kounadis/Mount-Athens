# Anomaly Triage & Self-Healing Scraper Guidelines for AI Agents

Whenever triaging or repairing scrapers in **Mount Athens (Ορειβατικό Ημερολόγιο)**, AI agents—especially **Antigravity Remote Agents** running in isolated Google Cloud VMs while the maintainer's Mac is closed—MUST follow this protocol.

---

## 1. Cloud Sandbox Environment & Pipeline Context

Because Remote Agents boot from a fresh `git clone` of `main`:
* `node_modules/` and `_input/` (gitignored) **do not exist initially** on the VM.
* `src/data/anomaly_report.md` is generated in CI to open the GitHub Issue and **is not committed to Git**; the anomaly details are provided in the prompt or reproduced by running the scraper.

The data pipeline runs sequentially via `npm run scrape`:
1. `LINKS.md` $\to$ `scripts/fetch-raw.js`: Crawls club pages/APIs into `_input/*.html`, writes `_input/link-config.json` and `_input/fetch-status.json`, and updates `src/data/content-hashes.json`.
2. `scripts/extract-text.js`: Converts `_input/*.html` to plain text `_input/*.txt`.
3. `scripts/parse-events.js`: Parses HTML/JSON/text into `src/data/events.json` and writes `src/data/status.json`.
4. `scripts/detect-anomalies.js`: Compares `src/data/events.json` against `src/data/health-baseline.json`.

---

## 2. Step-by-Step Self-Healing Protocol

### Step 1: Bootstrap the Cloud Sandbox & Reproduce
Always start by installing dependencies and running the full pipeline to populate `_input/` and reproduce the live state:
```bash
npm install && npm run scrape
```

### Step 2: Classify the Root Cause (Crucial — Not Every Alert is a Code Bug!)
Inspect `_input/fetch-status.json`, `src/data/status.json`, `_input/<club_slug>.html`, and `src/data/anomaly_report.md`. Classify the anomaly for the affected club into one of these 4 cases:

#### Case A: DOM Structure, Date Format, or API Schema Changed (Parser Bug)
* **Symptoms:** Fetch succeeded (`HTTP 200`), the club's live page in `_input/` has upcoming excursions, but `parse-events.js` extracted `0` events, missed events, or produced an invalid date.
* **Action:**
  1. Locate the club's parser in `scripts/parse-events.js` (`parseAos`, `parseEosAthinon`, `parseEosAthinonExoterikoy`, `parseEosAcharnon`, `parseEosh`, `parseEposFilis`, `parsePoa`, `parseFoni`, `parseFop`).
  2. Update the selector, regex, or JSON mapping for **that club only**.
  3. Re-run `npm run scrape:parse` to verify the events are extracted properly.

#### Case B: New Seasonal Schedule URL Published
* **Symptoms:** The club published a new seasonal page (e.g., a new semester/year URL slug) or moved their calendar URL.
* **Action:**
  1. Update the club's URL under its heading in `LINKS.md` (and any hardcoded URL reference in `scripts/fetch-raw.js` or `scripts/parse-events.js` if applicable).
  2. Re-run `npm run scrape` to fetch the new page and parse events.

#### Case C: Legitimate Schedule Reduction / Cancelled Excursions (No Code Bug!)
* **Symptoms:** `detect-anomalies.js` reported an `Event Count Drop` (e.g., `was 14 in last healthy baseline, now 11`), AND inspecting `_input/<club_slug>.html` confirms the club genuinely only lists 11 upcoming hikes now (because excursions were cancelled, removed, or completed).
* **Action:**
  1. **Do NOT modify `scripts/parse-events.js`** when the parser is already extracting 100% of the hikes listed on the club's website.
  2. Accept the new lower event count into `src/data/health-baseline.json` by running:
     ```bash
     npm run baseline:accept
     ```

#### Case D: Datacenter IP Bot-Block / Server Down (HTTP 403 / Cloudflare / 5xx)
* **Symptoms:** `_input/fetch-status.json` shows `HTTP 403`, a Cloudflare challenge, or connection timeout from the cloud VM IP.
* **Action:**
  1. Do not break the parser in `scripts/parse-events.js`.
  2. Verify that `parse-events.js` triggered `[RESILIENCE FALLBACK]` to preserve healthy events from `src/data/health-baseline.json`. If a public WordPress REST API endpoint (`/wp-json/wp/v2/...` or `/wp-json/tribe/events/v1/...`) is accessible without bot-blocking, consider using it; otherwise report the upstream outage/IP block clearly.

---

## 3. Scraper Invariants (Do Not Break)

When editing `scripts/parse-events.js`:
* **Greek Accent Insensitivity:** Always use `normalizeGreek()` when matching Greek keywords, titles, or month names.
* **Difficulty Extraction (`Β.Δ.`):** Preserve and normalize difficulty grades via `normalizeDifficulty()`.
* **Exclude Training Schools (`Σχολές`):** Keep `isSchoolTitle()` filtering active while preserving excursions for school graduates (`Απόφοιτοι`).
* **Date Formatting:** Output `YYYY-MM-DD` for `startDate` and `endDate`, resolving cross-month and cross-year ranges accurately.
* **Strict Isolation:** Never alter shared date helpers in a way that regresses the other 7 clubs.

---

## 4. Mandatory Verification Gate

Before committing, run:
```bash
# 1. Extract text, parse events, and run anomaly check
npm run scrape:parse

# 2. Verify zero critical anomalies remain
npm run test:anomalies

# 3. Verify Astro static site builds cleanly
npm run build
```
All three commands MUST succeed with `0` critical alerts (so `src/data/anomaly_report.md` is automatically removed) and `0` build errors.

---

## 5. Git, Changelog & Pull Request Delivery

1. Create a branch: `fix/scraper-<club-slug>` (or `chore/baseline-<club-slug>` for Case C).
2. Log the change under `## [Unreleased]` in `CHANGELOG.md` (following `.gemini/rules/versioning.md`).
3. Stage the modified code/data files (`scripts/parse-events.js`, `LINKS.md`, `src/data/events.json`, `src/data/health-baseline.json`, `src/data/status.json`, `CHANGELOG.md`). Never force-add `_input/` or `src/data/anomaly_report.md`.
4. Commit and open a Pull Request targeting `main` with a concise summary of the root cause (Case A/B/C/D) and the before/after event counts.

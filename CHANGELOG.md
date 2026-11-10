# Changelog

All notable changes to the Mount Athens (Ορειβατικό Ημερολόγιο) project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.7.0] - 2026-11-10

### Added
- Added dedicated `/notifications` page (`src/pages/notifications.astro`) offering Telegram channel (`@oreivatiko_hmerologio`) and Buttondown email subscription options with privacy disclaimers.
- Added dismissible homepage notifications callout banner (`#notifications-callout-banner`) with `localStorage` persistence in `src/pages/index.astro`.
- Added automated notification script (`scripts/send-notifications.js`) and CI post-deploy step in `.github/workflows/deploy.yml` to send a concise teaser message when healthy clubs add brand-new excursions, isolated from the self-healing anomaly pipeline.

### Changed
- Updated browser tab title, meta tags (`src/components/SEO.astro`), PWA manifests (`public/site.webmanifest`, `public/manifest.json`), and install prompt (`src/components/InstallPrompt.astro`) to `Ορειβατικό Ημερολόγιο`.
- Replaced the header date display in `src/layouts/Layout.astro` with a clean two-link sans-serif top navigation (`Πληροφορίες` and `Ενημερώσεις` with bell icon) and removed the `GITHUB` link from the footer.
- Merged `Αναφορά Προβλήματος` into `src/pages/info.astro` (`#report` section), restructured the page with a consistent heading hierarchy (`h1` / `h2`) and a two-column club sources grid, and removed the standalone `src/pages/report.astro` page.

## [1.6.1] - 2026-11-10

### Added
- Added `npm run baseline:accept` (`--accept-baseline` flag in `scripts/detect-anomalies.js`) to cleanly accept legitimate schedule reductions into `src/data/health-baseline.json` when a club cancels or removes hikes.
- Added `LINKS.md` direct fallback parser in `scripts/detect-anomalies.js` when `_input/link-config.json` is absent in fresh cloud clones.

### Fixed
- Fixed `scripts/detect-anomalies.js` so resilience fallback clubs (`🛡️ Fallback`) are separated from critical alert clubs (`🚨 Alert`) and no longer misattributed in the Remote Agent prompt.
- Embedded full anomaly context directly inside the generated Remote Agent prompt and updated `.gemini/rules/anomaly-triage.md` to bootstrap fresh cloud VMs (`npm install && npm run scrape`) and classify root causes into 4 distinct buckets.
- Fixed `npm run scrape:parse` in `package.json` to always run `scripts/extract-text.js` before `scripts/parse-events.js`.

## [1.6.0] - 2026-11-09

### Added
- Added Antigravity Remote Agent self-healing runbook and strict triage protocol in `.gemini/rules/anomaly-triage.md`.
- Added automated one-click Remote Agent dispatch prompt template and affected club source URLs to anomaly alert reports in `scripts/detect-anomalies.js`.
- Added scraper diagnostic artifacts archiving (`scraper-diagnostics`) and test alert trigger (`workflow_dispatch`) to `.github/workflows/deploy.yml`.
- Added pipeline convenience shortcuts (`scrape`, `scrape:parse`, `test:anomalies`) in `package.json`.
- Added clean, non-truncated mobile-only PWA install floating card and iOS bottom-sheet instructions modal that seamlessly triggers the native OS installation dialog.
- Added Web App Manifest (`public/site.webmanifest`), Service Worker (`public/sw.js`), and high-resolution PWA icons (`public/icons/`).
- Added PWA and mobile web app meta tags to `src/components/SEO.astro` (`apple-touch-icon`, `theme-color`, `apple-mobile-web-app-capable`, `mobile-web-app-capable`).

## [1.5.1] - 2026-10-27

### Added
- Added a list of parsed mountaineering clubs and their source schedule links in `src/pages/info.astro`.
- Added difficulty (`Β.Δ.`) extraction for ΕΠΟΣ Φυλής via its Tribe Events REST API (`wp-json/tribe/events/v1/events`) with dynamic `next_rest_url` pagination support.
- Added numeric and verbal difficulty (`Εύκολη`, `Μέτρια`, `Δύσκολη`) extraction for ΦΟΝΙ via its WordPress REST API (`wp-json/wp/v2/posts?categories=59`) and mapped verbal tokens in `src/pages/index.astro`.
- Added sub-link difficulty extraction (`wp-json/wp/v2/posts`) and multi-team annual block scanning (`Ομάδα Α` + `Ομάδα Β`) for ΑΟΣ in `scripts/parse-events.js`.

### Fixed
- Excluded pure sightseeing/museum trips (`Περιηγητική`) and first-aid seminars (`Σεμινάριο`) in `parseFoni` only when zero hiking/trail indicators exist in both title and body, and preserved full place names before dashes (e.g., `Καμάρι – Παναγία η Κορφιώτισσα`).
- Fixed hyphenated start-day matching (`30-31 Αυγούστου & 01 Σεπτεμβρίου 2025`) in `parseDateRange` cross-month regex.

## [1.5.0] - 2026-10-27

### Added
- Added official club difficulty ratings (`Β.Δ.`) inline after excursion titles (`{event.title} | Β.Δ.: {event.difficulty}`) in `src/pages/index.astro` when available.
- Added a 4-tier sidebar difficulty filter (`ΔΥΣΚΟΛΙΑ`: `Όλες`, `Εύκολη`, `Μέτρια`, `Απαιτητική`, `Άγνωστη`) in `src/pages/index.astro`, with multi-tier matching for multi-group excursions (e.g., `Α, Β+`, `1-2`, `2 ή 5`, `1 & 2 ή Χ1`).
- Expanded difficulty extraction in `scripts/parse-events.js` across ΕΟΣ Αχαρνών (`D_PLUS` -> `Δ+`, sorted multi-grade arrays), ΑΟΣ (`Β.Δ.` / `Βαθμός Δυσκολίας` in annual programs), ΠΟΑ (anchored title `ΒΔ` extraction + accordion body fallback), ΕΟΣ Αθηνών (`Β.Δ.` line scanning), ΕΟΣ Ηλιούπολης, and ΦΟΠ (`normalizeDifficulty`).
- Added an explanatory section on difficulty scales (`Β.Δ.`) and filter tiers in `src/pages/info.astro`.

### Changed
- Excluded mountaineering training courses (`Σχολή` / `Σχολές` in the event title or `-course-` slug) via `isSchoolTitle` in `scripts/parse-events.js`, while preserving regular excursions aimed at school graduates (`Απόφοιτοι Σχολών`).

## [1.4.0] - 2026-10-27

### Added
- Switched ΕΟΣ Αχαρνών data source to the unpaginated JSON API (`https://eosacharnon.xmiddleware.com/api/events`) with automatic fallback to multi-page Next.js HTML hydration parsing.
- Added dynamic pagination discovery in `scripts/fetch-raw.js` for ΕΠΟΣ Φυλής (`.tribe-events-c-nav__next`), ΕΟΣ Αχαρνών (`?page=N`), and broader ΑΟΣ seasonal program slugs (`https://aos.gr/programma-*`).
- Added structured `.hgrid.entry-content` card parsing in `parseAos` and partial-fetch baseline resilience in `addClubEvents`.
- Added fallback composite Star ID matching (`club_startDate`) and UTC date getters in `src/pages/index.astro`.

### Fixed
- Fixed ΑΟΣ cross-month regex capture group offset, annual header year anchoring, `&` cross-month separators, weekday-prefixed date lines, and `"Αναμένεται"` placeholder filtering.
- Fixed ΕΟΣ Αθηνών date parsing when spaces appear around slashes (`7 – 8 /11`, `6 /12`) and broadened `parseEosAthinonExoterikoy` year detection (`20\d{2}`) to prevent archived historical trips from defaulting to the current year.
- Fixed ΦΟΠ rolling `contextYear` tracking across chronological accordion items to handle 3-digit year typos (`202`) and cross-month year resolution in `parseDateRange`.
- Removed the `"06-09"` fallback date in `parseDateRange`, fixed global deduplication predicate and 1-word title preservation in `scripts/parse-events.js`, and aligned `scripts/detect-anomalies.js` with resilience fallback logs.

## [1.3.0] - 2026-07-28

### Added
- Interactive Star / Favorite excursions feature with local storage persistence (`mount_athens_starred_events`) and UI filter button.
- SHA-256 raw webpage content hashing (`content-hashes.json`) during daily crawl to track website updates.
- Enhanced anomaly detector (`detect-anomalies.js`) alerting when a club updates its website overnight but parser yields 0 events.

### Fixed
- Refactored `fop.gr` parser (`parseFop`) to use Cheerio DOM accordion selectors (`.gdlr-core-accordion-item-tab`) and enhanced date range matching for dot-separated formats (`DD.MM.YYYY`).
- Prefix and folk month name resolution (`parseGreekMonth`) supporting truncated month names (`ΙΑΝ`, `ΙΑΝΟΥΡ`, `ΦΕΒΡ`, `ΓΕΝΑΡΗΣ`, `ΦΛΕΒ`).

## [1.2.1] - 2026-07-23

### Fixed
- Fixed GitHub Actions deployment pipeline by making anomaly issue reporting step non-blocking (`continue-on-error: true`) and passing `GH_TOKEN`.

## [1.2.0] - 2026-07-23

### Added
- Smart deduplication & anomaly detection in excursion parser pipeline (`detect-anomalies.js`).
- Universal URL fallbacks and Elementor accordion hash ID targeting for EOS Athinon URLs.
- Scroll-to-text title targeting for POA event links.
- Star / Favorite excursions feature (`feature/star-events`) with local storage persistence.
- Dynamic project versioning in global layout footer linked to `package.json`.
- Agent rule file `.gemini/rules/versioning.md` for strict version bump & changelog discipline.

### Fixed
- POA date parser bug and climbs abroad handling for ΕΟΣ Αθηνών and ΕΟΣ Ηλιούπολης.
- Accessibility fixes (color contrast, search input aria-labels, descriptive event details labels).
- Footer full-width alignment on info and report pages.

### Changed
- Converted club name badges to interactive inline filter buttons with smooth scroll.
- Standardized `LINKS.md` with dynamic link-config mapping and integrated ΦΟΠ theme/parser.

## [1.1.0] - 2026-07-15

### Added
- Event duration filter (single-day vs. multi-day excursions).
- Sticky side-filter panel layout for desktop viewports.
- Scroll progress indicator bar.
- Formspree contact/report form integration.

## [1.0.0] - 2026-07-01

### Added
- Initial public release of Mount Athens (Ορειβατικό Ημερολόγιο) Astro site.
- Automated daily GitHub Actions parser pipeline for 8+ mountain clubs in Attica.
- Responsive excursion table layout, Greek accent search normalization, and mobile view.

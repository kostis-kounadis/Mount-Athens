# Changelog

All notable changes to the Mount Athens (Ορειβατικό Ημερολόγιο) project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

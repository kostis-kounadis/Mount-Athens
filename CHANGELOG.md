# Changelog

All notable changes to the Mount Athens (Ορειβατικό Ημερολόγιο) project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

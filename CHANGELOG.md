# Changelog

All notable changes to the Mount Athens (Ορειβατικό Ημερολόγιο) project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

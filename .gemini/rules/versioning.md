# Versioning & Changelog Guidelines for AI Agents

Whenever working on this codebase, all AI agents MUST follow these versioning and changelog rules:

## 1. Changelog Discipline (`CHANGELOG.md`)
- **Log all edits**: When implementing new features, bug fixes, or UI changes, log them under the `[Unreleased]` section of [`CHANGELOG.md`](file:///Users/kkounadi/Desktop/antigravity-projects/Mount-Athens/CHANGELOG.md).
- Use standard categories:
  - `Added` for new features.
  - `Changed` for changes in existing functionality.
  - `Fixed` for any bug fixes.
  - `Removed` for deleted features or files.

## 2. Version Bumping Rules (`package.json`)
Before merging to `main` or preparing a release, bump the `"version"` field in [`package.json`](file:///Users/kkounadi/Desktop/antigravity-projects/Mount-Athens/package.json). The global footer (`src/layouts/Layout.astro`) dynamically renders `v{pkg.version}`.

Follow Semantic Versioning (`MAJOR.MINOR.PATCH`):

- **PATCH (`1.2.0` -> `1.2.1`)**:
  - Small bug fixes, parser regex fixes, URL hash tweaks.
  - Minor visual/CSS fixes or small refactors.
  - Documentation or script maintenance.

- **MINOR (`1.2.0` -> `1.3.0`)**:
  - New user-facing UI features (e.g. Star/Favorite filter, new filter layout, dark mode).
  - Integration of a new mountain club parser or scraper.
  - Significant enhancement to anomaly detection or workflow automation.

- **MAJOR (`1.2.0` -> `2.0.0`)**:
  - Complete architecture overhaul or site redesign.
  - Breaking schema changes to `events.json` structure or API contracts.

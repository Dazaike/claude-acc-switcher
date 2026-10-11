# Changelog

All notable changes to the Claude Account Switcher extension are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [v19.8] - 2026-10-11

### Added
- Local import/export on the sync page: export all accounts (cookies + storage snapshots) to a JSON file; import with Merge (union by id, newer `savedAt` wins) or Replace.
- Dropbox "Merge Sync (two-way)": downloads the backup, merges with local accounts, saves locally, then uploads the merged result. Push/Pull overwrite behavior is unchanged.
- Backups (file and Dropbox) now carry `format`/`version: 2`; imports and pulls validate each account entry.

## [v19.7] - 2026-09-27

### Fixed
- Removed `input`/`textarea` from the global `:focus-visible` glow in `styles.css` so the extension no longer draws a temporary orange box around Claude's composer input bar on focus. Buttons, links, and menu items keep the glow; the composer keeps its native focus ring.

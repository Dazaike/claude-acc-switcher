# Changelog

All notable changes to the Claude Account Switcher extension are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [v19.7] - 2026-09-27

### Fixed
- Removed `input`/`textarea` from the global `:focus-visible` glow in `styles.css` so the extension no longer draws a temporary orange box around Claude's composer input bar on focus. Buttons, links, and menu items keep the glow; the composer keeps its native focus ring.

# Changelog

All notable changes to Tend are documented in this file.

## [0.1.1] - 2026-03-30

Note: Version was incorrectly labeled 0.1.1. The actual version is v0.1.20260330-203511.

### Added
- Home icon in collapsed sidebar for quick navigation to today's journal

## [0.1.0] - 2026-03-30

### Fixed
- Blank screen on initial page load: app now shows "Loading..." until initialization completes
- 500 error when page/meeting names contain colons (e.g., "1:1 Jamie Parker")
- Typewriter scroll bottom padding on desktop
- Multi-block delete on subsequent selections
- Shift+Arrow block selection + Delete
- Drag-to-select starting from outside editor container
- Two-click activation: focus editor on first click
- Blue outline on multi-block selection container focus
- Scroll title overlapping page content
- Editor mouse interaction bugs
- Typewriter scroll targeting wrong scroll container

### Added
- Cross-platform filename encoding for page/sheet names (`:` `<` `>` `"` `|` `?` `*` `\` percent-encoded)
- Backwards-compatible file reading (falls back to raw filenames for pre-encoding files)
- Input validation for encrypted filesystem operations (was missing)
- Control character rejection in page name validation
- GitHub Actions workflow to build and push Docker image to GHCR
- Scroll title that appears when page title scrolls out of view
- Multi-block selection and delete
- Demo mode with IndexedDB storage

### Security
- Added validate_safe_name calls to encrypted filesystem (was unvalidated)
- Removed overzealous Windows drive letter check that incorrectly blocked legitimate names

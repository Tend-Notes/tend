# Changelog

All notable changes to Tend are documented in this file.

## [Unreleased]

### Added
- Collapsed-sidebar badge showing count of due/overdue tasks (1-9, or `*` for 10+) with red-faded background; click opens the task manager (49fe77f)
- Full-canvas task manager view (Alt+Shift+T) with view filters (Today / Overdue / Due soon / Starting soon / No due date / All active / Completed) and priority multi-select (High/Medium/Low/None) with theme-colored fills (921f548, d362e58, 3114c6a, 08a2ff4, 2df328d, 351ad4c)
- Expand-to-full-view button in the sidebar todos panel header (79f700e)
- Alt+Shift+T global keyboard shortcut to open the task manager (14efda0)

### Changed
- Task fetching consolidated into a new `taskStore` so the collapsed-sidebar badge, sidebar todos panel, and full-canvas task manager share one source of truth (2195847, 9245d6d, 414cb6e, 792b932)
- `pageStore` now tracks `viewingTasks` with `openTaskManager()` / `closeTaskManager()` actions; navigating to a page exits the task manager naturally; deep-linking via `/tasks` URL works (4313dc1, 2dc6cdd, 790d500)
- Wikilink rendering helper for task content extracted to a shared module so both `SidebarTodos` and `TaskManagerPage` use it (351ad4c)

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

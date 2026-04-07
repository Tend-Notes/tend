# TODO: Investigate excessive todo index rebuilds

The server log shows multiple "Rebuilding todo index" events on every page load. This is likely triggered by every page/sheet save or file watcher event, not just on startup. Rebuilding the full todo index on every change is O(n) across all content types and wasteful.

Should investigate:
- What triggers the rebuild (file watcher? every save?)
- Can it be incremental (update only the changed page's todos)?
- Or debounced (batch changes, rebuild once)?

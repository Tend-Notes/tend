# Task Manager Page — Design

**Date:** 2026-05-01
**Status:** Approved (brainstorm complete)
**Branch:** `v0.2/task-manager-page`

## Summary

Surface due/overdue task pressure on the collapsed sidebar via a small count badge, and promote the task manager from a sidebar-only panel to a first-class full-canvas view with filter controls.

## Motivation

The current task UI is buried: it's only visible when the sidebar is expanded and the todos mode is selected. Users keeping the sidebar collapsed have no signal that work is due. Even when expanded, the narrow column limits how much filter context can be exposed (today vs overdue vs upcoming, priority slicing).

## Architecture

### New: `taskStore` (Zustand)

`packages/web/src/stores/taskStore.ts`

Hoists task fetching out of `SidebarTodos` so three consumers (collapsed badge, sidebar panel, full-canvas page) share one source of truth.

State:

- `tasks: Task[]`
- `loading: boolean`
- `error: string | null`

Actions:

- `refresh()` — re-fetches `todosApi.list()`
- Subscribes to `pageStore.pageVersion` to auto-refresh on save (preserves the existing `SidebarTodos` invalidation trigger).

Derived selectors:

- `selectToday` — `dueDate === today || startDate === today`, active only
- `selectOverdue` — `dueDate < today`, active only
- `selectDueSoon` — `today < dueDate <= today + 7`, active only
- `selectStartingSoon` — `today < startDate <= today + 7`, active only
- `selectNoDueDate` — active tasks with no `dueDate`
- `selectAllActive` — every non-completed task
- `selectCompleted` — `status === 'DONE' || 'NEVER'`
- `selectBadgeCount` — overdue + today (dueDate or startDate today), active only. Count semantic for the collapsed-sidebar badge.

### Routing into the full-canvas view

Follow the existing template-editor pattern in `pageStore`. Add `viewMode: 'page' | 'template' | 'importError' | 'tasks'` (or equivalent guarded by the existing `editingTemplate`/`editingImportError` mechanism — to be picked at impl time based on what's cleanest).

`MainContent.tsx` adds a branch:

```tsx
if (viewMode === 'tasks') return <TaskManagerPage />;
```

New helper: `pageStore.openTaskManager()` sets the view and pushes a history entry. Existing `navigateToPage()` and `navigateToJournal()` exit the view naturally.

## UI

### Collapsed-sidebar badge

Component: `SidebarBadge` rendered inside `Sidebar.tsx`'s collapsed branch.

- Position: between "Today's journal" icon and the expand chevron.
- Visibility: only when `selectBadgeCount > 0`.
- Hit target: 32px wide (matches sibling collapsed buttons).
- Inner pill: ~24×20px, slightly rounded.
- Background: `color-mix(in srgb, var(--base08) 50%, transparent)`.
- Text: `var(--base-07)`, small bold numeral.
- Content: `count <= 9 ? String(count) : '*'`.
- Tooltip: `"N due/overdue tasks (Alt+Shift+T)"`.
- `aria-label="Open task manager — N due or overdue"`.
- Click → `pageStore.openTaskManager()`.

### Sidebar todos panel changes

`SidebarTodos.tsx`:

1. **Fetch refactor:** replace local `useState<Task[]>` + `useEffect`/`pageVersion` re-fetch with a `taskStore` subscription. Behavior unchanged from the user's perspective.
2. **Expand button:** small icon button in the panel header (top-right). Icon: lucide-react `Maximize2`. Tooltip: `"Expand task manager (Alt+Shift+T)"`. Click → `pageStore.openTaskManager()`. If the panel currently has no header bar, add a minimal one.

Side benefit: badge count and panel list are guaranteed consistent (single source).

### Full-canvas `TaskManagerPage`

`packages/web/src/components/tasks/TaskManagerPage.tsx`. Rendered when `viewMode === 'tasks'`.

**Visual approach:** matches sidebar aesthetics. No boxes, borders, or column dividers — left filter list and right task list are spatially separated by whitespace alone.

**Header:** single line, "Tasks" left-aligned, close (×) right-aligned. No bottom border.

**Layout sketch:**

```
Tasks                                                      ×

  Today              4         · pick up groceries        today  high
  Overdue            2           [page name]
  Due soon           7
  Starting soon      3         · email Joe                today
  No due date       12           [page name]
  All active        29
  Completed                    · review draft        today (start)
                                 [page name]
  Priority
   High              5
   Medium            8
   Low               3
   None             13
```

**Left filter column (~200px):**

*Views (single-select buttons, default `Today`):*

- Today / Overdue / Due soon / Starting soon / No due date / All active / Completed
- Each shows live trailing count from store selectors.
- Active: `bg-base-02 text-base-06`. Inactive: `text-base-04 hover:bg-base-01`.
- Counts use existing badge style: `color-mix(in srgb, var(--base08) 15%, transparent)` for overdue-flavored counts, neutral `text-base-04` for others (consistent with sidebar nav badges).

*Priority (multi-select toggle buttons, slightly rounded rectangles):*

- High active: `color-mix(in srgb, var(--base08) 50%, transparent)` (red, faded)
- Medium active: `color-mix(in srgb, var(--base0D) 50%, transparent)` (blue, faded)
- Low active: `color-mix(in srgb, var(--base0B) 50%, transparent)` (green, faded)
- None active: `bg-base-02` (normal active sidebar button color)
- Inactive: `text-base-04 hover:bg-base-01`, no fill.
- No checkbox glyph — fill *is* the active indicator.
- Multi-select: each priority toggles independently; multiple may be active simultaneously.

Filter state lives in `TaskManagerPage` local state — no persistence in v1.

**Right task list (flex-1):**

`TaskRow` similar to `SidebarTodos` rendering, slightly expanded:

- Priority shown as a small leading badge.
- Page name as a clickable chip (sidebar truncates this; here it's full).
- Both `dueDate` and `startDate` rendered side by side when present, with urgency styling from `dateUtils.ts`.
- Click on task content → `navigateToPage(pageName)` and exit the task manager. Block-focus on arrival is a stretch goal.
- No row separators — vertical spacing only, matching the sidebar.

**Empty states:** view-specific — "No overdue tasks", "Nothing due today", etc.

## Keyboard shortcuts

Claim **Alt+Shift+T** for "Open task manager" (consistent with the existing Alt+Shift+ family). Add to CLAUDE.md shortcut list. Both the collapsed-sidebar badge and the sidebar-panel expand button reference this shortcut in their tooltips. The shortcut is global (registered in the existing keyboard-shortcut handler).

## Theme color verification

The design assumes base16 standard mappings:

- `--base08` = red
- `--base0D` = blue
- `--base0B` = green

These should be verified against `packages/web/src/styles/globals.css` and `packages/web/src/lib/themes.ts` at implementation time. If the project's themes deviate, match what's actually defined.

## Out of scope (deferred)

- "By page" filter / grouping.
- Persistence of filter state across sessions.
- Block-focus on click-through (open the source page first; focus is a follow-up).
- Bulk operations (mark multiple done, batch reassign dates).
- Sort controls (default ordering only).
- Multi-arch Docker (issue #92, unrelated).

# Task Manager Page Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a collapsed-sidebar due-task badge and a full-canvas task manager view with filter controls, hoisting task fetching into a shared Zustand store.

**Architecture:** Three frontend-only changes: (1) new `taskStore` consolidating task fetch + selectors; (2) new `viewMode === 'tasks'` branch in `pageStore` + `MainContent`, following the existing template-editor pattern; (3) new `TaskManagerPage` component plus a small `SidebarBadge` and a `SidebarTodos` expand button.

**Tech Stack:** React 18, TypeScript, Zustand (with immer), Tailwind, lucide-react icons. No backend changes — uses existing `todosApi.list()`. No new test infrastructure (project has none); verification = `tsc --noEmit` + manual browser test per task.

**Design doc:** `docs/plans/2026-05-01-task-manager-page-design.md` (commit b86484c).

**Branch:** `v0.2/task-manager-page` (already created).

**Theme color confirmation (from verification):**
- `--base08` = red (`#e06c75`)
- `--base0D` = blue (`#61afef`)
- `--base0B` = green (`#98c379`)

---

## Conventions for every task

- After each task: run `cd packages/web && npx --no-install tsc --noEmit` from project root. Must pass.
- Commit at the end of each task with the message format from `CLAUDE.md`: what / why / test / rollback.
- No `Co-Authored-By` lines.
- Add `// SPDX-License-Identifier: MIT WITH Commons-Clause` to every new source file.
- Tooling note: `pnpm` may not be on PATH; use `nix develop -c pnpm ...` if needed, or `npx --no-install` for binaries already in `node_modules/.bin`.

---

## Phase 1 — Data layer

### Task 1: Create `taskStore` with state, fetch action, and selectors

**Files:**
- Create: `packages/web/src/stores/taskStore.ts`

**Reference for store shape:** look at any existing Zustand store in `packages/web/src/stores/` (e.g. `pageStore.ts`) for the immer + create pattern used in this project. Match it.

**Reference for `Task` type:** look at where `todosApi.list()` is called in `packages/web/src/components/sidebar/SidebarTodos.tsx` and find the Task type import path. Reuse that exact type.

**Step 1: Write the store**

```ts
// SPDX-License-Identifier: MIT WITH Commons-Clause
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { todosApi } from '../lib/api';
import type { Task } from '../lib/api'; // adjust import to wherever Task is defined

const todayYMD = (): string => {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
};

const addDaysYMD = (days: number): string => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
};

const isCompleted = (status: string): boolean =>
  status === 'DONE' || status === 'NEVER';

interface TaskState {
  tasks: Task[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export const useTaskStore = create<TaskState>()(
  immer((set) => ({
    tasks: [],
    loading: false,
    error: null,
    refresh: async () => {
      set((s) => {
        s.loading = true;
        s.error = null;
      });
      try {
        const tasks = await todosApi.list();
        set((s) => {
          s.tasks = tasks;
          s.loading = false;
        });
      } catch (err) {
        set((s) => {
          s.loading = false;
          s.error = err instanceof Error ? err.message : String(err);
        });
      }
    },
  })),
);

// Pure selector helpers — call from components with useTaskStore((s) => selectX(s.tasks))
const active = (t: Task) => !isCompleted(t.status);

export const selectToday = (tasks: Task[]): Task[] => {
  const today = todayYMD();
  return tasks.filter(
    (t) => active(t) && (t.dueDate === today || t.startDate === today),
  );
};

export const selectOverdue = (tasks: Task[]): Task[] => {
  const today = todayYMD();
  return tasks.filter((t) => active(t) && t.dueDate && t.dueDate < today);
};

export const selectDueSoon = (tasks: Task[]): Task[] => {
  const today = todayYMD();
  const horizon = addDaysYMD(7);
  return tasks.filter(
    (t) => active(t) && t.dueDate && t.dueDate > today && t.dueDate <= horizon,
  );
};

export const selectStartingSoon = (tasks: Task[]): Task[] => {
  const today = todayYMD();
  const horizon = addDaysYMD(7);
  return tasks.filter(
    (t) =>
      active(t) && t.startDate && t.startDate > today && t.startDate <= horizon,
  );
};

export const selectNoDueDate = (tasks: Task[]): Task[] =>
  tasks.filter((t) => active(t) && !t.dueDate);

export const selectAllActive = (tasks: Task[]): Task[] => tasks.filter(active);

export const selectCompleted = (tasks: Task[]): Task[] =>
  tasks.filter((t) => isCompleted(t.status));

// Badge count = today + overdue (active only). Same definition surfaced in
// existing nav-mode badges.
export const selectBadgeCount = (tasks: Task[]): number => {
  const today = todayYMD();
  return tasks.filter(
    (t) =>
      active(t) &&
      ((t.dueDate && t.dueDate <= today) || t.startDate === today),
  ).length;
};
```

**Step 2: Verify TypeScript**

Run: `cd packages/web && npx --no-install tsc --noEmit`
Expected: PASS.

**Step 3: Commit**

```bash
git add packages/web/src/stores/taskStore.ts
git commit -m "Add taskStore with task fetch and filter selectors

packages/web/src/stores/taskStore.ts: Zustand store hoisting task fetch out
of SidebarTodos. Exposes refresh() and pure selectors (today, overdue, due
soon, starting soon, no due date, all active, completed, badge count) for
upcoming collapsed-sidebar badge and full-canvas task manager.

Test: tsc --noEmit; store unused so far, no behavior change.
Rollback: safe to revert; new file only."
```

---

### Task 2: Wire `taskStore` auto-refresh to `pageVersion`

**Files:**
- Modify: `packages/web/src/stores/taskStore.ts`

**Context:** `SidebarTodos` currently re-fetches on `pageVersion` change. Replicate that subscription in the store so all consumers stay fresh.

**Step 1: Find the `pageVersion` subscription pattern**

Read `packages/web/src/components/sidebar/SidebarTodos.tsx` and locate where it subscribes to `pageVersion` from `pageStore`. Mirror that approach: at module load, subscribe to `usePageStore` for `pageVersion` changes and call `useTaskStore.getState().refresh()`.

**Step 2: Add subscription at the bottom of `taskStore.ts`**

```ts
import { usePageStore } from './pageStore';

// Auto-refresh on page save (pageVersion bumps after a save flushes).
let lastPageVersion = usePageStore.getState().pageVersion;
usePageStore.subscribe((state) => {
  if (state.pageVersion !== lastPageVersion) {
    lastPageVersion = state.pageVersion;
    void useTaskStore.getState().refresh();
  }
});

// Initial fetch.
void useTaskStore.getState().refresh();
```

If the field is named differently (`pageRefreshKey`, `version`, etc.), use the actual name from `pageStore.ts`.

**Step 3: Verify TypeScript**

Run: `cd packages/web && npx --no-install tsc --noEmit`
Expected: PASS.

**Step 4: Commit**

```bash
git add packages/web/src/stores/taskStore.ts
git commit -m "Auto-refresh taskStore on pageVersion change

packages/web/src/stores/taskStore.ts: subscribe to pageStore so taskStore
re-fetches whenever a page save bumps pageVersion. Mirrors SidebarTodos's
existing invalidation; required so the badge stays accurate when the
sidebar todos panel isn't mounted.

Test: tsc --noEmit; not yet consumed by UI.
Rollback: revert this commit; taskStore still works manually."
```

---

### Task 3: Refactor `SidebarTodos` to consume `taskStore`

**Files:**
- Modify: `packages/web/src/components/sidebar/SidebarTodos.tsx`

**Step 1: Replace local fetch with store subscription**

Remove the local `useState<Task[]>`, the `useEffect` that calls `todosApi.list()`, and the `pageVersion` dependency wiring. Replace with:

```ts
import { useTaskStore } from '../../stores/taskStore';

const tasks = useTaskStore((s) => s.tasks);
const loading = useTaskStore((s) => s.loading);
```

Existing filtering logic (`isCompletedStatus`, `dueDate < todayStr`, etc.) stays in the component. The store provides the raw list; `SidebarTodos` continues to derive its own grouped view.

**Step 2: Remove now-unused imports**

`todosApi`, `useState`/`useEffect` (if no longer used elsewhere in the file), and any `pageVersion` import.

**Step 3: Verify TypeScript and run dev server**

Run: `cd packages/web && npx --no-install tsc --noEmit`
Expected: PASS.

Manual: start backend (`TEND_CORS_ORIGINS="*" TEND_AUTH_REQUIRED=false TEND_AUTH_DEFAULT_USER=dev cargo run -p tend-server`) and frontend (`pnpm dev`). Open the todos sidebar panel; tasks load. Edit a task content on a page, save, return to sidebar — task list reflects the edit.

**Step 4: Commit**

```bash
git add packages/web/src/components/sidebar/SidebarTodos.tsx
git commit -m "Move SidebarTodos task fetch to taskStore

packages/web/src/components/sidebar/SidebarTodos.tsx: read tasks from
taskStore instead of local useState + useEffect fetch. taskStore handles
pageVersion-driven refresh, so behavior is unchanged. Prepares for
collapsed-sidebar badge and full-canvas view to share the same data.

Test: tsc --noEmit; manual: open todos panel, edit a task, verify list
updates after save.
Rollback: safe to revert; SidebarTodos behavior unchanged."
```

---

## Phase 2 — Routing into the full-canvas view

### Task 4: Add `viewMode === 'tasks'` to `pageStore`

**Files:**
- Modify: `packages/web/src/stores/pageStore.ts`

**Step 1: Pick the integration shape**

The existing pattern uses nullable `editingTemplate` and `editingImportError` objects. Match it: add a boolean `viewingTasks: boolean` (default `false`), with actions `openTaskManager()` and `closeTaskManager()`. Keep it boolean (no payload needed).

**Step 2: Add state field**

In the state interface and the initial state object, add `viewingTasks: false`.

**Step 3: Add actions**

```ts
openTaskManager: () => {
  // Flush any pending edits, like navigateToPage does.
  get().flushPendingSave?.();
  set((s) => {
    s.viewingTasks = true;
  });
  window.history.pushState({ viewingTasks: true }, '', '/tasks');
},

closeTaskManager: () => {
  set((s) => {
    s.viewingTasks = false;
  });
},
```

If `flushPendingSave` is named differently or is private, omit the call — page editor flushes on its own when blurred.

**Step 4: Make sure `navigateToPage` / `navigateToJournal` clear the flag**

Inside the existing `navigateToPage` and `navigateToJournal` actions, add `s.viewingTasks = false;` to the immer mutation. This is the natural exit when the user clicks a sidebar page link from the task view.

**Step 5: Verify TypeScript**

Run: `cd packages/web && npx --no-install tsc --noEmit`
Expected: PASS.

**Step 6: Commit**

```bash
git add packages/web/src/stores/pageStore.ts
git commit -m "Add viewingTasks state and actions to pageStore

packages/web/src/stores/pageStore.ts: introduce viewingTasks boolean,
openTaskManager() and closeTaskManager() actions. navigateToPage and
navigateToJournal clear the flag so clicking a page exits the task
manager naturally. Routing target for the upcoming TaskManagerPage.

Test: tsc --noEmit; no UI consumer yet.
Rollback: revert; no other code references viewingTasks."
```

---

### Task 5: Render a stub `TaskManagerPage` from `MainContent`

**Files:**
- Create: `packages/web/src/components/tasks/TaskManagerPage.tsx`
- Modify: `packages/web/src/components/layout/MainContent.tsx`

**Step 1: Stub component**

```tsx
// SPDX-License-Identifier: MIT WITH Commons-Clause
import { X } from 'lucide-react';
import { usePageStore } from '../../stores/pageStore';

export function TaskManagerPage() {
  const closeTaskManager = usePageStore((s) => s.closeTaskManager);

  return (
    <div className="flex h-full w-full flex-col bg-base-00 text-base-05">
      <header className="flex items-center justify-between px-6 py-4">
        <h1 className="text-lg font-semibold text-base-06">Tasks</h1>
        <button
          onClick={closeTaskManager}
          className="rounded p-1 text-base-04 hover:bg-base-01 hover:text-base-06"
          aria-label="Close task manager"
          title="Close"
        >
          <X size={18} />
        </button>
      </header>
      <div className="flex flex-1 gap-6 overflow-hidden px-6 pb-6">
        <aside className="w-[200px] shrink-0">
          {/* filter column — Task 7+ */}
        </aside>
        <main className="flex-1 overflow-y-auto">
          {/* task list — Task 9 */}
        </main>
      </div>
    </div>
  );
}
```

Verify Tailwind class names match what's used elsewhere (e.g. `bg-base-00`, `text-base-05`) — read one component like `SidebarTodos` to confirm naming.

**Step 2: Modify `MainContent.tsx`**

Find the existing branch logic that picks `OutlinerEditor` vs `TemplateEditor` vs `ImportErrorEditor`. Add a higher-priority check:

```tsx
const viewingTasks = usePageStore((s) => s.viewingTasks);

if (viewingTasks) {
  return <TaskManagerPage />;
}
```

Place it before the template / import-error checks so the task manager takes precedence when active.

**Step 3: Manual verification**

In the browser console with the app running:

```js
window.__pageStore = (await import('/src/stores/pageStore')).usePageStore;
window.__pageStore.getState().openTaskManager();
```

Or more pragmatically: temporarily wire a button somewhere reachable, or just trust Task 12 to provide the entry point and verify there.

For this task, verify by setting `viewingTasks: true` directly in browser devtools (React devtools → pageStore) and confirming the stub renders with header + close button. Click close → returns to previous view.

**Step 4: TypeScript check**

Run: `cd packages/web && npx --no-install tsc --noEmit`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/web/src/components/tasks/TaskManagerPage.tsx packages/web/src/components/layout/MainContent.tsx
git commit -m "Render TaskManagerPage stub when viewingTasks is true

packages/web/src/components/tasks/TaskManagerPage.tsx: stub component
with header (title + close button) and empty two-pane layout.
packages/web/src/components/layout/MainContent.tsx: render
TaskManagerPage when pageStore.viewingTasks is true, taking precedence
over the page/template/import-error branches.

Test: tsc --noEmit; manual: set viewingTasks=true in devtools, verify
stub renders and close button returns to previous view.
Rollback: safe to revert; no entry point yet."
```

---

## Phase 3 — TaskManagerPage UI

### Task 6: Filter column — view buttons

**Files:**
- Modify: `packages/web/src/components/tasks/TaskManagerPage.tsx`

**Step 1: Add view state and button list**

```tsx
import { useTaskStore, selectToday, selectOverdue, selectDueSoon, selectStartingSoon, selectNoDueDate, selectAllActive, selectCompleted } from '../../stores/taskStore';
import { useState } from 'react';

type ViewKey = 'today' | 'overdue' | 'dueSoon' | 'startingSoon' | 'noDueDate' | 'allActive' | 'completed';

const VIEWS: Array<{ key: ViewKey; label: string; selector: typeof selectToday }> = [
  { key: 'today',        label: 'Today',         selector: selectToday },
  { key: 'overdue',      label: 'Overdue',       selector: selectOverdue },
  { key: 'dueSoon',      label: 'Due soon',      selector: selectDueSoon },
  { key: 'startingSoon', label: 'Starting soon', selector: selectStartingSoon },
  { key: 'noDueDate',    label: 'No due date',   selector: selectNoDueDate },
  { key: 'allActive',    label: 'All active',    selector: selectAllActive },
  { key: 'completed',    label: 'Completed',     selector: selectCompleted },
];
```

Inside the component:

```tsx
const [activeView, setActiveView] = useState<ViewKey>('today');
const tasks = useTaskStore((s) => s.tasks);
```

**Step 2: Render view buttons in the `<aside>`**

```tsx
<aside className="w-[200px] shrink-0 space-y-4">
  <div className="space-y-0.5">
    {VIEWS.map((v) => {
      const count = v.selector(tasks).length;
      const isActive = activeView === v.key;
      return (
        <button
          key={v.key}
          onClick={() => setActiveView(v.key)}
          className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-sm ${
            isActive
              ? 'bg-base-02 text-base-06'
              : 'text-base-04 hover:bg-base-01'
          }`}
        >
          <span>{v.label}</span>
          <span className="text-xs text-base-04">{count}</span>
        </button>
      );
    })}
  </div>
</aside>
```

**Step 3: Manual + TypeScript**

Set `viewingTasks=true` in devtools. Confirm view buttons render with counts; clicking switches active highlight; counts match visible tasks once Task 8 is done.

Run: `cd packages/web && npx --no-install tsc --noEmit`. Expected: PASS.

**Step 4: Commit**

```bash
git add packages/web/src/components/tasks/TaskManagerPage.tsx
git commit -m "Add view filter buttons to TaskManagerPage

packages/web/src/components/tasks/TaskManagerPage.tsx: render seven
single-select view buttons (Today / Overdue / Due soon / Starting soon /
No due date / All active / Completed) with live counts from taskStore
selectors. Active button uses bg-base-02; inactive hovers bg-base-01.

Test: tsc --noEmit; manual: open task manager, click each view, confirm
highlight switches and counts are non-negative integers.
Rollback: safe; no task list yet, just filter UI."
```

---

### Task 7: Filter column — priority toggle buttons

**Files:**
- Modify: `packages/web/src/components/tasks/TaskManagerPage.tsx`

**Step 1: Find the `Priority` type**

It's defined alongside the `Task` type. Likely values: `'HIGH' | 'MEDIUM' | 'LOW' | 'NONE'`. Import the type.

**Step 2: Add priority state and button rendering**

```tsx
type Priority = 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';

const PRIORITY_BUTTONS: Array<{
  key: Priority;
  label: string;
  activeBg: string; // CSS color value for background when active
}> = [
  { key: 'HIGH',   label: 'High',   activeBg: 'color-mix(in srgb, var(--base08) 50%, transparent)' },
  { key: 'MEDIUM', label: 'Medium', activeBg: 'color-mix(in srgb, var(--base0D) 50%, transparent)' },
  { key: 'LOW',    label: 'Low',    activeBg: 'color-mix(in srgb, var(--base0B) 50%, transparent)' },
  { key: 'NONE',   label: 'None',   activeBg: 'var(--base02)' },
];

const [activePriorities, setActivePriorities] = useState<Set<Priority>>(new Set());
const togglePriority = (p: Priority) =>
  setActivePriorities((prev) => {
    const next = new Set(prev);
    if (next.has(p)) next.delete(p);
    else next.add(p);
    return next;
  });
```

In the aside, below the views block:

```tsx
<div className="space-y-1">
  <div className="px-2 text-xs font-semibold uppercase tracking-wide text-base-03">Priority</div>
  <div className="flex flex-col gap-1">
    {PRIORITY_BUTTONS.map((p) => {
      const isActive = activePriorities.has(p.key);
      const count = currentViewTasks.filter((t) => (t.priority ?? 'NONE') === p.key).length;
      return (
        <button
          key={p.key}
          onClick={() => togglePriority(p.key)}
          className={`flex items-center justify-between rounded-md px-2 py-1 text-sm ${
            isActive ? 'text-base-06' : 'text-base-04 hover:bg-base-01'
          }`}
          style={isActive ? { backgroundColor: p.activeBg } : undefined}
        >
          <span>{p.label}</span>
          <span className="text-xs">{count}</span>
        </button>
      );
    })}
  </div>
</div>
```

`currentViewTasks` is computed in Task 8; for now it can be `tasks` or `[]`.

**Step 3: TypeScript + manual**

Run tsc. Manually verify: clicking High shows red-faded fill; Medium shows blue; Low shows green; None shows neutral `bg-base-02`; multiple can be active at once.

**Step 4: Commit**

```bash
git add packages/web/src/components/tasks/TaskManagerPage.tsx
git commit -m "Add priority toggle buttons to TaskManagerPage

packages/web/src/components/tasks/TaskManagerPage.tsx: multi-select
priority buttons (High/Medium/Low/None). Active fills use 50%-mixed
theme colors — base08 (red), base0D (blue), base0B (green) — and base02
for None. Inactive uses standard inactive sidebar styling.

Test: tsc --noEmit; manual: click each priority, confirm color matches
spec, multi-select works.
Rollback: safe; filter not yet applied to a list."
```

---

### Task 8: Compute `currentViewTasks` and render the task list

**Files:**
- Modify: `packages/web/src/components/tasks/TaskManagerPage.tsx`

**Step 1: Compose view + priority filters**

```tsx
const viewedTasks = VIEWS.find((v) => v.key === activeView)!.selector(tasks);
const currentViewTasks =
  activePriorities.size === 0
    ? viewedTasks
    : viewedTasks.filter((t) => activePriorities.has((t.priority ?? 'NONE') as Priority));
```

**Step 2: Render task rows**

A new `TaskRow` subcomponent in the same file (or extracted to `tasks/TaskRow.tsx` if it gets long). It should render: priority badge, content, page-name chip, dueDate / startDate with urgency styling.

For the urgency styling, reuse the existing helper from `packages/web/src/lib/dateUtils.ts` (`getUrgencyStyle` or similar). Follow how `SidebarTodos.tsx` formats and styles dates — copy that approach so the visual language is consistent.

```tsx
{currentViewTasks.length === 0 ? (
  <p className="px-2 py-4 text-sm text-base-04">{emptyMessage(activeView)}</p>
) : (
  <ul className="space-y-1">
    {currentViewTasks.map((t) => (
      <TaskRow key={t.id} task={t} />
    ))}
  </ul>
)}
```

`emptyMessage` returns view-specific text:
- `today` → "Nothing due today"
- `overdue` → "No overdue tasks"
- `dueSoon` → "Nothing due in the next 7 days"
- `startingSoon` → "Nothing starting in the next 7 days"
- `noDueDate` → "Every task has a due date"
- `allActive` → "No active tasks"
- `completed` → "No completed tasks"

**Step 3: Click-through navigation**

`TaskRow` makes the content area clickable:

```tsx
const navigateToPage = usePageStore((s) => s.navigateToPage);
// ...
<button
  onClick={() => navigateToPage(task.pageName)}
  className="text-left ..."
>
  {task.content}
</button>
```

`navigateToPage` already clears `viewingTasks` (Task 4), so this naturally exits the task manager. Block-focus on arrival is a stretch goal — skip for v1.

**Step 4: TypeScript + manual**

Run tsc. Switch through every view — counts on filter buttons match list length. Toggle priorities — list narrows. Click a task — page opens.

**Step 5: Commit**

```bash
git add packages/web/src/components/tasks/TaskManagerPage.tsx
git commit -m "Render task list with view + priority filters

packages/web/src/components/tasks/TaskManagerPage.tsx: TaskRow
subcomponent shows priority, content, page name, and dates with urgency
styling (reusing dateUtils). Compose active view with priority
multi-select. View-specific empty states. Click content navigates to
source page (which clears viewingTasks via existing pageStore action).

Test: tsc --noEmit; manual: cycle views, toggle priorities, click a
task and verify it opens the source page.
Rollback: safe; reverting yields a stub task manager but doesn't break
other features."
```

---

## Phase 4 — Sidebar integration

### Task 9: Collapsed-sidebar `SidebarBadge`

**Files:**
- Modify: `packages/web/src/components/sidebar/Sidebar.tsx`

**Step 1: Inline the badge in the collapsed branch**

The collapsed branch is around Sidebar.tsx:338–358 per the design doc. Insert between the journal icon and the expand chevron:

```tsx
{(() => {
  const tasks = useTaskStore((s) => s.tasks);
  const count = selectBadgeCount(tasks);
  if (count === 0) return null;
  const display = count <= 9 ? String(count) : '*';
  return (
    <button
      onClick={() => usePageStore.getState().openTaskManager()}
      className="flex h-8 w-8 items-center justify-center"
      aria-label={`Open task manager — ${count} due or overdue`}
      title={`${count} due/overdue tasks (Alt+Shift+T)`}
    >
      <span
        className="flex h-5 w-6 items-center justify-center rounded text-xs font-semibold text-base-07"
        style={{ backgroundColor: 'color-mix(in srgb, var(--base08) 50%, transparent)' }}
      >
        {display}
      </span>
    </button>
  );
})()}
```

If using inline-IIFE feels awkward, extract to a `SidebarBadge` component in the same file or `sidebar/SidebarBadge.tsx`. Either is fine.

**Step 2: TypeScript + manual**

Run tsc. Collapse the sidebar. Open a page, mark a block as a task with today's date, save, return to the collapsed sidebar — badge appears with count `1`. Add 10 such tasks (or fake it temporarily) — badge displays `*`. Click badge → full-canvas task manager opens.

**Step 3: Commit**

```bash
git add packages/web/src/components/sidebar/Sidebar.tsx
git commit -m "Add due/overdue task badge to collapsed sidebar

packages/web/src/components/sidebar/Sidebar.tsx: when sidebar is
collapsed and selectBadgeCount > 0, render a small red-faded pill (1-9
or '*' for 10+) between the today's-journal and expand-chevron icons.
Click opens the task manager.

Test: tsc --noEmit; manual: collapse sidebar with active tasks dated
today, verify badge shows count, click navigates to task manager.
Rollback: safe; only affects collapsed-sidebar rendering."
```

---

### Task 10: Expand button in `SidebarTodos` panel header

**Files:**
- Modify: `packages/web/src/components/sidebar/SidebarTodos.tsx`

**Step 1: Add a header row with the expand button**

If the panel already has a header bar, append the button to the right edge. If not, add a minimal one:

```tsx
import { Maximize2 } from 'lucide-react';
import { usePageStore } from '../../stores/pageStore';
// ...
<div className="flex items-center justify-end px-2 py-1">
  <button
    onClick={() => usePageStore.getState().openTaskManager()}
    className="rounded p-1 text-base-04 hover:bg-base-01 hover:text-base-06"
    aria-label="Expand task manager to full view"
    title="Expand task manager (Alt+Shift+T)"
  >
    <Maximize2 size={14} />
  </button>
</div>
```

**Step 2: TypeScript + manual**

Run tsc. Open todos panel; expand button visible top-right. Click → full-canvas task manager opens.

**Step 3: Commit**

```bash
git add packages/web/src/components/sidebar/SidebarTodos.tsx
git commit -m "Add expand-to-full-view button in sidebar todos header

packages/web/src/components/sidebar/SidebarTodos.tsx: small Maximize2
icon button in the panel header. Click opens TaskManagerPage in the
main canvas — same handler as the collapsed-sidebar badge.

Test: tsc --noEmit; manual: open todos panel, click expand button,
verify task manager opens.
Rollback: safe; UI-only addition."
```

---

### Task 11: Register `Alt+Shift+T` global shortcut

**Files:**
- Modify: wherever the global keyboard shortcuts are registered (likely `packages/web/src/hooks/useKeyboardShortcuts.ts` or similar — search the codebase for the existing Alt+Shift+J binding to find the file).

**Step 1: Locate the registration point**

```bash
grep -rn "Alt+Shift+J\|altKey.*shiftKey.*'j'\|'KeyJ'" packages/web/src
```

Add a parallel binding for `'KeyT'` that calls `usePageStore.getState().openTaskManager()`.

**Step 2: TypeScript + manual**

Run tsc. With the app focused (not in an editor), press Alt+Shift+T → task manager opens. Confirm Alt+Shift+J still works.

**Step 3: Update CLAUDE.md shortcut list**

In `/home/cbl/Projects/Tend/CLAUDE.md`, find the keyboard shortcut list (the "Use `Alt+Shift+<key>` for formatting" section) and add:

```
- Alt+Shift+T: Task manager
```

**Step 4: Commit**

```bash
git add packages/web/src CLAUDE.md
git commit -m "Add Alt+Shift+T shortcut for task manager

packages/web/src/hooks/useKeyboardShortcuts.ts (or equivalent): bind
Alt+Shift+T to open the task manager. Tooltips on collapsed-sidebar
badge and sidebar-panel expand button already advertise this shortcut.
CLAUDE.md: document the new shortcut.

Test: tsc --noEmit; manual: press Alt+Shift+T from a non-editor focus,
verify task manager opens; confirm Alt+Shift+J still works.
Rollback: safe; key binding only, no other behavior change."
```

---

## Phase 5 — Polish

### Task 12: CHANGELOG + final smoke test

**Files:**
- Modify: `CHANGELOG.md`

**Step 1: Add CHANGELOG entry**

Under `## [Unreleased]` → `### Added`:

```markdown
- Collapsed-sidebar badge showing count of due/overdue tasks (`1`-`9` or `*` for 10+), red-faded background, click opens task manager.
- Full-canvas task manager view (`Alt+Shift+T`) with view filters (Today / Overdue / Due soon / Starting soon / No due date / All active / Completed) and priority multi-select. Reachable from the collapsed-sidebar badge or an expand button on the sidebar todos panel.
- New `taskStore` (Zustand) consolidating task fetch and selectors so the badge, sidebar panel, and full-canvas view share one source of truth.
```

**Step 2: Smoke test**

- Sidebar collapsed, no due/overdue → no badge.
- Sidebar collapsed, 1 due task → badge shows `1`.
- Add 10+ due tasks → badge shows `*`.
- Click badge → task manager opens with `Today` view selected.
- Cycle every view; counts update; lists match.
- Toggle priorities individually → list narrows; combinations work; colors match (red/blue/green/neutral).
- Click a task → source page opens; task manager closes.
- Open todos panel from sidebar; click expand button → task manager opens.
- Press `Alt+Shift+T` from various focus contexts → task manager opens.
- Edit a task on a page, save, return → badge / panel / full view all reflect the change without manual refresh.

**Step 3: Commit**

```bash
git add CHANGELOG.md
git commit -m "Document task manager + collapsed-sidebar badge in CHANGELOG

CHANGELOG.md: log the collapsed-sidebar due-task badge, full-canvas
task manager view, Alt+Shift+T shortcut, and the new taskStore.

Test: read CHANGELOG.
Rollback: safe; documentation only."
```

---

## Done criteria

- All 12 tasks committed.
- `tsc --noEmit` passes.
- Smoke test from Task 12 fully clean.
- No regressions in `SidebarTodos` (sidebar panel still works as before).
- Branch ready to merge to trunk via the standard CHANGELOG-in-merge-commit flow described in `CLAUDE.md`.

## Out of scope (deferred — do not implement)

- "By page" filter / grouping.
- Persistence of filter state across sessions.
- Block-focus on click-through.
- Bulk operations.
- Sort controls.
- Frontend test infrastructure (separate decision; not blocking this feature).

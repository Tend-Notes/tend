# Session State

## OBJECTIVE
Task manager feature implementation complete on v0.2/task-manager-page; awaiting user smoke test + merge.

## PLAN
[x] Brainstorm + design (b86484c)
[x] Implementation plan (77228a8)
[x] Task 1-12: taskStore, pageStore routing, TaskManagerPage UI, sidebar badge, expand button, Alt+Shift+T, CHANGELOG
[x] Final review fixes: popstate handler (dfd1470), close URL restore (db02515), dedupe sidebar fetch (45e8d1e)
[ ] User smoke test
[ ] Merge to trunk

## STATUS
- Branch v0.2/task-manager-page, 22 commits ahead of trunk (head 45e8d1e)
- tsc --noEmit clean
- All review-flagged criticals addressed

## DECISIONS
- taskStore is module-level singleton; subscription on pageStore.currentPage.version drives refresh
- `/tasks` URL handled by initializeFromUrl + popstate; closeTaskManager calls history.back
- Priority values are numeric strings ('3'/'2'/'1') with 'none' sentinel
- Status badge per row deferred (implementer judgment, user may want it)
- Sidebar.tsx nav panel switched from local fetch to taskStore (eliminated double-fetch)

## SMOKE TEST CHECKLIST (for user)
- Collapsed sidebar with 1 due/overdue task -> badge shows count
- 10+ due tasks -> badge shows '*'
- Click badge -> task manager opens
- Cycle all 7 views; counts update
- Toggle priorities; multi-select works; colors red/blue/green/neutral
- Click task -> source page opens (journal tasks route to journal URL)
- Click X close -> URL restored, refresh stays on prior page
- Alt+Shift+T from various contexts -> opens manager
- Edit task on a page, save -> badge & lists update without manual refresh
- Direct nav to /tasks -> task manager opens

## WORKING SET
- packages/web/src/stores/taskStore.ts (new)
- packages/web/src/components/tasks/TaskManagerPage.tsx (new)
- packages/web/src/lib/renderTaskContent.tsx (new, shared with SidebarTodos)
- packages/web/src/stores/pageStore.ts
- packages/web/src/components/sidebar/{Sidebar,SidebarTodos}.tsx
- packages/web/src/components/layout/MainContent.tsx
- packages/web/src/App.tsx
- CHANGELOG.md

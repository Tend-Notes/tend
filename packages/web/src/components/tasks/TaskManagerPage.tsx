// SPDX-License-Identifier: MIT WITH Commons-Clause
import { useState } from 'react';
import { usePageStore } from '../../stores/pageStore';
import {
  useTaskStore,
  selectToday,
  selectOverdue,
  selectDueSoon,
  selectStartingSoon,
  selectNoDueDate,
  selectAllActive,
  selectCompleted,
  type Task,
} from '../../stores/taskStore';
import { renderContentWithWikilinks } from '../../lib/renderTaskContent';
import { nextStatusKeyword, taskContentWithStatus, taskContentWithText, statusColorVar } from '../../lib/taskStatus';
import { TaskMetadata } from '../editor/TaskMetadata';

// '3' = high, '2' = medium, '1' = low, 'none' = sentinel for null priority
type Priority = '3' | '2' | '1' | 'none';

const PRIORITY_BUTTONS: Array<{
  key: Priority;
  label: string;
  activeBg: string;
}> = [
  { key: '3',    label: 'High',   activeBg: 'color-mix(in srgb, var(--base08) 50%, transparent)' },
  { key: '2',    label: 'Medium', activeBg: 'color-mix(in srgb, var(--base0D) 50%, transparent)' },
  { key: '1',    label: 'Low',    activeBg: 'color-mix(in srgb, var(--base0B) 50%, transparent)' },
  { key: 'none', label: 'None',   activeBg: 'var(--base02)' },
];

type ViewKey =
  | 'today'
  | 'overdue'
  | 'dueSoon'
  | 'startingSoon'
  | 'noDueDate'
  | 'allActive'
  | 'completed';

const VIEWS: Array<{ key: ViewKey; label: string; selector: (t: Task[]) => Task[] }> = [
  { key: 'today',        label: 'Today',         selector: selectToday },
  { key: 'overdue',      label: 'Overdue',       selector: selectOverdue },
  { key: 'dueSoon',      label: 'Due soon',      selector: selectDueSoon },
  { key: 'startingSoon', label: 'Starting soon', selector: selectStartingSoon },
  { key: 'noDueDate',    label: 'No due date',   selector: selectNoDueDate },
  { key: 'allActive',    label: 'All active',    selector: selectAllActive },
  { key: 'completed',    label: 'Completed',     selector: selectCompleted },
];

function emptyMessage(view: ViewKey): string {
  switch (view) {
    case 'today':        return 'Nothing due today';
    case 'overdue':      return 'No overdue tasks';
    case 'dueSoon':      return 'Nothing due in the next 7 days';
    case 'startingSoon': return 'Nothing starting in the next 7 days';
    case 'noDueDate':    return 'Every task has a due date';
    case 'allActive':    return 'No active tasks';
    case 'completed':    return 'No completed tasks';
  }
}

function TaskRow({
  task,
  onOpen,
  navigateToPage,
  navigateToJournal,
}: {
  task: Task;
  onOpen: (task: Task) => void;
  navigateToPage: (name: string) => void;
  navigateToJournal: (date: string) => void;
}) {
  const updateTask = useTaskStore((s) => s.updateTask);
  const [editingText, setEditingText] = useState(false);
  const [draft, setDraft] = useState(task.content);

  const isCompleted = task.status === 'DONE' || task.status === 'NEVER';

  const cycleStatus = () => {
    const next = nextStatusKeyword(task.status);
    if (next) updateTask(task.uuid, { content: taskContentWithStatus(task, next) });
  };
  const startEdit = () => { setDraft(task.content); setEditingText(true); };
  const commitEdit = () => {
    setEditingText(false);
    if (draft !== task.content) updateTask(task.uuid, { content: taskContentWithText(task, draft) });
  };

  // Reconstruct the block properties TaskMetadata reads — same data, off-page.
  const properties: Record<string, string> = {};
  if (task.dueDate) properties.due_date = task.dueDate;
  if (task.startDate) properties.start_date = task.startDate;
  if (task.priority) properties.priority = task.priority;
  if (task.workLog) properties.work_log = task.workLog;

  return (
    <li className="px-2 py-1.5 rounded-lg hover:bg-base-01 transition-colors">
      <div className="flex items-start gap-2">
        {/* Status pill — click cycles to the next status (parity with the editor badge). */}
        <button
          onClick={cycleStatus}
          className="flex-shrink-0 rounded font-semibold"
          style={{
            padding: '1px 6px',
            fontSize: '0.7rem',
            backgroundColor: `var(--${statusColorVar(task.status)}, #666)`,
            color: 'var(--base00, #fff)',
          }}
          title="Click to cycle status"
        >
          {task.status}
        </button>
        {/* Task text — rendered (with clickable wikilinks); double-click to edit. */}
        {editingText ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); commitEdit(); }
              else if (e.key === 'Escape') { setDraft(task.content); setEditingText(false); }
            }}
            className="text-sm flex-1 bg-base-00 border border-base-02 rounded px-1 py-0.5 text-base-06"
          />
        ) : (
          <span
            className="text-sm flex-1 text-base-05"
            onDoubleClick={startEdit}
            title="Double-click to edit"
          >
            {task.content
              ? renderContentWithWikilinks(task.content, navigateToPage, navigateToJournal)
              : <span className="italic text-base-04">(empty)</span>}
          </span>
        )}
      </div>

      {/* Source page — the task manager's one addition; click to open it. */}
      <button
        onClick={() => onOpen(task)}
        className="mt-1 ml-0.5 text-xs text-base-04 hover:text-base-06 hover:underline"
        title="Open page"
      >
        {task.pageTitle ?? task.pageName}
      </button>

      {/* The exact same task-metadata widget the editor uses (due / start /
          priority / work timer), fed this task's own data and page. */}
      <TaskMetadata
        blockUuid={task.uuid}
        properties={properties}
        onPropertyChange={(key, value) => updateTask(task.uuid, { properties: { [key]: value } })}
        isCompleted={isCompleted}
        taskContent={task.content}
        taskPage={{ name: task.pageName, contentType: task.contentType, sheetDate: task.journalDate }}
      />
    </li>
  );
}

export function TaskManagerPage() {
  const closeTaskManager = usePageStore((s) => s.closeTaskManager);
  const navigateToPage = usePageStore((s) => s.navigateToPage);
  const navigateToJournal = usePageStore((s) => s.navigateToJournal);
  const [activeView, setActiveView] = useState<ViewKey>('today');
  const [activePriorities, setActivePriorities] = useState<Set<Priority>>(new Set());
  const tasks = useTaskStore((s) => s.tasks);

  const togglePriority = (p: Priority) =>
    setActivePriorities((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });

  const openTask = (task: Task) => {
    if (task.isJournal && task.journalDate) {
      navigateToJournal(task.journalDate);
    } else {
      navigateToPage(task.pageName);
    }
  };

  const viewedTasks = VIEWS.find((v) => v.key === activeView)!.selector(tasks);
  const filteredTasks =
    activePriorities.size === 0
      ? viewedTasks
      : viewedTasks.filter((t) => activePriorities.has((t.priority ?? 'none') as Priority));

  return (
    // min-w-0 + overflow-hidden give this flex item an implicit min-width of 0
    // (like the normal editor <main>), so wide task content can't force the
    // width up and squeeze the sibling app sidebar to zero (it would otherwise
    // vanish and the content shift left — seen only in views with wide content,
    // e.g. Completed).
    <div className="flex h-full w-full min-w-0 flex-col overflow-hidden bg-base-00 text-base-05">
      <header className="flex items-center justify-between px-6 py-4">
        <h1 className="text-lg font-semibold text-base-06">Tasks</h1>
        <button
          onClick={closeTaskManager}
          className="rounded p-1 text-base-04 hover:bg-base-01 hover:text-base-06"
          aria-label="Close task manager"
          title="Close"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </header>
      <div className="flex flex-1 gap-6 overflow-hidden px-6 pb-6">
        <aside className="w-[200px] shrink-0 space-y-4">
          <div className="space-y-0.5">
            {VIEWS.map((v) => {
              const count = v.selector(tasks).length;
              const isActive = activeView === v.key;
              return (
                <button
                  key={v.key}
                  onClick={() => setActiveView(v.key)}
                  className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-sm transition-colors ${
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
          <div className="space-y-1">
            <div className="px-2 text-xs font-semibold uppercase tracking-wide text-base-03">
              Priority
            </div>
            <div className="flex flex-col gap-1">
              {PRIORITY_BUTTONS.map((p) => {
                const isActive = activePriorities.has(p.key);
                return (
                  <button
                    key={p.key}
                    onClick={() => togglePriority(p.key)}
                    className={`flex items-center justify-between rounded-md px-2 py-1 text-sm transition-colors ${
                      isActive ? 'text-base-06' : 'text-base-04 hover:bg-base-01'
                    }`}
                    style={isActive ? { backgroundColor: p.activeBg } : undefined}
                  >
                    <span>{p.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </aside>
        <main className="flex-1 min-w-0 overflow-y-auto">
          {filteredTasks.length === 0 ? (
            <p className="px-2 py-4 text-sm text-base-04">{emptyMessage(activeView)}</p>
          ) : (
            <ul className="space-y-1">
              {filteredTasks.map((t) => (
                <TaskRow
                  key={t.uuid}
                  task={t}
                  onOpen={openTask}
                  navigateToPage={navigateToPage}
                  navigateToJournal={navigateToJournal}
                />
              ))}
            </ul>
          )}
        </main>
      </div>
    </div>
  );
}

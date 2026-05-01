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

type Priority = 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';

const PRIORITY_BUTTONS: Array<{
  key: Priority;
  label: string;
  activeBg: string;
}> = [
  { key: 'HIGH',   label: 'High',   activeBg: 'color-mix(in srgb, var(--base08) 50%, transparent)' },
  { key: 'MEDIUM', label: 'Medium', activeBg: 'color-mix(in srgb, var(--base0D) 50%, transparent)' },
  { key: 'LOW',    label: 'Low',    activeBg: 'color-mix(in srgb, var(--base0B) 50%, transparent)' },
  { key: 'NONE',   label: 'None',   activeBg: 'var(--base02)' },
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

export function TaskManagerPage() {
  const closeTaskManager = usePageStore((s) => s.closeTaskManager);
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
        <main className="flex-1 overflow-y-auto">
          {/* task list — Task 8 */}
        </main>
      </div>
    </div>
  );
}

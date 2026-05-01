// SPDX-License-Identifier: MIT WITH Commons-Clause
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
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </header>
      <div className="flex flex-1 gap-6 overflow-hidden px-6 pb-6">
        <aside className="w-[200px] shrink-0">
          {/* filter column — Task 6+ */}
        </aside>
        <main className="flex-1 overflow-y-auto">
          {/* task list — Task 8 */}
        </main>
      </div>
    </div>
  );
}

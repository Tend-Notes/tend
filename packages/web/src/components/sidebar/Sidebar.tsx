// SPDX-License-Identifier: MIT WITH Commons-Clause
import { usePageStore } from '../../stores/pageStore'
import { useUIStore } from '../../stores/uiStore'
import { SidebarHistory } from './SidebarHistory'
import { SidebarOptions } from './SidebarOptions'

export type SidebarMode = 'navigation' | 'history' | 'graph' | 'options'

interface SidebarProps {
  mode: SidebarMode
  onModeChange: (mode: SidebarMode) => void
}

export function Sidebar({ mode, onModeChange }: SidebarProps) {
  const { pages, journals, currentPageName, navigateToPage, navigateToJournal, loadTodaysJournal } =
    usePageStore()
  const { sidebarOpen, sidebarWidth, toggleSidebar } = useUIStore()

  // Get current page info for history
  const currentPage = pages.find(p => p.name === currentPageName)
    || journals.find(j => j.name === currentPageName)
  const isCurrentJournal = currentPage?.isJournal ?? false

  // Render content based on mode
  const renderContent = () => {
    switch (mode) {
      case 'history':
        return (
          <SidebarHistory
            onBack={() => onModeChange('navigation')}
            pageName={currentPageName}
            isJournal={isCurrentJournal}
          />
        )

      case 'graph':
        return (
          <div className="flex-1 flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between p-3 border-b border-base-02">
              <button
                onClick={() => onModeChange('navigation')}
                className="p-1 text-base-04 hover:text-base-05 transition-colors"
                title="Back to navigation"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <span className="text-sm font-medium text-base-05">Graph</span>
              <div className="w-4" /> {/* Spacer for alignment */}
            </div>
            {/* Graph placeholder */}
            <div className="flex-1 flex items-center justify-center p-4 text-base-04 text-sm">
              Graph visualization coming soon...
            </div>
          </div>
        )

      case 'options':
        return (
          <SidebarOptions onBack={() => onModeChange('navigation')} />
        )

      default:
        return (
          <>
            {/* Header with collapse button */}
            <div className="flex items-center justify-between p-3">
              <button
                onClick={() => loadTodaysJournal()}
                className="px-2 py-1 text-sm text-base-04 hover:text-base-05 transition-colors"
              >
                Today
              </button>
              <button
                onClick={toggleSidebar}
                className="p-1 text-base-03 hover:text-base-05 transition-colors"
                title="Close sidebar (Alt+Shift+S)"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M11 19l-7-7 7-7M19 19l-7-7 7-7" />
                </svg>
              </button>
            </div>

            {/* Navigation */}
            <div className="flex-1 overflow-y-auto px-3">
              {/* Recent journals */}
              {journals.length > 0 && (
                <div className="mb-4">
                  <h2 className="px-2 py-1 text-xs text-base-03 uppercase tracking-wide">
                    Journals
                  </h2>
                  <ul>
                    {journals.slice(0, 7).map((journal) => (
                      <li key={journal.name}>
                        <button
                          onClick={() => navigateToJournal(journal.journalDate!)}
                          className={`w-full px-2 py-1 text-left text-sm transition-colors ${
                            currentPageName === journal.name
                              ? 'text-base-06'
                              : 'text-base-04 hover:text-base-05'
                          }`}
                        >
                          {journal.title}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Pages */}
              {pages.length > 0 && (
                <div>
                  <h2 className="px-2 py-1 text-xs text-base-03 uppercase tracking-wide">
                    Pages
                  </h2>
                  <ul>
                    {pages.map((page) => (
                      <li key={page.name}>
                        <button
                          onClick={() => navigateToPage(page.name)}
                          className={`w-full px-2 py-1 text-left text-sm transition-colors ${
                            currentPageName === page.name
                              ? 'text-base-06'
                              : 'text-base-04 hover:text-base-05'
                          }`}
                        >
                          {page.title}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </>
        )
    }
  }

  // Width animates between collapsed (32px) and expanded
  const currentWidth = sidebarOpen ? sidebarWidth : 32

  return (
    <aside
      className="sidebar flex flex-col overflow-hidden"
      style={{ width: currentWidth, backgroundColor: 'var(--sidebar-bg)' }}
    >
      {/* Collapsed state: just show toggle button */}
      {!sidebarOpen ? (
        <div className="flex flex-col items-center py-3">
          <button
            onClick={toggleSidebar}
            className="p-1 text-base-03 hover:text-base-05 transition-colors"
            title="Open sidebar (Alt+Shift+S)"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 5l7 7-7 7M5 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      ) : (
        <>
          <div className="sidebar-content flex-1 flex flex-col overflow-hidden">
            {/* Key changes with mode to trigger animation */}
            <div key={mode} className="sidebar-mode-content flex-1 flex flex-col overflow-hidden">
              {renderContent()}
            </div>
          </div>

          {/* Bottom toolbar: Graph, History, Options - always visible when open */}
          <div className="flex justify-end gap-1 p-[10px] border-t border-base-02">
            <button
              onClick={() => onModeChange(mode === 'graph' ? 'navigation' : 'graph')}
              className={`p-2 rounded-lg transition-colors ${
                mode === 'graph' ? 'text-base-06 bg-base-02' : 'text-base-04 hover:text-base-05'
              }`}
              style={{ boxShadow: 'inset 0 0 0 1px var(--base02)' }}
              title="Graph view"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                {/* Central node */}
                <circle cx="12" cy="12" r="3" />
                {/* Radiating lines and outer nodes */}
                <line x1="12" y1="12" x2="12" y2="3" stroke="currentColor" strokeWidth="1.5" />
                <circle cx="12" cy="3" r="2" />
                <line x1="12" y1="12" x2="20" y2="8" stroke="currentColor" strokeWidth="1.5" />
                <circle cx="20" cy="8" r="2" />
                <line x1="12" y1="12" x2="19" y2="17" stroke="currentColor" strokeWidth="1.5" />
                <circle cx="19" cy="17" r="2" />
                <line x1="12" y1="12" x2="5" y2="18" stroke="currentColor" strokeWidth="1.5" />
                <circle cx="5" cy="18" r="2" />
                <line x1="12" y1="12" x2="4" y2="9" stroke="currentColor" strokeWidth="1.5" />
                <circle cx="4" cy="9" r="2" />
              </svg>
            </button>
            <button
              onClick={() => onModeChange(mode === 'history' ? 'navigation' : 'history')}
              className={`p-2 rounded-lg transition-colors ${
                mode === 'history' ? 'text-base-06 bg-base-02' : 'text-base-04 hover:text-base-05'
              }`}
              style={{ boxShadow: 'inset 0 0 0 1px var(--base02)' }}
              title="History"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 3v5h5" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 7v5l4 2" />
              </svg>
            </button>
            <button
              onClick={() => onModeChange(mode === 'options' ? 'navigation' : 'options')}
              className={`p-2 rounded-lg transition-colors ${
                mode === 'options' ? 'text-base-06 bg-base-02' : 'text-base-04 hover:text-base-05'
              }`}
              style={{ boxShadow: 'inset 0 0 0 1px var(--base02)' }}
              title="Options (Alt+Shift+O)"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
              </svg>
            </button>
          </div>
        </>
      )}
    </aside>
  )
}

// Re-export for use elsewhere if needed
export type { SidebarProps }

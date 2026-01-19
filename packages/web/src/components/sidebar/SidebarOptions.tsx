// SPDX-License-Identifier: MIT WITH Commons-Clause
// Sidebar options view - settings and configuration

interface SidebarOptionsProps {
  onBack: () => void
}

export function SidebarOptions({ onBack }: SidebarOptionsProps) {
  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-base-02">
        <button
          onClick={onBack}
          className="p-1 text-base-04 hover:text-base-05 transition-colors"
          title="Back to navigation"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <span className="text-sm font-medium text-base-05">Options</span>
        <div className="w-4" /> {/* Spacer for alignment */}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3">
        <p className="text-sm text-base-04">Options panel coming soon...</p>
      </div>
    </div>
  )
}

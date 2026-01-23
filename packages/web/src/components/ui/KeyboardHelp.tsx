// SPDX-License-Identifier: MIT WITH Commons-Clause
// Keyboard shortcuts help overlay

interface KeyboardHelpProps {
  open: boolean
  onClose: () => void
}

const shortcuts = [
  { category: 'Navigation', items: [
    { keys: ['Alt', 'Shift', 'P'], description: 'Open command palette' },
    { keys: ['Alt', 'Shift', 'S'], description: 'Toggle sidebar' },
    { keys: ['Alt', 'Shift', 'F'], description: 'Search' },
    { keys: ['Alt', 'Shift', 'O'], description: 'Open options' },
    { keys: ['Ctrl', 'Shift', '/'], description: 'Show keyboard shortcuts' },
  ]},
  { category: 'Editor', items: [
    { keys: ['Enter'], description: 'Create new block' },
    { keys: ['Backspace'], description: 'Merge with previous (at start)' },
    { keys: ['Tab'], description: 'Indent block' },
    { keys: ['Shift', 'Tab'], description: 'Outdent block' },
  ]},
  { category: 'Formatting', items: [
    { keys: ['Alt', 'Shift', 'B'], description: 'Bold' },
    { keys: ['Alt', 'Shift', 'I'], description: 'Italic' },
    { keys: ['Alt', 'Shift', 'U'], description: 'Underline' },
    { keys: ['Alt', 'Shift', '-'], description: 'Strikethrough' },
    { keys: ['Alt', 'Shift', 'H'], description: 'Highlight' },
  ]},
  { category: 'Links', items: [
    { keys: ['[['], description: 'Create wiki-link' },
    { keys: ['(('], description: 'Create block reference' },
  ]},
]

function KeyboardHelp({ open, onClose }: KeyboardHelpProps) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="overlay-backdrop fixed inset-0 bg-black/50 animate-fade-in"
        onClick={onClose}
      />

      {/* Dialog */}
      <div className="overlay-content relative bg-base-01 rounded-lg shadow-2xl border border-base-02 p-6 max-w-2xl w-full mx-4 max-h-[80vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-medium text-base-06">Keyboard Shortcuts</h2>
          <button
            onClick={onClose}
            className="p-1 text-base-04 hover:text-base-05 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {shortcuts.map((section) => (
            <div key={section.category}>
              <h3 className="text-xs uppercase tracking-wide text-base-04 mb-3">
                {section.category}
              </h3>
              <div className="space-y-2">
                {section.items.map((item, idx) => (
                  <div key={idx} className="flex items-center justify-between">
                    <span className="text-sm text-base-05">{item.description}</span>
                    <div className="flex items-center gap-1">
                      {item.keys.map((key, keyIdx) => (
                        <kbd
                          key={keyIdx}
                          className="px-2 py-0.5 text-xs bg-base-02 text-base-05 rounded border border-base-03"
                        >
                          {key}
                        </kbd>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-6 pt-4 border-t border-base-02 text-center">
          <span className="text-xs text-base-04">
            Press <kbd className="px-1.5 py-0.5 bg-base-02 text-base-05 rounded text-xs">Esc</kbd> or{' '}
            <kbd className="px-1.5 py-0.5 bg-base-02 text-base-05 rounded text-xs">Ctrl</kbd>+
            <kbd className="px-1.5 py-0.5 bg-base-02 text-base-05 rounded text-xs">Shift</kbd>+
            <kbd className="px-1.5 py-0.5 bg-base-02 text-base-05 rounded text-xs">/</kbd> to close
          </span>
        </div>
      </div>
    </div>
  )
}

export default KeyboardHelp

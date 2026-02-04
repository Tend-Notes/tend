// SPDX-License-Identifier: MIT WITH Commons-Clause
// Save status indicator - shows sync state as a subtle outlined pill
// Clicking navigates to /tags/{status} for more info

import { usePageStore } from '../../stores/pageStore'
import { useSyncStatusStore, type SyncStatus } from '../../stores/syncStatusStore'

const statusConfig: Record<SyncStatus, { label: string; className: string }> = {
  unsaved: {
    label: 'unsaved',
    className: 'border-base-08 text-base-08 hover:bg-base-08/10', // red/orange - needs attention
  },
  saved: {
    label: 'saved',
    className: 'border-base-03 text-base-04 hover:bg-base-03/10', // subtle gray
  },
  stored: {
    label: 'stored',
    className: 'border-base-03 text-base-04 hover:bg-base-03/10', // subtle gray
  },
  'backed up': {
    label: 'backed up',
    className: 'border-base-0B text-base-0B hover:bg-base-0B/10', // green - fully safe
  },
}

export function SaveStatus() {
  const { status } = useSyncStatusStore()
  const navigateToPage = usePageStore((state) => state.navigateToPage)
  const config = statusConfig[status]

  const handleClick = () => {
    // Navigate to the tag page for this status
    // Tag names use the status label (e.g., "unsaved", "saved", "stored", "backed up")
    navigateToPage(`tags/${config.label}`)
  }

  return (
    <button
      onClick={handleClick}
      className={`
        inline-flex items-center
        px-2 py-0.5
        text-[10px] font-medium
        border rounded
        bg-transparent
        cursor-pointer
        transition-colors
        ${config.className}
      `}
      title={`Click to learn more about "${config.label}" status`}
    >
      {config.label}
    </button>
  )
}

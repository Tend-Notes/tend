// SPDX-License-Identifier: MIT WITH Commons-Clause
// Block selection state.
//
// anchor/focus mark a multi-block selection range; focusedBlockUuid tracks which
// block last had keyboard focus.

import { create } from 'zustand'

interface SelectionState {
  // Anchor: where selection started (like text selection anchor)
  anchorUuid: string | null

  // Focus: where selection currently ends (like text selection focus)
  focusUuid: string | null

  // Which block currently has keyboard focus
  focusedBlockUuid: string | null

  setFocusedBlock: (uuid: string) => void
  clearSelection: () => void

  // Computed helpers (need flatBlockOrder from caller for index lookup)
  getSelectedRange: (flatBlockOrder: string[]) => { start: number; end: number } | null
  isInSelection: (uuid: string, flatBlockOrder: string[]) => boolean
}

export const useSelectionStore = create<SelectionState>()((set, get) => ({
  anchorUuid: null,
  focusUuid: null,
  focusedBlockUuid: null,

  setFocusedBlock: (uuid) => {
    set({ focusedBlockUuid: uuid })
  },

  clearSelection: () => {
    set({ anchorUuid: null, focusUuid: null })
  },

  getSelectedRange: (flatBlockOrder) => {
    const { anchorUuid, focusUuid } = get()
    if (!anchorUuid || !focusUuid) return null

    const anchorIndex = flatBlockOrder.indexOf(anchorUuid)
    const focusIndex = flatBlockOrder.indexOf(focusUuid)

    if (anchorIndex === -1 || focusIndex === -1) return null

    return {
      start: Math.min(anchorIndex, focusIndex),
      end: Math.max(anchorIndex, focusIndex),
    }
  },

  isInSelection: (uuid, flatBlockOrder) => {
    const range = get().getSelectedRange(flatBlockOrder)
    if (!range) return false

    // Single block isn't a "multi-block selection"
    if (range.start === range.end) return false

    const index = flatBlockOrder.indexOf(uuid)
    return index >= range.start && index <= range.end
  },
}))

// SPDX-License-Identifier: MIT WITH Commons-Clause
// Block selection state management (range-based, like text selection)
//
// Key concepts:
// - anchor: where selection started (fixed point)
// - focus: where selection currently ends (moves as user extends)
// - focusedBlockUuid: which block has keyboard focus (for Shift+Arrow navigation)
//
// The focusedBlockUuid tracks which block last received focus, so Shift+Arrow
// can extend selection from the correct position (the selection focus, not the
// keyboard-focused block).

import { create } from 'zustand'

interface SelectionState {
  // Anchor: where selection started (like text selection anchor)
  anchorUuid: string | null

  // Focus: where selection currently ends (like text selection focus)
  focusUuid: string | null

  // Which block currently has keyboard focus (for knowing where Shift+Arrow originates)
  focusedBlockUuid: string | null

  // Is the user currently dragging to select?
  isDragging: boolean

  // Actions
  setFocusedBlock: (uuid: string) => void
  startSelection: (uuid: string) => void
  extendSelection: (uuid: string) => void
  extendSelectionInDirection: (direction: 'up' | 'down', flatBlockOrder: string[]) => string | null
  clearSelection: () => void
  startDrag: (uuid: string) => void
  endDrag: () => void

  // Computed helpers (need flatBlockOrder from caller for index lookup)
  getSelectedRange: (flatBlockOrder: string[]) => { start: number; end: number } | null
  isInSelection: (uuid: string, flatBlockOrder: string[]) => boolean
  getSelectedUuids: (flatBlockOrder: string[]) => string[]
  hasMultiBlockSelection: (flatBlockOrder: string[]) => boolean
}

export const useSelectionStore = create<SelectionState>()((set, get) => ({
  anchorUuid: null,
  focusUuid: null,
  focusedBlockUuid: null,
  isDragging: false,

  setFocusedBlock: (uuid) => {
    set({ focusedBlockUuid: uuid })
  },

  startSelection: (uuid) => {
    set({ anchorUuid: uuid, focusUuid: uuid })
  },

  startDrag: (uuid) => {
    set({ anchorUuid: uuid, focusUuid: uuid, isDragging: true })
  },

  endDrag: () => {
    set({ isDragging: false })
  },

  extendSelection: (uuid) => {
    const { anchorUuid } = get()
    if (!anchorUuid) {
      // No anchor yet - set both anchor and focus to this block
      set({ anchorUuid: uuid, focusUuid: uuid })
    } else {
      // Extend focus to the new block
      set({ focusUuid: uuid })
    }
  },

  // Extend selection in a direction, returning the new focus UUID (or null if can't extend)
  // This is the key fix: we extend from the SELECTION FOCUS, not from the keyboard-focused block
  extendSelectionInDirection: (direction, flatBlockOrder) => {
    const { anchorUuid, focusUuid, focusedBlockUuid } = get()

    // If no selection yet, start from the focused block
    if (!anchorUuid || !focusUuid) {
      if (!focusedBlockUuid) return null
      const focusedIndex = flatBlockOrder.indexOf(focusedBlockUuid)
      if (focusedIndex === -1) return null

      // Start selection at focused block
      set({ anchorUuid: focusedBlockUuid, focusUuid: focusedBlockUuid })

      // Calculate target
      const targetIndex = direction === 'up' ? focusedIndex - 1 : focusedIndex + 1
      if (targetIndex < 0 || targetIndex >= flatBlockOrder.length) return null

      const targetUuid = flatBlockOrder[targetIndex]
      set({ focusUuid: targetUuid })
      return targetUuid
    }

    // Selection exists - extend from the current FOCUS (not the keyboard-focused block)
    const focusIndex = flatBlockOrder.indexOf(focusUuid)
    if (focusIndex === -1) return null

    const targetIndex = direction === 'up' ? focusIndex - 1 : focusIndex + 1
    if (targetIndex < 0 || targetIndex >= flatBlockOrder.length) return null

    const targetUuid = flatBlockOrder[targetIndex]
    set({ focusUuid: targetUuid })
    return targetUuid
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

  getSelectedUuids: (flatBlockOrder) => {
    const range = get().getSelectedRange(flatBlockOrder)
    if (!range) return []
    return flatBlockOrder.slice(range.start, range.end + 1)
  },

  hasMultiBlockSelection: (flatBlockOrder) => {
    const range = get().getSelectedRange(flatBlockOrder)
    if (!range) return false
    return range.end > range.start
  },
}))

// SPDX-License-Identifier: MIT WITH Commons-Clause
//
// One keyboard-driven "filter a list -> pick one OR create new" control. A Page
// is the base case; a custom content type is a Page with an optional namespace
// and/or date attached, so this same control backs all of them — the dated
// panel passes a date filter as `headerRight`, and the namespaced panel stacks
// two of these (a compilation level, then a file level).
//
// Keyboard model (see the palette feature): type to filter; Tab cycles
// search -> results -> create (Shift-Tab reverses); Up/Down also step through
// them. Arrowing a result fills the box (for Create) WITHOUT re-filtering the
// frozen list. Enter commits the active zone — a result via onPick, search or
// create via onCreate with the box's current text.

import { useMemo, useState, type KeyboardEvent, type ReactNode } from 'react'

export interface LinkPickerProps<T> {
  /** Candidate items, already narrowed by any external filter (e.g. a date). */
  items: T[]
  /** Display text for an item (also what fills the box when arrowed onto). */
  getLabel: (item: T) => string
  /** Secondary text shown at the right of a row (e.g. a journal date). */
  getMeta?: (item: T) => string | undefined
  /** Stable React key for an item. */
  getKey: (item: T) => string
  /** Substring predicate; defaults to a case-insensitive getLabel match. */
  matches?: (item: T, query: string) => boolean
  placeholder: string
  autoFocus?: boolean
  /** Whether the box's current text can be created (non-empty, no collision…). */
  canCreate: (box: string) => boolean
  /** Label for the Create row given the box's current text. */
  createLabel: (box: string) => string
  /** Existing item chosen. */
  onPick: (item: T) => void
  /** Create the box's current text. */
  onCreate: (box: string) => void
  onEscape?: () => void
  /** Shift-Tab out of the search zone — lets a parent hand focus to a prior level. */
  onExitBackward?: () => void
  /** Content rendered to the right of the input (e.g. a date-filter button). */
  headerRight?: ReactNode
  /** Min-height for the body (reserve room for an absolute popover like a calendar). */
  bodyMinHeight?: string
  /** Cap on rendered rows. */
  limit?: number
}

const HEADING = 'px-2 pb-1 text-xs font-medium uppercase tracking-wide text-base-04'
const ROW = 'flex items-center justify-between px-3 py-2 text-sm rounded cursor-pointer'

export function LinkPicker<T>({
  items,
  getLabel,
  getMeta,
  getKey,
  matches,
  placeholder,
  autoFocus,
  canCreate,
  createLabel,
  onPick,
  onCreate,
  onEscape,
  onExitBackward,
  headerRight,
  bodyMinHeight,
  limit = 50,
}: LinkPickerProps<T>) {
  // `box` is the live input value and the Create target. `typed` is the last
  // actually-typed query and is what filters — so arrowing fills `box` without
  // reshuffling the frozen list.
  const [box, setBox] = useState('')
  const [typed, setTyped] = useState('')
  const [zone, setZone] = useState<'search' | 'results' | 'create'>('search')
  const [index, setIndex] = useState(0)

  const results = useMemo(() => {
    const q = typed.toLowerCase().trim()
    const match = matches ?? ((it: T, query: string) => getLabel(it).toLowerCase().includes(query))
    return items.filter((it) => match(it, q)).slice(0, limit)
  }, [items, typed, matches, getLabel, limit])

  const showCreate = canCreate(box)

  const enterResults = (at = 0) => {
    if (!results.length) return
    const i = Math.min(Math.max(at, 0), results.length - 1)
    setZone('results')
    setIndex(i)
    setBox(getLabel(results[i]))
  }
  const toSearch = () => {
    setZone('search')
    setBox(typed)
  }
  const moveResult = (delta: number) => {
    const next = index + delta
    if (next < 0) return toSearch()
    if (next > results.length - 1) {
      if (showCreate) setZone('create')
      return
    }
    setIndex(next)
    setBox(getLabel(results[next]))
  }
  const commit = () => {
    if (zone === 'results' && results[index]) onPick(results[index])
    else if (showCreate) onCreate(box)
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') return onEscape?.()
    if (e.key === 'Enter') { e.preventDefault(); return commit() }
    if (e.key === 'Tab') {
      e.preventDefault()
      if (!e.shiftKey) {
        if (zone === 'search') { if (results.length) enterResults(); else if (showCreate) setZone('create') }
        else if (zone === 'results') { if (showCreate) setZone('create'); else toSearch() }
        else toSearch()
      } else {
        if (zone === 'search') {
          if (showCreate) setZone('create')
          else if (results.length) enterResults(results.length - 1)
          else onExitBackward?.()
        } else if (zone === 'create') { if (results.length) enterResults(results.length - 1); else toSearch() }
        else toSearch()
      }
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (zone === 'search') enterResults()
      else if (zone === 'results') moveResult(1)
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (zone === 'results') moveResult(-1)
      else if (zone === 'create') enterResults(results.length - 1)
      return
    }
  }

  return (
    <>
      <div className="flex items-center border-b border-base-02">
        <input
          autoFocus={autoFocus}
          value={box}
          onChange={(e) => { const v = e.target.value; setBox(v); setTyped(v); setZone('search'); setIndex(0) }}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          className="flex-1 px-4 py-3 bg-transparent text-base-05 placeholder:text-base-04 focus:outline-none"
        />
        {headerRight}
      </div>
      <div className="flex flex-col max-h-80" style={bodyMinHeight ? { minHeight: bodyMinHeight } : undefined}>
        <div className="flex-1 min-h-0 overflow-y-auto p-2">
          {results.length > 0 && (
            <div>
              <div className={HEADING}>Existing</div>
              {results.map((it, i) => (
                <div
                  key={getKey(it)}
                  onClick={() => onPick(it)}
                  className={`${ROW} ${zone === 'results' && index === i ? 'bg-base-02' : 'hover:bg-base-02'}`}
                >
                  <span>{getLabel(it)}</span>
                  {getMeta?.(it) && <span className="ml-2 text-xs text-base-04">{getMeta(it)}</span>}
                </div>
              ))}
            </div>
          )}
          {results.length === 0 && !typed.trim() && (
            <div className="py-6 text-center text-sm text-base-04">Type to filter or create.</div>
          )}
        </div>
        {showCreate && (
          <div className="shrink-0 border-t border-base-02 p-2">
            <div className={HEADING}>Create new</div>
            <div
              onClick={() => onCreate(box)}
              className={`${ROW} ${zone === 'create' ? 'bg-base-02' : 'hover:bg-base-02'}`}
            >
              <span>{createLabel(box)}</span>
            </div>
          </div>
        )}
      </div>
    </>
  )
}

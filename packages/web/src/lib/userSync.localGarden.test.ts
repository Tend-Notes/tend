// SPDX-License-Identifier: MIT WITH Commons-Clause
//
// The canary test: nothing a local garden holds may reach the server.
//
// Written in the shape of the local registry's "records only what the server
// must never learn" — the policy as an executing test rather than a paragraph,
// so a field added to one of these stores later fails here instead of quietly
// shipping someone's note titles.
//
// A canary string goes into every place UI state touches garden content — a
// sheet name, a sheet title, a tag name, a work session's task text — and then
// every outbound payload is checked for it. This covers the network half; the
// at-rest half (localStorage, IndexedDB, Cache Storage) arrives with the
// per-garden UI-state file in task 5.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { PageMeta } from '../types'

const CANARY = 'ZZCANARYZZ'

// userSync's only server dependency. Mocked wholesale so no payload can escape
// and every attempt is recorded.
const savePrefs = vi.fn(async () => {})
const saveState = vi.fn(async () => {})
const getPrefs = vi.fn(async () => ({}) as Record<string, unknown>)
const getState = vi.fn(async () => ({}) as Record<string, unknown>)

vi.mock('./api', () => ({
  user: { savePrefs, saveState, getPrefs, getState },
}))

const { setActiveBackend, resetBackendForTests } = await import('./backend')
const { startSync, stopSync, loadUserState } = await import('./userSync')
const { useRecentSheetsStore } = await import('../stores/recentSheetsStore')
const { useTagStore } = await import('../stores/tagStore')
const { useWorkSessionStore } = await import('../stores/workSessionStore')
const { useUIStore } = await import('../stores/uiStore')
const { useSettingsStore } = await import('../stores/settingsStore')

function sheet(name: string): PageMeta {
  return {
    name,
    title: `${CANARY} title`,
    contentType: 'page',
    isJournal: false,
    journalDate: null,
    blockCount: 3,
    createdAt: '2026-10-29T00:00:00Z',
    modifiedAt: '2026-10-29T00:00:00Z',
  }
}

/** Everything a visit to a sheet in a local garden records. */
function workInTheGarden(): void {
  useRecentSheetsStore.getState().recordAccess('page', sheet(`notes/${CANARY}`))
  useRecentSheetsStore.getState().recordTagAccess(`${CANARY}-tag`)
  useTagStore.getState().ensureTag(`${CANARY}-tag`)
  useWorkSessionStore
    .getState()
    .startSession('block-1', `notes/${CANARY}`, 'page', undefined, `${CANARY} task text`)
}

const beacon = vi.fn((_url: string, _body?: BodyInit) => true)

/**
 * Every byte userSync tried to send, by either route.
 *
 * sendBeacon takes a Blob, and `String(blob)` is the useless `[object Blob]` —
 * so the body is read out properly. A canary assertion against the stringified
 * Blob would pass no matter what the payload held.
 */
async function everythingSent(): Promise<string> {
  const beacons = await Promise.all(
    beacon.mock.calls.map(([, body]) =>
      body instanceof Blob ? body.text() : Promise.resolve(String(body))
    )
  )
  const posts = [...savePrefs.mock.calls, ...saveState.mock.calls].map((args) =>
    JSON.stringify(args)
  )
  return [...beacons, ...posts].join('\n')
}

/** Listeners userSync registered on window, so beforeunload can be fired. */
const windowListeners = new Map<string, () => void>()

/** Fire the beforeunload flush — the route that does not wait for a debounce. */
function unload(): void {
  const flush = windowListeners.get('beforeunload')
  expect(flush, 'userSync registers a beforeunload flush').toBeTypeOf('function')
  flush!()
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('navigator', { sendBeacon: beacon })
  windowListeners.clear()
  vi.stubGlobal('window', {
    addEventListener: (event: string, fn: () => void) => windowListeners.set(event, fn),
    removeEventListener: (event: string) => windowListeners.delete(event),
  })
  savePrefs.mockClear()
  saveState.mockClear()
  getState.mockClear()
  beacon.mockClear()
  useRecentSheetsStore.getState().reset()
  useTagStore.getState().reset()
  useWorkSessionStore.getState().clearSession()
})

afterEach(() => {
  stopSync()
  resetBackendForTests()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('a local garden sends nothing', () => {
  it('posts no UI state, by either route, however much work happens', async () => {
    startSync()
    setActiveBackend({ kind: 'local', gardenId: 'work-notes' })
    await vi.advanceTimersByTimeAsync(10)

    workInTheGarden()
    await vi.advanceTimersByTimeAsync(5000)

    expect(saveState).not.toHaveBeenCalled()
    expect(await everythingSent()).not.toContain(CANARY)
  })

  it('sends nothing on unload either, which is the route that bypasses the debounce', async () => {
    startSync()
    setActiveBackend({ kind: 'local', gardenId: 'work-notes' })
    await vi.advanceTimersByTimeAsync(10)

    workInTheGarden()
    unload()

    expect(beacon).not.toHaveBeenCalled()
    expect(await everythingSent()).not.toContain(CANARY)
  })

  it('still syncs preferences, which carry no garden content', async () => {
    startSync()
    setActiveBackend({ kind: 'local', gardenId: 'work-notes' })
    await vi.advanceTimersByTimeAsync(10)

    useSettingsStore.getState().setFontSizePreset('large')
    await vi.advanceTimersByTimeAsync(2000)

    expect(savePrefs).toHaveBeenCalled()
    expect(await everythingSent()).not.toContain(CANARY)
  })
})

describe('switching away from a local garden', () => {
  it('drops the local garden content instead of posting it under the next session', async () => {
    startSync()
    setActiveBackend({ kind: 'local', gardenId: 'work-notes' })
    await vi.advanceTimersByTimeAsync(10)
    workInTheGarden()

    setActiveBackend({ kind: 'server' })
    await vi.advanceTimersByTimeAsync(10)

    // The stores are empty, so there is nothing of the local garden left to send.
    expect(useRecentSheetsStore.getState().recentSheets).toEqual({})
    expect(useRecentSheetsStore.getState().recentTags).toEqual([])
    expect(useTagStore.getState().tags).toEqual({})
    expect(useWorkSessionStore.getState().activeSession).toBeNull()

    // And the state the server holds is read back rather than overwritten.
    expect(getState).toHaveBeenCalled()

    // A real change in the server garden now does post — without the canary.
    useUIStore.getState().setSidebarWidth(321)
    await vi.advanceTimersByTimeAsync(2000)

    expect(saveState).toHaveBeenCalled()
    expect(await everythingSent()).not.toContain(CANARY)
  })
})

describe('a server garden is unaffected', () => {
  it('posts UI state including recents, as it always did', async () => {
    startSync()
    await loadUserState()
    useRecentSheetsStore.getState().recordAccess('page', sheet('notes/Ordinary'))
    await vi.advanceTimersByTimeAsync(2000)

    expect(saveState).toHaveBeenCalled()
    const sent = JSON.stringify(saveState.mock.calls)
    expect(sent).toContain('notes/Ordinary')
  })

  it('beacons on unload, so the local garden assertion above is not vacuous', async () => {
    startSync()
    await loadUserState()
    useRecentSheetsStore.getState().recordAccess('page', sheet('notes/Ordinary'))
    unload()

    expect(beacon).toHaveBeenCalled()
    expect(await everythingSent()).toContain('notes/Ordinary')
  })
})

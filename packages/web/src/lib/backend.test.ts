// SPDX-License-Identifier: MIT WITH Commons-Clause
//
// The backend selector's contract. Small, but load-bearing: every guard that
// keeps a local garden's content off the network reads `isLocalGarden()`, so
// the rules about what a valid backend looks like are asserted here rather
// than trusted.

import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  activeBackend,
  isLocalGarden,
  onBackendChange,
  resetBackendForTests,
  setActiveBackend,
  type ActiveBackend,
} from './backend'

afterEach(() => resetBackendForTests())

describe('backend selection', () => {
  it('starts on the server, since that is what a build without demo mode is', () => {
    expect(activeBackend()).toEqual({ kind: 'server' })
    expect(isLocalGarden()).toBe(false)
  })

  it('switches to a local garden', () => {
    setActiveBackend({ kind: 'local', gardenId: 'work-notes' })

    expect(activeBackend()).toEqual({ kind: 'local', gardenId: 'work-notes' })
    expect(isLocalGarden()).toBe(true)
  })

  it('refuses a local backend with no garden', () => {
    // An unidentified local backend would address no directory at all, and the
    // guards downstream would be protecting a garden nothing can name.
    expect(() => setActiveBackend({ kind: 'local' })).toThrow(/needs a gardenId/)
    expect(isLocalGarden()).toBe(false)
  })

  it('refuses a garden id on a backend that has no gardens of its own', () => {
    expect(() => setActiveBackend({ kind: 'server', gardenId: 'work-notes' })).toThrow(
      /no gardenId/
    )
  })
})

describe('switch notifications', () => {
  it('reports the new and the previous backend, with the change already applied', () => {
    const seen: Array<[ActiveBackend, ActiveBackend, boolean]> = []
    onBackendChange((next, previous) => seen.push([next, previous, isLocalGarden()]))

    setActiveBackend({ kind: 'local', gardenId: 'notes' })

    expect(seen).toEqual([[{ kind: 'local', gardenId: 'notes' }, { kind: 'server' }, true]])
  })

  it('says nothing when the same garden is selected again', () => {
    const listener = vi.fn()
    setActiveBackend({ kind: 'local', gardenId: 'notes' })
    onBackendChange(listener)

    setActiveBackend({ kind: 'local', gardenId: 'notes' })
    expect(listener).not.toHaveBeenCalled()

    // A different local garden is a switch, though.
    setActiveBackend({ kind: 'local', gardenId: 'other' })
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('stops notifying once unsubscribed', () => {
    const listener = vi.fn()
    const off = onBackendChange(listener)
    off()

    setActiveBackend({ kind: 'local', gardenId: 'notes' })
    expect(listener).not.toHaveBeenCalled()
  })
})

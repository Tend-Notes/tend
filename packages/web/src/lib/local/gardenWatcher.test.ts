// SPDX-License-Identifier: MIT WITH Commons-Clause
//
// The folder watcher, and the three things it has to get right.
//
// Our own saves must not come back as changes, or every save reloads the note
// just saved. A burst from a sync client must coalesce, or a single remote
// change causes a dozen reloads. And a record saying events were *missed* means
// the folder's state is unknown, which is a different outcome entirely — not a
// path to reload, but a garden to re-read.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { FakeDirectoryHandle } from './handleFake'
import { LocalFolderStore } from './LocalFolderStore'
import { canWatch, watchGarden } from './gardenWatcher'

describe('garden watcher', () => {
  let root: FakeDirectoryHandle
  let store: LocalFolderStore
  let changed: string[][]
  let desynchronized: number

  beforeEach(() => {
    vi.useFakeTimers()
    root = FakeDirectoryHandle.create()
    store = new LocalFolderStore(root.asHandle())
    changed = []
    desynchronized = 0
    vi.stubGlobal('FileSystemObserver', root.observerClass())
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  function watch(debounceMs = 500) {
    return watchGarden(
      root.asHandle(),
      store,
      {
        onChanged: (paths) => changed.push(paths),
        onDesynchronized: () => {
          desynchronized += 1
        },
      },
      { debounceMs }
    )
  }

  it('is unavailable without the browser API, and says so rather than failing', () => {
    vi.stubGlobal('FileSystemObserver', undefined)
    expect(canWatch()).toBe(false)

    const watcher = watch()
    expect(watcher.active).toBe(false)
    // Safe to stop something that never started.
    expect(() => watcher.stop()).not.toThrow()
  })

  it('observes the garden recursively when the API is there', () => {
    expect(canWatch()).toBe(true)
    const watcher = watch()
    expect(watcher.active).toBe(true)
    expect(root.observerCount).toBe(1)

    watcher.stop()
    expect(root.observerCount).toBe(0)
  })

  it('reports a change made outside Tend', () => {
    watch()
    root.emit([{ type: 'modified', relativePathComponents: ['pages', 'Shopping.md'] }])

    // Nothing yet: the window has not closed.
    expect(changed).toEqual([])
    vi.advanceTimersByTime(500)
    expect(changed).toEqual([['pages/Shopping.md']])
  })

  it('coalesces a burst for one path into a single report', () => {
    watch()
    // What a sync client looks like: several records for the same file.
    for (const type of ['appeared', 'modified', 'modified'] as const) {
      root.emit([{ type, relativePathComponents: ['pages', 'Shopping.md'] }])
    }
    vi.advanceTimersByTime(500)

    expect(changed).toEqual([['pages/Shopping.md']])
  })

  it('reports several changed paths together', () => {
    watch()
    root.emit([
      { type: 'modified', relativePathComponents: ['pages', 'A.md'] },
      { type: 'appeared', relativePathComponents: ['pages', 'B.md'] },
      { type: 'disappeared', relativePathComponents: ['pages', 'C.md'] },
    ])
    vi.advanceTimersByTime(500)

    expect(changed).toHaveLength(1)
    expect(changed[0].sort()).toEqual(['pages/A.md', 'pages/B.md', 'pages/C.md'])
  })

  it('does not report our own save back to us', async () => {
    watch()
    // A real write through the store, which fires a `modified` record exactly
    // as the browser would, and holds the path while it is in flight.
    await store.write('pages/Shopping.md', '- milk\n')
    vi.advanceTimersByTime(500)

    expect(changed).toEqual([])
  })

  it('reports a later outside change to a path we once wrote', async () => {
    watch()
    await store.write('pages/Shopping.md', '- milk\n')
    vi.advanceTimersByTime(500)
    expect(changed).toEqual([])

    // The write is finished, so the path is no longer held: someone else's
    // change to the same file must get through.
    root.emit([{ type: 'modified', relativePathComponents: ['pages', 'Shopping.md'] }])
    vi.advanceTimersByTime(500)
    expect(changed).toEqual([['pages/Shopping.md']])
  })

  describe('missed events', () => {
    it('re-reads the garden rather than guessing which file changed', () => {
      watch()
      root.emit([{ type: 'unknown', relativePathComponents: [] }])

      // Immediate: there is nothing to coalesce when the state is unknown.
      expect(desynchronized).toBe(1)
      expect(changed).toEqual([])
    })

    it('drops paths already pending, since they can no longer be trusted', () => {
      watch()
      root.emit([{ type: 'modified', relativePathComponents: ['pages', 'A.md'] }])
      root.emit([{ type: 'unknown', relativePathComponents: [] }])
      vi.advanceTimersByTime(500)

      expect(desynchronized).toBe(1)
      expect(changed).toEqual([])
    })

    it('treats a failed observation the same way', () => {
      watch()
      root.emit([{ type: 'errored', relativePathComponents: [] }])
      expect(desynchronized).toBe(1)
    })
  })

  it('reports nothing after it is stopped', () => {
    const watcher = watch()
    watcher.stop()

    root.emit([{ type: 'modified', relativePathComponents: ['pages', 'A.md'] }])
    root.emit([{ type: 'unknown', relativePathComponents: [] }])
    vi.advanceTimersByTime(500)

    expect(changed).toEqual([])
    expect(desynchronized).toBe(0)
  })

  it('ignores a record with no path', () => {
    watch()
    root.emit([{ type: 'modified', relativePathComponents: [] }])
    vi.advanceTimersByTime(500)
    expect(changed).toEqual([])
  })
})

// SPDX-License-Identifier: MIT WITH Commons-Clause
//
// Noticing when the garden folder changes underneath Tend.
//
// `FileSystemObserver` shipped in Chrome and Edge 133, so a local garden does
// get a watcher and the folder updating behaves the way it does for a server
// garden. Desktop only, which fits the target; a browser without it falls back
// to the manual reload, which is why that stays.
//
// # Concepts
//
//   - **record** — one change the browser reports: `appeared`, `disappeared`,
//     `modified`, `moved`, `unknown` or `errored`, with the path components
//     relative to the directory being observed.
//   - **our own write** — a save Tend just made, which fires `modified` like
//     any other change. The store knows which paths it is writing; those
//     records are dropped, or every save would reload the note just saved.
//   - **debounce window** — a cloud-synced folder is noisy: one remote change
//     can arrive as a burst of creates, renames and modifications. Records are
//     coalesced per path before anything acts on them. The server does the same
//     with notify-debouncer-full on 500ms.
//   - **`unknown`** — events were *missed*, not something strange. The only
//     safe response is to re-read the whole garden.
//
// One observer on the garden root, recursive: there is an undocumented
// per-origin limit on concurrent observations, and one observer is also all
// this needs.

import type { LocalFolderStore } from './LocalFolderStore'

/** What the browser hands the observer callback. */
interface FileSystemChangeRecord {
  type: 'appeared' | 'disappeared' | 'modified' | 'moved' | 'unknown' | 'errored'
  relativePathComponents: string[]
}

interface FileSystemObserverLike {
  observe(handle: FileSystemHandle, options?: { recursive?: boolean }): void | Promise<void>
  disconnect(): void
}

type ObserverConstructor = new (
  callback: (records: FileSystemChangeRecord[]) => void
) => FileSystemObserverLike

/** Whether this browser can watch a folder at all. */
export function canWatch(): boolean {
  return typeof (globalThis as { FileSystemObserver?: unknown }).FileSystemObserver === 'function'
}

export interface WatcherCallbacks {
  /**
   * Paths that changed, garden-relative. Already filtered of our own writes and
   * coalesced over the debounce window.
   */
  onChanged: (paths: string[]) => void
  /**
   * Events were missed, so nothing about the folder can be assumed. The caller
   * re-reads the garden.
   */
  onDesynchronized: () => void
}

export interface GardenWatcher {
  /** Stop watching. Safe to call more than once. */
  stop: () => void
  /** Whether a watcher is actually running, as opposed to unsupported. */
  readonly active: boolean
}

/** The window over which a burst of records for one path is coalesced. */
const DEBOUNCE_MS = 500

/**
 * Watch a garden's directory, reporting what changed.
 *
 * Returns an inactive watcher when the browser has no `FileSystemObserver`;
 * the caller falls back to the manual reload rather than being told it failed.
 */
export function watchGarden(
  directory: FileSystemDirectoryHandle,
  store: LocalFolderStore,
  callbacks: WatcherCallbacks,
  options: { debounceMs?: number } = {}
): GardenWatcher {
  const Observer = (globalThis as { FileSystemObserver?: ObserverConstructor })
    .FileSystemObserver
  if (!Observer) return { stop: () => {}, active: false }

  const debounceMs = options.debounceMs ?? DEBOUNCE_MS
  let pending = new Set<string>()
  let timer: ReturnType<typeof setTimeout> | null = null
  let stopped = false

  const flush = () => {
    timer = null
    if (stopped || pending.size === 0) return
    const paths = [...pending]
    pending = new Set()
    callbacks.onChanged(paths)
  }

  const observer = new Observer((records) => {
    if (stopped) return

    for (const record of records) {
      // Events were missed; nothing about the folder can be trusted, so the
      // per-path accounting is pointless and the whole garden is re-read.
      if (record.type === 'unknown') {
        pending = new Set()
        if (timer) {
          clearTimeout(timer)
          timer = null
        }
        callbacks.onDesynchronized()
        return
      }

      // 'errored' means this observation has stopped working. Treated the same
      // way: we no longer know the folder's state.
      if (record.type === 'errored') {
        callbacks.onDesynchronized()
        return
      }

      const path = record.relativePathComponents.join('/')
      if (!path) continue
      // Our own save. The store holds the path for the duration of the write.
      if (store.isWriting(path)) continue
      pending.add(path)
    }

    if (pending.size > 0 && !timer) timer = setTimeout(flush, debounceMs)
  })

  // `observe` can reject — a folder that has gone, or permission withdrawn.
  // That is the same condition the permission check reports, so it surfaces as
  // a desynchronized garden rather than an unhandled rejection.
  void Promise.resolve(observer.observe(directory, { recursive: true })).catch(() => {
    if (!stopped) callbacks.onDesynchronized()
  })

  return {
    active: true,
    stop: () => {
      if (stopped) return
      stopped = true
      if (timer) clearTimeout(timer)
      timer = null
      pending = new Set()
      observer.disconnect()
    },
  }
}

// SPDX-License-Identifier: MIT WITH Commons-Clause
//
// Which backend serves the active garden.
//
// `api.ts` used to choose at module load — `isDemoMode ? demoApi.pages :
// _pages` — and that cannot express a local-folder garden, because the choice
// belongs to the garden the user switched into, not to the build.
//
// Deliberately tiny and dependency-free. `api.ts` and `userSync.ts` both ask it
// what is active, so anything imported here would risk a cycle with them.

/** Where the active garden's files live, and therefore who serves them. */
export type BackendKind = 'server' | 'demo' | 'local'

/** Set at build time. Seeds the initial backend; never changes afterwards. */
export const isDemoMode = import.meta.env.VITE_DEMO_MODE === 'true'

export interface ActiveBackend {
  readonly kind: BackendKind
  /**
   * Registry id of the open local garden. Present only for `local`, where every
   * read and write is addressed relative to that garden's directory.
   */
  readonly gardenId?: string
}

const initial: ActiveBackend = { kind: isDemoMode ? 'demo' : 'server' }

let active: ActiveBackend = initial
const listeners = new Set<(next: ActiveBackend, previous: ActiveBackend) => void>()

/** What is serving the active garden right now. */
export function activeBackend(): ActiveBackend {
  return active
}

/**
 * True when the active garden's files live in a folder on this machine and must
 * not reach the server. Read this rather than comparing `kind` at call sites:
 * it is the question callers actually mean.
 */
export function isLocalGarden(): boolean {
  return active.kind === 'local'
}

/**
 * Switch backends. Called by the garden switch, and by nothing else — the
 * active backend is a consequence of which garden is open.
 *
 * Listeners run after the change, so `activeBackend()` already reports the new
 * value when they do. A switch to the same garden is dropped.
 */
export function setActiveBackend(next: ActiveBackend): void {
  // A local garden is always identified: its files are addressed by id, and an
  // unidentified one would silently read the wrong directory or none.
  if (next.kind === 'local') {
    if (!next.gardenId) throw new Error('a local backend needs a gardenId')
  } else if (next.gardenId) {
    throw new Error(`a ${next.kind} backend has no gardenId`)
  }

  if (next.kind === active.kind && next.gardenId === active.gardenId) return

  const previous = active
  active = next
  for (const notify of listeners) notify(active, previous)
}

/**
 * Subscribe to backend switches. Returns the unsubscribe.
 *
 * Switching gardens is the moment every in-memory and synced copy of the old
 * garden's content has to be dropped, so this is how that gets wired rather
 * than each store polling.
 */
export function onBackendChange(
  listener: (next: ActiveBackend, previous: ActiveBackend) => void
): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Tests only: back to the build-time default, with no listeners attached. */
export function resetBackendForTests(): void {
  active = initial
  listeners.clear()
}

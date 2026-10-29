// SPDX-License-Identifier: MIT WITH Commons-Clause
//
// Choosing an API implementation per call, not per build.
//
// `api.ts` used to pick once at module load — `isDemoMode ? demoApi.pages :
// _pages` — which cannot express a local-folder garden: the choice belongs to
// the garden the user switched into. A dispatcher asks `backend.ts` at call
// time instead.
//
// # Two rules that are the point of this module
//
// **It fails closed.** A group with no implementation for the active backend,
// or a method missing from one, throws. It never falls through to the server
// implementation. For a local garden that fallback would POST the contents of a
// folder the user chose precisely because it must not leave the machine — so
// the failure mode has to be a visible error, not a silent upload.
//
// **The other implementations stay out of the main chunk.** Each is reached
// through a dynamic import, as the build-time ternary managed by being
// tree-shaken. Every API function already returns a promise, so there is
// nothing to change at the call sites.

import { activeBackend, type BackendKind } from './backend'

/** An API group: methods that return promises, and nothing else. */
type Group = Record<string, (...args: never[]) => unknown>

/**
 * Where a backend's implementation of a group comes from.
 *
 * `demo` and `local` are typed as the *whole* group, not a partial one, so a
 * method added to the server implementation is a compile error until that
 * backend has it too. A backend that cannot serve the group at all omits its
 * loader entirely, which is the explicit way to say so.
 */
export interface GroupSources<G extends Group> {
  server: G
  demo?: () => Promise<G>
  local?: () => Promise<G>
}

/** No implementation of this group for the backend serving the active garden. */
export class UnsupportedHereError extends Error {
  constructor(
    readonly group: string,
    readonly method: string,
    readonly kind: BackendKind
  ) {
    super(
      kind === 'local'
        ? `${group}.${method} is not available for a local folder garden`
        : `${group}.${method} is not available in ${kind} mode`
    )
    this.name = 'UnsupportedHereError'
  }
}

// One cached promise per loader, so the module is fetched once however many
// calls race. Keyed by the loader itself, which is stable per group.
const loaded = new WeakMap<() => Promise<Group>, Promise<Group>>()

function load<G extends Group>(loader: () => Promise<G>): Promise<G> {
  let pending = loaded.get(loader as () => Promise<Group>)
  if (!pending) {
    pending = loader() as Promise<Group>
    loaded.set(loader as () => Promise<Group>, pending)
  }
  return pending as Promise<G>
}

/**
 * A group whose methods resolve against whichever backend is active when they
 * are called.
 *
 * The returned object has the same type as the server implementation, so call
 * sites are unchanged and a typo is still a compile error.
 */
export function dispatch<G extends Group>(name: string, sources: GroupSources<G>): G {
  const methods = Object.keys(sources.server) as (keyof G & string)[]

  const resolve = async (method: string): Promise<(...args: never[]) => unknown> => {
    const { kind } = activeBackend()
    if (kind === 'server') return sources.server[method]

    const loader = kind === 'demo' ? sources.demo : sources.local
    if (!loader) throw new UnsupportedHereError(name, method, kind)

    const group = await load(loader)
    const fn = group[method]
    // A method the other implementation does not have. Refused here rather
    // than quietly handled by the server's version.
    if (typeof fn !== 'function') throw new UnsupportedHereError(name, method, kind)
    return fn.bind(group) as (...args: never[]) => unknown
  }

  const out = {} as G
  for (const method of methods) {
    // Always async: resolving the backend may need a dynamic import, and every
    // method in these groups already returns a promise.
    out[method] = (async (...args: never[]) =>
      (await resolve(method))(...args)) as G[typeof method]
  }
  return out
}

/**
 * The method names a dispatcher covers, for the test that every one of them
 * resolves on every backend that claims to serve the group.
 */
export function dispatchedMethods<G extends Group>(sources: GroupSources<G>): string[] {
  return Object.keys(sources.server)
}

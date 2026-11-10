// SPDX-License-Identifier: MIT WITH Commons-Clause
//
// The dispatcher, and the one property that matters most about it: a local
// garden's content never reaches the server because a method is missing.
//
// A `??` fallback in here would post the contents of a folder the user chose
// precisely because it must not leave the machine. So the absence of a method
// has to be a thrown error, and these checks say so from several directions.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { dispatch, dispatchedMethods, UnsupportedHereError } from './dispatch'
import { resetBackendForTests, setActiveBackend } from './backend'

describe('dispatch', () => {
  beforeEach(() => resetBackendForTests())
  afterEach(() => resetBackendForTests())

  /** A group with one method, implemented differently per backend. */
  function group(options: { demo?: boolean; local?: boolean } = {}) {
    const server = { read: vi.fn(async (n: number) => `server:${n}`) }
    const demo = { read: vi.fn(async (n: number) => `demo:${n}`) }
    const local = { read: vi.fn(async (n: number) => `local:${n}`) }
    const dispatched = dispatch('thing', {
      server,
      demo: options.demo === false ? undefined : async () => demo,
      local: options.local === false ? undefined : async () => local,
    })
    return { dispatched, server, demo, local }
  }

  it('sends a call to whichever backend is active when it is made', async () => {
    const { dispatched, server, demo, local } = group()

    expect(await dispatched.read(1)).toBe('server:1')

    setActiveBackend({ kind: 'local', gardenId: 'notes' })
    expect(await dispatched.read(2)).toBe('local:2')

    setActiveBackend({ kind: 'demo' })
    expect(await dispatched.read(3)).toBe('demo:3')

    setActiveBackend({ kind: 'server' })
    expect(await dispatched.read(4)).toBe('server:4')

    expect(server.read).toHaveBeenCalledTimes(2)
    expect(demo.read).toHaveBeenCalledTimes(1)
    expect(local.read).toHaveBeenCalledTimes(1)
  })

  it('keeps the method signature, so arguments still arrive', async () => {
    const { dispatched, server } = group()
    await dispatched.read(7)
    expect(server.read).toHaveBeenCalledWith(7)
  })

  describe('failing closed', () => {
    it('throws for a group the local backend does not serve', async () => {
      const { dispatched, server } = group({ local: false })
      setActiveBackend({ kind: 'local', gardenId: 'notes' })

      await expect(dispatched.read(1)).rejects.toThrow(UnsupportedHereError)
      // The point: the server implementation was NOT reached.
      expect(server.read).not.toHaveBeenCalled()
    })

    it('throws for a method the local backend is missing from a group it does serve', async () => {
      const server = {
        read: vi.fn(async () => 'server'),
        write: vi.fn(async () => 'server'),
      }
      // A local implementation that forgot `write`. The real one is typed so
      // this cannot happen, but the runtime refuses it regardless.
      const partial = { read: async () => 'local' } as unknown as typeof server
      const dispatched = dispatch('thing', { server, local: async () => partial })

      setActiveBackend({ kind: 'local', gardenId: 'notes' })
      expect(await dispatched.read()).toBe('local')
      await expect(dispatched.write()).rejects.toThrow(UnsupportedHereError)
      expect(server.write).not.toHaveBeenCalled()
    })

    it('says which garden kind cannot do it, in words a user can act on', async () => {
      const { dispatched } = group({ local: false })
      setActiveBackend({ kind: 'local', gardenId: 'notes' })
      await expect(dispatched.read(1)).rejects.toThrow(
        /thing\.read is not available for a local folder garden/
      )

      const demoless = group({ demo: false })
      setActiveBackend({ kind: 'demo' })
      await expect(demoless.dispatched.read(1)).rejects.toThrow(/not available in demo mode/)
    })
  })

  it('loads an implementation once, however many calls race', async () => {
    const local = { read: async () => 'local' }
    const loader = vi.fn(async () => local)
    const dispatched = dispatch('thing', { server: { read: async () => 'server' }, local: loader })

    setActiveBackend({ kind: 'local', gardenId: 'notes' })
    await Promise.all([dispatched.read(), dispatched.read(), dispatched.read()])
    expect(loader).toHaveBeenCalledTimes(1)
  })

  it('reports the methods it covers', () => {
    expect(
      dispatchedMethods({ server: { a: async () => 1, b: async () => 2 } }).sort()
    ).toEqual(['a', 'b'])
  })
})

// The real groups. This is the check the plan asks for: every method of every
// dispatched group resolves on every backend that claims to serve it, so an
// omission cannot hide until someone clicks the button that needs it.
describe('the real API groups', () => {
  beforeEach(() => resetBackendForTests())
  afterEach(() => resetBackendForTests())

  /** Groups the local backend serves, and the ones only a server can. */
  const LOCAL_SERVED = [
    'pages',
    'journals',
    'search',
    'links',
    'graph',
    'tags',
    'todos',
    'templates',
    'contentTypes',
    'sheets',
    'blocks',
    'user',
    'stabilize',
  ] as const
  const SERVER_ONLY = ['git', 'gardens', 'identity', 'reindex'] as const

  it('has a local implementation of every method of every group it serves', async () => {
    const api = await import('./api')
    const local = await import('./local/localBackend')

    for (const name of LOCAL_SERVED) {
      const serverGroup = api[name] as Record<string, unknown>
      const localGroup = local[name as keyof typeof local] as Record<string, unknown>
      expect(localGroup, `${name} has no local implementation`).toBeDefined()

      for (const method of Object.keys(serverGroup)) {
        expect(
          typeof localGroup[method],
          `${name}.${method} is missing from the local backend`
        ).toBe('function')
      }
    }
  })

  it('has a demo implementation of every method of every group', async () => {
    const api = await import('./api')
    const demo = await import('./demoApi')

    for (const name of [...LOCAL_SERVED, ...SERVER_ONLY]) {
      const serverGroup = api[name] as Record<string, unknown>
      const demoGroup = demo[name as keyof typeof demo] as Record<string, unknown>
      expect(demoGroup, `${name} has no demo implementation`).toBeDefined()

      for (const method of Object.keys(serverGroup)) {
        expect(
          typeof demoGroup[method],
          `${name}.${method} is missing from demo mode`
        ).toBe('function')
      }
    }
  })

  it('refuses a server-only group in a local garden rather than calling the server', async () => {
    const api = await import('./api')
    setActiveBackend({ kind: 'local', gardenId: 'notes' })

    // Git, gardens and reindex belong to a server. A local garden must be told
    // so, not quietly served from the server's own garden.
    await expect(api.git.status()).rejects.toThrow(UnsupportedHereError)
    await expect(api.reindex.rebuildAll()).rejects.toThrow(UnsupportedHereError)
    await expect(api.gardens.list()).rejects.toThrow(UnsupportedHereError)
  })
})

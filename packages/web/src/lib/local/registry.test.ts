// SPDX-License-Identifier: MIT WITH Commons-Clause
//
// The registry contract, written against MemoryRegistry.
//
// IndexedDbRegistry implements the same interface and is deliberately not
// covered here: there is no IndexedDB in the Node test environment, and a fake
// would test the fake. It is exercised for real by the browser e2e in task 8.

import { describe, it, expect } from 'vitest'
import { FakeDirectoryHandle } from './handleFake'
import { MemoryRegistry, type LocalGarden } from './registry'

function garden(id: string, createdAt: string): LocalGarden {
  return { id, name: id, encrypted: false, createdAt }
}

describe('registry', () => {
  it('starts with no root and no gardens', async () => {
    const registry = new MemoryRegistry()
    expect(await registry.getRoot()).toBeNull()
    expect(await registry.listGardens()).toEqual([])
  })

  it('stores and clears the root handle', async () => {
    const registry = new MemoryRegistry()
    const root = FakeDirectoryHandle.create().asHandle()

    await registry.setRoot(root)
    expect(await registry.getRoot()).toBe(root)

    await registry.clearRoot()
    expect(await registry.getRoot()).toBeNull()
  })

  it('lists gardens oldest first, so the order is stable across sessions', async () => {
    const registry = new MemoryRegistry()
    await registry.putGarden(garden('second', '2026-02-01T00:00:00Z'))
    await registry.putGarden(garden('first', '2026-01-01T00:00:00Z'))

    expect((await registry.listGardens()).map((g) => g.id)).toEqual(['first', 'second'])
  })

  it('updates a garden in place rather than duplicating it', async () => {
    const registry = new MemoryRegistry()
    await registry.putGarden(garden('notes', '2026-01-01T00:00:00Z'))
    await registry.putGarden({ ...garden('notes', '2026-01-01T00:00:00Z'), name: 'Renamed' })

    const all = await registry.listGardens()
    expect(all).toHaveLength(1)
    expect(all[0].name).toBe('Renamed')
  })

  it('removes a garden without touching the others', async () => {
    const registry = new MemoryRegistry()
    await registry.putGarden(garden('a', '2026-01-01T00:00:00Z'))
    await registry.putGarden(garden('b', '2026-01-02T00:00:00Z'))

    await registry.removeGarden('a')
    expect((await registry.listGardens()).map((g) => g.id)).toEqual(['b'])
  })

  it('records only what the server must never learn', async () => {
    // The shape is the policy: no paths, no content, no passphrase. If a field
    // is added here, it should be because it belongs on this list.
    const registry = new MemoryRegistry()
    await registry.putGarden(garden('notes', '2026-01-01T00:00:00Z'))

    expect(Object.keys((await registry.listGardens())[0]).sort()).toEqual([
      'createdAt',
      'encrypted',
      'id',
      'name',
    ])
  })
})

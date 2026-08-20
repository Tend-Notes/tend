// SPDX-License-Identifier: MIT WITH Commons-Clause
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('./draftStore', () => ({
  clearAllDrafts: vi.fn().mockResolvedValue(undefined),
}))

import { clearUserScopedContent, clearContentCaches } from './cacheReset'
import { clearAllDrafts } from './draftStore'

afterEach(() => {
  vi.clearAllMocks()
  // @ts-expect-error test cleanup
  delete globalThis.caches
})

describe('clearContentCaches', () => {
  it('deletes the api content caches but NOT drafts (kept for recovery)', async () => {
    const del = vi.fn().mockResolvedValue(true)
    // @ts-expect-error minimal CacheStorage stub for the test
    globalThis.caches = { delete: del }

    await clearContentCaches()

    expect(del).toHaveBeenCalledWith('api-pages')
    expect(del).toHaveBeenCalledWith('api-journals')
    expect(clearAllDrafts).not.toHaveBeenCalled()
  })

  it('is a no-op without Cache Storage', async () => {
    await expect(clearContentCaches()).resolves.toBeUndefined()
    expect(clearAllDrafts).not.toHaveBeenCalled()
  })
})

describe('clearUserScopedContent', () => {
  it('deletes the api content caches and clears drafts', async () => {
    const del = vi.fn().mockResolvedValue(true)
    // @ts-expect-error minimal CacheStorage stub for the test
    globalThis.caches = { delete: del }

    await clearUserScopedContent()

    expect(del).toHaveBeenCalledWith('api-pages')
    expect(del).toHaveBeenCalledWith('api-journals')
    expect(clearAllDrafts).toHaveBeenCalledTimes(1)
  })

  it('still clears drafts when Cache Storage is unavailable', async () => {
    await clearUserScopedContent()
    expect(clearAllDrafts).toHaveBeenCalledTimes(1)
  })

  it('does not reject if a cache deletion fails', async () => {
    const del = vi.fn().mockRejectedValue(new Error('boom'))
    // @ts-expect-error minimal CacheStorage stub for the test
    globalThis.caches = { delete: del }

    await expect(clearUserScopedContent()).resolves.toBeUndefined()
  })
})

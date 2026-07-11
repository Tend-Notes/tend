// SPDX-License-Identifier: MIT WITH Commons-Clause
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('./draftStore', () => ({
  clearAllDrafts: vi.fn().mockResolvedValue(undefined),
}))

import { clearUserScopedContent } from './cacheReset'
import { clearAllDrafts } from './draftStore'

afterEach(() => {
  vi.clearAllMocks()
  // @ts-expect-error test cleanup
  delete globalThis.caches
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

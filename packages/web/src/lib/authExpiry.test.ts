// SPDX-License-Identifier: MIT WITH Commons-Clause
import { describe, it, expect } from 'vitest'
import { isAuthExpiredResponse, checkAuthResponse, AuthExpiredError } from './api'

const ORIGIN = 'https://tend.example.com'

// Build a Response-alike with just the fields isAuthExpiredResponse reads.
// A real Response can't be given a `redirected`/`type` of our choosing.
function res(init: {
  status?: number
  ok?: boolean
  type?: string
  redirected?: boolean
  url?: string
  contentType?: string
}): Response {
  const status = init.status ?? 200
  return {
    status,
    ok: init.ok ?? (status >= 200 && status < 300),
    type: init.type ?? 'basic',
    redirected: init.redirected ?? false,
    url: init.url ?? 'https://tend.example.com/api/v1/pages',
    headers: new Headers(
      init.contentType ? { 'content-type': init.contentType } : { 'content-type': 'application/json' }
    ),
  } as unknown as Response
}

describe('isAuthExpiredResponse', () => {
  it('treats 401 as expired', () => {
    expect(isAuthExpiredResponse(res({ status: 401 }))).toBe(true)
  })

  // Regression: Tend answers routine "feature off for this garden" cases with
  // 403 (block lookups in an encrypted garden). Treating those as an expired
  // session blocked the app on a valid login.
  it('does not treat 403 as expired', () => {
    expect(isAuthExpiredResponse(res({ status: 403 }))).toBe(false)
  })

  it('does not treat a 403 feature_disabled body as expired', () => {
    expect(isAuthExpiredResponse(res({ status: 403, contentType: 'application/json' }))).toBe(false)
  })

  it('treats an opaque redirect as expired', () => {
    expect(isAuthExpiredResponse(res({ status: 0, ok: false, type: 'opaqueredirect' }))).toBe(true)
  })

  it('treats a redirect to another origin as expired', () => {
    expect(
      isAuthExpiredResponse(
        res({ redirected: true, url: 'https://auth.example.com/?rd=https://tend.example.com' }),
        ORIGIN
      )
    ).toBe(true)
  })

  it('treats an HTML body where JSON was expected as expired', () => {
    expect(isAuthExpiredResponse(res({ contentType: 'text/html; charset=utf-8' }))).toBe(true)
  })

  it('does not treat a same-origin redirect as expired', () => {
    expect(
      isAuthExpiredResponse(
        res({ redirected: true, url: 'https://tend.example.com/api/v1/pages/x' }),
        ORIGIN
      )
    ).toBe(false)
  })

  it('does not treat a 500 as expired', () => {
    expect(isAuthExpiredResponse(res({ status: 500 }))).toBe(false)
  })

  it('does not treat a 404 as expired', () => {
    expect(isAuthExpiredResponse(res({ status: 404 }))).toBe(false)
  })

  it('does not treat a 409 version conflict as expired', () => {
    expect(isAuthExpiredResponse(res({ status: 409 }))).toBe(false)
  })

  it('does not treat a normal 200 JSON response as expired', () => {
    expect(isAuthExpiredResponse(res({ status: 200 }))).toBe(false)
  })
})

describe('checkAuthResponse', () => {
  it('throws AuthExpiredError on an expired session', () => {
    expect(() => checkAuthResponse(res({ status: 401 }))).toThrow(AuthExpiredError)
  })

  it('returns quietly on a healthy response', () => {
    expect(() => checkAuthResponse(res({ status: 200 }))).not.toThrow()
  })
})

// SPDX-License-Identifier: MIT WITH Commons-Clause
import { describe, it, expect } from 'vitest'
import { redactRemoteUrl } from './SidebarOptions'

describe('redactRemoteUrl', () => {
  it('strips an embedded token from an https URL', () => {
    expect(redactRemoteUrl('https://user:ghp_TOKEN@github.com/o/r.git')).toBe('https://github.com/o/r.git')
    expect(redactRemoteUrl('https://ghp_TOKEN@github.com/o/r.git')).toBe('https://github.com/o/r.git')
  })

  it('drops userinfo from ssh URLs', () => {
    expect(redactRemoteUrl('ssh://git@host.example/o/r.git')).toBe('ssh://host.example/o/r.git')
  })

  it('leaves a plain https/scp URL unchanged', () => {
    expect(redactRemoteUrl('https://github.com/o/r.git')).toBe('https://github.com/o/r.git')
    expect(redactRemoteUrl('git@github.com:o/r.git')).toBe('git@github.com:o/r.git')
  })

  it('drops a password from an scp-style URL', () => {
    expect(redactRemoteUrl('user:secret@github.com:o/r.git')).toBe('user@github.com:o/r.git')
  })
})

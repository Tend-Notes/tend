// SPDX-License-Identifier: MIT WITH Commons-Clause
// Encryption indicator for the page title row — a fixed-size disc matching
// SaveStatus, so it never reflows the title. Shown only for encrypted gardens:
//   grey   = encrypted, no plaintext index exists
//   orange = encrypted but NOT fully secured, because a plaintext full-text
//            index of every note exists (in memory while unlocked, or left
//            behind on disk, which is worse and gets its own legend).
// Pale disc via color-mix, since Tailwind /opacity doesn't work on our
// var-hex colors (same as SaveStatus).

import { useGardenInfo } from '../../hooks/useGardenInfo'

// Deliberately a literal, not a --baseXX var: this is a warning, and it has to
// stay orange under any of the ~250 Base16 schemes a user can load. Reads as
// orange on both the default dark (#282c34) and light (#fafafa) backgrounds.
const WARNING_ORANGE = '#e07b1f'

function LockIcon() {
  return (
    <svg
      className="w-2.5 h-2.5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
    </svg>
  )
}

export function GardenLockStatus() {
  const { isEncrypted, indexStatus, indexOnDisk } = useGardenInfo()

  if (!isEncrypted) return null

  // An index that is ready, or being built, is a plaintext copy of the notes.
  // 'disabled', 'not_built' and 'expired' all mean there is no such copy.
  const indexResident = indexStatus === 'ready' || indexStatus === 'building'

  let color = 'var(--base04)'
  let mix = '30%'
  let label = 'Encrypted garden — notes are encrypted at rest and no search index exists'

  if (indexOnDisk) {
    color = WARNING_ORANGE
    mix = '20%'
    label =
      'Encrypted garden — an unencrypted search index has been left on disk, so your notes are readable at rest. This should not happen; check the server log.'
  } else if (indexResident) {
    color = WARNING_ORANGE
    mix = '20%'
    label =
      'Encrypted garden, not fully secured — full-text search keeps an unencrypted index of your notes in memory while the garden is unlocked'
  }

  return (
    <span
      className="inline-flex items-center justify-center h-4 w-4 rounded-full transition-colors"
      style={{
        backgroundColor: `color-mix(in srgb, ${color} ${mix}, transparent)`,
        color,
      }}
      title={label}
      aria-label={label}
    >
      <LockIcon />
    </span>
  )
}

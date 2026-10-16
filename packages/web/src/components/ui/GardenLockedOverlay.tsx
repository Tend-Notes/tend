// SPDX-License-Identifier: MIT WITH Commons-Clause
// Shown when the server reports the active garden is encrypted and locked -
// which is what every request says after a restart, since an unlocked garden
// only lives in the server's memory.
//
// There is deliberately no way to dismiss this: with the garden locked there is
// nothing behind it to work on. The sidebar's garden switcher keeps working
// (listing gardens needs no unlocked garden), so someone who can't remember the
// passphrase can still move to another garden.

import { useGardenLockStore } from '../../stores/gardenLockStore'
import { UnlockGardenDialog } from './UnlockGardenDialog'

export function GardenLockedOverlay() {
  const lockedGardenId = useGardenLockStore((s) => s.lockedGardenId)
  const unlocking = useGardenLockStore((s) => s.unlocking)
  const error = useGardenLockStore((s) => s.error)
  const unlock = useGardenLockStore((s) => s.unlock)

  if (!lockedGardenId) return null

  return <UnlockGardenDialog error={error} busy={unlocking} onSubmit={(p) => void unlock(p)} />
}

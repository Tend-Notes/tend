// SPDX-License-Identifier: MIT WITH Commons-Clause
//
// What encrypting a garden actually means, said before the garden exists.
//
// Same shape as the local-folder dialog, and for the same reason: it cannot be
// turned on afterwards, and the one thing that really can go wrong — a
// forgotten passphrase — has no remedy at all. The copy used to sit inline
// under the checkbox as three separate notes, where the consequence that
// matters was the easiest part to scroll past.
//
// The filename point is here because it is the one honest exposure, and the
// only thing about an encrypted garden that is visible on disk.

import { GardenChoiceDialog } from './GardenChoiceDialog'

interface EncryptGardenDialogProps {
  /**
   * True for a garden kept in a local folder, where the passphrase is needed
   * once per browser session rather than after a server restart.
   */
  local: boolean
  onContinue: () => void
  onCancel: () => void
}

function LockIcon() {
  return (
    <svg
      className="w-5 h-5 text-base-0A"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
      />
    </svg>
  )
}

export function EncryptGardenDialog({ local, onContinue, onCancel }: EncryptGardenDialogProps) {
  return (
    <GardenChoiceDialog
      icon={<LockIcon />}
      title="Encrypt this garden"
      intro="Every note will be encrypted on disk with age, to a key your passphrase unwraps. That changes a few things:"
      bullets={[
        <>
          <strong className="text-base-08">
            Forget the passphrase and the notes are gone.
          </strong>{' '}
          There is no reset and no recovery — not by you, not by Tend, not by anyone holding
          the files. Keep it somewhere you will still have it in a year.
        </>,
        <>
          <strong className="text-base-05">Filenames are not encrypted.</strong> Note bodies
          are; their names stay readable on disk, so a sheet called "Divorce settlement" is
          visible to anyone who can see the folder. It is the one thing encryption here does
          not hide.
        </>,
        <>
          <strong className="text-base-05">You unlock it {local ? 'once a session' : 'after every server restart'}.</strong>{' '}
          {local
            ? 'The key is held in memory while the garden is open and dropped when you lock it or close the tab.'
            : 'The server cannot open the garden without the passphrase, so it asks for one each time it starts.'}
        </>,
        <>
          <strong className="text-base-05">Full-text search becomes optional.</strong> An
          index is only useful in the clear, so it is built in memory while the garden is
          unlocked and never written to disk.
        </>,
        <>
          <strong className="text-base-05">
            <code className="text-base-0C">age</code> reads it without Tend.
          </strong>{' '}
          The files are standard age, so <code className="text-base-0C">age -d</code> and your
          passphrase are enough to get a note back by hand.
        </>,
      ]}
      note="A garden cannot be encrypted after it is created."
      onContinue={onContinue}
      onCancel={onCancel}
    />
  )
}

// SPDX-License-Identifier: MIT WITH Commons-Clause
//
// What choosing "local folder" actually means, said before the garden exists.
//
// A local garden is not a storage detail the user can discover later. Its files
// are somewhere only this browser can reach, it is not on their other machines,
// and the features that belong to a server are simply not there. All of that is
// fixed once the garden is created, so it is said up front, with a way to back
// out.
//
// Deliberately not a warning. Keeping notes off a server is the point of the
// feature, not a risk to be talked out of; the list is what changes, not a
// reason to reconsider.

import { GardenChoiceDialog } from './GardenChoiceDialog'

interface LocalGardenDialogProps {
  /** True when a gardens folder has not been chosen yet, which Continue does. */
  needsFolder: boolean
  onContinue: () => void
  onCancel: () => void
}

function FolderIcon() {
  return (
    <svg
      className="w-5 h-5 text-base-0C"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"
      />
    </svg>
  )
}

export function LocalGardenDialog({ needsFolder, onContinue, onCancel }: LocalGardenDialogProps) {
  return (
    <GardenChoiceDialog
      icon={<FolderIcon />}
      title="Keep this garden in a local folder"
      intro="Its notes will live in a folder on this machine and never reach the server. That changes a few things:"
      bullets={[
        <>
          <strong className="text-base-05">Only this browser, on this machine.</strong> The
          garden will not appear in Tend on your other devices, or in another browser here.
          Nothing is lost when it does not — there is simply nothing there to find.
        </>,
        <>
          <strong className="text-base-05">No version control or backup from Tend.</strong>{' '}
          The server owns the git repository, and it cannot see this folder. Whatever backs up
          the folder is what backs up these notes.
        </>,
        <>
          <strong className="text-base-05">No importing.</strong> Import runs on the server,
          into a server garden.
        </>,
        <>
          <strong className="text-base-05">Search works, ordered differently.</strong> It is
          built in your browser from the folder, so results match but their ranking will not
          be identical to a server garden's.
        </>,
        <>
          <strong className="text-base-05">The files are not locked in.</strong> They are the
          same markdown Tend writes everywhere else, readable with any editor, and{' '}
          <code className="text-base-0C">age</code> decrypts an encrypted one on its own.
          Moving a garden between local and server is not something Tend does for you.
        </>,
      ]}
      note="Whether a garden is local is fixed when it is created."
      prompt={
        needsFolder
          ? 'You will be asked to choose the folder your local gardens live in. Each one is created as a subfolder of it.'
          : undefined
      }
      continueLabel={needsFolder ? 'Continue and choose a folder…' : 'Continue'}
      onContinue={onContinue}
      onCancel={onCancel}
    />
  )
}

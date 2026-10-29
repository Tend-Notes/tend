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
// reason to reconsider. The one sentence that *is* reassurance — a garden
// missing from the list means the folder needs reconnecting, not that notes are
// gone — earns its place, because that is the moment a user would otherwise
// assume the worst.

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
      intro="Your garden's notes will live in a folder on your computer and not sync to the Tend server. That changes a few things:"
      bullets={[
        <>
          <strong className="text-base-05">Only this browser, on this machine.</strong> The
          garden will not appear in Tend on your other devices, or in another browser here.
        </>,
        <>
          <strong className="text-base-05">Version control and backup are up to you.</strong>{' '}
          Tend does not actively manage local gardens, so you will have to set up any version
          control and backup functionality you'd like to use. Please note that some solutions,
          such as OneDrive and similar services, may corrupt notes.
        </>,
        <>
          <strong className="text-base-05">No importing.</strong> Import runs on the server,
          into a server garden only.
        </>,
        <>
          <strong className="text-base-05">The files are not locked in.</strong> You can edit
          unencrypted files in any editor you'd like, and you can decrypt encrypted notes
          using common decryption tools, even if Tend isn't working.
        </>,
        <>
          <strong className="text-base-05">You may have to reconnect from time to time.</strong>{' '}
          You may have to occasionally choose to reconnect Tend to your local folder. If Tend
          does not display your local garden, that doesn't mean your notes are lost — just try
          the "reconnect" option for your local garden in settings.
        </>,
      ]}
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

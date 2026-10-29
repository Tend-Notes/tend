// SPDX-License-Identifier: MIT WITH Commons-Clause
//
// What choosing "local folder" actually means, said before the garden exists.
//
// A local garden is not a storage detail the user can discover later. Its files
// are somewhere only this browser can reach, it is not on their other machines,
// and the features that belong to a server are simply not there. All of that is
// irreversible once notes are in it — a garden cannot be moved between the two
// — so it is said up front, with a way to back out.
//
// Deliberately not a warning. Keeping notes off a server is the point of the
// feature, not a risk to be talked out of; the list is what changes, not a
// reason to reconsider.

import { ModalShell } from './ModalShell'

interface LocalGardenDialogProps {
  /** True when a gardens folder has not been chosen yet, which Continue does. */
  needsFolder: boolean
  onContinue: () => void
  onCancel: () => void
}

export function LocalGardenDialog({ needsFolder, onContinue, onCancel }: LocalGardenDialogProps) {
  return (
    <ModalShell onBackdropClick={onCancel} maxWidth="max-w-md" panelClassName="p-4 mx-4 space-y-3">
      <div className="flex items-center gap-2">
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
        <h3 className="text-sm font-medium text-base-05">Keep this garden in a local folder</h3>
      </div>

      <p className="text-xs text-base-04">
        Its notes will live in a folder on this machine and never reach the server. That
        changes a few things:
      </p>

      <ul className="text-xs text-base-04 space-y-1.5 list-disc pl-4">
        <li>
          <strong className="text-base-05">Only this browser, on this machine.</strong> The
          garden will not appear in Tend on your other devices, or in another browser here.
          Nothing is lost when it does not — there is simply nothing there to find.
        </li>
        <li>
          <strong className="text-base-05">No version control or backup from Tend.</strong>{' '}
          The server owns the git repository, and it cannot see this folder. Whatever backs up
          the folder is what backs up these notes.
        </li>
        <li>
          <strong className="text-base-05">No importing.</strong> Import runs on the server,
          into a server garden.
        </li>
        <li>
          <strong className="text-base-05">Search works, ordered differently.</strong> It is
          built in your browser from the folder, so results match but their ranking will not
          be identical to a server garden's.
        </li>
        <li>
          <strong className="text-base-05">It stays an ordinary Tend garden.</strong> The
          files are the same format the server writes, so you can point a Tend server at the
          folder later, and <code className="text-base-0C">age</code> still decrypts an
          encrypted one.
        </li>
      </ul>

      <p className="text-xs text-base-03">
        A garden cannot be moved between local and server afterwards.
      </p>

      {needsFolder && (
        <p className="text-xs text-base-0A">
          You will be asked to choose the folder your local gardens live in. Each one is
          created as a subfolder of it.
        </p>
      )}

      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={onContinue}
          className="px-2 py-1 text-xs text-base-05 bg-base-01 border border-base-02 rounded hover:border-base-03 transition-colors"
        >
          {needsFolder ? 'Continue and choose a folder…' : 'Continue'}
        </button>
        <button
          onClick={onCancel}
          className="px-2 py-1 text-xs text-base-04 hover:text-base-05 transition-colors"
        >
          Cancel
        </button>
      </div>
    </ModalShell>
  )
}

// SPDX-License-Identifier: MIT WITH Commons-Clause
//
// The shape of "here is what this choice actually means".
//
// Two of the options on the new-garden form are irreversible once notes exist —
// encrypting it, and keeping it in a local folder — and neither is something to
// discover afterwards. Both get the same dialog: what it is, what changes, and
// a way to back out with the box left unticked.
//
// Shared rather than copied so the two stay the same shape when either one's
// wording is revised. The content lives in the callers; this owns only the
// format.

import type { ReactNode } from 'react'
import { ModalShell } from './ModalShell'

export interface GardenChoiceDialogProps {
  /** A small icon for the heading. The caller's, since it names the choice. */
  icon: ReactNode
  title: string
  /** One line, before the list: what this option is. */
  intro: ReactNode
  /** What changes. Each entry opens with a bolded phrase, then the detail. */
  bullets: ReactNode[]
  /** A closing line, for the part that is not a change but a constraint. */
  note?: ReactNode
  /** Shown above the buttons, for something the user is about to be asked. */
  prompt?: ReactNode
  continueLabel?: string
  onContinue: () => void
  onCancel: () => void
}

export function GardenChoiceDialog({
  icon,
  title,
  intro,
  bullets,
  note,
  prompt,
  continueLabel = 'Continue',
  onContinue,
  onCancel,
}: GardenChoiceDialogProps) {
  return (
    <ModalShell onBackdropClick={onCancel} maxWidth="max-w-md" panelClassName="p-4 mx-4 space-y-3">
      <div className="flex items-center gap-2">
        {icon}
        <h3 className="text-sm font-medium text-base-05">{title}</h3>
      </div>

      <p className="text-xs text-base-04">{intro}</p>

      <ul className="text-xs text-base-04 space-y-1.5 list-disc pl-4">
        {bullets.map((bullet, i) => (
          <li key={i}>{bullet}</li>
        ))}
      </ul>

      {note && <p className="text-xs text-base-03">{note}</p>}
      {prompt && <p className="text-xs text-base-0A">{prompt}</p>}

      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={onContinue}
          className="px-2 py-1 text-xs text-base-05 bg-base-01 border border-base-02 rounded hover:border-base-03 transition-colors"
        >
          {continueLabel}
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

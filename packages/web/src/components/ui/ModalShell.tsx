// SPDX-License-Identifier: MIT WITH Commons-Clause
// The centered-dialog shell every overlay was hand-rolling: a fixed full-screen
// flex container, a backdrop, and a panel.
//
// The copies had already drifted — fade or no fade, black/50 vs a themed
// backdrop, click-away or not — so the props keep those differences explicit
// instead of spread across six files. The command palette is deliberately not
// built on this: cmdk supplies its own Command.Dialog.

import type { ReactNode } from 'react'

interface ModalShellProps {
  children: ReactNode
  /**
   * Called when the backdrop is clicked. Omit for a dialog that must not be
   * dismissed that way (draft recovery, session expiry, a locked garden).
   */
  onBackdropClick?: () => void
  /** Centered, or sitting near the top like the search panel. */
  align?: 'center' | 'top'
  /** Tailwind max-width for the panel. */
  maxWidth?: string
  /** Panel extras: padding, scrolling, overflow. */
  panelClassName?: string
  /** Backdrop override, for the sites whose backdrop is not the default. */
  backdropClassName?: string
}

const DEFAULT_BACKDROP = 'overlay-backdrop fixed inset-0 bg-black/50 animate-fade-in'

export function ModalShell({
  children,
  onBackdropClick,
  align = 'center',
  maxWidth = 'max-w-md',
  panelClassName = '',
  backdropClassName = DEFAULT_BACKDROP,
}: ModalShellProps) {
  const position = align === 'top' ? 'items-start justify-center pt-[15vh]' : 'items-center justify-center'

  return (
    <div className={`fixed inset-0 z-50 flex ${position}`}>
      <div className={backdropClassName} onClick={onBackdropClick} />
      <div
        className={`overlay-content relative bg-base-01 rounded-lg shadow-2xl border border-base-02 w-full ${maxWidth} ${panelClassName}`}
      >
        {children}
      </div>
    </div>
  )
}

// SPDX-License-Identifier: MIT WITH Commons-Clause
//
// Pointer-capability helpers.

// True when the device's primary pointer is precise (mouse/trackpad), false on
// touch-primary devices (phones/tablets). Used to skip auto-focusing the editor
// on load on touch devices, where it would pop the soft keyboard every time.
// Defaults to true if matchMedia is unavailable.
export function hasFinePointer(): boolean {
  return window.matchMedia?.('(pointer: fine)').matches ?? true
}

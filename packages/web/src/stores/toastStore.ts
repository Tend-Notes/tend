// SPDX-License-Identifier: MIT WITH Commons-Clause
// Toast notification store

import { create } from 'zustand'

interface Toast {
  id: string
  message: string
  duration: number
}

interface ToastState {
  toasts: Toast[]
  addToast: (message: string, duration?: number) => void
  removeToast: (id: string) => void
}

let toastId = 0

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],

  addToast: (message, duration = 2000) => {
    const id = `toast-${++toastId}`
    set((state) => ({
      toasts: [...state.toasts, { id, message, duration }],
    }))

    // Auto-dismiss after duration
    setTimeout(() => {
      set((state) => ({
        toasts: state.toasts.filter((t) => t.id !== id),
      }))
    }, duration)
  },

  removeToast: (id) => {
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    }))
  },
}))

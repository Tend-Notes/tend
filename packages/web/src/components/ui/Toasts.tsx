// SPDX-License-Identifier: MIT WITH Commons-Clause
// Toast notification display component

import { useToastStore } from '../../stores/toastStore'

export function Toasts() {
  const toasts = useToastStore((state) => state.toasts)
  const removeToast = useToastStore((state) => state.removeToast)

  if (toasts.length === 0) return null

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex flex-col gap-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="bg-base-01 text-base-05 px-4 py-2 rounded-lg shadow-lg border border-base-02 text-sm animate-fade-in"
          onClick={() => removeToast(toast.id)}
        >
          {toast.message}
        </div>
      ))}
    </div>
  )
}

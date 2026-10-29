// SPDX-License-Identifier: MIT WITH Commons-Clause
//
// The local-folder gardens, listed under the server's own in the switcher.
//
// Three things make this different from the server list above it, and each
// shows as its own state rather than as an error:
//
//   - A folder has to be picked once, and the browser only allows that from a
//     click. Same for re-granting access after a restart, which is why
//     "Reconnect" is a button and not something that happens on load.
//   - A saved handle outlives the folder: it can be moved or deleted between
//     sessions, which is a different problem with a different remedy.
//   - These gardens live in this browser on this machine. Opening Tend
//     elsewhere simply does not show them, and that is stated once rather than
//     reported as a failure.
//
// Forgetting a garden removes it from the list and leaves the folder alone.
// Deleting someone's notes is never a side effect of tidying a list.

import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { UnlockGardenDialog } from '../ui/UnlockGardenDialog'
import { useLocalGardenStore } from '../../stores/localGardenStore'

/** A folder, for the badge beside a local garden's name. */
function FolderIcon() {
  return (
    <svg
      className="w-3 h-3 text-base-0C flex-shrink-0"
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

function LockIcon() {
  return (
    <svg
      className="w-3 h-3 text-base-0A flex-shrink-0"
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

export function LocalGardens() {
  const {
    supported,
    status,
    gardens,
    openId,
    busy,
    error,
    refresh,
    pickRoot,
    reconnect,
    create,
    open,
    forget,
    clearError,
  } = useLocalGardenStore()

  const [showNewForm, setShowNewForm] = useState(false)
  const [name, setName] = useState('')
  const [encrypted, setEncrypted] = useState(false)
  const [passphrase, setPassphrase] = useState('')
  const [passphraseConfirm, setPassphraseConfirm] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [unlockId, setUnlockId] = useState<string | null>(null)
  const [confirmForget, setConfirmForget] = useState<string | null>(null)
  const [reloading, setReloading] = useState(false)
  const [watching, setWatching] = useState(false)

  // Whether the folder is being watched decides what the Reload button is for:
  // a convenience, or the only way to notice an outside change.
  useEffect(() => {
    if (!openId) {
      setWatching(false)
      return
    }
    void import('../../lib/local/localBackend').then(({ isWatchingFolder }) => {
      setWatching(isWatchingFolder())
    })
  }, [openId])

  const reload = async () => {
    setReloading(true)
    try {
      const { reloadFromDisk } = await import('../../lib/local/localBackend')
      await reloadFromDisk()
    } finally {
      setReloading(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [refresh])

  if (!supported) {
    return (
      <div className="pt-2 border-t border-base-02 space-y-1">
        <h4 className="text-xs font-medium text-base-04">Local folders</h4>
        <p className="text-xs text-base-03">
          This browser cannot open local folders. Local gardens need a Chromium browser such
          as Edge.
        </p>
      </div>
    )
  }

  const resetForm = () => {
    setShowNewForm(false)
    setName('')
    setEncrypted(false)
    setPassphrase('')
    setPassphraseConfirm('')
    setFormError(null)
  }

  const submitNew = async () => {
    if (!name.trim()) return
    if (encrypted) {
      if (!passphrase) {
        setFormError('Enter a passphrase for the encrypted garden')
        return
      }
      if (passphrase !== passphraseConfirm) {
        setFormError('Passphrases do not match')
        return
      }
    }
    setFormError(null)
    await create({ name: name.trim(), passphrase: encrypted ? passphrase : undefined })
    // The passphrase is used to wrap the identity and then dropped; it is never
    // stored, so clearing the field is the whole of forgetting it here.
    resetForm()
  }

  const handleOpen = async (id: string) => {
    const { needsPassphrase } = await open(id)
    if (needsPassphrase) setUnlockId(id)
  }

  const submitUnlock = async (entered: string) => {
    if (!unlockId) return
    const { needsPassphrase } = await open(unlockId, entered)
    if (!needsPassphrase) setUnlockId(null)
  }

  return (
    <div className="pt-2 border-t border-base-02 space-y-2">
      <div className="flex items-baseline justify-between">
        <h4 className="text-xs font-medium text-base-04">Local folders</h4>
        {status.state === 'ready' && (
          <span className="text-xs text-base-03 truncate ml-2" title={status.folderName}>
            {status.folderName}
          </span>
        )}
      </div>

      <p className="text-xs text-base-03">
        Local gardens live in this browser on this machine, and never reach the server.
      </p>

      {error && (
        <div className="flex items-start justify-between gap-2 px-2 py-1.5 text-xs text-base-08 bg-base-08/10 rounded">
          <span>{error}</span>
          <button
            onClick={clearError}
            className="text-base-04 hover:text-base-05 transition-colors"
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      )}

      {/* The root: picked once, re-granted from a click after a restart. */}
      {status.state === 'none' && (
        <button
          onClick={() => void pickRoot()}
          disabled={busy}
          className="w-full py-1.5 text-xs text-base-04 hover:text-base-05 border border-dashed border-base-02 rounded transition-colors disabled:opacity-50"
        >
          Choose a folder for local gardens…
        </button>
      )}

      {status.state === 'needs-permission' && (
        <div className="space-y-1">
          <p className="text-xs text-base-04">
            Tend needs access to <strong>{status.folderName}</strong> again. Browsers drop
            folder permissions when they restart.
          </p>
          <button
            onClick={() => void reconnect()}
            disabled={busy}
            className="w-full py-1.5 text-xs text-base-05 bg-base-01 border border-base-02 rounded hover:border-base-03 transition-colors disabled:opacity-50"
          >
            Reconnect {status.folderName}
          </button>
        </div>
      )}

      {status.state === 'missing' && (
        <div className="space-y-1">
          <p className="text-xs text-base-04">
            <strong>{status.folderName}</strong> is gone — moved, renamed or deleted. Pick it
            again to carry on.
          </p>
          <button
            onClick={() => void pickRoot()}
            disabled={busy}
            className="w-full py-1.5 text-xs text-base-05 bg-base-01 border border-base-02 rounded hover:border-base-03 transition-colors disabled:opacity-50"
          >
            Choose a folder…
          </button>
        </div>
      )}

      {gardens.map((garden) => (
        <div
          key={garden.id}
          className={`flex items-center justify-between rounded border transition-colors ${
            openId === garden.id
              ? 'border-base-0D bg-base-01'
              : 'border-base-02 hover:border-base-03 cursor-pointer clickable'
          }`}
          onClick={openId === garden.id ? undefined : () => void handleOpen(garden.id)}
        >
          <div className="flex-1 flex items-center gap-1.5 px-2 py-1.5 min-w-0">
            <FolderIcon />
            {garden.encrypted && <LockIcon />}
            <span className="text-xs text-base-05 truncate">{garden.name}</span>
          </div>
          {openId === garden.id ? (
            <div className="flex items-center gap-1 pr-1">
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  void reload()
                }}
                disabled={reloading}
                className="px-1.5 py-0.5 text-xs text-base-04 hover:text-base-05 transition-colors disabled:opacity-50"
                title={
                  watching
                    ? 'Tend is watching this folder. Reload anyway.'
                    : 'This browser cannot watch the folder, so changes made outside Tend need a reload.'
                }
              >
                {reloading ? 'Reloading…' : 'Reload'}
              </button>
              <span className="text-xs text-base-0D">Active</span>
            </div>
          ) : confirmForget === garden.id ? (
            <div className="flex items-center gap-1 pr-1">
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  void forget(garden.id)
                  setConfirmForget(null)
                }}
                className="px-1.5 py-0.5 text-xs text-base-08 bg-base-08/10 rounded hover:bg-base-08/20 transition-colors"
                title="Remove from this list. The folder and its files are left alone."
              >
                Forget
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setConfirmForget(null)
                }}
                className="px-1.5 py-0.5 text-xs text-base-04 hover:text-base-05 transition-colors"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={(e) => {
                e.stopPropagation()
                setConfirmForget(garden.id)
              }}
              className="px-2 py-1.5 text-xs text-base-03 hover:text-base-08 transition-colors"
              title="Remove from this list. The folder and its files are left alone."
            >
              Forget
            </button>
          )}
        </div>
      ))}

      <AnimatePresence>
        {showNewForm && status.state === 'ready' && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="space-y-2 p-2 border border-base-02 rounded">
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Garden name"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !encrypted) void submitNew()
                  if (e.key === 'Escape') resetForm()
                }}
                className="w-full px-2 py-1 text-xs bg-base-00 border border-base-02 rounded text-base-05 focus:border-base-0D focus:outline-none"
              />

              <label className="flex items-center gap-1.5 text-xs text-base-04 cursor-pointer">
                <input
                  type="checkbox"
                  checked={encrypted}
                  onChange={(e) => setEncrypted(e.target.checked)}
                  className="accent-base-0D"
                />
                Encrypt this garden
              </label>

              {encrypted && (
                <div className="space-y-1.5">
                  <input
                    type="password"
                    value={passphrase}
                    onChange={(e) => setPassphrase(e.target.value)}
                    placeholder="Passphrase"
                    className="w-full px-2 py-1 text-xs bg-base-00 border border-base-02 rounded text-base-05 focus:border-base-0D focus:outline-none"
                  />
                  <input
                    type="password"
                    value={passphraseConfirm}
                    onChange={(e) => setPassphraseConfirm(e.target.value)}
                    placeholder="Confirm passphrase"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void submitNew()
                    }}
                    className="w-full px-2 py-1 text-xs bg-base-00 border border-base-02 rounded text-base-05 focus:border-base-0D focus:outline-none"
                  />
                  <p className="text-xs text-base-03">
                    The passphrase is not stored anywhere. Lose it and the notes cannot be
                    recovered — not by Tend, not by anyone.
                  </p>
                </div>
              )}

              {formError && <p className="text-xs text-base-08">{formError}</p>}

              <div className="flex items-center gap-2">
                <button
                  onClick={() => void submitNew()}
                  disabled={busy || !name.trim()}
                  className="px-2 py-1 text-xs text-base-05 bg-base-01 border border-base-02 rounded hover:border-base-03 transition-colors disabled:opacity-50"
                >
                  {busy ? 'Creating…' : 'Create'}
                </button>
                <button
                  onClick={resetForm}
                  className="px-2 py-1 text-xs text-base-04 hover:text-base-05 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {!showNewForm && status.state === 'ready' && (
        <button
          onClick={() => setShowNewForm(true)}
          className="w-full py-1.5 text-xs text-base-04 hover:text-base-05 border border-dashed border-base-02 rounded transition-colors"
        >
          + New local garden
        </button>
      )}

      {unlockId && (
        <UnlockGardenDialog
          error={error}
          busy={busy}
          onSubmit={(entered) => void submitUnlock(entered)}
          onCancel={() => {
            setUnlockId(null)
            clearError()
          }}
        />
      )}
    </div>
  )
}

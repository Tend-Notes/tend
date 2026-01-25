// SPDX-License-Identifier: MIT WITH Commons-Clause
// Sidebar options view - settings and configuration

import { useState, useCallback, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useSettingsStore, ThemeMode, FontSizePreset, ContentType, TaskStatusSet, TASK_STATUS_SETS } from '../../stores/settingsStore'
import { contentTypes as contentTypesApi } from '../../lib/api'
import {
  getDarkThemes,
  getLightThemes,
  findTheme,
  applyTheme,
  parseBase16Yaml,
  getSystemThemePreference,
  subscribeToThemes,
  isLoadingThemes,
  type Base16Theme,
} from '../../lib/themes'

interface SidebarOptionsProps {
  onBack: () => void
}

// Section IDs
type SectionId = 'appearance' | 'tasks' | 'backup' | 'content-types' | 'gardens' | 'import'

const SECTIONS: { id: SectionId; label: string }[] = [
  { id: 'appearance', label: 'Appearance' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'backup', label: 'Backup' },
  { id: 'content-types', label: 'Content Types' },
  { id: 'gardens', label: 'Gardens' },
  { id: 'import', label: 'Import' },
]

export function SidebarOptions({ onBack }: SidebarOptionsProps) {
  const { openSection, setOpenSection } = useSettingsStore()

  const handleSectionClick = (sectionId: SectionId) => {
    setOpenSection(openSection === sectionId ? null : sectionId)
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-base-02">
        <button
          onClick={onBack}
          className="p-1 text-base-04 hover:text-base-05 transition-colors"
          title="Back to navigation"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <span className="text-sm font-medium text-base-05">Settings</span>
        <div className="w-4" />
      </div>

      {/* Sections */}
      <div className="flex-1 overflow-y-auto">
        {SECTIONS.map(({ id, label }) => (
          <CollapsibleSection
            key={id}
            id={id}
            label={label}
            isOpen={openSection === id}
            onToggle={() => handleSectionClick(id)}
          >
            {id === 'appearance' && <AppearanceSection />}
            {id === 'tasks' && <TasksSection />}
            {id === 'backup' && <BackupSection />}
            {id === 'content-types' && <ContentTypesSection />}
            {id === 'gardens' && <GardensSection />}
            {id === 'import' && <ImportSection />}
          </CollapsibleSection>
        ))}
      </div>
    </div>
  )
}

// Collapsible section wrapper with animation
function CollapsibleSection({
  id,
  label,
  isOpen,
  onToggle,
  children,
}: {
  id: string
  label: string
  isOpen: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  return (
    <div className="border-b border-base-02">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-base-01 transition-colors"
      >
        <span className={`text-sm font-medium ${isOpen ? 'text-base-06' : 'text-base-04'}`}>
          {label}
        </span>
        <motion.svg
          animate={{ rotate: isOpen ? 180 : 0 }}
          transition={{ duration: 0.2 }}
          className="w-4 h-4 text-base-03"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </motion.svg>
      </button>
      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            key={`${id}-content`}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// Appearance section
function AppearanceSection() {
  const {
    themeMode,
    setThemeMode,
    lightThemeName,
    darkThemeName,
    setLightThemeName,
    setDarkThemeName,
    customLightTheme,
    customDarkTheme,
    setCustomLightTheme,
    setCustomDarkTheme,
    fontSizePreset,
    setFontSizePreset,
    customFontSize,
    setCustomFontSize,
  } = useSettingsStore()

  const [showCustomFontSize, setShowCustomFontSize] = useState(fontSizePreset === 'custom')
  const [showThemePicker, setShowThemePicker] = useState<'light' | 'dark' | null>(null)
  const [showCustomYaml, setShowCustomYaml] = useState<'light' | 'dark' | null>(null)

  const handleFontSizeChange = (preset: FontSizePreset) => {
    setFontSizePreset(preset)
    if (preset !== 'custom') {
      setShowCustomFontSize(false)
    }
  }

  // Determine the effective theme variant (respecting system preference)
  const effectiveVariant: 'light' | 'dark' =
    themeMode === 'system' ? getSystemThemePreference() : themeMode

  // Get the current theme for each variant
  const currentLightTheme = customLightTheme?.parsed ?? findTheme(lightThemeName)
  const currentDarkTheme = customDarkTheme?.parsed ?? findTheme(darkThemeName)

  // The currently active theme (what's actually applied)
  const activeTheme = effectiveVariant === 'light' ? currentLightTheme : currentDarkTheme

  return (
    <div className="space-y-3">
      {/* Theme mode */}
      <SettingsRow label="Mode">
        <div className="flex gap-1">
          {(['light', 'dark', 'system'] as ThemeMode[]).map((mode) => (
            <button
              key={mode}
              onClick={() => setThemeMode(mode)}
              className={`px-2 py-1 text-xs rounded transition-colors ${
                themeMode === mode
                  ? 'bg-base-02 text-base-06'
                  : 'text-base-04 hover:text-base-05'
              }`}
            >
              {mode.charAt(0).toUpperCase() + mode.slice(1)}
            </button>
          ))}
        </div>
      </SettingsRow>

      {/* Light theme selector */}
      <div className="space-y-1">
        <SettingsRow label="Light theme">
          <button
            onClick={() => setShowThemePicker(showThemePicker === 'light' ? null : 'light')}
            className="flex items-center gap-2 px-2 py-1 text-xs rounded border border-base-02 hover:border-base-03 transition-colors"
          >
            <ThemeSwatch theme={currentLightTheme} size="sm" />
            <span className="text-base-05">{currentLightTheme?.name ?? 'Select...'}</span>
          </button>
        </SettingsRow>
        <AnimatePresence>
          {showThemePicker === 'light' && (
            <ThemePicker
              variant="light"
              currentThemeName={lightThemeName}
              activeTheme={activeTheme}
              onSelect={(name) => {
                setLightThemeName(name)
                setCustomLightTheme(null)
                setShowThemePicker(null)
              }}
              onCustom={() => {
                setShowThemePicker(null)
                setShowCustomYaml('light')
              }}
            />
          )}
        </AnimatePresence>
        <AnimatePresence>
          {showCustomYaml === 'light' && (
            <CustomThemeEditor
              variant="light"
              currentYaml={customLightTheme?.yaml ?? ''}
              onSave={(yaml, parsed) => {
                setCustomLightTheme({ yaml, parsed })
                setShowCustomYaml(null)
              }}
              onCancel={() => setShowCustomYaml(null)}
            />
          )}
        </AnimatePresence>
      </div>

      {/* Dark theme selector */}
      <div className="space-y-1">
        <SettingsRow label="Dark theme">
          <button
            onClick={() => setShowThemePicker(showThemePicker === 'dark' ? null : 'dark')}
            className="flex items-center gap-2 px-2 py-1 text-xs rounded border border-base-02 hover:border-base-03 transition-colors"
          >
            <ThemeSwatch theme={currentDarkTheme} size="sm" />
            <span className="text-base-05">{currentDarkTheme?.name ?? 'Select...'}</span>
          </button>
        </SettingsRow>
        <AnimatePresence>
          {showThemePicker === 'dark' && (
            <ThemePicker
              variant="dark"
              currentThemeName={darkThemeName}
              activeTheme={activeTheme}
              onSelect={(name) => {
                setDarkThemeName(name)
                setCustomDarkTheme(null)
                setShowThemePicker(null)
              }}
              onCustom={() => {
                setShowThemePicker(null)
                setShowCustomYaml('dark')
              }}
            />
          )}
        </AnimatePresence>
        <AnimatePresence>
          {showCustomYaml === 'dark' && (
            <CustomThemeEditor
              variant="dark"
              currentYaml={customDarkTheme?.yaml ?? ''}
              onSave={(yaml, parsed) => {
                setCustomDarkTheme({ yaml, parsed })
                setShowCustomYaml(null)
              }}
              onCancel={() => setShowCustomYaml(null)}
            />
          )}
        </AnimatePresence>
      </div>

      {/* Font size */}
      <SettingsRow label="Font size">
        <div className="flex items-center gap-1">
          {(['small', 'medium', 'large'] as const).map((size) => (
            <button
              key={size}
              onClick={() => handleFontSizeChange(size)}
              className={`px-2 py-1 text-xs rounded transition-colors ${
                fontSizePreset === size
                  ? 'bg-base-02 text-base-06'
                  : 'text-base-04 hover:text-base-05'
              }`}
            >
              {size.charAt(0).toUpperCase()}
            </button>
          ))}
          <button
            onClick={() => {
              setShowCustomFontSize(true)
              setFontSizePreset('custom')
            }}
            className={`px-2 py-1 text-xs rounded transition-colors ${
              fontSizePreset === 'custom'
                ? 'bg-base-02 text-base-06'
                : 'text-base-04 hover:text-base-05'
            }`}
            title="Custom font size"
          >
            ...
          </button>
        </div>
      </SettingsRow>

      {/* Custom font size input */}
      <AnimatePresence>
        {showCustomFontSize && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <SettingsRow label="Custom size">
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={10}
                  max={32}
                  value={customFontSize}
                  onChange={(e) => setCustomFontSize(Number(e.target.value))}
                  className="w-14 bg-base-01 border border-base-02 rounded px-2 py-1 text-xs text-base-05 focus:outline-none focus:border-base-04"
                />
                <span className="text-xs text-base-03">px</span>
                <button
                  onClick={() => {
                    setFontSizePreset('medium')
                    setShowCustomFontSize(false)
                  }}
                  className="text-xs text-base-04 hover:text-base-05 transition-colors"
                  title="Reset to medium"
                >
                  ×
                </button>
              </div>
            </SettingsRow>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// Theme color swatch preview
function ThemeSwatch({ theme, size = 'md' }: { theme: Base16Theme | undefined; size?: 'sm' | 'md' }) {
  if (!theme) return null

  const sizeClass = size === 'sm' ? 'w-4 h-4' : 'w-6 h-6'

  return (
    <div className={`${sizeClass} rounded overflow-hidden flex flex-wrap`}>
      <div className="w-1/2 h-1/2" style={{ backgroundColor: theme.palette.base00 }} />
      <div className="w-1/2 h-1/2" style={{ backgroundColor: theme.palette.base0D }} />
      <div className="w-1/2 h-1/2" style={{ backgroundColor: theme.palette.base0B }} />
      <div className="w-1/2 h-1/2" style={{ backgroundColor: theme.palette.base08 }} />
    </div>
  )
}

// Theme picker dropdown
function ThemePicker({
  variant,
  currentThemeName,
  activeTheme,
  onSelect,
  onCustom,
}: {
  variant: 'light' | 'dark'
  currentThemeName: string
  activeTheme: Base16Theme | undefined // The currently applied theme (to restore on mouse leave)
  onSelect: (name: string) => void
  onCustom: () => void
}) {
  // Subscribe to theme updates (for when themes finish loading from tinted-theming)
  const [, forceUpdate] = useState({})
  useEffect(() => {
    return subscribeToThemes(() => forceUpdate({}))
  }, [])

  const themes = variant === 'light' ? getLightThemes() : getDarkThemes()
  const loading = isLoadingThemes()
  // Always preview themes on hover, regardless of which variant is active
  const handlePreview = useCallback((theme: Base16Theme) => {
    applyTheme(theme)
  }, [])

  const handleMouseLeave = useCallback(() => {
    if (activeTheme) {
      applyTheme(activeTheme)
    }
  }, [activeTheme])

  const handleSelect = useCallback((theme: Base16Theme) => {
    // Revert to active theme when selection is made
    // (the selected theme will be applied through the settings store)
    if (activeTheme) {
      applyTheme(activeTheme)
    }
    onSelect(theme.name)
  }, [onSelect, activeTheme])

  return (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: 'auto', opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="overflow-hidden"
    >
      <div
        className="mt-1 p-1 bg-base-01 border border-base-02 rounded max-h-48 overflow-y-auto"
        onMouseLeave={handleMouseLeave}
      >
        {themes.map((theme) => (
          <button
            key={theme.name}
            onClick={() => handleSelect(theme)}
            onMouseEnter={() => handlePreview(theme)}
            className={`w-full flex items-center gap-2 px-2 py-1.5 text-left rounded transition-colors ${
              currentThemeName === theme.name
                ? 'bg-base-02 text-base-06'
                : 'hover:bg-base-02 text-base-04 hover:text-base-05'
            }`}
          >
            <ThemeSwatch theme={theme} size="sm" />
            <span className="text-xs">{theme.name}</span>
          </button>
        ))}
        {loading && (
          <div className="px-2 py-1.5 text-xs text-base-03">
            Loading themes...
          </div>
        )}
        <div className="border-t border-base-02 mt-1 pt-1">
          <button
            onClick={onCustom}
            className="w-full flex items-center gap-2 px-2 py-1.5 text-left rounded text-base-04 hover:text-base-05 hover:bg-base-02 transition-colors"
          >
            <span className="text-xs">+ Custom YAML...</span>
          </button>
        </div>
      </div>
    </motion.div>
  )
}

// Custom theme YAML editor
function CustomThemeEditor({
  variant,
  currentYaml,
  onSave,
  onCancel,
}: {
  variant: 'light' | 'dark'
  currentYaml: string
  onSave: (yaml: string, parsed: Base16Theme) => void
  onCancel: () => void
}) {
  const [yaml, setYaml] = useState(currentYaml || getDefaultYaml(variant))
  const [error, setError] = useState<string | null>(null)

  const handleSave = () => {
    const parsed = parseBase16Yaml(yaml)
    if (!parsed) {
      setError('Invalid Base16 YAML format')
      return
    }
    onSave(yaml, parsed)
  }

  const handlePreview = () => {
    const parsed = parseBase16Yaml(yaml)
    if (parsed) {
      applyTheme(parsed)
      setError(null)
    } else {
      setError('Invalid Base16 YAML format')
    }
  }

  return (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: 'auto', opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="overflow-hidden"
    >
      <div className="mt-1 p-2 bg-base-01 border border-base-02 rounded space-y-2">
        <p className="text-xs text-base-03">
          Paste Base16 theme YAML below.{' '}
          <a
            href="https://tinted-theming.github.io/tinted-gallery/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-base-0D hover:underline"
          >
            Browse themes
          </a>
        </p>
        <textarea
          value={yaml}
          onChange={(e) => {
            setYaml(e.target.value)
            setError(null)
          }}
          className="w-full h-32 bg-base-00 border border-base-02 rounded px-2 py-1 text-xs text-base-05 font-mono focus:outline-none focus:border-base-04 resize-none"
          placeholder="system: base16&#10;name: My Theme&#10;..."
        />
        {error && <p className="text-xs text-base-08">{error}</p>}
        <div className="flex gap-2">
          <button
            onClick={handlePreview}
            className="px-2 py-1 text-xs text-base-04 hover:text-base-05 border border-base-02 rounded transition-colors"
          >
            Preview
          </button>
          <button
            onClick={handleSave}
            className="px-2 py-1 text-xs text-base-06 bg-base-02 hover:bg-base-03 rounded transition-colors"
          >
            Save
          </button>
          <button
            onClick={onCancel}
            className="px-2 py-1 text-xs text-base-04 hover:text-base-05 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </motion.div>
  )
}

// Default YAML template for custom themes
function getDefaultYaml(variant: 'light' | 'dark'): string {
  if (variant === 'light') {
    return `system: "base16"
name: "My Light Theme"
author: "You"
variant: "light"
palette:
  base00: "#fafafa"
  base01: "#f0f0f0"
  base02: "#e5e5e5"
  base03: "#a0a1a7"
  base04: "#696c77"
  base05: "#383a42"
  base06: "#202227"
  base07: "#090a0b"
  base08: "#e45649"
  base09: "#986801"
  base0A: "#c18401"
  base0B: "#50a14f"
  base0C: "#0184bc"
  base0D: "#4078f2"
  base0E: "#a626a4"
  base0F: "#ca1243"`
  }
  return `system: "base16"
name: "My Dark Theme"
author: "You"
variant: "dark"
palette:
  base00: "#282c34"
  base01: "#353b45"
  base02: "#3e4451"
  base03: "#545862"
  base04: "#565c64"
  base05: "#abb2bf"
  base06: "#b6bdca"
  base07: "#c8ccd4"
  base08: "#e06c75"
  base09: "#d19a66"
  base0A: "#e5c07b"
  base0B: "#98c379"
  base0C: "#56b6c2"
  base0D: "#61afef"
  base0E: "#c678dd"
  base0F: "#be5046"`
}

// Tasks section
function TasksSection() {
  const { taskStatusSet, setTaskStatusSet } = useSettingsStore()

  const statusSetLabels: Record<TaskStatusSet, string> = {
    'todo-doing-done': 'TODO / DOING / DONE',
    'now-later-never': 'NOW / LATER / NEVER',
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-base-03">
        Task markers appear at the start of a block. Click a marker to cycle through statuses.
      </p>

      {/* Status set selection */}
      <SettingsRow label="Status keywords">
        <div className="flex flex-col gap-1 items-end">
          {(Object.keys(TASK_STATUS_SETS) as TaskStatusSet[]).map((set) => (
            <button
              key={set}
              onClick={() => setTaskStatusSet(set)}
              className={`px-2 py-1 text-xs rounded transition-colors ${
                taskStatusSet === set
                  ? 'bg-base-02 text-base-06'
                  : 'text-base-04 hover:text-base-05'
              }`}
            >
              {statusSetLabels[set]}
            </button>
          ))}
        </div>
      </SettingsRow>

      {/* Preview current set */}
      <div className="p-2 bg-base-01 border border-base-02 rounded">
        <p className="text-xs text-base-03 mb-2">Preview:</p>
        <div className="flex gap-2">
          {TASK_STATUS_SETS[taskStatusSet].map((status) => (
            <span
              key={status.keyword}
              className="text-xs font-semibold px-1.5 py-0.5 rounded"
              style={{
                color: `var(--${status.color})`,
                backgroundColor: `color-mix(in srgb, var(--${status.color}) 15%, transparent)`,
              }}
            >
              {status.keyword}
            </span>
          ))}
        </div>
      </div>

      <p className="text-xs text-base-03 italic">
        Custom status keywords coming in a future update.
      </p>
    </div>
  )
}

// Remote status indicator
type RemoteStatus = 'unknown' | 'testing' | 'verified' | 'failed'

function RemoteStatusIcon({ status, message }: { status: RemoteStatus; message?: string }) {
  if (status === 'testing') {
    return (
      <span className="inline-block w-2 h-2 rounded-full bg-base-03 animate-pulse" title="Testing connection..." />
    )
  }
  if (status === 'verified') {
    return (
      <span className="inline-block w-2 h-2 rounded-full bg-base-0B" title={message || 'Connection verified'} />
    )
  }
  if (status === 'failed') {
    return (
      <span
        className="inline-block w-0 h-0 border-l-[4px] border-r-[4px] border-b-[7px] border-l-transparent border-r-transparent border-b-base-08"
        title={message || 'Connection failed'}
      />
    )
  }
  return null
}

// Backup section
function BackupSection() {
  const {
    backupEnabled,
    setBackupEnabled,
    backupIntervalMinutes,
    setBackupIntervalMinutes,
  } = useSettingsStore()

  const [remoteUrl, setRemoteUrl] = useState<string | null>(null)
  const [editingRemote, setEditingRemote] = useState(false)
  const [remoteInput, setRemoteInput] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isGitRepo, setIsGitRepo] = useState(false)
  const [initializingGit, setInitializingGit] = useState(false)
  const [remoteStatus, setRemoteStatus] = useState<RemoteStatus>('unknown')
  const [remoteMessage, setRemoteMessage] = useState<string | undefined>()
  const [saving, setSaving] = useState(false)

  // Fetch git status to get remote URL and repo status
  useEffect(() => {
    const fetchGitStatus = async () => {
      try {
        const { git } = await import('../../lib/api')
        const status = await git.status()
        setIsGitRepo(status.isRepo)
        setRemoteUrl(status.remote)
        setRemoteInput(status.remote || '')
        setError(null)

        // If remote exists, test connection
        if (status.remote) {
          testRemoteConnection()
        }
      } catch (err) {
        setError('Failed to fetch git status')
        console.error('Failed to fetch git status:', err)
      } finally {
        setLoading(false)
      }
    }
    fetchGitStatus()
  }, [])

  const testRemoteConnection = async () => {
    setRemoteStatus('testing')
    setRemoteMessage(undefined)
    try {
      const { git } = await import('../../lib/api')
      const result = await git.testRemote()
      if (result.verified) {
        setRemoteStatus('verified')
        setRemoteMessage(result.message)
      } else {
        setRemoteStatus('failed')
        setRemoteMessage(result.message)
      }
    } catch (err) {
      setRemoteStatus('failed')
      setRemoteMessage(err instanceof Error ? err.message : 'Connection test failed')
    }
  }

  const handleSaveRemote = async () => {
    if (!remoteInput.trim()) {
      setEditingRemote(false)
      return
    }

    setSaving(true)
    setError(null)
    try {
      const { git } = await import('../../lib/api')
      const result = await git.setRemote(remoteInput.trim())
      if (result.success) {
        setRemoteUrl(result.url)
        setEditingRemote(false)
        // Test the new remote
        testRemoteConnection()
      } else {
        setError(result.message)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to set remote')
    } finally {
      setSaving(false)
    }
  }

  const handleEnableVersions = async () => {
    setInitializingGit(true)
    try {
      const { git } = await import('../../lib/api')
      await git.backup()
      setIsGitRepo(true)
      setError(null)
    } catch (err) {
      setError('Failed to initialize version control')
      console.error('Failed to initialize git:', err)
    } finally {
      setInitializingGit(false)
    }
  }

  return (
    <div className="space-y-3">
      {/* Enable versions - initializes local git repo */}
      <SettingsRow label="Enable versions">
        <Toggle
          checked={isGitRepo}
          onChange={(checked) => {
            if (checked && !isGitRepo) {
              handleEnableVersions()
            }
          }}
        />
      </SettingsRow>
      <p className="text-xs text-base-03">
        {initializingGit ? 'Initializing...' : isGitRepo
          ? 'Version history is enabled. Your notes are stored locally on your server.'
          : 'Enable to track changes and restore previous versions. Notes are stored on your server.'}
      </p>

      {/* Show backup options only when versions are enabled */}
      <AnimatePresence>
        {isGitRepo && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden space-y-3"
          >
            {/* Enable/disable remote backup - controls push/pull operations */}
            <SettingsRow label="Enable remote backup">
              <Toggle checked={backupEnabled} onChange={setBackupEnabled} />
            </SettingsRow>
            <p className="text-xs text-base-03">
              Push changes to a remote git repository for off-site backup.
            </p>

            {/* Remote URL with status indicator */}
            <div className="space-y-1">
              <SettingsRow label="Remote">
                {loading ? (
                  <span className="text-xs text-base-03">Loading...</span>
                ) : editingRemote ? (
                  <div className="flex items-center gap-1">
                    <input
                      type="text"
                      value={remoteInput}
                      onChange={(e) => setRemoteInput(e.target.value)}
                      placeholder="git@github.com:..."
                      className="w-28 bg-base-01 border border-base-02 rounded px-2 py-1 text-xs text-base-05 focus:outline-none focus:border-base-04"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSaveRemote()
                        if (e.key === 'Escape') {
                          setEditingRemote(false)
                          setRemoteInput(remoteUrl || '')
                        }
                      }}
                    />
                    <button
                      onClick={handleSaveRemote}
                      disabled={saving}
                      className="px-1.5 py-0.5 text-xs text-base-06 bg-base-02 rounded hover:bg-base-03 transition-colors disabled:opacity-50"
                    >
                      {saving ? '...' : 'Save'}
                    </button>
                    <button
                      onClick={() => {
                        setEditingRemote(false)
                        setRemoteInput(remoteUrl || '')
                      }}
                      className="px-1.5 py-0.5 text-xs text-base-04 hover:text-base-05 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5">
                    <RemoteStatusIcon status={remoteStatus} message={remoteMessage} />
                    <button
                      onClick={() => setEditingRemote(true)}
                      className="text-xs text-base-05 hover:text-base-06 transition-colors text-right max-w-[130px] truncate"
                      title={remoteUrl || 'Not configured'}
                    >
                      {remoteUrl ? remoteUrl.replace(/^(git@|https:\/\/)/, '').replace(/\.git$/, '') : 'Not configured'}
                    </button>
                  </div>
                )}
              </SettingsRow>
              {error && <p className="text-xs text-base-08">{error}</p>}
              {remoteStatus === 'failed' && remoteMessage && (
                <p className="text-xs text-base-08">{remoteMessage}</p>
              )}
            </div>

            {/* Backup interval - shown when remote backup is enabled */}
            <AnimatePresence>
              {backupEnabled && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden space-y-3"
                >
                  <SettingsRow label="Interval">
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min={5}
                        max={1440}
                        value={backupIntervalMinutes}
                        onChange={(e) => setBackupIntervalMinutes(Number(e.target.value))}
                        className="w-14 bg-base-01 border border-base-02 rounded px-2 py-1 text-xs text-base-05 focus:outline-none focus:border-base-04"
                      />
                      <span className="text-xs text-base-03">min</span>
                    </div>
                  </SettingsRow>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// Content Types section - synced with backend
function ContentTypesSection() {
  const { contentTypes, setContentTypes, updateContentType, addContentType, removeContentType } = useSettingsStore()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Keep a ref to always have latest contentTypes for async operations
  const contentTypesRef = useRef(contentTypes)
  useEffect(() => {
    contentTypesRef.current = contentTypes
  }, [contentTypes])

  // Load content types from API on mount
  useEffect(() => {
    const loadContentTypes = async () => {
      try {
        const types = await contentTypesApi.list()
        setContentTypes(types)
        setError(null)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load content types')
      } finally {
        setLoading(false)
      }
    }
    loadContentTypes()
  }, [setContentTypes])

  // Manual save handler - uses ref to always get latest content types
  const handleSave = useCallback(async () => {
    setSaving(true)
    try {
      await contentTypesApi.update(contentTypesRef.current)
      setError(null)
      // Close the editing panel after successful save
      setEditingId(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save content types')
    } finally {
      setSaving(false)
    }
  }, [])

  // Update handler
  const handleUpdate = useCallback((id: string, updates: Partial<ContentType>) => {
    updateContentType(id, updates)
  }, [updateContentType])

  const handleAddType = useCallback(() => {
    const newName = 'New Type'
    const newType: ContentType = {
      id: `custom-${Date.now()}`,
      name: newName,
      directory: newName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'custom',
      saveByDate: false,
      template: '',
    }
    addContentType(newType)
    setEditingId(newType.id)
  }, [addContentType])

  const handleRemove = useCallback((id: string) => {
    removeContentType(id)
  }, [removeContentType])

  if (loading) {
    return <div className="text-xs text-base-04">Loading...</div>
  }

  return (
    <div className="space-y-3">
      {error && (
        <div className="text-xs text-base-08 bg-base-01 rounded px-2 py-1">{error}</div>
      )}
      {contentTypes.map((type) => (
        <ContentTypeRow
          key={type.id}
          type={type}
          isEditing={editingId === type.id}
          onEdit={() => setEditingId(editingId === type.id ? null : type.id)}
          onUpdate={(updates) => handleUpdate(type.id, updates)}
          onRemove={() => handleRemove(type.id)}
          onSave={handleSave}
          isBuiltIn={type.id === 'page' || type.id === 'journal'}
          isSaving={saving}
        />
      ))}
      <button
        onClick={handleAddType}
        className="w-full py-1.5 text-xs text-base-04 hover:text-base-05 border border-dashed border-base-02 rounded transition-colors"
      >
        + Add content type
      </button>
    </div>
  )
}

// Convert a name to a directory-safe slug (lowercase, hyphenated)
function nameToDirectory(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')  // Replace non-alphanumeric with hyphens
    .replace(/^-+|-+$/g, '')      // Remove leading/trailing hyphens
    || 'custom'                   // Fallback if empty
}

// Individual content type row
function ContentTypeRow({
  type,
  isEditing,
  onEdit,
  onUpdate,
  onRemove,
  onSave,
  isBuiltIn,
  isSaving,
}: {
  type: ContentType
  isEditing: boolean
  onEdit: () => void
  onUpdate: (updates: Partial<ContentType>) => void
  onRemove: () => void
  onSave: () => void
  isBuiltIn: boolean
  isSaving: boolean
}) {
  // Track whether the user has manually edited the directory
  const [directoryManuallyEdited, setDirectoryManuallyEdited] = useState(false)

  // Reset manual edit flag when starting to edit a new type
  useEffect(() => {
    if (isEditing) {
      // If directory matches what we'd auto-generate from name, consider it not manually edited
      setDirectoryManuallyEdited(type.directory !== nameToDirectory(type.name))
    }
  }, [isEditing, type.id])

  const handleNameChange = (newName: string) => {
    // Update name, and auto-update directory if not manually edited
    if (!directoryManuallyEdited) {
      onUpdate({ name: newName, directory: nameToDirectory(newName) })
    } else {
      onUpdate({ name: newName })
    }
  }

  const handleDirectoryChange = (newDirectory: string) => {
    setDirectoryManuallyEdited(true)
    onUpdate({ directory: newDirectory })
  }

  return (
    <div className="border border-base-02 rounded overflow-hidden">
      <button
        onClick={onEdit}
        className="w-full flex items-center justify-between px-2 py-1.5 text-left hover:bg-base-01 transition-colors"
      >
        <span className="text-xs text-base-05">{type.name}</span>
        <span className="text-xs text-base-03">{type.directory}/</span>
      </button>
      <AnimatePresence>
        {isEditing && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="px-2 pb-2 space-y-2 border-t border-base-02 pt-2">
              <div className="flex items-center gap-2">
                <label className="text-xs text-base-04 w-16">Name</label>
                <input
                  type="text"
                  value={type.name}
                  onChange={(e) => handleNameChange(e.target.value)}
                  disabled={isBuiltIn}
                  className="flex-1 bg-base-01 border border-base-02 rounded px-2 py-1 text-xs text-base-05 focus:outline-none focus:border-base-04 disabled:opacity-50"
                />
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs text-base-04 w-16">Directory</label>
                <input
                  type="text"
                  value={type.directory}
                  onChange={(e) => handleDirectoryChange(e.target.value)}
                  disabled={isBuiltIn}
                  className="flex-1 bg-base-01 border border-base-02 rounded px-2 py-1 text-xs text-base-05 focus:outline-none focus:border-base-04 disabled:opacity-50"
                />
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs text-base-04 w-16">By date</label>
                <Toggle
                  checked={type.saveByDate}
                  onChange={(checked) => onUpdate({ saveByDate: checked })}
                />
                <span className="text-xs text-base-03">Create date subfolders</span>
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs text-base-04 w-16">Template</label>
                <button
                  className="text-xs text-base-0D hover:text-base-0C transition-colors"
                  title="Edit template (coming soon)"
                >
                  Edit...
                </button>
              </div>
              <div className="flex items-center gap-2 pt-1">
                <button
                  onClick={onSave}
                  disabled={isSaving}
                  className="px-2 py-1 text-xs text-base-06 bg-base-02 hover:bg-base-03 rounded transition-colors disabled:opacity-50"
                >
                  {isSaving ? 'Saving...' : 'Save'}
                </button>
                {!isBuiltIn && (
                  <button
                    onClick={onRemove}
                    className="text-xs text-base-08 hover:text-base-09 transition-colors"
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// Archived garden type (matches API response)
interface ArchivedGarden {
  id: string
  name: string
  path: string
  archived_at: string
}

// Gardens section - manages multiple gardens
function GardensSection() {
  const { currentGraphId, setCurrentGraphId } = useSettingsStore()
  const [gardens, setGardens] = useState<{ id: string; name: string; encrypted?: boolean }[]>([])
  const [archivedGardens, setArchivedGardens] = useState<ArchivedGarden[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showNewForm, setShowNewForm] = useState(false)
  const [newGardenName, setNewGardenName] = useState('')
  const [newGardenEncrypted, setNewGardenEncrypted] = useState(false)
  const [newGardenPassphrase, setNewGardenPassphrase] = useState('')
  const [newGardenPassphraseConfirm, setNewGardenPassphraseConfirm] = useState('')
  const [newGardenSearchEnabled, setNewGardenSearchEnabled] = useState(false)
  const [newGardenIndexTtl, setNewGardenIndexTtl] = useState(6)
  const [creating, setCreating] = useState(false)
  const [confirmArchive, setConfirmArchive] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [unlockGardenId, setUnlockGardenId] = useState<string | null>(null)
  const [unlockPassphrase, setUnlockPassphrase] = useState('')
  const [unlocking, setUnlocking] = useState(false)

  // Fetch gardens on mount
  useEffect(() => {
    fetchGardens()
  }, [])

  const fetchGardens = async () => {
    try {
      setLoading(true)
      setError(null)
      const response = await fetch('/api/v1/gardens')
      if (!response.ok) throw new Error('Failed to fetch gardens')
      const data = await response.json()
      setGardens(data.gardens)
      setArchivedGardens(data.archived || [])
      // Update currentGraphId if not set or not found
      if (!currentGraphId || !data.gardens.find((g: { id: string }) => g.id === currentGraphId)) {
        setCurrentGraphId(data.active)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load gardens')
    } finally {
      setLoading(false)
    }
  }

  const handleCreateGarden = async () => {
    if (!newGardenName.trim()) return

    // Validate passphrase if encrypted
    if (newGardenEncrypted) {
      if (!newGardenPassphrase) {
        setError('Please enter a passphrase for the encrypted garden')
        return
      }
      if (newGardenPassphrase !== newGardenPassphraseConfirm) {
        setError('Passphrases do not match')
        return
      }
      if (newGardenPassphrase.length < 4) {
        // Soft warning, not blocking
        if (!confirm('Your passphrase is very short. This may make your garden easier to crack. Continue anyway?')) {
          return
        }
      }
    }

    try {
      setCreating(true)
      setError(null)
      const response = await fetch('/api/v1/gardens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newGardenName.trim(),
          // Default path: base data dir + garden name
          path: `~/.local/share/tend/${newGardenName.trim().toLowerCase().replace(/[^a-z0-9]/g, '-')}`,
          passphrase: newGardenEncrypted ? newGardenPassphrase : undefined,
          // Search options for encrypted gardens
          search_enabled: newGardenEncrypted ? newGardenSearchEnabled : undefined,
          index_ttl_hours: newGardenEncrypted && newGardenSearchEnabled ? newGardenIndexTtl : undefined,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to create garden')
      }

      // Show warning about remembering passphrase
      if (newGardenEncrypted) {
        alert('IMPORTANT: Remember your passphrase! If you forget it, your notes cannot be recovered. There is no password reset.')
      }

      // Refresh the list and reset form
      await fetchGardens()
      setNewGardenName('')
      setNewGardenEncrypted(false)
      setNewGardenPassphrase('')
      setNewGardenPassphraseConfirm('')
      setNewGardenSearchEnabled(false)
      setNewGardenIndexTtl(6)
      setShowNewForm(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create garden')
    } finally {
      setCreating(false)
    }
  }

  const handleSwitchGarden = async (id: string) => {
    try {
      const response = await fetch('/api/v1/gardens/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to switch garden')
      }

      const data = await response.json()

      // Check if unlock is required
      if (data.unlock_required) {
        setUnlockGardenId(id)
        setUnlockPassphrase('')
        return
      }

      setCurrentGraphId(id)
      // Reload the page to refresh all data for the new garden
      window.location.reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to switch garden')
    }
  }

  const handleUnlockGarden = async () => {
    if (!unlockGardenId || !unlockPassphrase) return

    try {
      setUnlocking(true)
      setError(null)
      const response = await fetch('/api/v1/gardens/unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: unlockGardenId, passphrase: unlockPassphrase }),
      })

      if (!response.ok) {
        const data = await response.json()
        if (response.status === 401) {
          throw new Error('Invalid passphrase')
        }
        throw new Error(data.error || 'Failed to unlock garden')
      }

      setCurrentGraphId(unlockGardenId)
      setUnlockGardenId(null)
      setUnlockPassphrase('')
      // Reload the page to refresh all data for the new garden
      window.location.reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to unlock garden')
    } finally {
      setUnlocking(false)
    }
  }

  const handleArchiveGarden = async (id: string) => {
    if (id === currentGraphId) {
      setError('Cannot archive the active garden')
      return
    }
    try {
      const response = await fetch(`/api/v1/gardens/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      })
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to archive garden')
      }
      // Move to archived list
      const garden = gardens.find(g => g.id === id)
      if (garden) {
        setArchivedGardens([...archivedGardens, { ...garden, path: '', archived_at: new Date().toISOString() }])
      }
      setGardens(gardens.filter(g => g.id !== id))
      setConfirmArchive(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to archive garden')
    }
  }

  const handleRestoreGarden = async (id: string) => {
    try {
      const response = await fetch(`/api/v1/gardens/${encodeURIComponent(id)}/restore`, {
        method: 'POST',
      })
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to restore garden')
      }
      const garden = await response.json()
      setGardens([...gardens, garden])
      setArchivedGardens(archivedGardens.filter(g => g.id !== id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to restore garden')
    }
  }

  const handleDeletePermanent = async (id: string) => {
    try {
      const response = await fetch(`/api/v1/gardens/${encodeURIComponent(id)}/permanent`, {
        method: 'DELETE',
      })
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to delete garden')
      }
      setArchivedGardens(archivedGardens.filter(g => g.id !== id))
      setConfirmDelete(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete garden')
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-base-03">
        Select which garden to work with.
      </p>

      {error && (
        <p className="text-xs text-base-08">{error}</p>
      )}

      {loading ? (
        <p className="text-xs text-base-03">Loading gardens...</p>
      ) : (
        <>
          {gardens.map((garden) => (
            <div
              key={garden.id}
              className={`flex items-center justify-between px-2 py-1.5 rounded border transition-colors ${
                currentGraphId === garden.id
                  ? 'border-base-0D bg-base-01'
                  : 'border-base-02 hover:border-base-03'
              }`}
            >
              <button
                onClick={() => handleSwitchGarden(garden.id)}
                className="flex-1 text-left flex items-center gap-1.5"
              >
                {garden.encrypted && (
                  <svg className="w-3 h-3 text-base-0A flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                )}
                <span className="text-xs text-base-05">{garden.name}</span>
              </button>
              {currentGraphId === garden.id ? (
                <span className="text-xs text-base-0D">Active</span>
              ) : confirmArchive === garden.id ? (
                <div className="flex items-center gap-1">
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      handleArchiveGarden(garden.id)
                    }}
                    className="px-1.5 py-0.5 text-xs text-base-08 bg-base-08/10 rounded hover:bg-base-08/20 transition-colors"
                  >
                    Archive
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      setConfirmArchive(null)
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
                    setConfirmArchive(garden.id)
                  }}
                  className="p-1 text-base-03 hover:text-base-08 transition-colors"
                  title="Archive garden"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
                  </svg>
                </button>
              )}
            </div>
          ))}

          {/* Archived gardens */}
          {archivedGardens.length > 0 && (
            <div className="pt-2 border-t border-base-02">
              <p className="text-xs text-base-03 mb-2">Archived (auto-deleted after 15 days)</p>
              {archivedGardens.map((garden) => (
                <div
                  key={garden.id}
                  className="flex items-center justify-between px-2 py-1.5 rounded border border-base-02 bg-base-01/50 opacity-60 mb-1"
                >
                  <div className="flex-1 min-w-0">
                    <span className="text-xs text-base-04">{garden.name}</span>
                  </div>
                  {confirmDelete === garden.id ? (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleDeletePermanent(garden.id)}
                        className="px-1.5 py-0.5 text-xs text-base-00 bg-base-08 rounded hover:bg-base-08/80 transition-colors"
                      >
                        Delete
                      </button>
                      <button
                        onClick={() => setConfirmDelete(null)}
                        className="px-1.5 py-0.5 text-xs text-base-04 hover:text-base-05 transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleRestoreGarden(garden.id)}
                        className="px-1.5 py-0.5 text-xs text-base-0D hover:bg-base-0D/10 rounded transition-colors"
                      >
                        Restore
                      </button>
                      <button
                        onClick={() => setConfirmDelete(garden.id)}
                        className="p-1 text-base-08 hover:bg-base-08/10 rounded transition-colors"
                        title="Permanently delete"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Unlock dialog for encrypted gardens */}
      <AnimatePresence>
        {unlockGardenId && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-base-00/80 flex items-center justify-center z-50"
            onClick={() => {
              setUnlockGardenId(null)
              setUnlockPassphrase('')
            }}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-base-01 border border-base-02 rounded-lg p-4 max-w-sm w-full mx-4 space-y-3"
            >
              <div className="flex items-center gap-2">
                <svg className="w-5 h-5 text-base-0A" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
                <h3 className="text-sm font-medium text-base-05">Unlock Encrypted Garden</h3>
              </div>
              <p className="text-xs text-base-04">
                This garden is encrypted. Enter your passphrase to unlock it.
              </p>
              <input
                type="password"
                value={unlockPassphrase}
                onChange={(e) => setUnlockPassphrase(e.target.value)}
                placeholder="Passphrase"
                autoFocus
                className="w-full bg-base-00 border border-base-02 rounded px-2 py-1.5 text-sm text-base-05 focus:outline-none focus:border-base-04"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleUnlockGarden()
                  if (e.key === 'Escape') {
                    setUnlockGardenId(null)
                    setUnlockPassphrase('')
                  }
                }}
              />
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => {
                    setUnlockGardenId(null)
                    setUnlockPassphrase('')
                  }}
                  className="px-3 py-1.5 text-xs text-base-04 hover:text-base-05 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleUnlockGarden}
                  disabled={unlocking || !unlockPassphrase}
                  className="px-3 py-1.5 text-xs text-base-00 bg-base-0D hover:bg-base-0D/80 rounded transition-colors disabled:opacity-50"
                >
                  {unlocking ? 'Unlocking...' : 'Unlock'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showNewForm && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="p-2 bg-base-01 border border-base-02 rounded space-y-2">
              <input
                type="text"
                value={newGardenName}
                onChange={(e) => setNewGardenName(e.target.value)}
                placeholder="Garden name"
                autoFocus
                className="w-full bg-base-00 border border-base-02 rounded px-2 py-1 text-xs text-base-05 focus:outline-none focus:border-base-04"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !newGardenEncrypted) handleCreateGarden()
                  if (e.key === 'Escape') setShowNewForm(false)
                }}
              />

              {/* Encryption toggle */}
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={newGardenEncrypted}
                  onChange={(e) => {
                    setNewGardenEncrypted(e.target.checked)
                    if (!e.target.checked) {
                      setNewGardenPassphrase('')
                      setNewGardenPassphraseConfirm('')
                    }
                  }}
                  className="w-3.5 h-3.5 accent-base-0D"
                />
                <span className="text-xs text-base-04 flex items-center gap-1">
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                  Encrypt garden
                </span>
              </label>

              {/* Passphrase fields (shown when encryption is enabled) */}
              {newGardenEncrypted && (
                <div className="space-y-2 pt-1">
                  <input
                    type="password"
                    value={newGardenPassphrase}
                    onChange={(e) => setNewGardenPassphrase(e.target.value)}
                    placeholder="Passphrase"
                    className="w-full bg-base-00 border border-base-02 rounded px-2 py-1 text-xs text-base-05 focus:outline-none focus:border-base-04"
                  />
                  <input
                    type="password"
                    value={newGardenPassphraseConfirm}
                    onChange={(e) => setNewGardenPassphraseConfirm(e.target.value)}
                    placeholder="Confirm passphrase"
                    className="w-full bg-base-00 border border-base-02 rounded px-2 py-1 text-xs text-base-05 focus:outline-none focus:border-base-04"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleCreateGarden()
                    }}
                  />
                  <p className="text-[10px] text-base-0A leading-tight">
                    Warning: If you forget your passphrase, your notes cannot be recovered. There is no password reset.
                  </p>

                  {/* Search options for encrypted gardens */}
                  <div className="pt-2 border-t border-base-02 space-y-2">
                    <label className="flex items-start gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={newGardenSearchEnabled}
                        onChange={(e) => setNewGardenSearchEnabled(e.target.checked)}
                        className="w-3.5 h-3.5 accent-base-0D mt-0.5"
                      />
                      <div>
                        <span className="text-xs text-base-04">Enable full-text search</span>
                        <p className="text-[10px] text-base-0A leading-tight">
                          Creates a plaintext index in .tend/ for search. This exposes your note contents on disk.
                        </p>
                      </div>
                    </label>

                    {/* Index TTL (shown when search is enabled) */}
                    {newGardenSearchEnabled && (
                      <div className="pl-5 space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-base-04">Auto-delete index after</span>
                          <input
                            type="number"
                            min={0}
                            max={168}
                            value={newGardenIndexTtl}
                            onChange={(e) => setNewGardenIndexTtl(Number(e.target.value))}
                            className="w-12 bg-base-00 border border-base-02 rounded px-1.5 py-0.5 text-xs text-base-05 focus:outline-none focus:border-base-04"
                          />
                          <span className="text-xs text-base-03">hours of non-use</span>
                        </div>
                        <p className="text-[10px] text-base-03 leading-tight">
                          When you enable index expiration, the index will be recreated when it is next used. This may impact performance and will create a plaintext index until it auto-deletes. To keep the index indefinitely without deleting, set expiration to 0.
                        </p>
                      </div>
                    )}

                    <p className="text-[10px] text-base-08 leading-tight">
                      Note: Filenames are NOT encrypted and remain visible on disk.
                    </p>
                  </div>
                </div>
              )}

              <div className="flex gap-2">
                <button
                  onClick={handleCreateGarden}
                  disabled={creating || !newGardenName.trim() || (newGardenEncrypted && (!newGardenPassphrase || newGardenPassphrase !== newGardenPassphraseConfirm))}
                  className="px-2 py-1 text-xs text-base-06 bg-base-02 hover:bg-base-03 rounded transition-colors disabled:opacity-50"
                >
                  {creating ? 'Creating...' : 'Create'}
                </button>
                <button
                  onClick={() => {
                    setShowNewForm(false)
                    setNewGardenName('')
                    setNewGardenEncrypted(false)
                    setNewGardenPassphrase('')
                    setNewGardenPassphraseConfirm('')
                  }}
                  className="px-2 py-1 text-xs text-base-04 hover:text-base-05 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {!showNewForm && (
        <button
          onClick={() => setShowNewForm(true)}
          className="w-full py-1.5 text-xs text-base-04 hover:text-base-05 border border-dashed border-base-02 rounded transition-colors"
        >
          + New garden
        </button>
      )}
    </div>
  )
}

// Import section
function ImportSection() {
  const [sourcePath, setSourcePath] = useState('')
  const [overwrite, setOverwrite] = useState(false)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{
    pagesImported: number
    journalsImported: number
    skipped: number
    brokenLinks: { sourceFile: string; target: string }[]
    warnings: string[]
    dryRun: boolean
  } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleImport = async (dryRun: boolean) => {
    if (!sourcePath.trim()) {
      setError('Please enter a source path')
      return
    }

    setLoading(true)
    setError(null)
    setResult(null)

    try {
      const { importApi } = await import('../../lib/api')
      const res = await importApi.logseq({
        sourcePath: sourcePath.trim(),
        overwrite,
        dryRun,
      })
      setResult(res)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-base-03">
        Import an existing Logseq graph into this garden.
      </p>

      {/* Source path */}
      <div className="space-y-1">
        <label className="text-xs text-base-04">Logseq graph path</label>
        <input
          type="text"
          value={sourcePath}
          onChange={(e) => setSourcePath(e.target.value)}
          placeholder="/path/to/logseq/graph"
          className="w-full bg-base-01 border border-base-02 rounded px-2 py-1.5 text-xs text-base-05 focus:outline-none focus:border-base-04"
        />
        <p className="text-xs text-base-03">
          The path to your Logseq graph directory on the server.
        </p>
      </div>

      {/* Overwrite option */}
      <SettingsRow label="Overwrite existing">
        <Toggle checked={overwrite} onChange={setOverwrite} />
      </SettingsRow>
      <p className="text-xs text-base-03">
        {overwrite
          ? 'Existing files will be replaced.'
          : 'Existing files will be skipped.'}
      </p>

      {/* Action buttons */}
      <div className="flex gap-2">
        <button
          onClick={() => handleImport(true)}
          disabled={loading}
          className="px-2 py-1 text-xs text-base-04 hover:text-base-05 border border-base-02 rounded transition-colors disabled:opacity-50"
        >
          {loading ? 'Checking...' : 'Preview'}
        </button>
        <button
          onClick={() => handleImport(false)}
          disabled={loading}
          className="px-2 py-1 text-xs text-base-06 bg-base-02 hover:bg-base-03 rounded transition-colors disabled:opacity-50"
        >
          {loading ? 'Importing...' : 'Import'}
        </button>
      </div>

      {/* Error */}
      {error && (
        <p className="text-xs text-base-08">{error}</p>
      )}

      {/* Results */}
      <AnimatePresence>
        {result && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="p-2 bg-base-01 border border-base-02 rounded space-y-2">
              <p className="text-xs text-base-05 font-medium">
                {result.dryRun ? 'Preview Results' : 'Import Complete'}
              </p>
              <div className="text-xs text-base-04 space-y-1">
                <p>Pages: {result.pagesImported}</p>
                <p>Journals: {result.journalsImported}</p>
                {result.skipped > 0 && <p>Skipped: {result.skipped}</p>}
              </div>

              {/* Warnings */}
              {result.warnings.length > 0 && (
                <div className="pt-2 border-t border-base-02">
                  <p className="text-xs text-base-09 font-medium mb-1">Warnings</p>
                  <ul className="text-xs text-base-04 space-y-0.5">
                    {result.warnings.slice(0, 5).map((w, i) => (
                      <li key={i}>• {w}</li>
                    ))}
                    {result.warnings.length > 5 && (
                      <li className="text-base-03">...and {result.warnings.length - 5} more</li>
                    )}
                  </ul>
                </div>
              )}

              {/* Broken links */}
              {result.brokenLinks.length > 0 && (
                <div className="pt-2 border-t border-base-02">
                  <p className="text-xs text-base-08 font-medium mb-1">
                    Broken Links ({result.brokenLinks.length})
                  </p>
                  <ul className="text-xs text-base-04 space-y-0.5 max-h-24 overflow-y-auto">
                    {result.brokenLinks.slice(0, 10).map((link, i) => (
                      <li key={i}>
                        <span className="text-base-03">{link.sourceFile}:</span>{' '}
                        <span className="text-base-08">[[{link.target}]]</span>
                      </li>
                    ))}
                    {result.brokenLinks.length > 10 && (
                      <li className="text-base-03">...and {result.brokenLinks.length - 10} more</li>
                    )}
                  </ul>
                </div>
              )}

              {result.dryRun && (
                <p className="text-xs text-base-03 italic">
                  This was a preview. Click Import to apply changes.
                </p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// Settings row with label and control
function SettingsRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-base-04">{label}</span>
      {children}
    </div>
  )
}

// Toggle switch component
function Toggle({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative w-8 h-4 rounded-full transition-colors ${
        checked ? 'bg-base-0D' : 'bg-base-02'
      }`}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-3 h-3 bg-base-06 rounded-full transition-transform ${
          checked ? 'translate-x-4' : 'translate-x-0'
        }`}
      />
    </button>
  )
}

// SPDX-License-Identifier: MIT WITH Commons-Clause
// Sidebar options view - settings and configuration

import { useState, useCallback, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useSettingsStore, ThemeMode, FontSizePreset, ContentType } from '../../stores/settingsStore'
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
type SectionId = 'appearance' | 'storage' | 'backup' | 'content-types' | 'graph'

const SECTIONS: { id: SectionId; label: string }[] = [
  { id: 'appearance', label: 'Appearance' },
  { id: 'storage', label: 'Storage' },
  { id: 'backup', label: 'Backup' },
  { id: 'content-types', label: 'Content Types' },
  { id: 'graph', label: 'Graph' },
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
            {id === 'storage' && <StorageSection />}
            {id === 'backup' && <BackupSection />}
            {id === 'content-types' && <ContentTypesSection />}
            {id === 'graph' && <GraphSection />}
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
              activeVariant={effectiveVariant}
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
              activeVariant={effectiveVariant}
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
  activeVariant,
  activeTheme,
  onSelect,
  onCustom,
}: {
  variant: 'light' | 'dark'
  currentThemeName: string
  activeVariant: 'light' | 'dark' // The currently active theme variant
  activeTheme: Base16Theme | undefined // The currently applied theme
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
  // Only enable live preview if browsing themes for the currently active variant
  const enableLivePreview = variant === activeVariant

  const handlePreview = useCallback((theme: Base16Theme) => {
    if (enableLivePreview) {
      applyTheme(theme)
    }
  }, [enableLivePreview])

  const handleMouseLeave = useCallback(() => {
    if (enableLivePreview && activeTheme) {
      applyTheme(activeTheme)
    }
  }, [enableLivePreview, activeTheme])

  const handleSelect = useCallback((theme: Base16Theme) => {
    // Only apply the theme immediately if it's for the active variant
    if (enableLivePreview) {
      applyTheme(theme)
    }
    onSelect(theme.name)
  }, [onSelect, enableLivePreview])

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

// Storage section
function StorageSection() {
  const { gardenPath, setGardenPath } = useSettingsStore()

  return (
    <div className="space-y-3">
      <SettingsRow label="Garden path">
        <input
          type="text"
          value={gardenPath}
          onChange={(e) => setGardenPath(e.target.value)}
          placeholder="/path/to/garden"
          className="w-32 bg-base-01 border border-base-02 rounded px-2 py-1 text-xs text-base-05 focus:outline-none focus:border-base-04"
        />
      </SettingsRow>
      <p className="text-xs text-base-03">
        The local directory where your notes are stored. Leave empty to use the server default.
      </p>
    </div>
  )
}

// Backup section
function BackupSection() {
  const {
    backupEnabled,
    setBackupEnabled,
    backupRemoteUrl,
    setBackupRemoteUrl,
    backupIntervalMinutes,
    setBackupIntervalMinutes,
    backupAuthMethod,
    setBackupAuthMethod,
  } = useSettingsStore()

  return (
    <div className="space-y-3">
      <SettingsRow label="Enable backup">
        <Toggle checked={backupEnabled} onChange={setBackupEnabled} />
      </SettingsRow>

      <AnimatePresence>
        {backupEnabled && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden space-y-3"
          >
            <SettingsRow label="Remote URL">
              <input
                type="text"
                value={backupRemoteUrl}
                onChange={(e) => setBackupRemoteUrl(e.target.value)}
                placeholder="git@github.com:..."
                className="w-32 bg-base-01 border border-base-02 rounded px-2 py-1 text-xs text-base-05 focus:outline-none focus:border-base-04"
              />
            </SettingsRow>

            <SettingsRow label="Auth method">
              <select
                value={backupAuthMethod}
                onChange={(e) => setBackupAuthMethod(e.target.value as 'ssh' | 'https' | 'none')}
                className="bg-base-01 border border-base-02 rounded px-2 py-1 text-xs text-base-05 focus:outline-none focus:border-base-04"
              >
                <option value="ssh">SSH</option>
                <option value="https">HTTPS</option>
                <option value="none">None</option>
              </select>
            </SettingsRow>

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
    </div>
  )
}

// Content Types section
function ContentTypesSection() {
  const { contentTypes, updateContentType, addContentType, removeContentType } = useSettingsStore()
  const [editingId, setEditingId] = useState<string | null>(null)

  const handleAddType = () => {
    const newType: ContentType = {
      id: `custom-${Date.now()}`,
      name: 'New Type',
      directory: 'custom',
      saveByDate: false,
      template: '',
    }
    addContentType(newType)
    setEditingId(newType.id)
  }

  return (
    <div className="space-y-3">
      {contentTypes.map((type) => (
        <ContentTypeRow
          key={type.id}
          type={type}
          isEditing={editingId === type.id}
          onEdit={() => setEditingId(editingId === type.id ? null : type.id)}
          onUpdate={(updates) => updateContentType(type.id, updates)}
          onRemove={() => removeContentType(type.id)}
          isBuiltIn={type.id === 'page' || type.id === 'journal'}
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

// Individual content type row
function ContentTypeRow({
  type,
  isEditing,
  onEdit,
  onUpdate,
  onRemove,
  isBuiltIn,
}: {
  type: ContentType
  isEditing: boolean
  onEdit: () => void
  onUpdate: (updates: Partial<ContentType>) => void
  onRemove: () => void
  isBuiltIn: boolean
}) {
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
                  onChange={(e) => onUpdate({ name: e.target.value })}
                  disabled={isBuiltIn}
                  className="flex-1 bg-base-01 border border-base-02 rounded px-2 py-1 text-xs text-base-05 focus:outline-none focus:border-base-04 disabled:opacity-50"
                />
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs text-base-04 w-16">Directory</label>
                <input
                  type="text"
                  value={type.directory}
                  onChange={(e) => onUpdate({ directory: e.target.value })}
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
              {!isBuiltIn && (
                <button
                  onClick={onRemove}
                  className="text-xs text-base-08 hover:text-base-09 transition-colors"
                >
                  Remove
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// Graph section
function GraphSection() {
  const { currentGraphId, setCurrentGraphId } = useSettingsStore()

  // Placeholder graphs - in the future this would come from the server
  const graphs = [
    { id: 'default', name: 'Default Garden', path: '~/notes' },
  ]

  return (
    <div className="space-y-3">
      <p className="text-xs text-base-03">
        Select which graph (note collection) to work with.
      </p>
      {graphs.map((graph) => (
        <button
          key={graph.id}
          onClick={() => setCurrentGraphId(graph.id)}
          className={`w-full flex items-center justify-between px-2 py-1.5 text-left rounded border transition-colors ${
            currentGraphId === graph.id
              ? 'border-base-0D bg-base-01'
              : 'border-base-02 hover:border-base-03'
          }`}
        >
          <span className="text-xs text-base-05">{graph.name}</span>
          <span className="text-xs text-base-03">{graph.path}</span>
        </button>
      ))}
      <button
        className="w-full py-1.5 text-xs text-base-04 hover:text-base-05 border border-dashed border-base-02 rounded transition-colors"
        title="Create new graph (coming soon)"
      >
        + New graph
      </button>
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

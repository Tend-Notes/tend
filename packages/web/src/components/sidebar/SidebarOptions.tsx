// SPDX-License-Identifier: MIT WITH Commons-Clause
// Sidebar options view - settings and configuration

import { useSettingsStore, ThemeName } from '../../stores/settingsStore'
import { useUIStore } from '../../stores/uiStore'

interface SidebarOptionsProps {
  onBack: () => void
}

// Theme display names
const THEMES: { value: ThemeName; label: string }[] = [
  { value: 'one-dark', label: 'One Dark' },
  { value: 'nord', label: 'Nord' },
  { value: 'solarized-dark', label: 'Solarized Dark' },
  { value: 'solarized-light', label: 'Solarized Light' },
]

export function SidebarOptions({ onBack }: SidebarOptionsProps) {
  const { theme, setTheme, fontSize, setFontSize, autoBackupEnabled, setAutoBackupEnabled, autoBackupIntervalMinutes, setAutoBackupIntervalMinutes } = useSettingsStore()
  const { sidebarWidth, setSidebarWidth } = useUIStore()

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
        <div className="w-4" /> {/* Spacer for alignment */}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {/* Appearance Section */}
        <SettingsSection title="Appearance">
          <SettingsRow label="Theme">
            <select
              value={theme}
              onChange={(e) => setTheme(e.target.value as ThemeName)}
              className="bg-base-01 border border-base-02 rounded px-2 py-1 text-sm text-base-05 focus:outline-none focus:border-base-04"
            >
              {THEMES.map(({ value, label }) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </SettingsRow>
          <SettingsRow label="Font size">
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={12}
                max={24}
                value={fontSize}
                onChange={(e) => setFontSize(Number(e.target.value))}
                className="w-20 accent-base-0D"
              />
              <span className="text-xs text-base-04 w-8">{fontSize}px</span>
            </div>
          </SettingsRow>
          <SettingsRow label="Sidebar width">
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={200}
                max={400}
                value={sidebarWidth}
                onChange={(e) => setSidebarWidth(Number(e.target.value))}
                className="w-20 accent-base-0D"
              />
              <span className="text-xs text-base-04 w-8">{sidebarWidth}px</span>
            </div>
          </SettingsRow>
        </SettingsSection>

        {/* Backup Section */}
        <SettingsSection title="Backup">
          <SettingsRow label="Auto-backup">
            <Toggle
              checked={autoBackupEnabled}
              onChange={setAutoBackupEnabled}
            />
          </SettingsRow>
          {autoBackupEnabled && (
            <SettingsRow label="Interval">
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={5}
                  max={1440}
                  value={autoBackupIntervalMinutes}
                  onChange={(e) => setAutoBackupIntervalMinutes(Number(e.target.value))}
                  className="w-16 bg-base-01 border border-base-02 rounded px-2 py-1 text-sm text-base-05 focus:outline-none focus:border-base-04"
                />
                <span className="text-xs text-base-04">min</span>
              </div>
            </SettingsRow>
          )}
        </SettingsSection>

        {/* About Section */}
        <SettingsSection title="About">
          <div className="px-3 py-2 text-xs text-base-04">
            <p className="mb-1">Tend v0.1.0</p>
            <p className="text-base-03">A digital garden for your thoughts</p>
          </div>
        </SettingsSection>
      </div>
    </div>
  )
}

// Settings section with title
function SettingsSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-base-02">
      <h3 className="px-3 pt-3 pb-1 text-xs text-base-03 uppercase tracking-wide">{title}</h3>
      <div className="pb-2">{children}</div>
    </div>
  )
}

// Settings row with label and control
function SettingsRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-3 py-2">
      <span className="text-sm text-base-05">{label}</span>
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
      className={`relative w-10 h-5 rounded-full transition-colors ${
        checked ? 'bg-base-0D' : 'bg-base-02'
      }`}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-4 h-4 bg-base-06 rounded-full transition-transform ${
          checked ? 'translate-x-5' : 'translate-x-0'
        }`}
      />
    </button>
  )
}

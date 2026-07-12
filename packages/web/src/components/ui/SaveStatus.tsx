// SPDX-License-Identifier: MIT WITH Commons-Clause
// Save status indicator — a fixed-size circle so it never reflows the title.
// Progression unsaved -> saved -> stored -> backed up, encoded by color + icon:
//   unsaved = red tilde, saved = grey check, stored = blue double-check,
//   backed up = green up-arrow.
// Pale disc (color-mix, since Tailwind /opacity doesn't work on our var-hex
// colors) with a saturated bold icon. Clicking navigates to /tags/{status}.

import { usePageStore } from '../../stores/pageStore'
import { useSyncStatusStore, type SyncStatus } from '../../stores/syncStatusStore'

const svgProps = {
  className: 'w-2.5 h-2.5',
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 3.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

function TildeIcon() {
  return <svg {...svgProps}><path d="M4 13c2-4 4-4 6 0s4 4 6 0" /></svg>
}
function CheckIcon() {
  return <svg {...svgProps}><path d="M5 13l4 4L19 7" /></svg>
}
function DoubleCheckIcon() {
  return (
    <svg {...svgProps} className="w-3 h-3" viewBox="0 0 30 24">
      <path d="M2 13l4 4 9-10" />
      <path d="M13 17l1.5 1.5L28 7" />
    </svg>
  )
}
function UpArrowIcon() {
  return <svg {...svgProps}><path d="M12 19V6M6 12l6-6 6 6" /></svg>
}

// Each status: the theme color var (saturated icon + pale disc) and its icon.
const statusConfig: Record<SyncStatus, { label: string; colorVar: string; Icon: () => JSX.Element }> = {
  unsaved:     { label: 'unsaved',    colorVar: '--base08', Icon: TildeIcon },       // red
  saved:       { label: 'saved',      colorVar: '--base04', Icon: CheckIcon },       // grey
  stored:      { label: 'stored',     colorVar: '--base0D', Icon: DoubleCheckIcon }, // blue
  'backed up': { label: 'backed up',  colorVar: '--base0B', Icon: UpArrowIcon },     // green
}

export function SaveStatus() {
  const status = useSyncStatusStore((s) => s.status)
  const navigateToPage = usePageStore((state) => state.navigateToPage)
  const config = statusConfig[status]
  const { Icon, colorVar } = config

  const handleClick = () => {
    // Tag names use the status label (e.g., "unsaved", "saved", "stored", "backed up")
    navigateToPage(`tags/${config.label}`)
  }

  return (
    <button
      onClick={handleClick}
      className="inline-flex items-center justify-center h-4 w-4 rounded-full transition-colors cursor-pointer"
      style={{
        backgroundColor: `color-mix(in srgb, var(${colorVar}) 30%, transparent)`,
        color: `var(${colorVar})`,
      }}
      title={`${config.label} — click to learn more`}
      aria-label={`Status: ${config.label}`}
    >
      <Icon />
    </button>
  )
}

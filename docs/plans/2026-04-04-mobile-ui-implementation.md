# Mobile UI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rebuild mobile UI with responsive CSS, swipe indent/outdent, and a selection context pill for formatting.

**Architecture:** Three layers: (1) responsive CSS using width + pointer media queries, (2) touch gesture handler on block elements for indent/outdent, (3) floating formatting pill positioned relative to text selection. All interact with existing systems -- `handleIndent`/`handleOutdent` in Plots.tsx, `seed-format` custom events in Seed.tsx.

**Tech Stack:** CSS media queries, Touch Events API, Selection API, React, CodeMirror 6

---

### Task 1: Update viewport meta tag

**Files:**
- Modify: `packages/web/index.html:7`

**Step 1: Update the meta tag**

Change:
```html
<meta name="viewport" content="width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1, shrink-to-fit=no" />
```

To:
```html
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
```

This removes `maximum-scale=1` (accessibility: allows pinch zoom) and adds `viewport-fit=cover` (enables `env(safe-area-inset-*)` for notch devices).

**Step 2: Commit**

```bash
git add packages/web/index.html
git commit -m "Update viewport meta: allow pinch zoom, add viewport-fit=cover"
```

---

### Task 2: Add responsive CSS for phone screens

**Files:**
- Modify: `packages/web/src/styles/globals.css` (append after line 1160)

**Step 1: Add phone media query**

Append to end of globals.css:

```css
/* ─────────────────────────────────────────────────────────────────────────────
   Mobile Responsive Styles
   ───────────────────────────────────────────────────────────────────────────── */

/* Phone screens */
@media (max-width: 767px) {
  /* Typography: 16px body, tighter line height */
  html {
    font-size: 16px;
  }

  body {
    font-size: 16px;
    line-height: 1.5;
    -webkit-text-size-adjust: 100%;
  }

  /* Headings */
  .page-title, h1 { font-size: 22px; }
  h2 { font-size: 18px; }
  h3 { font-size: 16px; font-weight: 600; }

  /* CodeMirror -- match body text */
  .cm-editor,
  .cm-content,
  .cm-line {
    font-size: 16px !important;
    line-height: 1.5 !important;
  }

  /* Prevent iOS auto-zoom on input focus (must be >= 16px) */
  input, textarea, select, .cm-content {
    font-size: 16px !important;
  }

  /* Content area -- 16px side margins, no max-width constraint */
  .page-content {
    padding: 12px 16px 50vh 16px !important;
    max-width: 100% !important;
    margin: 0 !important;
  }

  /* Block spacing */
  .block {
    gap: 8px;
    padding: 3px 0;
  }

  /* Indentation -- tighter on phone */
  .block-children {
    margin-left: 16px;
    padding-left: 8px;
  }

  /* Scroll title -- full width */
  .scroll-title {
    padding: 0 16px;
  }
  .scroll-title--visible {
    padding: 8px 16px 12px 16px;
  }
}
```

**Step 2: Verify desktop is unaffected**

Open at full width, confirm no visual changes. Resize below 768px, confirm tighter spacing and 16px type.

**Step 3: Commit**

```bash
git add packages/web/src/styles/globals.css
git commit -m "Add responsive CSS for phone screens: typography, spacing, margins"
```

---

### Task 3: Add touch target expansion for coarse pointer devices

**Files:**
- Modify: `packages/web/src/styles/globals.css` (append)

**Step 1: Add pointer: coarse media query**

Append to globals.css after the phone media query:

```css
/* Touch devices -- expand targets regardless of screen size */
@media (pointer: coarse) {
  /* Bullet touch target via pseudo-element */
  .bullet {
    position: relative;
  }
  .bullet::before {
    content: '';
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    min-width: 44px;
    min-height: 44px;
  }

  /* Replace hover with active feedback */
  .bullet:hover {
    transform: none;
  }
  .bullet:active {
    background-color: var(--base0D);
    transform: scale(1.3);
  }
  .bullet--collapsed:active {
    border-color: var(--base0D);
    transform: scale(1.3);
  }

  /* Prevent text selection on UI chrome */
  button, [role="button"] {
    -webkit-user-select: none;
    user-select: none;
  }

  /* Disable double-tap zoom on interactive elements */
  button, [role="button"], .bullet {
    touch-action: manipulation;
  }
}
```

**Step 2: Test**

Use browser dev tools to toggle "coarse" pointer. Bullet hit area should be 44px (visible via DevTools element inspection). Hover effect should be suppressed, active state should work.

**Step 3: Commit**

```bash
git add packages/web/src/styles/globals.css
git commit -m "Add touch target expansion for coarse pointer devices"
```

---

### Task 4: Add swipe indent/outdent gesture handler

**Files:**
- Create: `packages/web/src/components/editor/plots/useBlockSwipe.ts`
- Modify: `packages/web/src/components/editor/plots/Plots.tsx` (block element, ~line 1467)

**Step 1: Create the swipe hook**

Create `packages/web/src/components/editor/plots/useBlockSwipe.ts`:

```typescript
// SPDX-License-Identifier: MIT WITH Commons-Clause
import { useRef, useCallback } from 'react'

const SWIPE_THRESHOLD = 36 // px horizontal to trigger
const VERTICAL_LIMIT = 20  // px vertical movement cancels swipe

interface SwipeHandlers {
  onTouchStart: (e: React.TouchEvent) => void
  onTouchMove: (e: React.TouchEvent) => void
  onTouchEnd: (e: React.TouchEvent) => void
}

export function useBlockSwipe(
  onIndent: () => void,
  onOutdent: () => void,
): SwipeHandlers {
  const startX = useRef(0)
  const startY = useRef(0)
  const swiping = useRef(false)

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0]
    startX.current = touch.clientX
    startY.current = touch.clientY
    swiping.current = true
  }, [])

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (!swiping.current) return
    const touch = e.touches[0]
    const dy = Math.abs(touch.clientY - startY.current)
    // Cancel if user is scrolling vertically
    if (dy > VERTICAL_LIMIT) {
      swiping.current = false
    }
  }, [])

  const onTouchEnd = useCallback((e: React.TouchEvent) => {
    if (!swiping.current) return
    swiping.current = false
    const touch = e.changedTouches[0]
    const dx = touch.clientX - startX.current
    if (Math.abs(dx) >= SWIPE_THRESHOLD) {
      if (dx > 0) {
        onIndent()
      } else {
        onOutdent()
      }
    }
  }, [onIndent, onOutdent])

  return { onTouchStart, onTouchMove, onTouchEnd }
}
```

**Step 2: Wire the hook into Plots.tsx block rendering**

In `Plots.tsx`, import the hook at the top:
```typescript
import { useBlockSwipe } from './useBlockSwipe'
```

This hook needs to be called per-block, so it must be used in a component. The block rendering is currently inline in a map. The cleanest approach: extract a `BlockRow` component, or call the hook at the Plots level with a factory pattern.

Since hooks can't be called in loops, create a thin wrapper. Find the block container div (~line 1467):
```tsx
<div className="block flex items-start py-0.5">
```

Wrap each block's render in a small component. In Plots.tsx, add before the main component:

```tsx
function BlockSwipeWrapper({
  children,
  onIndent,
  onOutdent,
}: {
  children: React.ReactNode
  onIndent: () => void
  onOutdent: () => void
}) {
  const swipe = useBlockSwipe(onIndent, onOutdent)
  return (
    <div
      onTouchStart={swipe.onTouchStart}
      onTouchMove={swipe.onTouchMove}
      onTouchEnd={swipe.onTouchEnd}
      style={{ touchAction: 'pan-y' }}
    >
      {children}
    </div>
  )
}
```

Then wrap the block div (~line 1467) in `<BlockSwipeWrapper>`:
```tsx
<BlockSwipeWrapper
  onIndent={() => handleIndent(uuid)}
  onOutdent={() => handleOutdent(uuid)}
>
  <div className="block flex items-start py-0.5">
    {/* ...existing bullet and seed... */}
  </div>
</BlockSwipeWrapper>
```

**Step 3: Test**

Use browser dev tools touch simulation. Swipe right on a nested block -- should indent. Swipe left -- should outdent. Vertical scrolling should not trigger indent/outdent.

**Step 4: Commit**

```bash
git add packages/web/src/components/editor/plots/useBlockSwipe.ts packages/web/src/components/editor/plots/Plots.tsx
git commit -m "Add swipe indent/outdent gesture for touch devices"
```

---

### Task 5: Create the selection context pill component

**Files:**
- Create: `packages/web/src/components/editor/SelectionPill.tsx`
- Modify: `packages/web/src/styles/globals.css` (append styles)

**Step 1: Create the component**

Create `packages/web/src/components/editor/SelectionPill.tsx`:

```tsx
// SPDX-License-Identifier: MIT WITH Commons-Clause
import { useEffect, useState, useCallback, useRef } from 'react'

interface PillPosition {
  top: number
  left: number
}

// Only show on touch devices
function isCoarsePointer() {
  return window.matchMedia('(pointer: coarse)').matches
}

export function SelectionPill() {
  const [visible, setVisible] = useState(false)
  const [position, setPosition] = useState<PillPosition>({ top: 0, left: 0 })
  const pillRef = useRef<HTMLDivElement>(null)

  const updatePosition = useCallback(() => {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
      setVisible(false)
      return
    }

    // Only show within editor blocks
    const anchor = sel.anchorNode?.parentElement
    if (!anchor?.closest('[data-seed-editor]')) {
      setVisible(false)
      return
    }

    const range = sel.getRangeAt(0)
    const rect = range.getBoundingClientRect()
    if (rect.width === 0) {
      setVisible(false)
      return
    }

    const pillWidth = pillRef.current?.offsetWidth ?? 200
    let left = rect.left + rect.width / 2 - pillWidth / 2
    // Clamp to viewport
    left = Math.max(8, Math.min(left, window.innerWidth - pillWidth - 8))
    const top = rect.top - 48 // 48px above selection

    setPosition({ top: Math.max(8, top), left })
    setVisible(true)
  }, [])

  useEffect(() => {
    if (!isCoarsePointer()) return

    const handler = () => {
      // Small delay to let selection stabilize
      requestAnimationFrame(updatePosition)
    }

    document.addEventListener('selectionchange', handler)
    return () => document.removeEventListener('selectionchange', handler)
  }, [updatePosition])

  // Hide on scroll
  useEffect(() => {
    if (!visible) return
    const hide = () => setVisible(false)
    window.addEventListener('scroll', hide, { capture: true })
    return () => window.removeEventListener('scroll', hide, { capture: true })
  }, [visible])

  const format = useCallback((delimiter: string) => {
    // Find the active editor and dispatch format event
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0) return
    const editor = sel.anchorNode?.parentElement?.closest('[data-seed-editor]')
    if (!editor) return

    const event = new CustomEvent('seed-format', {
      detail: { delimiter },
      bubbles: false,
    })
    editor.dispatchEvent(event)
  }, [])

  if (!visible) return null

  return (
    <div
      ref={pillRef}
      className="selection-pill"
      style={{
        position: 'fixed',
        top: position.top,
        left: position.left,
      }}
    >
      <button onPointerDown={(e) => { e.preventDefault(); format('**') }} title="Bold">
        <strong>B</strong>
      </button>
      <button onPointerDown={(e) => { e.preventDefault(); format('*') }} title="Italic">
        <em>I</em>
      </button>
      <button onPointerDown={(e) => { e.preventDefault(); format('~~') }} title="Strikethrough">
        <s>S</s>
      </button>
      <button onPointerDown={(e) => { e.preventDefault(); format('==') }} title="Highlight">
        H
      </button>
    </div>
  )
}
```

Note: Uses `onPointerDown` with `preventDefault()` instead of `onClick` to prevent the selection from collapsing before the format action fires.

**Step 2: Add styles**

Append to globals.css:

```css
/* Selection context pill -- touch formatting */
.selection-pill {
  z-index: 50;
  display: flex;
  gap: 2px;
  padding: 4px;
  background: var(--base01);
  border: 1px solid var(--base02);
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
}

.selection-pill button {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 32px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--base05);
  font-size: 14px;
  cursor: pointer;
}

.selection-pill button:active {
  background: var(--base02);
  color: var(--base0D);
}
```

**Step 3: Commit**

```bash
git add packages/web/src/components/editor/SelectionPill.tsx packages/web/src/styles/globals.css
git commit -m "Add selection context pill for touch formatting"
```

---

### Task 6: Mount the SelectionPill in the editor

**Files:**
- Modify: `packages/web/src/components/layout/MainContent.tsx`

**Step 1: Import and render**

Add import:
```typescript
import { SelectionPill } from '../editor/SelectionPill'
```

Add `<SelectionPill />` inside the main content area, as a sibling of the editor. Place it just before the closing `</main>` tag in the normal page render (after the scroll container div, before `</main>`):

```tsx
      </div>
      <SelectionPill />
    </main>
```

The pill uses `position: fixed` so its placement in the DOM doesn't affect layout. It only renders on `pointer: coarse` devices.

**Step 2: Test**

In browser dev tools with touch simulation, select text in the editor. The pill should appear above the selection with B/I/S/H buttons. Tapping a button should apply formatting. The pill should hide when scrolling or when selection collapses.

**Step 3: Commit**

```bash
git add packages/web/src/components/layout/MainContent.tsx
git commit -m "Mount SelectionPill in main content area"
```

---

### Task 7: Final verification and cleanup

**Step 1: TypeScript check**

```bash
cd packages/web && npx --no-install tsc --noEmit
```

**Step 2: Test at multiple widths**

- Full desktop width: no visual changes
- 768px: transition point
- 375px (iPhone SE): typography, spacing, bullets visible, swipe works
- 414px (iPhone 14): same checks

**Step 3: Test touch interactions**

Using browser touch simulation:
- Swipe right on a block → indents
- Swipe left on a block → outdents
- Vertical scroll → no accidental indent/outdent
- Select text → pill appears
- Tap formatting button → applies format
- Scroll → pill hides

**Step 4: Commit any fixes, then squash or keep as-is**

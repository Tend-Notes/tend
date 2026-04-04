# Mobile UI Design Plan

## Interaction Model

No persistent toolbar. No floating bar above keyboard. Two gesture-based interactions cover the core needs:

1. **Swipe left/right on a block** -- indent/outdent
2. **Text selection context pill** -- floating pill above selected text with inline formatting (bold, italic, highlight, strikethrough, link)

Everything else uses existing affordances:
- Tap bullet to collapse/expand
- Markdown syntax for power users
- Block-level actions (move, delete, type change) deferred to future version

## Responsive Strategy

Use both width and pointer queries:

```css
/* Phone layout */
@media (max-width: 767px) { ... }

/* Touch device -- expand targets regardless of screen size */
@media (pointer: coarse) { ... }
```

An iPad with hardware keyboard should behave like desktop.

## Typography

| Element | Phone | Tablet/Desktop |
|---------|-------|----------------|
| Body | 16-17px (1rem) | 16px |
| H1 | 22px | 24px |
| H2 | 18px | 20px |
| H3 | 16px bold | 18px |
| UI labels | 13px | 13px |
| Line height | 1.5 | 1.5 |

Use `rem` units to respect user browser zoom. CodeMirror overrides use `!important` only where necessary.

## Touch Targets

44px minimum for all interactive elements on `pointer: coarse` devices. Expand bullet hit area via `::before` pseudo-element (not negative margins):

```css
.bullet {
  position: relative;
}
.bullet::before {
  content: '';
  position: absolute;
  top: 50%; left: 50%;
  transform: translate(-50%, -50%);
  min-width: 44px;
  min-height: 44px;
}
```

## Spacing

| Parameter | Phone | Tablet |
|-----------|-------|--------|
| Content side margin | 16px | 24-32px |
| Indent per level | 16-20px | 24px |
| Block vertical gap | 4-8px | 4-6px |
| Max line width | ~65ch | ~65ch |

Cap visible indent at 4-5 levels on phone before content becomes too narrow.

## Swipe Indent/Outdent

Horizontal swipe on a block triggers indent (right) or outdent (left).

- Threshold: 30-40px horizontal movement
- CSS: `touch-action: pan-y` on block element (allows vertical scroll, captures horizontal)
- Visual feedback: block slides slightly in swipe direction, then snaps
- Events: `touchstart` / `touchmove` / `touchend`
- Cancel if vertical movement exceeds horizontal (user is scrolling)

## Selection Context Pill

Floating pill appears above text selection with formatting buttons:

- Buttons: **B** | *I* | ~~S~~ | ==H== | Link
- Position: centered above selection range, clamped to viewport edges
- Show on `selectionchange` when selection is non-empty
- Hide on selection collapse or scroll
- Use `Selection.getRangeAt(0).getBoundingClientRect()` for positioning
- Pill height: 36-40px, buttons: 32px touch targets (acceptable since it's transient, not a primary control)

## Viewport Management

```html
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
```

- Use `100dvh` for app shell height (tracks keyboard open/close)
- Use `env(safe-area-inset-*)` for notch/home indicator padding
- Do NOT fight the iOS accessory bar -- design around it

## Implementation Order

1. Responsive CSS: typography, spacing, content margins, touch targets
2. Swipe indent/outdent gesture handler
3. Selection context pill
4. Testing on iOS Safari and Android Chrome

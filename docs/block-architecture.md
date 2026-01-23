# Block Architecture Summary

Reference for rebuilding Block.tsx and OutlinerEditor.tsx with CodeMirror.

## OutlinerEditor.tsx (992 lines)

**Purpose:** Tree-level orchestration. Owns the block tree, passes callbacks down.

### State
- Uses `Page` from `pageStore` (blocks, rootBlocks)
- Uses `selectionStore` for multi-block selection (anchor/focus model)

### Core Operations (callbacks passed to Block)

| Callback | Trigger | Behavior |
|----------|---------|----------|
| `handleBlockChange(uuid, content)` | Text input | Update single block content |
| `handleCreateBlock(afterUuid, contentForNewBlock)` | Enter | Insert new block after current (as sibling, or first child if parent has children and is expanded) |
| `handleDeleteBlock(uuid)` | - | Remove block from tree |
| `handleIndent(uuid)` | Tab | Make child of previous sibling |
| `handleOutdent(uuid)` | Shift-Tab | Move to parent's level (become sibling after parent) |
| `handleToggleCollapse(uuid)` | Bullet click | Toggle `block.collapsed` |
| `handleMergeWithPrevious(uuid)` | Backspace at start | Merge content with previous block |
| `handleNavigateUp(uuid, cursorOffset?)` | Arrow Up | Focus previous block |
| `handleNavigateDown(uuid, cursorOffset?)` | Arrow Down | Focus next block |
| `handleMoveBlockUp(uuid)` | Alt-Arrow Up | Swap with previous sibling, or outdent if first child |
| `handleMoveBlockDown(uuid)` | Alt-Arrow Down | Swap with next sibling, or outdent if last child |
| `pasteBlocks(afterUuid)` | Ctrl-V | Parse markdown clipboard, create block subtree |

### Multi-block Selection Operations
- `deleteSelectedBlocks` - Delete all selected blocks
- `copySelectedBlocks` - Copy to clipboard as markdown
- `cutSelectedBlocks` - Copy then delete
- `blocksToMarkdown` - Serialize selected blocks for copy

### Helpers
- `getFlattenedBlocks()` - DFS traversal respecting collapsed state
- `flatBlockOrder` - Memoized UUID list for selection
- `focusBlock(uuid, position)` - Focus block's contenteditable, set cursor

### Render
Recursive `renderBlock()` passing all callbacks as props.

---

## Block.tsx (2394 lines)

**Purpose:** Single block UI. Handles keyboard events, text editing, formatting, popups.

### Props from OutlinerEditor
```typescript
interface BlockProps {
  block: Block
  children?: ReactNode
  onChange: (uuid: string, content: string) => void
  onCreateBlock: (afterUuid: string, contentForNewBlock?: string) => string | undefined
  onDeleteBlock: (uuid: string) => void
  onIndent: (uuid: string) => void
  onOutdent: (uuid: string) => void
  onToggleCollapse: (uuid: string) => void
  onMergeWithPrevious: (uuid: string) => void
  onNavigateUp: (uuid: string, cursorOffset?: number) => void
  onNavigateDown: (uuid: string, cursorOffset?: number) => void
  onMoveBlockUp: (uuid: string) => void
  onMoveBlockDown: (uuid: string) => void
  onPasteBlocks: (afterUuid: string) => void
  flatBlockOrder: string[]
  readonly?: boolean
}
```

### Local State
- `wikiLink` - Autocomplete popup state
- `slashCommand` - Slash command popup state
- `focusedSpan` - Which formatted span is "focused" (showing delimiters)
- `contextMenu` - Block context menu
- `isEditorFocused` - For SmoothCaret

### Keyboard Handling (handleKeyDown)

| Key | Condition | Action |
|-----|-----------|--------|
| Enter | - | Split block at cursor, create new block with content after cursor |
| Backspace | At start | `onMergeWithPrevious` |
| Backspace | In tag | Delete entire tag atomically |
| Backspace | At formatted span end | Delete from raw content, show delimiters |
| Tab | - | `onIndent` |
| Shift-Tab | - | `onOutdent` |
| Arrow Up | Single-line or at start | `onNavigateUp` |
| Arrow Down | Single-line or at end | `onNavigateDown` |
| Arrow Left | At start | Navigate to previous block end |
| Arrow Right | At end | Navigate to next block start |
| Arrow L/R | At span boundary | Jump over hidden delimiters |
| Alt-Arrow Up | - | `onMoveBlockUp` |
| Alt-Arrow Down | - | `onMoveBlockDown` |
| Alt-Arrow Left | - | `onOutdent` |
| Alt-Arrow Right | - | `onIndent` |
| Shift-Arrow Up/Down | - | Extend multi-block selection |
| Ctrl-V | No text selection | `onPasteBlocks` |
| Alt-Shift-B | - | Bold (`**`) |
| Alt-Shift-I | - | Italic (`*`) |
| Alt-Shift-U | - | Underline (`__`) |
| Alt-Shift-- | - | Strikethrough (`~~`) |
| Alt-Shift-H | - | Highlight (`==`) |
| `*`, `~`, `_`, `=` | With selection | Wrap selection with format delimiters |
| `[` | With selection | Wiki-link wrapping |

### Content Rendering (renderContent)

Parses content string, generates HTML with spans for:
- **Task status** (TODO, DOING, DONE, etc.) - Clickable to cycle
- **Heading markers** (#, ##, etc.)
- **Wiki-links** (`[[page]]`) - Clickable, delimiters hidden unless focused
- **Format patterns** (`**`, `*`, `~~`, `__`, `==`) - Delimiters hidden unless focused
- **Tags** (#tagname) - Colored pills

### Cursor/Offset Helpers

| Function | Purpose |
|----------|---------|
| `getCursorOffset(el, selection)` | Get DOM cursor position |
| `restoreCursor(el, offset)` | Set cursor at DOM offset (walks text nodes) |
| `domOffsetToContentOffset(content, domOffset, focusedSpan)` | Account for hidden delimiters |
| `contentOffsetToDomOffset(content, contentOffset, focusedSpan)` | Reverse of above |
| `reconstructContentFromDom(previousContent, domText)` | Rebuild raw content when DOM has hidden delimiters |

### UI Structure
```
block-container
├── bullet (clickable collapse, right-click context menu)
├── block-content (contenteditable div)
│   └── SmoothCaret
├── block-children (indented, left border)
│   └── [child blocks]
├── WikiLinkPopup (portal)
├── SlashCommandPopup (portal)
└── contextMenu (portal)
```

---

## Key Insights for CodeMirror Rewrite

### Block is the complexity center
2400 lines mostly handling:
- Hidden delimiter cursor math
- Format pattern rendering/editing
- Keyboard event handling

### OutlinerEditor is clean
Tree operations are straightforward array/object manipulation.

### CodeMirror replacement targets Block internals

| Old (contenteditable) | New (CodeMirror) |
|-----------------------|------------------|
| `renderContent()` HTML generation | CodeMirror decorations |
| Cursor offset helpers | CodeMirror positions |
| `handleKeyDown` | CodeMirror keymap |
| `handleInput` | CodeMirror updateListener |
| `focusedSpan` state | Decoration state facet |

### What stays the same
- OutlinerEditor's tree operations
- Block's structure (bullet, children, popups)
- The callback interface between OutlinerEditor and Block
- Multi-block selection in selectionStore

---

## Block Type Reference

```typescript
interface Block {
  uuid: string
  content: string
  parentUuid: string | null
  children: string[]
  collapsed: boolean
  properties: Record<string, string>
  depth: number
}
```

# Tend - Implementation Plan

## Overview

Tend is a self-hosted, browser-based digital garden / outliner note-taking application. It aims to provide a native, clean, elegant experience comparable to Roam Research and Logseq, with server-side file storage and Git backup.

## Tech Stack

### Backend (Rust)
- **Axum** - Web framework (Tokio ecosystem, type-safe, low memory)
- **Tantivy** - Full-text fuzzy search (embedded, fast, cross-platform)
- **gitoxide (gix)** - Git operations (pure Rust, no OpenSSL dependency)
- **notify** - File watching (cross-platform, debounced)
- **comrak** - Markdown parsing (GFM support)
- **tokio** - Async runtime

### Frontend (TypeScript/React)
- **React 18+** - UI framework
- **TipTap 3.x** - Editor (ProseMirror-based)
- **Zustand** - State management
- **cmdk** - Command palette
- **Tailwind CSS** - Styling
- **Vite** - Build tool

## Project Structure

```
tend/
├── Cargo.toml                    # Workspace manifest
├── package.json                  # Root package.json
├── pnpm-workspace.yaml
│
├── crates/                       # Rust workspace
│   ├── tend-core/                # Domain logic (parser, serializer, block model)
│   ├── tend-storage/             # File system operations + watcher
│   ├── tend-search/              # Tantivy search integration
│   ├── tend-git/                 # Git backup operations
│   └── tend-server/              # Axum web server + API
│
├── packages/
│   └── web/                      # React frontend
│       └── src/
│           ├── components/
│           │   ├── editor/       # TipTap outliner editor
│           │   ├── sidebar/      # Navigation
│           │   ├── panels/       # Backlinks, graph, etc.
│           │   └── ui/           # Base components
│           ├── stores/           # Zustand stores
│           ├── hooks/
│           └── lib/              # API client, utilities
│
├── docker/
│   ├── Dockerfile
│   └── docker-compose.yml
│
└── nix/
    ├── flake.nix
    └── module.nix
```

## File Format (Logseq-Compatible)

```markdown
- Top-level block content
  id:: a1b2c3d4-e5f6-7890-abcd-ef1234567890
  - Child block with [[wiki-link]]
    id:: b2c3d4e5-f6a7-8901-bcde-f12345678901
- Another top-level block
  id:: c3d4e5f6-a7b8-9012-cdef-123456789012
  status:: TODO
```

- Files in `pages/` and `journals/` directories
- Journal naming: `YYYY_MM_DD.md`
- Every line is a bullet: `- content`
- Block IDs: `id:: uuid` on line after content
- Properties: `key:: value` format
- Wiki-links: `[[Page Name]]`
- Block refs: `((uuid))`

## Implementation Phases

### Phase 1: Foundation (MVP)

#### 1.1 Backend Core
- [ ] Initialize Rust workspace with crate structure
- [ ] Implement `tend-core`: Block/Page models, Logseq Markdown parser, serializer
- [ ] Implement `tend-storage`: File read/write, atomic saves, file watcher
- [ ] Implement `tend-server`: Basic Axum server, serve static files

#### 1.2 API Endpoints
- [ ] `GET /api/v1/pages` - List all pages
- [ ] `GET /api/v1/pages/{name}` - Get page with blocks
- [ ] `PUT /api/v1/pages/{name}` - Update page
- [ ] `POST /api/v1/pages` - Create page
- [ ] `DELETE /api/v1/pages/{name}` - Delete page
- [ ] `GET /api/v1/journals/today` - Get/create today's journal
- [ ] `GET /api/v1/journals/{date}` - Get journal by date

#### 1.3 Frontend Foundation
- [ ] Initialize React + Vite + TypeScript project
- [ ] Set up Tailwind CSS with base16 CSS variables
- [ ] Create basic layout: sidebar + main content area
- [ ] Implement API client
- [ ] Set up Zustand stores (pages, blocks, UI state)

#### 1.4 Editor Core
- [ ] Set up TipTap with basic extensions
- [ ] Implement Block component with bullet point
- [ ] Implement outliner keyboard handling:
  - Enter: create new block
  - Backspace at start: merge with previous
  - Tab: indent
  - Shift+Tab: outdent
  - Arrow keys: navigate between blocks
- [ ] Implement block collapsing/expanding

#### 1.5 Linking
- [ ] Wiki-link extension `[[Page Name]]`
- [ ] Autocomplete popup for `[[` trigger
- [ ] Block reference extension `((uuid))`
- [ ] Autocomplete popup for `((` trigger
- [ ] Backlinks panel (linked references)

### Phase 2: Offline & Sync

#### 2.0 Local Draft Cache (Data Loss Prevention)
- [x] IndexedDB store for unsaved changes (keyed by page name)
- [x] Auto-save drafts on every keystroke (debounced ~300ms)
- [x] Visual indicator when draft differs from server ("unsaved changes")
- [x] On page load: check for stale drafts, offer to restore or discard
- [x] Clear draft from IndexedDB only after successful server save
- [x] Handle browser crash/close gracefully (drafts persist)

#### 2.1 Conflict Resolution Infrastructure
- [ ] Add `version` field to Block model (Rust + TypeScript)
- [ ] Server-side version checking on save (reject if version mismatch)
- [ ] Add `diff-match-patch` for smart 3-way text merging
- [ ] Auto-merge when patches apply cleanly
- [ ] Conflict resolution UI for true conflicts (keep mine / keep server / keep both)
- [ ] Service worker with background sync for offline edits
- [ ] Optimistic UI with retry queue for flaky connections

#### 2.2 Multi-Block Selection
- [x] Track selection state in outliner (start block, end block)
- [x] Shift+Click to select range of blocks
- [x] Shift+Arrow to extend selection across blocks
- [x] Visual indication of selected blocks (background highlight)
- [x] Delete key removes all selected blocks
- [x] Copy/Cut selected blocks to clipboard (as markdown)
- [x] Paste blocks from clipboard

#### 2.3 Block Movement (Alt+Arrow)
- [x] Alt+Up: Swap block with previous sibling (stays at same indent level)
- [x] Alt+Down: Swap block with next sibling (stays at same indent level)
- [ ] Visual feedback during move (subtle animation)
- [x] Preserve children when moving parent block

#### 2.4 Search
- [ ] Implement `tend-search`: Tantivy index schema
- [ ] Index blocks on startup
- [ ] Incremental index updates on file changes
- [ ] `GET /api/v1/search?q={query}` - Fuzzy search endpoint
- [ ] Search UI with keyboard navigation

#### 2.5 Git Backup
- [ ] Implement `tend-git`: gitoxide integration
- [ ] Scheduled backup (configurable interval)
- [ ] Garden locking during backup
- [ ] `POST /api/v1/git/backup` - Manual backup trigger
- [ ] `GET /api/v1/git/status` - Git status
- [ ] WebSocket notifications for backup status

#### 2.6 Real-time Updates
- [ ] WebSocket endpoint for file change notifications
- [ ] Frontend WebSocket client
- [ ] Merge external changes into editor state

#### 2.7 Custom Content Types
- [ ] Config file support for custom content types (meetings, people, projects, etc.)
- [ ] Each type gets its own subdirectory (like journals/ and pages/)
- [ ] Type-specific wiki-link syntax: `[[meeting:Standup 2026-01-18]]` or `[[person:John Doe]]`
- [ ] Sidebar sections per content type
- [ ] Optional type-specific templates
- [ ] API endpoints: `/api/v1/types`, `/api/v1/types/{type}/{name}`

### Phase 3: Polish & Features

#### 3.1 Command Palette
- [ ] cmdk integration
- [ ] Navigation commands (go to page, today's journal)
- [ ] Creation commands (new page)
- [ ] Keyboard shortcut: Ctrl/Cmd+Shift+P

#### 3.2 Slash Commands
- [ ] `/` trigger with command menu
- [ ] TODO/DOING/DONE markers
- [ ] Headings
- [ ] Code blocks
- [ ] Templates (basic)

#### 3.3 Theming
- [ ] Base16/Base24 CSS variable system
- [ ] Theme store with persistence
- [ ] Include 5+ built-in themes (One Dark, Nord, Solarized, etc.)
- [ ] Theme switcher in settings

#### 3.4 Smart TODO List
- [ ] Aggregate TODO/DOING/DONE blocks across graph
- [ ] TODO panel in sidebar

#### 3.5 Knowledge Graph
- [ ] `GET /api/v1/graph` - Graph data (nodes + edges)
- [ ] Graph visualization panel (d3-force or similar)
- [ ] Click to navigate

### Phase 4: Deployment & Import

#### 4.1 Docker
- [ ] Multi-stage Dockerfile (frontend build + Rust build)
- [ ] docker-compose.yml for easy deployment
- [ ] Health check endpoint

#### 4.2 NixOS
- [ ] Nix flake with package definition
- [ ] NixOS module for systemd service

#### 4.3 PWA
- [ ] Web app manifest
- [ ] Service worker for offline caching
- [ ] Background sync for offline edits

#### 4.4 Import
- [ ] Import existing Logseq graph
- [ ] Smart date rewriting for journals
- [ ] Link validation and repair

#### 4.5 At-Rest Encryption
- [ ] Optional encryption of markdown files on disk (age encryption)
- [ ] Config option to enable/disable encryption
- [ ] Key management (passphrase-based or key file)
- [ ] Transparent encrypt on save, decrypt on read
- [ ] Migration tool: encrypt existing garden / decrypt garden

### Phase 5: Future

- [ ] Longform mode (toggle bullets off)
- [ ] Templates system
- [ ] Page properties UI
- [ ] Pocket / web archiving integration
- [ ] Alternative markup languages

### Phase 6: Extensions

#### 6.1 Extension Architecture
- [ ] Define extension API (hooks, UI slots, data access)
- [ ] Extension manifest format (permissions, dependencies)
- [ ] Sandboxed execution environment (iframe or Web Worker)
- [ ] Extension settings UI

#### 6.2 Core Extension Points
- [ ] Block decorators (render custom UI for blocks matching patterns)
- [ ] Slash command providers (extensions can register new commands)
- [ ] Panel providers (sidebar panels, bottom panels)
- [ ] Export format providers (PDF, OPML, custom formats)
- [ ] Theme extensions (beyond CSS variables)

#### 6.3 Extension Distribution
- [ ] Local extension loading (dev mode)
- [ ] Extension marketplace/registry (future)
- [ ] Version management and updates

---

## Future Optimization: Sliding Window State Tracking

### Problem Statement

Currently, every mutation (keystroke, indent, delete) triggers a full clone of all blocks:

```typescript
const blocks = getAllBlocks().map((b) => ({ ...b, children: [...b.children] }))
```

For a page with 1000 blocks, this means 1000 object allocations per keystroke. While modern JS engines handle this efficiently for typical use, it becomes a scalability ceiling for power users with massive daily notes or deeply nested outlines.

### Proposed Solution: Cursor-Anchored State Window

Maintain a "hot zone" of mutable state around the cursor position, while treating distant blocks as immutable snapshots.

#### Mental Model

```
Document with cursor at B2:

Root A          ← frozen (immutable snapshot)
Root B          ← tracked (in working set)
  └─ B1         ← tracked
  └─ B2 |       ← CURSOR HERE
  └─ B3         ← tracked
Root C          ← tracked (adjacent to parent)
Root D          ← frozen
Root E          ← frozen
```

Only blocks B, B1, B2, B3, and C are cloned and tracked for mutations. Roots A, D, E remain as immutable references to the server-synced snapshot.

#### State Architecture

```typescript
interface WindowedEditorState {
  // Complete document state (immutable, from last server sync)
  snapshot: {
    blocks: Record<string, Block>
    rootBlocks: string[]
    version: number
  }

  // Active editing window
  window: {
    // Which blocks are currently "hot" (mutable copies)
    activeBlockIds: Set<string>

    // Mutable working copies of active blocks
    workingBlocks: Record<string, Block>

    // The block that anchors the window (cursor location)
    anchorBlockId: string

    // Pending changes not yet merged to snapshot
    dirtyBlockIds: Set<string>
  }

  // Derived: Get block by ID (from window if hot, else from snapshot)
  getBlock(id: string): Block
}
```

#### Window Calculation Algorithm

When cursor moves to a new block, calculate the new window:

```typescript
function calculateWindow(
  anchorId: string,
  blocks: Record<string, Block>,
  rootBlocks: string[]
): Set<string> {
  const window = new Set<string>()
  const anchor = blocks[anchorId]
  if (!anchor) return window

  // 1. Add the anchor block
  window.add(anchorId)

  // 2. Add full ancestor chain to root
  let current = anchor
  while (current.parentUuid) {
    window.add(current.parentUuid)
    current = blocks[current.parentUuid]
  }

  // 3. Add siblings of the anchor
  const siblings = anchor.parentUuid
    ? blocks[anchor.parentUuid].children
    : rootBlocks
  for (const siblingId of siblings) {
    window.add(siblingId)
  }

  // 4. Add adjacent "uncles" (siblings of parent)
  if (anchor.parentUuid) {
    const parent = blocks[anchor.parentUuid]
    const parentSiblings = parent.parentUuid
      ? blocks[parent.parentUuid].children
      : rootBlocks

    const parentIndex = parentSiblings.indexOf(anchor.parentUuid)
    if (parentIndex > 0) window.add(parentSiblings[parentIndex - 1])
    if (parentIndex < parentSiblings.length - 1) {
      window.add(parentSiblings[parentIndex + 1])
    }
  }

  // 5. Add children of anchor (if expanded)
  if (!anchor.collapsed) {
    for (const childId of anchor.children) {
      window.add(childId)
    }
  }

  return window
}
```

#### Window Transition Protocol

When cursor moves from block A to block B:

1. **Commit Phase**: Merge any dirty blocks from current window back to snapshot
2. **Calculate Phase**: Compute new window centered on B
3. **Clone Phase**: Create mutable copies of blocks entering the window
4. **Release Phase**: Discard working copies of blocks leaving the window

```typescript
function transitionWindow(
  state: WindowedEditorState,
  newAnchorId: string
): WindowedEditorState {
  // 1. Commit dirty blocks to snapshot
  const updatedSnapshot = { ...state.snapshot }
  for (const dirtyId of state.window.dirtyBlockIds) {
    updatedSnapshot.blocks[dirtyId] = state.window.workingBlocks[dirtyId]
  }

  // 2. Calculate new window
  const newActiveIds = calculateWindow(
    newAnchorId,
    updatedSnapshot.blocks,
    updatedSnapshot.rootBlocks
  )

  // 3. Clone blocks entering window
  const newWorkingBlocks: Record<string, Block> = {}
  for (const id of newActiveIds) {
    if (state.window.activeBlockIds.has(id) && !state.window.dirtyBlockIds.has(id)) {
      // Reuse existing working copy if clean
      newWorkingBlocks[id] = state.window.workingBlocks[id]
    } else {
      // Clone from snapshot
      const block = updatedSnapshot.blocks[id]
      newWorkingBlocks[id] = { ...block, children: [...block.children] }
    }
  }

  return {
    snapshot: updatedSnapshot,
    window: {
      activeBlockIds: newActiveIds,
      workingBlocks: newWorkingBlocks,
      anchorBlockId: newAnchorId,
      dirtyBlockIds: new Set(),
    },
    getBlock: (id) => newWorkingBlocks[id] ?? updatedSnapshot.blocks[id],
  }
}
```

#### Mutation Handling

Mutations only touch blocks in the working set:

```typescript
function updateBlockContent(
  state: WindowedEditorState,
  blockId: string,
  content: string
): WindowedEditorState {
  if (!state.window.activeBlockIds.has(blockId)) {
    // Edge case: mutation on frozen block (shouldn't happen with proper window calc)
    console.warn('Mutation on frozen block, expanding window')
    state = transitionWindow(state, blockId)
  }

  const updatedBlock = { ...state.window.workingBlocks[blockId], content }

  return {
    ...state,
    window: {
      ...state.window,
      workingBlocks: {
        ...state.window.workingBlocks,
        [blockId]: updatedBlock,
      },
      dirtyBlockIds: new Set([...state.window.dirtyBlockIds, blockId]),
    },
  }
}
```

#### Edge Cases to Handle

1. **Cross-window operations**: Indent/outdent might affect blocks outside the window. Expand window dynamically or commit-and-recalculate.

2. **Collapse/expand**: Collapsing a block removes its children from the window. Expanding adds them.

3. **Delete block with children**: Children might be outside window. Need to recursively collect all descendants for deletion.

4. **External updates**: Server-pushed changes need to update snapshot and potentially invalidate working copies.

5. **Undo/redo**: Operation log needs to track which blocks were modified, not just diffs.

#### Performance Characteristics

| Operation | Current | With Window |
|-----------|---------|-------------|
| Keystroke | O(n) clone | O(1) update |
| Cursor move | O(1) | O(w) clone where w = window size |
| Indent | O(n) clone | O(w) + potential window expansion |
| Save to server | O(n) serialize | O(dirty) serialize |

Window size (w) is typically 10-20 blocks regardless of document size.

#### Implementation Phases

1. **Phase A**: Implement WindowedEditorState and window calculation
2. **Phase B**: Migrate content editing to use windowed state
3. **Phase C**: Handle structural operations (indent, outdent, delete)
4. **Phase D**: Integrate with server sync and undo/redo
5. **Phase E**: Add telemetry to measure real-world performance gains

#### When to Implement

This optimization should be deferred until:
- Core editing experience is polished and stable
- Real users report performance issues with large documents
- Profiling confirms block cloning is the bottleneck

Premature optimization would add complexity without measurable benefit for typical use cases (< 500 blocks per page).

## API Design

### REST Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/v1/pages | List all pages |
| GET | /api/v1/pages/{name} | Get page content |
| POST | /api/v1/pages | Create page |
| PUT | /api/v1/pages/{name} | Update page |
| DELETE | /api/v1/pages/{name} | Delete page |
| GET | /api/v1/pages/{name}/backlinks | Get backlinks |
| GET | /api/v1/journals | List journals |
| GET | /api/v1/journals/today | Get today's journal |
| GET | /api/v1/journals/{date} | Get journal by date |
| GET | /api/v1/search?q={query} | Full-text search |
| GET | /api/v1/graph | Graph data |
| GET | /api/v1/git/status | Git status |
| POST | /api/v1/git/backup | Trigger backup |

### WebSocket

`WS /ws` - Real-time updates
- `file_changed` - External file modification
- `backup_started` / `backup_completed` - Backup status

## Key Files to Create

### Backend
- `crates/tend-core/src/lib.rs` - Core module exports
- `crates/tend-core/src/block.rs` - Block data model
- `crates/tend-core/src/parser.rs` - Logseq Markdown parser
- `crates/tend-core/src/serializer.rs` - Markdown serializer
- `crates/tend-storage/src/fs.rs` - File operations
- `crates/tend-storage/src/watcher.rs` - File watcher
- `crates/tend-search/src/index.rs` - Tantivy index
- `crates/tend-git/src/backup.rs` - Git backup
- `crates/tend-server/src/main.rs` - Server entry point
- `crates/tend-server/src/routes/pages.rs` - Page API

### Frontend
- `packages/web/src/App.tsx` - Main app
- `packages/web/src/components/editor/OutlinerEditor.tsx` - Editor wrapper
- `packages/web/src/components/editor/Block.tsx` - Block component
- `packages/web/src/components/editor/extensions/wiki-link.ts` - Wiki-link
- `packages/web/src/components/editor/extensions/block-reference.ts` - Block ref
- `packages/web/src/stores/blockStore.ts` - Block state
- `packages/web/src/stores/pageStore.ts` - Page state
- `packages/web/src/lib/api.ts` - API client

## Performance Goals

- **Instant UI response** - Optimistic updates, debounced saves
- **< 100ms search** - Tantivy handles this easily
- **< 1s initial load** - Code splitting, lazy panels
- **Smooth 60fps** - CSS transitions, virtual scrolling for large pages

## Decisions Made

- **Configuration format**: TOML
- **Journal date format**: YYYY-MM-DD (ISO 8601) - e.g., `2026-01-18.md`
- **Development approach**: Iterative - build Phase 1 MVP end-to-end first

## Next Steps

1. Initialize the project with Cargo workspace + pnpm workspace
2. Build `tend-core` (block model, parser, serializer)
3. Build `tend-storage` (file operations)
4. Build `tend-server` (basic API)
5. Build frontend foundation (React + TipTap outliner)
6. Connect frontend to backend
7. Iterate on editor feel until it's native and smooth

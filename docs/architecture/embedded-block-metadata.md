# v0.6: Embedded Block Metadata

## Problem Statement

Tend currently stores block structure (UUIDs, parent relationships, sibling order)
in-memory and derives it from the frontend state. This creates several issues:

1. **Split state problem**: `rootBlocks` (order) and `blocks` (map) can get out of sync
2. **Race conditions**: Direct setState calls interleave with updateCurrentPage()
3. **No persistence**: Block UUIDs are regenerated on reload if not carefully preserved
4. **Architecture debt**: Frontend is source of truth for structure, not files

Logseq solved this by moving to a database model. We want to stay files-first.

## Solution: Embedded Footer Database

Store block metadata in an HTML comment footer at the end of each markdown file:

```markdown
# My Page Title

- First bullet
  - Nested child
- Second bullet

<!-- tend:blocks
DO NOT EDIT - Tend uses this to track block relationships.
If corrupted, Tend will rebuild from markdown structure.

uuid|parent|order
abc123||0
def456|abc123|0
ghi789||1
-->
```

### Key Design Decisions

1. **Markdown body is human-readable** - No inline `id::` properties like Logseq
2. **Single file** - No sidecar sync issues
3. **Explicit warning** - Users know not to edit
4. **Graceful degradation** - If footer is missing/corrupt, rebuild from markdown

### Recovery Strategy (Phase 2)

When metadata is missing or corrupt:

1. **Page-level backlinks**: Match `[[page-name]]` to filenames (trivial, always works)
2. **Block ordering**: Derive from markdown indentation structure
3. **Block UUIDs**: Regenerate new UUIDs
4. **Block-level backlinks**: Fuzzy search on content to match old references to new UUIDs
5. **Orphans**: Flag any references that couldn't be resolved

## Implementation Phases

### Phase 1: Core Implementation (This Branch)

- [ ] **Parser changes** (tend-core)
  - Detect and parse `<!-- tend:blocks ... -->` footer
  - Extract UUID/parent/order table
  - Fall back to markdown-derived structure if missing

- [ ] **Serializer changes** (tend-core)
  - Write footer when saving page
  - Preserve existing UUIDs when present
  - Generate UUIDs for new blocks only

- [ ] **Storage changes** (tend-storage)
  - Update file watcher to handle footer presence
  - Ensure round-trip preserves footer

- [ ] **API changes** (tend-server)
  - Page response includes blocks with stable UUIDs
  - Page update preserves/updates footer

- [ ] **Frontend changes** (web)
  - Remove in-memory rootBlocks derivation
  - Trust server-provided block structure
  - Simplify pageStore (single source of truth)

### Phase 2: Recovery & Resilience (Future Branch)

- [ ] **Corruption detection**
  - Block count mismatch between body and footer
  - Invalid parent references
  - Duplicate UUIDs

- [ ] **Recovery workflow**
  - Full-garden reindex on corruption
  - Page-level backlink rebuilding
  - Block-level fuzzy matching
  - Orphan flagging and user notification

- [ ] **Migration tooling**
  - Convert existing pages to have footer
  - Handle Logseq imports

## File Format Specification

### Footer Format

```
<!-- tend:blocks
DO NOT EDIT - Tend uses this to track block relationships.
If corrupted, Tend will rebuild from markdown structure.

uuid|parent|order
{uuid}|{parent_uuid or empty}|{sibling_order}
...
-->
```

### Parsing Rules

1. Look for `<!-- tend:blocks` at end of file (allow trailing whitespace)
2. Parse pipe-delimited table after header
3. Empty parent field = root block
4. Order is 0-indexed within siblings

### Serialization Rules

1. Blocks listed in depth-first order (matches visual order)
2. Footer separated from content by blank line
3. Warning text always present
4. No trailing content after footer close

## Migration Path

Existing pages without footer:
- On first save, generate footer from current block state
- Preserve any existing UUIDs from API response
- New blocks get new UUIDs

## Failure Modes

| Scenario | Behavior |
|----------|----------|
| Footer missing | Parse markdown structure, generate UUIDs |
| Footer malformed | Same as missing |
| UUID collision | Regenerate one, log warning |
| Parent not found | Make block a root, log warning |
| Body/footer mismatch | Prefer body content, regenerate footer |

## Files to Modify

### Rust (Phase 1)
- `crates/tend-core/src/parser.rs` - Footer parsing
- `crates/tend-core/src/serializer.rs` - Footer writing
- `crates/tend-core/src/block.rs` - Block model updates
- `crates/tend-storage/src/garden.rs` - File handling
- `crates/tend-server/src/routes/pages.rs` - API response

### TypeScript (Phase 1)
- `packages/web/src/stores/pageStore.ts` - Remove rootBlocks derivation
- `packages/web/src/components/editor/plots/Plots.tsx` - Trust server structure

### Rust (Phase 2)
- `crates/tend-core/src/recovery.rs` - New module for recovery
- `crates/tend-search/src/index.rs` - Backlink reindexing

## Testing Strategy

1. Unit tests for parser/serializer round-trip
2. Integration tests for page save/load cycle
3. Edge cases: empty page, deeply nested, special characters in content
4. Recovery tests: corrupt footer, missing footer, partial corruption

## Success Criteria

Phase 1 complete when:
- Pages persist block UUIDs across reload
- Block structure survives external file edit (preserving markdown)
- Frontend no longer derives rootBlocks locally
- No more race conditions between blocks and rootBlocks

Phase 2 complete when:
- Corrupted pages auto-recover
- Page-level backlinks survive recovery
- Block-level backlinks best-effort recovered
- User notified of unrecoverable orphans

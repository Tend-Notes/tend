# Editor fixes — Plots/Seed outliner

End-to-end review of the block editor (`packages/web/src/components/editor/`).
Findings are risk-ordered with stable IDs. Each entry is self-contained: symptom,
root cause with code references, the fix, edge cases, and how to verify.

## Architecture context (read first)

The editor is **not** a hand-rolled contentEditable. It is:

- **Active block** = one **CodeMirror 6** instance (`ActiveSeed`, `Seed.tsx`).
  React renders an empty `<div>`; CodeMirror owns the DOM inside it. In-block
  selection, caret, word ops, and per-block undo come from CodeMirror.
- **Dormant blocks** = static React rendered from a hand-rolled tokenizer
  (`renderContentReact` / `parseContent`, `contentRenderer.ts`). Read-only.
- **Outliner level** (the block tree, cross-block selection, copy/delete,
  navigation, typewriter scroll) = hand-written in `plots/Plots.tsx` (2366 lines)
  on top of the native DOM `Selection`/`Range` API.

The recurring root cause: because only one block is ever a live CodeMirror view,
everything that spans blocks — selection, undo, the dormant renderer — is
re-implemented by hand at the tree level. That is where the serious bugs are.
`✓` marks findings confirmed by direct code reading during review.

Line numbers are accurate as of this review but may drift; treat the described
mechanism as authoritative and re-locate by symbol name if a line has moved.

Design constraint for all fixes: **this is a pure outliner (Logseq model).**
Blocks are the document primitive. Do not introduce a single whole-document
markdown editor (Obsidian model). Fixes must preserve the per-block model.

---

## HIGH

### EF-01 ✓ Cross-block delete orphans collapsed subtrees (silent data loss)

**Severity:** High — unrecoverable data loss.
**Files:** `plots/Plots.tsx` — `handleCrossBlockDelete` (~`:1739`–`:1875`), set
construction at `:1844`, filter at `:1866`; `flatBlockOrder` at `:200`–`:215`.

**Symptom.** Select across multiple blocks where the selection includes a
*collapsed* parent (or any block with children that are not in the current DOM),
then delete. The parent disappears, but its hidden children vanish from the UI,
cannot be reached again, and remain in stored data as unreachable nodes.

**Root cause.** The set of blocks to delete is derived from DOM nodes that
intersect the selection range:

```ts
let blockUuids: string[] = []           // built from [data-block-id] elements (:1752)
const uuidsToDelete = new Set(blockUuids.slice(1))   // :1844
...
const updatedBlocks = blocks.filter((b) => !uuidsToDelete.has(b.uuid))  // :1866
const newRootBlocks = pageRootBlocksRef.current.filter((id) => !uuidsToDelete.has(id))
```

`flatBlockOrder` (and therefore the rendered DOM) skips children of collapsed
blocks:

```ts
if (!block.collapsed && block.children.length > 0) traverse(block.children)  // :208
```

So a collapsed parent's descendants are never in `blockUuids`, never in
`uuidsToDelete`. After the filter, each surviving descendant keeps
`parentUuid === <deleted parent>`, is in no parent's `children`, and is not in
`rootBlocks`. It is orphaned.

**Fix.**
1. Before computing `uuidsToDelete`, expand the selected set to the **full
   descendant closure** of every fully-selected block, walking the model
   (`pageBlocksRef.current` + `children`), not the DOM. A block is "fully
   selected" if it is strictly between the first and last selected block in
   document order, or is the last block with the selection reaching its end.
2. Decide descendant content semantics explicitly: descendants of a fully
   deleted block are deleted with it (matches user intent of "delete this
   bullet and everything under it"). Do **not** silently keep them.
3. Reuse the child-transfer rules already in `handleMergeWithPrevious`
   (`:476`–`:484`) only for the boundary blocks (first/last), where partial
   text remains.
4. After building the final delete set, assert no surviving block references a
   deleted `parentUuid` (see EF-21 validator) and that every surviving non-root
   block appears in exactly one parent's `children`.

**Edge cases.** First/last blocks partially selected (keep partial text, keep
their non-selected children re-parented per merge rules); selection that starts
or ends inside a collapsed block; selection of an entire root subtree.

**Verify.** Unit test: build a tree with a collapsed parent P having child C;
select from a block above P through a block below P; delete; assert C is gone
from `blocks` and no orphan remains. Add a property test: after any cross-block
delete, the tree has no dangling `parentUuid` and no node reachable from two
parents.

---

### EF-02 ✓ No structural undo; per-block undo dies on deactivate

**Severity:** High — destructive edits are unrecoverable.
**Files:** `stores/pageStore.ts` (no history stack — confirmed: every `history`
reference is browser navigation or recent-files); `Seed.tsx` history extension
(`~:826`) destroyed on view teardown (`~:849`–`:852`); no app-level Ctrl/Cmd+Z
binding exists (confirmed by grep).

**Symptom.** Ctrl/Cmd+Z does nothing for indent, outdent, move, split, merge,
or delete. Even plain text undo is lost the moment focus leaves a block (the
CodeMirror `history` is per-`ActiveSeed` and torn down on deactivate). After an
accidental merge or the EF-01 delete, there is no recovery — the IndexedDB draft
already holds the post-edit state.

**Root cause.** Undo exists only inside the single active CodeMirror instance and
is scoped to that instance's lifetime. All structural mutations go through
`updateCurrentPage` with no history capture.

**Fix.**
1. Add a page-level history to `pageStore`: two stacks (`undo`, `redo`) of either
   full page snapshots (`{blocks, rootBlocks}`) for simplicity, or inverse
   operations for memory efficiency. Snapshots are simplest and adequate for
   per-page sizes; cap depth (e.g. 100) and coalesce rapid text edits.
2. Push the *pre-mutation* state before every structural handler in `Plots.tsx`
   (split, merge, indent, outdent, move, cross-block delete, paste). Best done
   by routing all mutations through a single reducer (see EF-15) and snapshotting
   there, so no call site can forget.
3. Bind Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z (and Ctrl+Y) at the container level
   **when no block is active**; when a block is active, let CodeMirror handle
   in-block undo, and only fall through to page undo at the block's history
   boundary. Decide and document the layering (recommended: page-level history is
   the source of truth for structural ops; CM history for intra-block text).
4. On undo/redo, restore focus/caret to a sensible block (the mutated block).

**Edge cases.** Undo of a delete must restore collapsed state and child order;
coalescing must not merge a structural op into an adjacent text edit; redo
invalidated after a new edit.

**Verify.** Tests for each structural op: do op → undo → assert tree identical to
pre-op (including `collapsed`, ordering, `depth`); redo → assert post-op state.
Manual: accidental merge + Ctrl+Z restores both blocks and caret.

**Depends on / enables:** EF-15 (reducer) makes this cheap and uniform.

---

### EF-03 Cross-block copy drops collapsed/hidden descendants (lossy clipboard)

**Severity:** High — silent data fidelity loss on copy/cut.
**Files:** `plots/Plots.tsx` — copy handler (~`:2030`–`:2242`), DOM intersection
detection at `:2049`–`:2055`, JSON build at `:2120`–`:2233`.

**Symptom.** Copy a collapsed bullet "with everything under it" and paste — only
the visible blocks appear. Both `text/plain` and the internal `text/tend-blocks`
JSON omit the hidden children.

**Root cause.** Same flaw class as EF-01: copied blocks are gathered from
DOM nodes intersecting the range (`range.intersectsNode(seedEl)`), and collapsed
children are not rendered.

**Fix.** Build the copied tree from the model: for any fully-selected block,
include its complete descendant subtree from `pageBlocksRef.current` +
`children`, regardless of `collapsed`/render state. Serialize both representations
(`text/plain` indented markdown and `text/tend-blocks` JSON) from that model
tree. Keep the existing partial-text handling for the boundary (first/last)
blocks.

**Edge cases.** Cut = copy + EF-01 delete; ensure both use the same closure.
Round-trip: copy a collapsed subtree → paste → identical tree including collapsed
flags.

**Verify.** Test: collapsed parent with children → copy → assert JSON contains
the full subtree → paste elsewhere → trees match.

**Related:** EF-01 (shared "build from model, not DOM" principle).

---

### EF-04 Two divergent markdown parsers (caret shift on activate; broken wikilink alias)

**Severity:** High — visible content/caret divergence and a navigation bug.
**Files:** dormant tokenizer `contentRenderer.ts` — `parseContent` (`:61`–`:180`),
offset maps `mapRenderedOffsetToSource` (`:662`–`:727`) and inverse (`:797`–`:871`);
active editor uses real `lezer-markdown` via `extensions/markdown.ts` (`:22`–`:60`)
plus satellite regex plugins (`tags.ts`, `wikilink.ts:34`, `blockReference.ts`,
`taskStatus.ts`).

**Symptom.**
- A block can render differently dormant vs active (active uses CommonMark-grade
  lezer; dormant uses a different, weaker grammar). On click-to-activate the
  visible text and caret column can shift.
- `[[page|Alias]]`: the active editor's regex `\[\[([^\]]+)\]\]` captures
  `page|Alias` as the target, so the pill shows the pipe and navigation builds
  `/page/page%7CAlias` (a nonexistent page). The dormant parser handles the alias
  correctly, so the two disagree.
- Dormant parser has **no nesting** (`**bold _italic_**` shows literal
  underscores), **no escapes** (`\*` still italicizes), an **over-greedy URL
  regex** (`:106`) that swallows adjacent markup, and a **hardcoded task-keyword
  set** (`:44`) that ignores the user's configured status set.

**Root cause.** Dormant rendering and the caret-on-click path were implemented as
an independent hand-rolled tokenizer instead of reusing the lezer tree that the
active editor already parses. The offset maps then re-derive each token's
delimiter width with hardcoded constants (see EF-08).

**Fix (preferred, larger).** Make one parser the single source of truth for both
views. Two viable routes:
- Render the dormant view from the same lezer tree the active editor uses
  (parse once, walk the tree to produce React nodes), **or**
- Replace `parseContent` with a real inline parser (e.g. `markdown-it` /
  `micromark`) used by both the dormant renderer and the active satellite
  features, and reconcile the satellite tokens (tags, wikilinks, block refs) as
  extensions of that one parser.

Either way: **emit each token's source span `[from,to)` during parsing** so the
offset maps (EF-08) become lookups instead of arithmetic, and dormant/active
agree by construction.

**Fix (immediate, smaller, do regardless).** Make the wikilink regex alias-aware
in the active editor (`wikilink.ts:34`) — split on `|` into `target` and
`display`, mirror `parseContent`'s handling — and route `href` through the
existing `safeHref`. This stops the broken navigation now even before the parser
unification lands.

**Edge cases.** Code spans suppressing inner markup; nested emphasis; escaped
delimiters; wikilink alias with spaces; tag/wikilink adjacent to punctuation;
unicode/emoji/CJK (currently consistent — keep it that way: all offsets are
UTF-16 code units end-to-end).

**Verify.** Golden tests comparing dormant-rendered text and active-rendered text
for a corpus of tricky strings; assert identical visible text and identical
caret-column mapping at every offset. Specific regression: `[[a|b]]` navigates to
`/a`, not `/a%7Cb`.

**Related:** EF-08 (offset maps), EF-18 (URL regex/escapes).

---

## MEDIUM

### EF-05 IME / dead-key first character corrupted when activating a dormant block

**Severity:** Med — silent text corruption for CJK/accent/dead-key users.
**Files:** `plots/Plots.tsx` — container keydown when all blocks dormant
(`:1918`–`:1945`), `insertTextAtCursor` polling path (`:1958`–`:1998`).

**Symptom.** With an IME or dead keys, typing the first character into a
not-yet-active area produces wrong/missing input.

**Root cause.** The container handler does `e.preventDefault()` then dispatches a
synthetic single-character insert using `e.key`. During composition `e.key` is
not the composed character (often `"Process"` or a dead key), and preventing
default discards the browser's composition.

**Fix.** Do not swallow printable keys. On a printable keydown over a dormant
area, activate the target block and let the **native** key/composition events
reach CodeMirror, which handles IME correctly. Guard the synthetic-insert path
with `if (e.isComposing) return;` and avoid `preventDefault` for the
printable-character case. Keep `preventDefault` only for the keys you genuinely
intercept (navigation, Enter, etc.).

**Edge cases.** Activation latency (the first composition must land in CM, not be
dropped); ensure the newly activated view has focus before composition starts.

**Verify.** Manual with a CJK IME (e.g. Pinyin) and with macOS dead keys (Option+e
then a → "é") starting from a dormant block. Automated: simulate a
`compositionstart`/`compositionend` sequence and assert no synthetic insert runs.

---

### EF-06 Typewriter-scroll jiggle masked by a guessed timer; no upward scroll

**Severity:** Med — visible oscillation at large jumps/boundaries; caret can
leave the top of the viewport.
**Files:** `plots/Seed.tsx` — `createTypewriterListener` (`:728`–`:762`),
re-arm timer at `:759`; navigation scroll race at `Plots.tsx:1648`–`:1663`.

**Symptom.** Caret-line-locking scroll oscillates ("jiggles") on big jumps
(tall blocks, multi-line paste, slow devices). Arrow-up / merge-into-higher-block
can park the caret above the visible area with nothing scrolling it back.

**Root cause.**
- The update listener runs on **every** CodeMirror update with no
  `docChanged`/`selectionSet` guard. Scrolling the ancestor container makes CM
  re-measure and fire more updates → a scroll→measure→scroll feedback loop. The
  only thing breaking it is `scrollingRef`, gated by a hardcoded `setTimeout(…,
  300)`. `scrollBy({behavior:'smooth'})` duration is browser/distance dependent
  and is not 300ms; for large `scrollAmount` the animation outlasts the lockout,
  the lockout releases mid-animation, a transient position is measured, and a
  second competing smooth scroll fires.
- Only the `scrollAmount > 10` (caret below middle) branch exists; there is no
  branch to scroll up when the caret is above the viewport. `.cm-scroller` is
  `overflow: visible` (`Seed.tsx:120`), so CM's own `scrollIntoView` is a no-op.

**Fix.**
1. Gate the listener: `if (!update.docChanged && !update.selectionSet) return;`
   so scroll-induced geometry updates don't re-trigger scrolling.
2. Replace the guessed timer with a real signal: listen for `scrollend` on the
   container to clear `scrollingRef` (with a timeout fallback for browsers
   without `scrollend`). Or compute one absolute target and issue a single
   `scrollTo`, ignoring intermediate updates.
3. Add the upward branch: when the caret is above the top margin, scroll up
   symmetrically.
4. Suppress the listener during programmatic navigation (`Plots.tsx:1648`): set
   `scrollingRef` while `scrollIntoView` animates, or use non-smooth
   `block:'center'` and let the typewriter own the final position, to avoid the
   navigation/typewriter race.
5. Fix the same-line optimization: `lastCursorYRef` stores viewport-relative Y
   (`:738`), which is invalidated by any scroll; store a document-relative Y or
   the line number instead. Clear the re-arm timer on unmount.

**Edge cases.** Top and bottom of document (clamp so a satisfied target doesn't
re-issue scrolls); blocks taller than the viewport; reduced-motion preference.

**Verify.** Manual: hold Down through a long block past the midline — smooth, no
jiggle; press Up to the first line — page scrolls to keep caret visible;
navigate via a link near the bottom — no double-scroll. Add a test that the
listener early-returns when `docChanged` and `selectionSet` are both false.

---

### EF-07 Per-keystroke O(n) work: full-tree rebuild + fence rescan + full-array write

**Severity:** Med — input lag on large pages (~2000 blocks).
**Files:** `plots/Plots.tsx` — `handleBlockChange` (`:326`), `getAllBlocks`
(`:223`–`:234`), `flatBlockOrder` (`:200`), `codeFenceMap`/`detectCodeFences`
(`:48`–`:117`, `:218`–`:220`); `stores/pageStore.ts` `updateCurrentPage`
(rebuilds `blockMap` + `rootBlocks`, ~`:594`–`:644`).

**Symptom.** Typing latency grows with page size. Each keystroke does several
O(n) passes plus n regex executions.

**Root cause.** Every text edit: `getAllBlocks()` traverses the whole tree →
`.map` over all blocks → `updateCurrentPage` rebuilds the entire map and
recomputes roots → Plots re-renders, invalidating `flatBlockOrder` (re-traverse)
and `codeFenceMap` (re-scan every block with `.trim()` + 3 regex `.match` each),
because `page.blocks` is a new reference. Component memoization (`Seed.tsx:1155`)
correctly prevents DOM re-render, but the JS work per keystroke remains O(n).

**Fix.**
1. Add a single-block store action `updateBlockContent(uuid, content)` that
   immutably patches one entry (one map key) instead of round-tripping the whole
   array. Route text edits through it.
2. Make `codeFenceMap` incremental: only recompute when an edited line contains a
   fence marker (` ``` `); otherwise reuse the previous map. Or compute fences in
   the store on block change rather than in a render-time memo.
3. Keep `getAllBlocks().map()` off the hot text-edit path (reserve it for
   structural ops, which are rarer).
4. Debounce the persistence side (already debounced for save; ensure the
   in-memory churn is what's reduced here).

**Edge cases.** Fence state spans blocks (a ` ``` ` opened in one block, closed
in a later one) — incremental fence detection must still recheck downstream
blocks when a fence marker is added/removed.

**Verify.** Benchmark keystroke latency on a 2000-block page before/after; assert
a single keystroke touches one block in the store (spy on the action) and does
not re-run `detectCodeFences` for fence-irrelevant edits.

---

### EF-08 Offset-mapping delimiter widths hardcoded in three places (off-by-one class)

**Severity:** Med — click-to-place-caret and copy boundaries land wrong near
inline markup; fragile to any token change.
**Files:** `contentRenderer.ts` — token render lengths in `parseContent`
(`:645`–`:732`), `mapRenderedOffsetToSource` (`:662`–`:727`),
`mapSourceOffsetToRendered` (`:797`–`:871`).

**Symptom.** Clicking inside or near a tag/wikilink/bold/etc. can place the caret
a character off; cross-block copy boundaries can be off by one. Adding or
changing any token requires editing three locations or the caret silently breaks.

**Root cause.** Each token's source width is re-derived with hardcoded constants
(`+4`/`+2`/`+6`, `name.length + 1` for tags, etc.) independently in the parser
and both maps. `default`/`taskStatus` branches use proportional interpolation
(`round(ratio * sourceLen)`), which drifts.

**Fix.** Have `parseContent` attach to each token its source span
(`srcFrom`, `srcTo`) and its rendered length (`renderedLen`) at parse time. Both
maps then become a linear walk over tokens comparing cumulative rendered length
to the target and returning `srcFrom + (offset - renderedStart)` clamped to the
token's source range — no per-type arithmetic. Remove the proportional branches.

**Edge cases.** Zero-width tokens (header prefix `:737`): map rendered offset 0 to
the first text character, not before the hashes; truncated wikilink display
(ensure rendered length matches what is actually shown).

**Verify.** Property test: for every offset `0..renderedLen`, mapping rendered→
source→rendered is identity; click positions inside each token type land on the
expected source index. This finding is largely **subsumed by EF-04** if the
parser is unified to emit spans — do them together.

**Related:** EF-04.

---

### EF-09 Ctrl/Alt+Backspace and Ctrl/Alt+Delete don't merge at block boundaries

**Severity:** Med — word-processor expectation unmet at edges (in-block word
delete works).
**Files:** `plots/Seed.tsx` — boundary keymap `Prec.highest` (`:474`), plain
`Backspace`/`Delete` bindings (`:608`–`:632`).

**Symptom.** At offset 0, Ctrl/Cmd/Alt+Backspace deletes nothing and does not
merge into the previous block (a word processor merges). At doc end,
Ctrl/Alt+Delete likewise doesn't pull up the next block. Word delete *within* a
block works (CodeMirror `deleteGroupBackward/Forward`).

**Root cause.** The boundary keymap binds only plain `Backspace`/`Delete` to fire
`backspace-at-start` / `delete-at-end`. Word-delete uses `Mod-Backspace` /
`Alt-Backspace`, which never matches the plain-key bindings, so CodeMirror's
in-block word delete runs and at the edge there is nothing to delete.

**Fix.** Add `Mod-Backspace`, `Alt-Backspace`, `Mod-Delete`, `Alt-Delete` (and
mac variants) to the boundary keymap. Each handler: if selection is empty AND at
offset 0 (backspace) / doc end (delete), fire the existing merge event; otherwise
`return false` to let CodeMirror perform the in-block word delete. Mirror the
existing plain-key fall-through pattern (`:613`–`:617`).

**Verify.** Test: caret at offset 0, Ctrl+Backspace → merges with previous block
(same result as plain Backspace at start); caret mid-word → deletes the word, no
merge.

---

### EF-10 Up-arrow into a multi-line block lands on the first line; no goal column

**Severity:** Med — vertical navigation skips lines.
**Files:** `plots/Seed.tsx` — `arrow-up` sends absolute offset (`:640`–`:643`);
`plots/Plots.tsx` — `navigateUp` applies it absolutely (`:742`–`:747` →
`focusBlock(prevUuid, cursorOffset)`).

**Symptom.** Pressing Up from the top of a block into a multi-line previous block
lands on that block's **first** line at the column, skipping its other lines.
Down is correct (it sends a column relative to line start). There is also no
goal-column memory across blocks.

**Root cause.** Up-navigation passes an absolute offset; when applied to the
previous block it resolves on line 1 instead of the last line.

**Fix.**
1. For up-navigation, target the previous block's **last** line at the desired
   column: `pos = doc.length - lastLineLength + column`, clamped to the last
   line's range.
2. Thread a persistent **goal column** through `focusBlock`/navigation so
   repeated Up/Down preserve the intended column across blocks and short lines
   (standard editor behavior). Reset the goal column on horizontal movement or
   typing.

**Verify.** Test: multi-line previous block, caret at column k, press Up → lands
on the last line at column k (or end if shorter); press Up again → previous block
at column k. Down then Up returns to the same column.

---

### EF-11 Hardcoded `lineHeight = 24` breaks Shift+Arrow cross-block selection on headers

**Severity:** Med — wrong selection extension on non-24px lines.
**Files:** `plots/Plots.tsx` — `:901` and `:960` compute the extension point as
`headCoords.y ± 24`; same magic number as a fallback in `SmoothCaret.tsx:50`.

**Symptom.** Shift+Arrow-Up/Down across blocks extends to the wrong line/block,
or fails to extend (synthesized point misses, `extNode` null), on header blocks
or any block whose line height isn't 24px.

**Root cause.** The cross-block selection synthesizes a `caretPositionFromPoint`
at a fixed 24px offset from the current caret coordinates instead of the real
line height.

**Fix.** Compute the real line height from the source block: use
`view.coordsAtPos` (you already call it) and take `bottom - top`, or
`parseFloat(getComputedStyle(seedEl).lineHeight)`. Use that for the ±offset.

**Verify.** Test/manual: Shift+Arrow-Down from a `# Header` block extends to the
correct next block; works across mixed header/body line heights.

---

### EF-12 Pending draft save races navigation → spurious recovery prompt

**Severity:** Med — false "unsaved draft" prompts; user confusion.
**Files:** `stores/pageStore.ts` — `flushPendingSave` clears `saveTimeout` and
`pendingSaveData` but not `draftTimeout` (~`:856`–`:902`); `draftTimeout` only
cleared in `reset` (~`:915`); `serverVersion` captured at schedule time (~`:655`).

**Symptom.** Edit then navigate within ~300ms. On returning to the page you get a
draft-recovery prompt for content identical to what's on the server.

**Root cause.** `flushPendingSave` saves to server and `deleteDraft`s, but the
still-pending `draftTimeout` then fires `saveDraft` with the stale captured
`serverVersion`. On next load `draft.serverVersion !== page.modifiedAt` (which
was just bumped by the save), so a recovery prompt appears.

**Fix.** Clear `draftTimeout` (and null its handle) inside `flushPendingSave`,
alongside `saveTimeout`. Confirm no other path can re-schedule a draft after a
flush without a subsequent edit.

**Verify.** Test: schedule an edit, call `flushPendingSave`, advance timers past
the draft delay → assert `saveDraft` not called and no draft persisted; reload →
no recovery prompt.

---

### EF-13 `depth` is denormalized state; `updateChildDepths` is O(n²) and desync-prone

**Severity:** Med — correctness risk + quadratic cost on deep subtrees.
**Files:** `plots/Plots.tsx` — `updateChildDepths` (`:580`–`:591`, `:644`–`:655`),
also recomputed in split (`:374`) and paste (`:1314`); `depth` consumed by layout
math (`:1463`–`:1465`).

**Symptom.** Any structural path that miscomputes `depth` desyncs it from the
real tree, and `depth` drives layout (code-block negative margin). Deep subtrees
incur O(n²) because `updateChildDepths` does `blocks.find` inside a recursion.

**Root cause.** `depth` is stored on each block in addition to
`parentUuid`/`children`, so it must be hand-synced on every move/indent/outdent/
split/paste — a denormalization with multiple owners.

**Fix.** Derive depth from tree position instead of storing it: compute it at
render time during the `flatBlockOrder` traversal (which already walks the tree
with depth available), or compute it once in `updateCurrentPage`. Remove the
stored field and all `updateChildDepths` calls. If a stored field must remain for
compatibility, centralize its computation in one place keyed off the tree.

**Edge cases.** Serialized data may carry `depth`; on load, recompute from the
tree rather than trusting it.

**Verify.** After removing the field, indent/outdent/move/paste still render at
the correct visual depth; a deep (e.g. 1000-node) subtree move is linear.

---

## LOW

### EF-14 Dead code: `SmoothCaret.tsx` and the `selectionStore` block-selection model

**Severity:** Low — confusion, maintenance drag, latent bugs if revived.
**Files:** `components/editor/SmoothCaret.tsx` (no importers); `stores/
selectionStore.ts` — `startSelection`/`extendSelection`/`startDrag`/`endDrag`/
`getSelectedUuids`/`hasMultiBlockSelection` have zero callers; `getSelectedRange`
always returns null so `isInSelection` (`Plots.tsx:1424`) is always false and the
`block-container--selected` styling (`:1452`) never renders.

**Symptom.** The codebase implies a block-selection mechanism and an animated
caret that don't exist; cross-block selection is actually done via native DOM
`Selection`.

**Fix.** Delete `SmoothCaret.tsx`. Either delete the unused `selectionStore`
actions/state, or wire the multi-select styling to the real native-selection
path (decide which; if multi-block visual selection is desired, implement it on
the native path and remove the dead store). Remove now-unused imports.

**Verify.** Build passes; grep confirms no references; multi-select visuals
behave as intended (either intentionally absent, or driven by the real path).

---

### EF-15 `Plots.tsx` is a 2366-line god component; extract a pure tree reducer

**Severity:** Low (structural) — but it is the enabler for EF-01/02/03.
**Files:** `plots/Plots.tsx` — tree mutation, navigation, focus/cursor, selection,
cross-block copy (`:2030`–`:2242`), cross-block delete (`:1739`–`:1878`), and a
~400-line inline paste parser inside one `switch` case (`:982`–`:1381`).

**Symptom.** Mutation handlers share many subtle invariants (rootBlocks hints,
`depth`, parent wiring) with no isolation and no unit-test seam; high risk of
divergent bug fixes.

**Fix.** Extract a pure module `blockTree.ts` exposing `(state, op) => newState`
for split, merge, indent, outdent, move, delete (incl. descendant closure),
insert, and paste-tree-insert, where `state = {blocks, rootBlocks}`. Move the
paste parser (tend-blocks reconstruction + indentation/list parsing) into its own
file. `Plots.tsx` becomes orchestration (DOM/selection in, ops out). Snapshot for
EF-02 inside the reducer so undo is automatic and uniform.

**Verify.** Reducer unit tests for every op (pure, no DOM). Tree-invariant
assertions (EF-21) run after each op in tests.

**Enables:** EF-02 (undo), and makes EF-01/EF-03 fixes testable in isolation.

---

### EF-16 Fragile rAF frame-count polling for focus/insert

**Severity:** Low — dropped focus or first character on slow renders.
**Files:** `plots/Plots.tsx` — `:287`–`:309`, `:1930`–`:1944`, `:1983`–`:1997`.

**Symptom.** After a structural op on a large page, focusing the new block or
inserting the first typed character can silently fail; the code polls ~10 frames
then gives up.

**Root cause.** Focus/insert is retried via `requestAnimationFrame` with a hard
frame-count cap and no fallback when the target block hasn't rendered yet.

**Fix.** Replace frame-count polling with a `useLayoutEffect` (or effect) keyed on
the new block's presence in the rendered set / a "pending focus" ref consumed
when the block mounts, so focus happens deterministically on render rather than
on a frame budget. If polling is retained as a fallback, surface a warning when
it gives up rather than failing silently.

**Verify.** Test: create a block on a large page → it receives focus and the next
keystroke lands, with no frame-timing dependence.

---

### EF-17 External content-sync resets the whole CodeMirror doc (loses undo + cursor)

**Severity:** Low (rare) — undo history and relative cursor lost on external
update.
**Files:** `plots/Seed.tsx` — `:892`–`:913` (replaces `0..doc.length`, clamps
cursor by length only).

**Symptom.** On an external `block.content` change (draft restore, conflict
resolution) the active block's in-block undo history is discarded and the cursor
position is only length-clamped, not preserved relative to content.

**Root cause.** The sync dispatches a full-document replacement instead of a
minimal diff.

**Fix.** Compute a minimal diff between current doc and new content and dispatch
only the changed ranges, preserving the cursor via change-mapping. Skip entirely
when `content === contentRef.current` (already guarded for the typing path).

**Verify.** Test: external update that changes one word keeps undo history and
maps the cursor through the change.

---

### EF-18 Over-greedy URL regex; no markdown escape handling

**Severity:** Low — wrong link boundaries; can't type literal delimiters.
**Files:** `contentRenderer.ts` — URL pattern (`:106`), emphasis patterns
(`:92`, `:94`).

**Symptom.** `https://x.com**bold**` parses as one URL; `(https://x)` includes the
`)`. `\*not italic\*` still italicizes and shows stray backslashes; users can't
type literal `*`/`_`/`~`/`` ` ``. `foo__bar__baz` bolds `bar` (intraword `__`,
unlike CommonMark).

**Fix.** Constrain the URL regex to stop on formatting delimiters and trim
trailing punctuation (`. , ) ] * ` ` ``). Add backslash-escape handling so an
escaped delimiter renders literally and is not treated as markup. Add the
flanking guard to the `**`/`__` rule to match the italic rule. (All of this is
free if EF-04 adopts a real parser — prefer that.)

**Verify.** Cases: URL followed by `**bold**`; parenthesized URL; `\*literal\*`;
`foo__bar__baz` not bolded.

**Related:** EF-04.

---

### EF-19 Code-block highlighting re-runs on every keystroke

**Severity:** Low — wasted CPU in large code blocks.
**Files:** `extensions/codeHighlight.ts` — rebuild on every `docChanged`
(`:176`–`:180`), `lowlight.highlight`/`highlightAuto` over the whole block
(`:71`–`:133`).

**Symptom.** Typing in a large fenced code block is heavier than necessary;
highlight recomputed per keystroke.

**Fix.** Debounce highlighting, and/or memoize on `(content, language)` so an
unchanged block isn't re-highlighted; consider incremental highlighting or only
re-highlighting the edited lines.

**Verify.** Spy/benchmark: typing in a 500-line code block does not call lowlight
on every keystroke.

---

### EF-20 Double-clicked word in a dormant block can't be typed over

**Severity:** Low — word-processor expectation unmet in dormant mode.
**Files:** `plots/Seed.tsx` — `DormantSeed.handleMouseUp` early-returns on
non-collapsed selection (`:271`–`:275`); container key handler then activates at
`'end'` ignoring the selection (`Plots.tsx:1918`–`:1945`). (Active mode handles
double/triple click natively — fine.)

**Symptom.** Double-click a word in a dormant block (selects it), type to
replace → the block activates at the end and inserts the char instead of
replacing the selected word.

**Fix.** On a printable key with a non-collapsed dormant selection, activate the
block and map the DOM selection to a CodeMirror range so the insert replaces it;
or activate on double-click by placing the CM selection over the word. Reuse the
rendered→source offset mapping (EF-08) to translate the DOM selection.

**Verify.** Manual: double-click a word in a dormant block, type → word is
replaced. Works mid-block and at block start/end.

---

## EF-21 (supporting) Tree-invariant validator + test harness

Not a bug, but required infrastructure to make EF-01/02/03/13/15 safe.

Add a `validateTree({blocks, rootBlocks})` helper (dev/test only, or behind a
debug flag) asserting: every non-root block's `parentUuid` exists; every block
appears in exactly one parent's `children` (or in `rootBlocks`); no cycles; no
orphans; `children` order is consistent; derived `depth` matches tree position.
Run it after every structural op in tests, and optionally in dev builds after
`updateCurrentPage`, to catch regressions like EF-01 immediately.

---

## Recommended sequencing

1. **EF-15** (extract pure `blockTree.ts` reducer) + **EF-21** (validator) —
   foundation; makes the rest testable and safe.
2. **EF-02** (structural undo) — cheap once mutations go through the reducer; also
   a safety net for the data bugs.
3. **EF-01** and **EF-03** (build delete/copy from the model, not the DOM) —
   stop data loss.
4. **EF-07** (single-block store update + incremental fences) — perf.
5. **EF-04 + EF-08 (+ EF-18)** as one project — unify the parser and emit source
   spans; clears a whole class of caret/render bugs. Do the immediate wikilink
   alias fix from EF-04 first, standalone.
6. **EF-06** (typewriter scroll), **EF-05** (IME), **EF-09/10/11** (word ops &
   vertical nav), **EF-12/13** — robustness polish.
7. **EF-14/16/17/19/20** — low-risk cleanup as capacity allows.

Constraint reminder: all of the above stay within the **per-block, pure-outliner
(Logseq) model**. None of these fixes require — or should introduce — a
single-document markdown editor.

// SPDX-License-Identifier: MIT WITH Commons-Clause
//
// The editor's functional layers, mirroring V1's allocation. Each layer is a
// factory returning a uniform interface ({ plugins, nodeViews }); the host
// composes them. Dependencies point DOWNWARD only — a layer may use the schema
// and the layer(s) below it, never a peer or a layer above. Removing or
// replacing a higher layer leaves the lower layers fully working; a drop-in
// replacement exposing the same interface slots in seamlessly.
//
//   Text (L1)        — editable markdown document + history        (most fundamental)
//   Outliner (L2)    — block tree: split/merge/indent/move, bullets/collapse
//   Formatting (L3)  — inline markup, wikilinks/tags, code, task badges (most cosmetic)
//
// (L0 is the block model/store, below the editor. Page/canvas is MainContent,
// above, which mounts the host.)

import { Plugin } from 'prosemirror-state'
import { NodeViewConstructor } from 'prosemirror-view'
import { keymap } from 'prosemirror-keymap'
import { history, undo, redo } from 'prosemirror-history'
import { baseKeymap, chainCommands, deleteSelection, joinBackward } from 'prosemirror-commands'
import { splitListItem, sinkListItem, liftListItem } from 'prosemirror-schema-list'
import { listItemType } from './schema'
import { uuidPlugin } from './uuidPlugin'
import { moveListItem, toggleCollapse } from './commands'
import { ListItemView } from './nodeview'
import { formattingPlugin, type NavHandlers } from './decorations'
import { slashMenuPlugin } from './slashMenuPlugin'
import { formatKeymap } from './formatKeymap'

export interface EditorLayer {
  plugins: Plugin[]
  nodeViews?: Record<string, NodeViewConstructor>
}

// L1 — Text: an editable plain-markdown document with undo. Depends only on the
// schema. Remove everything above and this still edits/saves raw markdown.
export function textLayer(): EditorLayer {
  return {
    plugins: [
      history(),
      keymap({ 'Mod-z': undo, 'Mod-y': redo, 'Shift-Mod-z': redo }),
      // Base editing (lowest keymap precedence — see composeLayers ordering).
      keymap(baseKeymap),
    ],
  }
}

// L2 — Outliner: the block tree. Split/merge/indent/outdent/move, bullets, and
// collapse. Depends only on the schema + text below. Remove it and a flat,
// editable markdown document remains.
export function outlinerLayer(): EditorLayer {
  return {
    plugins: [
      uuidPlugin(),
      keymap({
        // Pass explicit empty attrs: with no attrs, splitListItem copies the split
        // node's attrs onto the new bullet — including `properties`, so a new TODO
        // would inherit the previous one's priority/dates. The uuid plugin then
        // mints a fresh uuid for the '' default.
        Enter: splitListItem(listItemType, { uuid: '', collapsed: false, properties: {} }),
        // Chain a no-op returning true so structural keys never fall through to
        // the browser (focus escape).
        Tab: chainCommands(sinkListItem(listItemType), () => true),
        'Shift-Tab': chainCommands(liftListItem(listItemType), () => true),
        'Mod-]': chainCommands(sinkListItem(listItemType), () => true),
        'Mod-[': chainCommands(liftListItem(listItemType), () => true),
        'Alt-ArrowUp': moveListItem(-1),
        'Alt-ArrowDown': moveListItem(1),
        'Mod-.': toggleCollapse(),
        Backspace: chainCommands(deleteSelection, joinBackward),
      }),
    ],
    nodeViews: {
      list_item: (node, view, getPos) => new ListItemView(node, view, getPos),
    },
  }
}

// L3 — Formatting & linking: inline markup, wikilinks/tags/urls, code
// highlighting, task badges/metadata rendering. Depends only on the document +
// parse below. Remove it and the outline still works as raw editable markdown;
// a different L3 (e.g. a mobile/native renderer) with the same interface drops
// in unchanged.
export function formattingLayer(nav: NavHandlers): EditorLayer {
  // The format keymap sits in L3 (inline markup) and, being highest precedence,
  // its Mod-b/i/e/… win over the base keymap.
  // codeHighlightPlugin (lowlight + highlight.js languages) is added lazily
  // after mount in OutlineEditorV2 via reconfigure, so it stays out of the
  // initial chunk. Until it loads, fenced code renders as plain markdown text.
  return { plugins: [keymap(formatKeymap), formattingPlugin(nav)] }
}

// Slash-command trigger detection. Keyless (the React SlashMenu owns keyboard
// selection); this only exposes the "/query" trigger state to the host.
export function slashMenuLayer(): EditorLayer {
  return { plugins: [slashMenuPlugin()] }
}

// Compose layers into the flat ({ plugins, nodeViews }) ProseMirror expects.
// Array order is precedence, HIGH → LOW: a higher layer's keymap wins over a
// lower one (so the outliner's Enter=split beats the text layer's base Enter).
export function composeLayers(layers: EditorLayer[]): Required<EditorLayer> {
  return {
    plugins: layers.flatMap((l) => l.plugins),
    nodeViews: Object.assign({}, ...layers.map((l) => l.nodeViews ?? {})),
  }
}

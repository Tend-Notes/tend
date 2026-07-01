// SPDX-License-Identifier: MIT WITH Commons-Clause
//
// NodeView for list_item: renders a non-editable bullet as a real, clickable
// element (collapse toggle) plus the editable content. Bullets are structural
// chrome, never text — clicking is browser-agnostic, unlike keybinds.

import { Node as PMNode } from 'prosemirror-model'
import { EditorView, NodeView } from 'prosemirror-view'

export class ListItemView implements NodeView {
  dom: HTMLElement
  contentDOM: HTMLElement
  private fold: HTMLElement

  constructor(node: PMNode, view: EditorView, getPos: () => number | undefined) {
    this.dom = document.createElement('li')
    this.dom.className = 'block-container'

    this.fold = document.createElement('span')
    this.fold.className = 'block-fold'
    this.fold.contentEditable = 'false'
    this.fold.addEventListener('mousedown', (e) => {
      // Keep editor focus/selection; toggle collapsed on this item.
      e.preventDefault()
      const pos = getPos()
      if (pos == null) return
      const n = view.state.doc.nodeAt(pos)
      if (!n) return
      view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...n.attrs, collapsed: !n.attrs.collapsed }))
    })
    this.dom.appendChild(this.fold)

    this.contentDOM = document.createElement('div')
    this.contentDOM.className = 'block-body'
    this.dom.appendChild(this.contentDOM)

    this.sync(node)
  }

  private sync(node: PMNode) {
    this.dom.setAttribute('data-block-id', (node.attrs.uuid as string) || '')
    this.dom.setAttribute('data-collapsed', node.attrs.collapsed ? 'true' : 'false')
    // A block "has children" when it holds a nested bullet_list.
    let hasChildren = false
    node.forEach((c) => {
      if (c.type.name === 'bullet_list') hasChildren = true
    })
    this.dom.setAttribute('data-has-children', hasChildren ? 'true' : 'false')
  }

  update(node: PMNode) {
    if (node.type.name !== 'list_item') return false
    this.sync(node)
    return true
  }

  // The fold is our own chrome; ignore its mutations so PM doesn't try to read it.
  ignoreMutation(m: MutationRecord | { type: 'selection'; target: Node }) {
    if (m.type === 'selection') return false
    return this.fold.contains(m.target) || m.target === this.fold
  }
}

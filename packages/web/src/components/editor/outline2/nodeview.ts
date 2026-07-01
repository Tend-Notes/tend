// SPDX-License-Identifier: MIT WITH Commons-Clause
//
// NodeView for list_item: renders a non-editable bullet (collapse toggle) and,
// for task blocks, the TaskMetadata widget below the line (border/bg/icons) via a
// React root. Task metadata is a removable concern — gated on isTask; strip that
// branch and the block is a plain outline node.

import { createElement } from 'react'
import { createRoot, Root } from 'react-dom/client'
import { Node as PMNode } from 'prosemirror-model'
import { EditorView, NodeView } from 'prosemirror-view'
import { TaskMetadata } from '../TaskMetadata'

const TASK_STATUS_REGEX = /^(TODO|DOING|DONE|NOW|LATER|NEVER)(\s|$)/

export class ListItemView implements NodeView {
  dom: HTMLElement
  contentDOM: HTMLElement
  private fold: HTMLElement
  private main: HTMLElement
  private metaHost: HTMLElement
  private metaRoot: Root | null = null
  private view: EditorView
  private getPos: () => number | undefined

  constructor(node: PMNode, view: EditorView, getPos: () => number | undefined) {
    this.view = view
    this.getPos = getPos

    this.dom = document.createElement('li')
    this.dom.className = 'block-container'

    this.fold = document.createElement('span')
    this.fold.className = 'block-fold'
    this.fold.contentEditable = 'false'
    this.fold.addEventListener('mousedown', (e) => {
      e.preventDefault()
      const pos = getPos()
      if (pos == null) return
      const n = view.state.doc.nodeAt(pos)
      if (!n) return
      view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...n.attrs, collapsed: !n.attrs.collapsed }))
    })
    this.dom.appendChild(this.fold)

    // Wrapper that gets the task box (border/bg) for task blocks, holding the
    // content and the metadata but not the bullet.
    this.main = document.createElement('div')
    this.main.className = 'block-main'
    this.dom.appendChild(this.main)

    this.contentDOM = document.createElement('div')
    this.contentDOM.className = 'block-body'
    this.main.appendChild(this.contentDOM)

    // Task metadata host — non-editable, sits below the block content.
    this.metaHost = document.createElement('div')
    this.metaHost.className = 'task-meta-host'
    this.metaHost.contentEditable = 'false'
    this.main.appendChild(this.metaHost)

    this.sync(node)
  }

  // Update one property of this block in the model (merge; null deletes).
  private onPropertyChange = (key: string, value: string | null) => {
    const pos = this.getPos()
    if (pos == null) return
    const n = this.view.state.doc.nodeAt(pos)
    if (!n) return
    const properties = { ...(n.attrs.properties as Record<string, string>) }
    if (value === null) delete properties[key]
    else properties[key] = value
    this.view.dispatch(this.view.state.tr.setNodeMarkup(pos, undefined, { ...n.attrs, properties }))
  }

  private sync(node: PMNode) {
    this.dom.setAttribute('data-block-id', (node.attrs.uuid as string) || '')
    this.dom.setAttribute('data-collapsed', node.attrs.collapsed ? 'true' : 'false')
    let hasChildren = false
    node.forEach((c) => {
      if (c.type.name === 'bullet_list') hasChildren = true
    })
    this.dom.setAttribute('data-has-children', hasChildren ? 'true' : 'false')

    const text = node.child(0).textContent
    const noBullet = /^#{1,6}\s/.test(text) || text.startsWith('```') || /^\(\([0-9a-f-]{36}\)\)$/i.test(text.trim())
    this.dom.setAttribute('data-nobullet', noBullet ? 'true' : 'false')

    // Task-metadata layer.
    const match = text.match(TASK_STATUS_REGEX)
    this.dom.setAttribute('data-task', match ? 'true' : 'false')
    if (match) {
      const keyword = match[1]
      if (!this.metaRoot) this.metaRoot = createRoot(this.metaHost)
      this.metaRoot.render(
        createElement(TaskMetadata, {
          blockUuid: (node.attrs.uuid as string) || '',
          properties: (node.attrs.properties as Record<string, string>) ?? {},
          onPropertyChange: this.onPropertyChange,
          isCompleted: keyword === 'DONE' || keyword === 'NEVER',
          taskContent: text,
        })
      )
    } else if (this.metaRoot) {
      this.metaRoot.render(null)
    }
  }

  update(node: PMNode) {
    if (node.type.name !== 'list_item') return false
    this.sync(node)
    return true
  }

  // Our chrome (fold + metadata) is not PM content — ignore its mutations and
  // let its own event handlers run.
  ignoreMutation(m: MutationRecord | { type: 'selection'; target: Node }) {
    if (m.type === 'selection') return false
    return this.fold.contains(m.target) || m.target === this.fold || this.metaHost.contains(m.target) || m.target === this.metaHost
  }

  stopEvent(e: Event) {
    return this.metaHost.contains(e.target as Node)
  }

  destroy() {
    if (this.metaRoot) {
      const root = this.metaRoot
      this.metaRoot = null
      // Defer unmount to avoid React "unmount during render" warning.
      queueMicrotask(() => root.unmount())
    }
  }
}

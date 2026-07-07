// SPDX-License-Identifier: MIT WITH Commons-Clause
//
// Shared slash-command definitions. The command set (headings, code, quote,
// horizontal rule, date/time, and the task-status keywords) is identical for the
// V1 CodeMirror popup and the Editor V2 (ProseMirror) menu, so it lives here as
// the single source of truth. Each command's `action` is expressed against a
// small context so the host editor decides HOW to insert (CodeMirror `changes`
// vs. a ProseMirror transaction) while the WHAT stays shared.

import { TASK_STATUS_SETS, type ContentType } from '../../stores/settingsStore'
import { formatDateYMD } from '../../lib/dateUtils'

export interface SlashCommand {
  id: string
  label: string
  description: string
  icon?: string
  action: (context: SlashCommandContext) => void
  /** For content type commands, the content type to create (V1 only). */
  contentType?: ContentType
}

export interface SlashCommandContext {
  // The block content before the slash command.
  contentBefore: string
  // The block content after the slash command query.
  contentAfter: string
  // Replace the whole block content.
  replaceContent: (newContent: string) => void
  // Insert content at the slash command position (replacing the "/query").
  insertContent: (content: string) => void
}

// Non-task slash commands.
export const BASE_SLASH_COMMANDS: SlashCommand[] = [
  {
    id: 'h1',
    label: 'Heading 1',
    description: 'Large section heading',
    action: (ctx) => ctx.insertContent('# '),
  },
  {
    id: 'h2',
    label: 'Heading 2',
    description: 'Medium section heading',
    action: (ctx) => ctx.insertContent('## '),
  },
  {
    id: 'h3',
    label: 'Heading 3',
    description: 'Small section heading',
    action: (ctx) => ctx.insertContent('### '),
  },
  {
    id: 'code',
    label: 'Code Block',
    description: 'Insert a code block',
    action: (ctx) => ctx.insertContent('```\n'),
  },
  {
    id: 'quote',
    label: 'Quote',
    description: 'Insert a blockquote',
    action: (ctx) => ctx.insertContent('> '),
  },
  {
    id: 'hr',
    label: 'Divider',
    description: 'Insert a horizontal rule',
    action: (ctx) => ctx.insertContent('---\n'),
  },
  {
    id: 'date',
    label: "Today's Date",
    description: "Insert link to today's journal",
    action: (ctx) => {
      const today = formatDateYMD(new Date())
      // `journals/` (plural) is the prefix the wikilink navigator resolves.
      ctx.insertContent(`[[journals/${today}]] `)
    },
  },
  {
    id: 'time',
    label: 'Current Time',
    description: 'Insert current time',
    action: (ctx) => {
      const now = new Date()
      ctx.insertContent(now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' ')
    },
  },
]

// Generate task commands based on the selected status set.
export function getTaskCommands(taskStatusSet: keyof typeof TASK_STATUS_SETS): SlashCommand[] {
  const statuses = TASK_STATUS_SETS[taskStatusSet]
  return statuses.map((status) => ({
    id: status.keyword.toLowerCase(),
    label: status.keyword,
    description: `Create a ${status.keyword} task`,
    action: (ctx: SlashCommandContext) => ctx.insertContent(`${status.keyword} `),
  }))
}

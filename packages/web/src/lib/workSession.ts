// SPDX-License-Identifier: MIT WITH Commons-Clause
// Work-session persistence shared by the timer banner and status-driven timing.
//
// The store (workSessionStore) holds only the in-memory timer; stopping a session
// must append its entry to the owning block's `work_log` property and save. These
// helpers do that, and are reused so status changes (DOING) and the manual Stop
// button go through one path.

import { pages, journals, sheets, pageBlocksToApiFormat } from './api'
import type { Page } from '../types'
import { useWorkSessionStore, type WorkSession, type WorkLogEntry } from '../stores/workSessionStore'

async function fetchPage(session: WorkSession): Promise<Page> {
  const { pageName, contentType, sheetDate } = session
  if (contentType === 'journal') return journals.get(pageName)
  if (contentType === 'page') return pages.get(pageName)
  return sheets.get(contentType, pageName, sheetDate)
}

async function savePage(session: WorkSession, page: Page): Promise<void> {
  const { pageName, contentType, sheetDate } = session
  const blockData = pageBlocksToApiFormat(page)
  if (contentType === 'journal') await journals.update(pageName, blockData, page.version)
  else if (contentType === 'page') await pages.update(pageName, blockData, page.version)
  else await sheets.update(contentType, pageName, blockData, page.version, sheetDate)
}

// Append a completed work-log entry to its block's `work_log` and save the page.
export async function saveWorkLogToBlock(session: WorkSession, entry: WorkLogEntry): Promise<void> {
  const page = await fetchPage(session)
  const block = page.blocks[session.blockUuid]
  if (!block) {
    console.error('Block not found for work log:', session.blockUuid)
    return
  }
  let workLog: WorkLogEntry[] = []
  if (block.properties.work_log) {
    try {
      workLog = JSON.parse(block.properties.work_log)
    } catch {
      // Invalid JSON — start fresh.
    }
  }
  workLog.push(entry)
  block.properties.work_log = JSON.stringify(workLog)
  await savePage(session, page)
}

// Stop the active session (if any) and persist its entry. Safe to call when no
// session is active (no-op). Used to auto-stop when a task leaves DOING or when
// switching the active task.
export async function stopAndLogActiveSession(notes = ''): Promise<void> {
  const session = useWorkSessionStore.getState().activeSession
  if (!session) return
  const sessionToSave = { ...session }
  const entry = useWorkSessionStore.getState().stopSession(notes)
  if (entry) await saveWorkLogToBlock(sessionToSave, entry)
}

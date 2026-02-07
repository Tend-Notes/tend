// SPDX-License-Identifier: MIT WITH Commons-Clause
// Pre-populated demo content for new demo sessions

import type { Page, Block } from '../types'
import { v4 as uuidv4 } from 'uuid'

// Generate stable UUIDs for demo content (so block references work consistently)
const UUIDS = {
  // Welcome page blocks
  welcomeRoot: '00000001-0000-0000-0000-000000000001',
  welcomeIntro: '00000001-0000-0000-0000-000000000002',
  welcomeFeatures: '00000001-0000-0000-0000-000000000003',
  welcomeFormatting: '00000001-0000-0000-0000-000000000004',
  welcomeLinks: '00000001-0000-0000-0000-000000000005',
  welcomeTags: '00000001-0000-0000-0000-000000000006',
  welcomeTasks: '00000001-0000-0000-0000-000000000007',
  welcomeBlockRef: '00000001-0000-0000-0000-000000000008',

  // Getting Started page blocks
  startRoot: '00000002-0000-0000-0000-000000000001',
  startIntro: '00000002-0000-0000-0000-000000000002',
  startBlocks: '00000002-0000-0000-0000-000000000003',
  startBlocksNested1: '00000002-0000-0000-0000-000000000004',
  startBlocksNested2: '00000002-0000-0000-0000-000000000005',
  startShortcuts: '00000002-0000-0000-0000-000000000006',
  startShortcut1: '00000002-0000-0000-0000-000000000007',
  startShortcut2: '00000002-0000-0000-0000-000000000008',
  startShortcut3: '00000002-0000-0000-0000-000000000009',
  startShortcut4: '00000002-0000-0000-0000-00000000000a',
  startBack: '00000002-0000-0000-0000-00000000000b',
}

function createBlock(
  uuid: string,
  content: string,
  parentUuid: string | null,
  children: string[] = [],
  depth = 0
): Block {
  return {
    uuid,
    content,
    parentUuid,
    children,
    collapsed: false,
    properties: {},
    depth,
  }
}

/**
 * Create the "Welcome to Tend" page
 */
function createWelcomePage(): Page {
  const now = new Date().toISOString()

  const blocks: Record<string, Block> = {
    [UUIDS.welcomeIntro]: createBlock(
      UUIDS.welcomeIntro,
      'Tend is a digital garden for your thoughts. Write, organize, and connect your ideas in a clean, focused environment.',
      null,
      [],
      0
    ),
    [UUIDS.welcomeFeatures]: createBlock(
      UUIDS.welcomeFeatures,
      'Here are some things you can do:',
      null,
      [UUIDS.welcomeFormatting, UUIDS.welcomeLinks, UUIDS.welcomeTags, UUIDS.welcomeTasks, UUIDS.welcomeBlockRef],
      0
    ),
    [UUIDS.welcomeFormatting]: createBlock(
      UUIDS.welcomeFormatting,
      'Format text: **bold**, *italic*, ~~strikethrough~~, ==highlight==',
      UUIDS.welcomeFeatures,
      [],
      1
    ),
    [UUIDS.welcomeLinks]: createBlock(
      UUIDS.welcomeLinks,
      'Link pages together: [[Getting Started]]',
      UUIDS.welcomeFeatures,
      [],
      1
    ),
    [UUIDS.welcomeTags]: createBlock(
      UUIDS.welcomeTags,
      'Organize with tags: #demo #tutorial',
      UUIDS.welcomeFeatures,
      [],
      1
    ),
    [UUIDS.welcomeTasks]: createBlock(
      UUIDS.welcomeTasks,
      'TODO Track tasks with status markers',
      UUIDS.welcomeFeatures,
      [],
      1
    ),
    [UUIDS.welcomeBlockRef]: createBlock(
      UUIDS.welcomeBlockRef,
      `Reference other blocks: ((${UUIDS.startBlocksNested1}))`,
      UUIDS.welcomeFeatures,
      [],
      1
    ),
  }

  return {
    name: 'Welcome to Tend',
    title: 'Welcome to Tend',
    rootBlocks: [UUIDS.welcomeIntro, UUIDS.welcomeFeatures],
    blocks,
    properties: {},
    contentType: 'page',
    isJournal: false,
    journalDate: null,
    createdAt: now,
    modifiedAt: now,
    version: 1,
  }
}

/**
 * Create the "Getting Started" page
 */
function createGettingStartedPage(): Page {
  const now = new Date().toISOString()

  const blocks: Record<string, Block> = {
    [UUIDS.startIntro]: createBlock(
      UUIDS.startIntro,
      'This page will help you learn the basics of Tend.',
      null,
      [],
      0
    ),
    [UUIDS.startBlocks]: createBlock(
      UUIDS.startBlocks,
      'Everything in Tend is a block. Blocks can be nested to create outlines:',
      null,
      [UUIDS.startBlocksNested1],
      0
    ),
    [UUIDS.startBlocksNested1]: createBlock(
      UUIDS.startBlocksNested1,
      'This is a child block. Press Tab to indent, Shift+Tab to outdent.',
      UUIDS.startBlocks,
      [UUIDS.startBlocksNested2],
      1
    ),
    [UUIDS.startBlocksNested2]: createBlock(
      UUIDS.startBlocksNested2,
      'Blocks can be nested as deep as you need.',
      UUIDS.startBlocksNested1,
      [],
      2
    ),
    [UUIDS.startShortcuts]: createBlock(
      UUIDS.startShortcuts,
      'Useful keyboard shortcuts:',
      null,
      [UUIDS.startShortcut1, UUIDS.startShortcut2, UUIDS.startShortcut3, UUIDS.startShortcut4],
      0
    ),
    [UUIDS.startShortcut1]: createBlock(
      UUIDS.startShortcut1,
      'Alt+Shift+J - Go to today\'s journal',
      UUIDS.startShortcuts,
      [],
      1
    ),
    [UUIDS.startShortcut2]: createBlock(
      UUIDS.startShortcut2,
      'Alt+Shift+P - Open command palette',
      UUIDS.startShortcuts,
      [],
      1
    ),
    [UUIDS.startShortcut3]: createBlock(
      UUIDS.startShortcut3,
      'Alt+Shift+S - Toggle sidebar',
      UUIDS.startShortcuts,
      [],
      1
    ),
    [UUIDS.startShortcut4]: createBlock(
      UUIDS.startShortcut4,
      'Ctrl+Shift+/ - Show all shortcuts',
      UUIDS.startShortcuts,
      [],
      1
    ),
    [UUIDS.startBack]: createBlock(
      UUIDS.startBack,
      'Ready to start? Head back to [[Welcome to Tend]] or press Alt+Shift+J to open today\'s journal.',
      null,
      [],
      0
    ),
  }

  return {
    name: 'Getting Started',
    title: 'Getting Started',
    rootBlocks: [UUIDS.startIntro, UUIDS.startBlocks, UUIDS.startShortcuts, UUIDS.startBack],
    blocks,
    properties: {},
    contentType: 'page',
    isJournal: false,
    journalDate: null,
    createdAt: now,
    modifiedAt: now,
    version: 1,
  }
}

/**
 * Create today's journal with a welcome message
 */
function createTodayJournal(): Page {
  const now = new Date()
  // Use local date to match formatDateYMD() used by loadTodaysJournal
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  const dateStr = `${year}-${month}-${day}`
  const title = now.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

  const uuid1 = uuidv4()
  const uuid2 = uuidv4()

  const blocks: Record<string, Block> = {
    [uuid1]: createBlock(
      uuid1,
      'Welcome to your demo journal! This is your space for daily notes.',
      null,
      [],
      0
    ),
    [uuid2]: createBlock(
      uuid2,
      'Check out [[Welcome to Tend]] to learn more about what you can do here.',
      null,
      [],
      0
    ),
  }

  return {
    name: dateStr,
    title,
    rootBlocks: [uuid1, uuid2],
    blocks,
    properties: {},
    contentType: 'journal',
    isJournal: true,
    journalDate: dateStr,
    createdAt: now.toISOString(),
    modifiedAt: now.toISOString(),
    version: 1,
  }
}

/**
 * Get all demo pages
 */
export function getDemoPages(): Page[] {
  return [createWelcomePage(), createGettingStartedPage()]
}

/**
 * Get the initial demo journal
 */
export function getDemoJournal(): Page {
  return createTodayJournal()
}

/**
 * Initialize demo content in IndexedDB
 */
export async function initializeDemoContent(): Promise<void> {
  const { savePage, saveJournal, setInitialized, isInitialized } = await import('./demoStore')

  // Check if already initialized
  if (await isInitialized()) {
    return
  }

  // Save demo pages
  const pages = getDemoPages()
  for (const page of pages) {
    await savePage(page)
  }

  // Save today's journal
  const journal = getDemoJournal()
  await saveJournal(journal)

  // Mark as initialized
  await setInitialized(true)
}

/**
 * Reset demo content (after expiry or manual reset)
 */
export async function resetDemoContent(): Promise<void> {
  const { clearAll, setInitialized, savePage, saveJournal } = await import('./demoStore')

  // Clear existing content
  await clearAll()

  // Re-initialize with fresh content
  const pages = getDemoPages()
  for (const page of pages) {
    await savePage(page)
  }

  const journal = getDemoJournal()
  await saveJournal(journal)

  await setInitialized(true)
}

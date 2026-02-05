// SPDX-License-Identifier: MIT WITH Commons-Clause
// WebSocket hook for real-time updates from the server

import { useEffect, useRef } from 'react'
import { usePageStore, shouldSkipFileWatcherReload } from '../stores/pageStore'
import { useSyncStatusStore } from '../stores/syncStatusStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useUIStore } from '../stores/uiStore'
import { useRecentSheetsStore } from '../stores/recentSheetsStore'
import { contentTypes as contentTypesApi } from '../lib/api'

// WebSocket event types (must match server-side WsEvent enum)
interface WsEventBase {
  type: string
}

interface FileChangedEvent extends WsEventBase {
  type: 'file_changed'
  path: string
}

interface PageUpdatedEvent extends WsEventBase {
  type: 'page_updated'
  name: string
}

interface BackupStartedEvent extends WsEventBase {
  type: 'backup_started'
}

interface BackupCompletedEvent extends WsEventBase {
  type: 'backup_completed'
  commit_sha: string | null
  message: string
}

interface BackupFailedEvent extends WsEventBase {
  type: 'backup_failed'
  error: string
}

interface ConnectedEvent extends WsEventBase {
  type: 'connected'
}

interface GardenSwitchedEvent extends WsEventBase {
  type: 'garden_switched'
  garden_id: string
}

interface PushStartedEvent extends WsEventBase {
  type: 'push_started'
}

interface PushCompletedEvent extends WsEventBase {
  type: 'push_completed'
  message: string
}

interface PushFailedEvent extends WsEventBase {
  type: 'push_failed'
  error: string
}

type WsEvent =
  | FileChangedEvent
  | PageUpdatedEvent
  | BackupStartedEvent
  | BackupCompletedEvent
  | BackupFailedEvent
  | ConnectedEvent
  | GardenSwitchedEvent
  | PushStartedEvent
  | PushCompletedEvent
  | PushFailedEvent

/**
 * Hook that maintains a WebSocket connection to the server for real-time updates.
 * Automatically handles reconnection and dispatches events to relevant stores.
 */
export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const closingIntentionallyRef = useRef(false)

  useEffect(() => {
    const connect = () => {
      // Clear any pending reconnect
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
        reconnectTimeoutRef.current = null
      }

      // Determine WebSocket URL based on current location
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const wsUrl = `${protocol}//${window.location.host}/ws`

      const ws = new WebSocket(wsUrl)
      wsRef.current = ws

      ws.onopen = () => {
        // Connected
      }

      ws.onmessage = (event) => {
        try {
          const data: WsEvent = JSON.parse(event.data)
          // Get fresh state from stores on each message
          const pageState = usePageStore.getState()
          const { currentPageName, currentPage, navigateToPage, navigateToJournal } = pageState

          switch (data.type) {
            case 'connected':
              // Handshake complete
              break

            case 'file_changed': {
              // Check if this affects the currently open page
              const changedPath = data.path

              // Extract page name from path (e.g., "pages/foo.md" -> "foo")
              let pageName: string | null = null
              let isJournal = false

              if (changedPath.startsWith('pages/')) {
                pageName = changedPath.slice(6).replace(/\.md$/, '')
              } else if (changedPath.startsWith('journals/')) {
                pageName = changedPath.slice(9).replace(/\.md$/, '')
                isJournal = true
              }

              if (pageName && pageName === currentPageName) {
                // Use centralized check that includes:
                // - unsaved changes
                // - pending debounced saves
                // - recent save grace period
                if (shouldSkipFileWatcherReload()) {
                  break
                }

                // Re-fetch the current page (silent - don't show errors for background reloads)
                if (isJournal) {
                  navigateToJournal(pageName, false).catch(() => {})
                } else {
                  navigateToPage(pageName, false).catch(() => {})
                }
              }
              break
            }

            case 'page_updated':
              // Another client updated this page
              if (data.name === currentPageName) {
                // Use centralized check - protects against race conditions
                if (shouldSkipFileWatcherReload()) {
                  break
                }

                // Silent reload - don't show errors for background reloads
                if (currentPage?.isJournal) {
                  navigateToJournal(data.name, false).catch(() => {})
                } else {
                  navigateToPage(data.name, false).catch(() => {})
                }
              }
              break

            case 'backup_started':
            case 'backup_completed':
            case 'backup_failed':
              // Backup events - no action needed
              break

            case 'push_started':
              // Push started - no action needed
              break

            case 'push_completed':
              useSyncStatusStore.getState().recordPush()
              break

            case 'push_failed':
              // Push failed - no action needed (user will see error in UI)
              break

            case 'garden_switched':
              // Garden was switched (by another client or this client)
              // Reset all stores and reinitialize without a full page reload
              useSettingsStore.getState().setCurrentGraphId(data.garden_id)
              usePageStore.getState().reset()
              useUIStore.getState().reset()
              useSyncStatusStore.getState().reset()
              useRecentSheetsStore.getState().reset()
              // Load the new garden's content types and default page
              contentTypesApi.list()
                .then((types) => {
                  useSettingsStore.getState().setContentTypes(types)
                  usePageStore.getState().initializeFromUrl()
                })
                .catch(() => {
                  // Still try to initialize the page even if content types fail
                  usePageStore.getState().initializeFromUrl()
                })
              break

            default:
              // Unknown event type - ignore
          }
        } catch {
          // Failed to parse WebSocket message - ignore
        }
      }

      ws.onclose = () => {
        wsRef.current = null

        // Only reconnect if this wasn't an intentional close
        if (!closingIntentionallyRef.current) {
          reconnectTimeoutRef.current = setTimeout(connect, 3000)
        }
      }

      ws.onerror = () => {
        ws.close()
      }
    }

    // Small delay to let page fully load before connecting
    const initialDelay = setTimeout(connect, 100)

    return () => {
      clearTimeout(initialDelay)
      // Mark as intentional close to prevent reconnect loop
      closingIntentionallyRef.current = true

      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
      }
      if (wsRef.current) {
        wsRef.current.close()
      }
    }
  }, []) // No dependencies - connect once on mount

  return wsRef.current
}

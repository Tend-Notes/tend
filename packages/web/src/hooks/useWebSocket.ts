// SPDX-License-Identifier: MIT WITH Commons-Clause
// WebSocket hook for real-time updates from the server

import { useEffect, useRef } from 'react'
import { usePageStore } from '../stores/pageStore'
import { useSyncStatusStore } from '../stores/syncStatusStore'
import { useSettingsStore } from '../stores/settingsStore'

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
        console.log('WebSocket connected')
      }

      ws.onmessage = (event) => {
        try {
          const data: WsEvent = JSON.parse(event.data)
          // Get fresh state from stores on each message
          const pageState = usePageStore.getState()
          const { currentPageName, currentPage, navigateToPage, navigateToJournal } = pageState

          switch (data.type) {
            case 'connected':
              console.log('WebSocket handshake complete')
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
                console.log('Current page changed externally, reloading...')
                // Re-fetch the current page
                if (isJournal) {
                  navigateToJournal(pageName, false)
                } else {
                  navigateToPage(pageName, false)
                }
              }
              break
            }

            case 'page_updated':
              // Another client updated this page
              if (data.name === currentPageName) {
                console.log('Page updated by another client, reloading...')
                if (currentPage?.isJournal) {
                  navigateToJournal(data.name, false)
                } else {
                  navigateToPage(data.name, false)
                }
              }
              break

            case 'backup_started':
            case 'backup_completed':
            case 'backup_failed':
              console.log('Backup event:', data.type)
              break

            case 'push_started':
              console.log('Push started')
              break

            case 'push_completed':
              console.log('Push completed:', data.message)
              useSyncStatusStore.getState().recordPush()
              break

            case 'push_failed':
              console.log('Push failed:', data.error)
              break

            case 'garden_switched':
              // Garden was switched (by another client or this client)
              // Update the current garden ID before reloading so UI shows correct active state
              console.log('Garden switched to:', data.garden_id)
              useSettingsStore.getState().setCurrentGraphId(data.garden_id)
              window.location.reload()
              break

            default:
              console.log('Unknown WebSocket event:', data)
          }
        } catch (e) {
          console.error('Failed to parse WebSocket message:', e)
        }
      }

      ws.onclose = () => {
        wsRef.current = null

        // Only reconnect if this wasn't an intentional close
        if (!closingIntentionallyRef.current) {
          console.log('WebSocket disconnected, reconnecting in 3s...')
          reconnectTimeoutRef.current = setTimeout(connect, 3000)
        }
      }

      ws.onerror = (error) => {
        console.error('WebSocket error:', error)
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

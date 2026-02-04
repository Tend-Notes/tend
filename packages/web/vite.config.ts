import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // Force new service worker to activate immediately (helps with stale caches)
      devOptions: {
        enabled: false, // Don't use SW in dev mode
      },
      includeAssets: ['icons/icon.png'],
      manifest: {
        name: 'Tend',
        short_name: 'Tend',
        description: 'A digital garden for your thoughts',
        theme_color: '#181818',
        background_color: '#181818',
        display: 'standalone',
        icons: [
          {
            src: 'icons/icon.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        // Skip waiting ensures new service worker activates immediately
        // This prevents stale cache issues on mobile
        skipWaiting: true,
        clientsClaim: true,
        // Cache API responses for offline viewing
        runtimeCaching: [
          {
            urlPattern: /^\/api\/v1\/pages/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-pages',
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 60 * 60 * 24, // 24 hours
              },
              // Mobile browsers can have higher latency even on WiFi
              // 15 seconds allows for slow connections while still enabling offline fallback
              networkTimeoutSeconds: 15,
              // Only cache successful responses (prevents caching error pages)
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
          {
            urlPattern: /^\/api\/v1\/journals/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-journals',
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 60 * 60 * 24,
              },
              networkTimeoutSeconds: 15,
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
          {
            urlPattern: /^\/api\/v1\/search/,
            handler: 'NetworkOnly',
          },
        ],
        // Pre-cache app shell
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:3000',
        ws: true,
      },
    },
  },
})

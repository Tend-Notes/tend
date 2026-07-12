import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'path'

// Check if building for demo mode (GitHub Pages deployment)
const isDemo = process.env.VITE_DEMO_MODE === 'true'

// https://vite.dev/config/
export default defineConfig({
  // Use /tend/ base path for GitHub Pages (repo is tend-notes/tend)
  base: isDemo ? '/tend/' : '/',
  plugins: [
    {
      name: 'strip-demo-only-script',
      transformIndexHtml(html) {
        if (!isDemo) {
          return html.replace(
            /[ \t]*<!-- demo-only:gh-pages-redirect:start -->[\s\S]*?<!-- demo-only:gh-pages-redirect:end -->\n?/m,
            ''
          );
        }
        return html;
      },
    },
    react(),
    // PWA is disabled in demo mode since there's no backend to cache
    !isDemo && VitePWA({
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
            sizes: '192x192',
            type: 'image/png',
          },
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
  ].filter(Boolean),
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
    // Force a single instance of the ProseMirror core packages. Their classes
    // (Schema/Node/Fragment/EditorState) use identity checks, so a second copy
    // — which the dev server can pull in when a new PM-importing module is added
    // — breaks structural commands ("multiple versions of prosemirror-model").
    dedupe: [
      'prosemirror-model',
      'prosemirror-state',
      'prosemirror-view',
      'prosemirror-transform',
      'prosemirror-keymap',
    ],
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

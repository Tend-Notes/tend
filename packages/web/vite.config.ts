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
      includeAssets: ['icons/icon.svg'],
      manifest: {
        name: 'Tend',
        short_name: 'Tend',
        description: 'A digital garden for your thoughts',
        theme_color: '#181818',
        background_color: '#181818',
        display: 'standalone',
        icons: [
          {
            src: 'icons/icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
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
              networkTimeoutSeconds: 3,
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
              networkTimeoutSeconds: 3,
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
    },
  },
})

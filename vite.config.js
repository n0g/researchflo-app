import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'

const BASE = '/researchflo-app/'

export default defineConfig(({ command }) => ({
  base: command === 'build' ? BASE : '/',
  plugins: [
    vue(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        globPatterns: ['**/*.{js,css,html,woff2,png}'],
        runtimeCaching: [{
          urlPattern: /^https:\/\/api\.todoist\.com\//,
          handler: 'NetworkFirst',
          options: {
            cacheName: 'todoist-api',
            networkTimeoutSeconds: 10,
          },
        }],
      },
      manifest: {
        name: 'Research Board',
        short_name: 'Research',
        description: 'Research project pipeline tracker',
        start_url: BASE,
        scope: BASE,
        display: 'standalone',
        display_override: ['window-controls-overlay'],
        background_color: '#F5F5F7',
        theme_color: '#F5F5F7',
        orientation: 'any',
        icons: [
          { src: `${BASE}icons/icon-192-v2.png`, sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
          { src: `${BASE}icons/icon-512-v2.png`, sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
        shortcuts: [
          { name: 'Planning',        url: `${BASE}?stage=stage%3A%3Aplanning`,             icons: [{ src: `${BASE}icons/icon-192-v2.png`, sizes: '192x192' }] },
          { name: 'Preparing',       url: `${BASE}?stage=stage%3A%3Apreparing-to-submit`,  icons: [{ src: `${BASE}icons/icon-192-v2.png`, sizes: '192x192' }] },
          { name: 'Awaiting Reviews',url: `${BASE}?stage=stage%3A%3Aunder-submission`,     icons: [{ src: `${BASE}icons/icon-192-v2.png`, sizes: '192x192' }] },
          { name: 'Revision',        url: `${BASE}?stage=stage%3A%3Arevision`,             icons: [{ src: `${BASE}icons/icon-192-v2.png`, sizes: '192x192' }] },
        ],
      },
    }),
  ],
  build: {
    modulePreload: { polyfill: false },
  },
}))

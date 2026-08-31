import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      // Registered manually in main.jsx so we can poll for updates — the default
      // injected registerSW.js only registers once on load and never checks again,
      // which let already-open tabs run a stale build indefinitely after a deploy.
      injectRegister: false,
      includeAssets: ['icons/icon-192x192.png', 'icons/icon-512x512.png'],
      manifest: {
        name: 'BGM Office',
        short_name: 'BGMOffice',
        description: 'BGM internal operations management',
        theme_color: '#2F7DA2',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        orientation: 'portrait-primary',
        icons: [
          {
            src: '/icons/icon-192x192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any maskable',
          },
          {
            src: '/icons/icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        // vite-plugin-pwa only turns these on by default for the injected-script
        // registration it no longer generates (injectRegister: false above) — without
        // them a new service worker installs but sits "waiting" forever, since nothing
        // else here tells it to skip waiting and take over the open tab.
        skipWaiting: true,
        clientsClaim: true,
        // No runtimeCaching entries: the app is same-origin on Vercel now (the old
        // Railway API rule here was stale and matched nothing since the migration).
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
})

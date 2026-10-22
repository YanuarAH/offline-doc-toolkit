import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// Local-first by design: everything ships as static assets, no backend, no API keys.
export default defineConfig({
  // pdf-lib + pdf.js live in a lazily loaded chunk (~900 kB). Keeping the limit
  // above that avoids a noisy warning without affecting first paint.
  build: {
    chunkSizeWarningLimit: 1000,
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'LocalKit — Document & Image Toolkit',
        short_name: 'LocalKit',
        description:
          'Local-first watermarker, batch image compressor, and PDF toolkit. Files never leave your device.',
        theme_color: '#06070a',
        background_color: '#06070a',
        display: 'standalone',
        orientation: 'any',
        lang: 'id',
        start_url: '/',
        scope: '/',
        icons: [
          {
            src: 'icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
          {
            src: 'icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any',
          },
        ],
      },
      workbox: {
        // .mjs is the local pdf.js worker; fonts/cmaps/wasm render complex PDFs offline.
        globPatterns: [
          '**/*.{js,css,html,ico,png,svg,mjs,wasm,ttf,pfb,bcmap,icc}',
        ],
        // These are injected by the manifest and must not be duplicated by the glob.
        globIgnores: [
          '**/icon.svg',
          '**/icon-192.png',
          '**/icon-512.png',
          '**/icon-maskable-512.png',
        ],
        navigateFallback: '/index.html',
        cleanupOutdatedCaches: true,
        // Ghostscript WASM ±16 MB; it is lazy-loaded and must be precached so
        // compression also works after the first visit goes offline.
        maximumFileSizeToCacheInBytes: 30 * 1024 * 1024,
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
})

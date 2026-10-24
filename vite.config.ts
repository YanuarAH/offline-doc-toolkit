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
  // Pakai build "extern wasm" dari onnxruntime-web: file wasm diambil saat
  // runtime dari /ort (lihat src/lib/backgroundModel.ts), bukan di-emit Vite
  // sebagai aset 26 MB yang tidak pernah dipakai.
  resolve: {
    conditions: ['onnxruntime-web-use-extern-wasm'],
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
          // Aset AI diambil sesuai kebutuhan lalu di-cache (runtimeCaching).
          '**/ort/**',
          '**/models/**',
        ],
        // Model AI (±7 MB) + ONNX Runtime wasm (±14 MB) tidak ikut precache:
        // baru diambil saat fitur Background Remover dipakai pertama kali, lalu
        // disimpan Cache-First agar pemakaian berikutnya jalan tanpa internet.
        runtimeCaching: [
          {
            urlPattern: /\/models\/.*\.(onnx|json)$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'localkit-ai-model',
              expiration: { maxEntries: 8, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            urlPattern: /\/ort\/.*\.(wasm|mjs)$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'localkit-ai-runtime',
              expiration: { maxEntries: 8, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [200] },
            },
          },
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

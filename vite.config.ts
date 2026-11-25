import basicSsl from '@vitejs/plugin-basic-ssl'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    // `npm run dev:phone` runs with `--mode phone`: serve over HTTPS with a self-signed
    // certificate so geolocation, compass and wake lock work on an iPhone over the LAN.
    mode === 'phone' && basicSsl({ name: 'dash-dev' }),
    VitePWA({
      strategies: 'generateSW',
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      // Icons are already matched by `globPatterns` below; listing them again would
      // duplicate precache entries.
      includeManifestIcons: false,
      // Emit `<link rel="manifest" crossorigin="use-credentials">`: browsers fetch the
      // manifest without cookies by default, so behind Cloudflare Access it would be blocked
      // and "Add to Home Screen" would break. Harmless when Access is off.
      useCredentials: true,
      manifest: {
        id: '/',
        name: 'Dash',
        short_name: 'Dash',
        description: 'A calm instrument cluster for the road.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'landscape',
        background_color: '#000000',
        theme_color: '#000000',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // App shell only: the built JS/CSS/HTML plus the icons in /public.
        // (The plugin adds manifest.webmanifest itself.)
        globPatterns: ['**/*.{js,css,html,png}'],
        // SPA: every navigation is answered with the cached index.html.
        navigateFallback: '/index.html',
        cleanupOutdatedCaches: true,
        // mapbox-gl is a ~2 MB chunk; raise Workbox's 2 MiB default so it is part of the shell.
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        // Deliberately NO runtimeCaching: Mapbox tiles/styles, geocoding, directions and
        // weather requests always go to the network (Mapbox's terms and freshness).
        runtimeCaching: [],
      },
      devOptions: { enabled: false },
    }),
  ],
  build: {
    // One always-loaded screen: React + Chakra (~650 kB) now, mapbox-gl (~1.7 MB) later.
    // Splitting would not reduce what the car has to load, so silence the 500 kB warning.
    chunkSizeWarningLimit: 3000,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
  },
}))

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// GitHub Pages מגיש מתת-נתיב (/eyal-golan-quiz/), השרת שלנו מהשורש.
// אותו קוד נבנה לשניהם, רק ה-base משתנה.
const BASE = process.env.VITE_BASE ?? '/'

export default defineConfig({
  base: BASE,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'חידון אייל גולן',
        short_name: 'חידון אייל',
        description: 'חידון השירים של אייל גולן. לבד או עם עד עשרה חברים.',
        lang: 'he',
        dir: 'rtl',
        // חייב להיות מוחלט ותואם ל-base, אחרת האייקון במסך הבית
        // נפתח על נתיב שגוי ומקבל 404
        start_url: BASE,
        scope: BASE,
        display: 'standalone',
        background_color: '#0b0708',
        theme_color: '#0b0708',
        orientation: 'portrait',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // כל התוכן נכנס למטמון בטעינה הראשונה. מרגע שהאפליקציה נטענה פעם אחת,
        // משחק יחיד עובד לגמרי בלי רשת — זו הדרישה המרכזית של המוצר.
        globPatterns: ['**/*.{js,css,html,png,svg,woff2,json}'],
        maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'fonts',
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // קטעי האודיו נשמרים מקומית אחרי ההשמעה הראשונה
            urlPattern: /\/clips\/.*\.(mp3|m4a|ogg)$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'clips',
              expiration: { maxEntries: 600, maxAgeSeconds: 60 * 60 * 24 * 180 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      '/ws': { target: 'ws://localhost:8787', ws: true },
      '/health': { target: 'http://localhost:8787' },
    },
  },
})

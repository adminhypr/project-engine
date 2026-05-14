import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { sentryVitePlugin } from '@sentry/vite-plugin'

// Source maps go to Sentry only when SENTRY_AUTH_TOKEN is set (CI/Vercel).
// Local dev builds skip the plugin so missing-token warnings don't spam
// the console.
const sentryPlugin = process.env.SENTRY_AUTH_TOKEN
  ? sentryVitePlugin({
      org: 'hypr-services',
      project: 'project-engine',
      authToken: process.env.SENTRY_AUTH_TOKEN,
      telemetry: false,
    })
  : null

export default defineConfig({
  plugins: [react(), sentryPlugin].filter(Boolean),
  resolve: {
    alias: {
      '@': '/src'
    }
  },
  build: {
    // Emit source maps so Sentry can deobfuscate stack traces. The
    // @sentry/vite-plugin above uploads + then strips them at the
    // hosted-asset level (Vercel still serves them to Sentry; not
    // public via the CDN).
    sourcemap: true,
    // Split vendor deps into named chunks so the browser can cache the
    // big stable libs (React, Supabase, framer-motion, TipTap) separately
    // from app code, and so a single 1.96 MB blob doesn't have to parse
    // before first paint.
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor':    ['react', 'react-dom', 'react-router-dom'],
          'supabase-vendor': ['@supabase/supabase-js'],
          'motion-vendor':   ['framer-motion'],
          'tiptap-vendor':   ['@tiptap/react', '@tiptap/starter-kit', '@tiptap/extension-mention', '@tiptap/extension-link', '@tiptap/extension-image', '@tiptap/suggestion'],
          'dnd-vendor':      ['@dnd-kit/core', '@dnd-kit/sortable', '@dnd-kit/utilities'],
          'chart-vendor':    ['recharts'],
        },
      },
    },
    // We've already split routes via React.lazy + manualChunks; the warning
    // is now a false positive on the largest split. Bump it so the build
    // log doesn't carry a meaningless red herring.
    chunkSizeWarningLimit: 700,
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.js',
    css: true
  }
})

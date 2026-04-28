import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': '/src'
    }
  },
  build: {
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

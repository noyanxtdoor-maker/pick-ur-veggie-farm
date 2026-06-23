/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    // Split heavy vendors so per-route chunks stay small and vendors cache independently (M1B F1).
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            'react-vendor': ['react', 'react-dom', 'react-router-dom'],
            supabase: ['@supabase/supabase-js'],
            radix: ['@radix-ui/react-dialog', '@radix-ui/react-select'],
          },
        },
      },
    },
    // Vitest reuses this Vite config (C5 §2 — no separate runner). Node env
    // (Phase 0 has no DOM/component tests yet); explicit imports, no globals.
    test: {
      include: ['tests/**/*.test.{ts,tsx}'],
      environment: 'node', // default; component tests opt into jsdom via a per-file `// @vitest-environment jsdom`.
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});

import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { input: resolve('src/main/index.ts') } },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: resolve('src/preload/index.ts'),
        // Forced to CJS `index.js`. Because package.json is `"type": "module"`,
        // the default emit is `index.mjs` — which main's `preload:` path does
        // not point at, and which a sandboxed renderer cannot load anyway
        // (Electron has no ESM preload under `sandbox: true`). The failure is
        // silent: the bridge never attaches, `window.api` stays undefined, and
        // the app renders its empty state forever with nothing in the log.
        output: { format: 'cjs', entryFileNames: 'index.js' },
      },
    },
  },
  renderer: {
    root: resolve('src/renderer'),
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared'),
        // Committed data tables the renderer imports directly. Aliased rather
        // than reached for with `../../../../data` so the compiled enrichment
        // index can be declared as a module in env.d.ts — otherwise a typecheck
        // walks 1.2 MB of JSON to infer a type nothing reads.
        '@data': resolve('data'),
      },
    },
    build: { rollupOptions: { input: resolve('src/renderer/index.html') } },
  },
})

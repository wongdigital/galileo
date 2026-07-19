import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    // Mirrors electron.vite.config.ts, so renderer modules can be imported by
    // the suite under the same specifiers the app builds with.
    alias: {
      '@renderer': resolve('src/renderer/src'),
      '@shared': resolve('src/shared'),
      '@data': resolve('data'),
    },
  },
  test: {
    // The shared library is pure — no DOM, no Electron, no network. The main
    // process modules under test (the snapshot and star stores) touch only
    // node:fs; the ones that touch `electron` stay out of the suite. The
    // renderer modules under test are mostly the pure derivation selectors,
    // which need no DOM either. The handful that do — the scroll anchor and the
    // spine's refresh/star effects — opt in per file with an
    // `@vitest-environment jsdom` docblock rather than putting the whole suite
    // behind a DOM it does not use.
    environment: 'node',
    include: ['src/{shared,main,renderer}/**/__tests__/**/*.test.{ts,tsx}'],
  },
})

import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // The shared library is pure — no DOM, no Electron, no network. The main
    // process modules under test (the snapshot store) touch only node:fs; the
    // ones that touch `electron` stay out of the suite.
    environment: 'node',
    include: ['src/{shared,main}/**/__tests__/**/*.test.ts'],
  },
})

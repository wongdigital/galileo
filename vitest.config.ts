import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // The shared library is pure — no DOM, no Electron, no network.
    environment: 'node',
    include: ['src/shared/**/__tests__/**/*.test.ts'],
  },
})

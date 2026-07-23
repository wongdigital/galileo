import type { PlatformBridge } from '@shared/bridge/types'

let testBridge: PlatformBridge | null | undefined

/**
 * The renderer's only platform lookup. U6 supplies the web fallback; until
 * then a renderer outside Electron keeps today's null-safe empty behavior.
 */
export function bridge(): PlatformBridge | null {
  if (testBridge !== undefined) return testBridge
  return typeof window !== 'undefined' && window.api ? window.api : null
}

/** Test seam used by the typed fake-bridge helper. Production code must only
 * read through `bridge()`; keeping the override here prevents ambient window
 * mutation from leaking through renderer suites. */
export function setBridgeForTesting(value: PlatformBridge | null | undefined): void {
  testBridge = value
}

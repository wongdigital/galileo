import type { PlatformBridge } from '@shared/bridge/types'
import { webBridge } from './bridge/web'

let testBridge: PlatformBridge | null | undefined

/** The renderer's only platform lookup. Explicit test override wins, then the
 * Electron preload when present, then the singleton browser implementation. */
export function bridge(): PlatformBridge | null {
  if (testBridge !== undefined) return testBridge
  return typeof window !== 'undefined' && window.api ? window.api : webBridge()
}

/** Test seam used by the typed fake-bridge helper. Production code must only
 * read through `bridge()`; keeping the override here prevents ambient window
 * mutation from leaking through renderer suites. */
export function setBridgeForTesting(value: PlatformBridge | null | undefined): void {
  testBridge = value
}

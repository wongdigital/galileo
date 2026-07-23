/// <reference types="vite/client" />
import type { PlatformBridge } from '@shared/bridge/types'

declare global {
  const __APP_VERSION__: string
  const __SCHED_SITE__: string

  interface Window {
    /** Exposed by src/preload via contextBridge. The renderer's only I/O path. */
    api?: PlatformBridge
  }
}

/// <reference types="vite/client" />
import type { PlatformBridge } from '@shared/bridge/types'

declare global {
  interface Window {
    /** Exposed by src/preload via contextBridge. The renderer's only I/O path. */
    api?: PlatformBridge
  }
}

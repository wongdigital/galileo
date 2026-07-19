/// <reference types="vite/client" />
import type { AppApi } from '../../preload'

declare global {
  interface Window {
    /** Exposed by src/preload via contextBridge. The renderer's only I/O path. */
    api: AppApi
  }
}

import type { PlatformBridge } from '@shared/bridge/types'

let testBridge: PlatformBridge | null | undefined
let platformBridgePromise: Promise<PlatformBridge> | undefined

function loadPlatformBridge(): Promise<PlatformBridge> {
  platformBridgePromise ??= import('./bridge/web').then(({ platformBridge }) => platformBridge())
  return platformBridgePromise
}

function withPlatformBridge<T>(operation: (api: PlatformBridge) => Promise<T>): Promise<T> {
  return loadPlatformBridge().then(operation)
}

/** Synchronous, identity-stable facade whose web/Capacitor implementation is
 * loaded on first use. Electron windows return preload directly, so neither
 * the main renderer nor About eagerly loads provider and storage code. */
const lazyWebBridge: PlatformBridge = {
  app: {
    version: () => withPlatformBridge((api) => api.app.version()),
  },
  schedule: {
    refresh: (options) => withPlatformBridge((api) => api.schedule.refresh(options)),
  },
  changes: {
    acknowledge: (uids) => withPlatformBridge((api) => api.changes.acknowledge(uids)),
  },
  stars: {
    get: () => withPlatformBridge((api) => api.stars.get()),
    set: (stars) => withPlatformBridge((api) => api.stars.set(stars)),
  },
  export: {
    ics: (payload) => withPlatformBridge((api) => api.export.ics(payload)),
  },
  llm: {
    keyStatus: () => withPlatformBridge((api) => api.llm.keyStatus()),
    setKey: (provider, key) => withPlatformBridge((api) => api.llm.setKey(provider, key)),
    clearKey: (provider) => withPlatformBridge((api) => api.llm.clearKey(provider)),
    models: (provider) => withPlatformBridge((api) => api.llm.models(provider)),
    syncDataset: (candidates) => withPlatformBridge((api) => api.llm.syncDataset(candidates)),
    chat: (request) => withPlatformBridge((api) => api.llm.chat(request)),
    cancelChat: () => withPlatformBridge((api) => api.llm.cancelChat()),
    onChatDelta: (callback) => {
      let active = true
      let unsubscribe: (() => void) | undefined
      void loadPlatformBridge()
        .then((api) => {
          if (!active) return
          const next = api.llm.onChatDelta(callback)
          if (active) unsubscribe = next
          else next()
        })
        .catch((error: unknown) => {
          console.error('[bridge] failed to load browser chat subscription:', error)
        })
      return () => {
        active = false
        unsubscribe?.()
        unsubscribe = undefined
      }
    },
  },
  settings: {
    get: (name) => withPlatformBridge((api) => api.settings.get(name)),
    set: (name, value) => withPlatformBridge((api) => api.settings.set(name, value)),
  },
}

/** The renderer's only platform lookup. Explicit test override wins, then the
 * Electron preload when present, then the singleton browser implementation. */
export function bridge(): PlatformBridge | null {
  if (testBridge !== undefined) return testBridge
  return typeof window !== 'undefined' && window.api ? window.api : lazyWebBridge
}

/** True only when Electron's preload is actually present. Test overrides and
 * the browser bridge deliberately do not opt into macOS titlebar geometry. */
export function isElectronShell(): boolean {
  return typeof window !== 'undefined' && Boolean(window.api)
}

/** Test seam used by the typed fake-bridge helper. Production code must only
 * read through `bridge()`; keeping the override here prevents ambient window
 * mutation from leaking through renderer suites. */
export function setBridgeForTesting(value: PlatformBridge | null | undefined): void {
  testBridge = value
}

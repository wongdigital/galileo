import { contextBridge, ipcRenderer } from 'electron'

/**
 * The only surface the renderer gets. One named method per channel — no generic
 * `invoke(channel, ...args)` passthrough, which would hand the renderer the
 * whole IPC namespace and make the allowlist meaningless.
 */
const api = {
  schedule: {
    // `acceptAnyway` is the drift warning's "use the new data anyway" override.
    refresh: (options?: { acceptAnyway?: boolean }) => ipcRenderer.invoke('schedule:refresh', options),
  },
  changes: {
    acknowledge: (uids: string[]) => ipcRenderer.invoke('changes:acknowledge', uids),
  },
  stars: {
    get: () => ipcRenderer.invoke('stars:get'),
    // Returns the persisted list; the renderer adopts what comes back rather
    // than assuming its optimistic write landed (R11 echo-back).
    set: (stars: unknown[]) => ipcRenderer.invoke('stars:set', stars),
  },
  export: {
    ics: (payload: { uids: string[]; options?: unknown }) => ipcRenderer.invoke('export:ics', payload),
  },
}

export type AppApi = typeof api

contextBridge.exposeInMainWorld('api', api)

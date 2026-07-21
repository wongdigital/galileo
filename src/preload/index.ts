import { contextBridge, ipcRenderer } from 'electron'
import type {
  ChatDelta,
  ChatRequest,
  ChatResponse,
  KeyStatus,
  ModelChoice,
  ProviderId,
} from '../shared/chat'
import type { FilterCandidate } from '../shared/filter/types'

/**
 * The only surface the renderer gets. One named method per channel — no generic
 * `invoke(channel, ...args)` passthrough, which would hand the renderer the
 * whole IPC namespace and make the allowlist meaningless.
 */
const api = {
  app: {
    /** The running app version, read by the standalone About window. */
    version: (): Promise<string> => ipcRenderer.invoke('app:version'),
  },
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
  llm: {
    /** Which providers have a stored key — the key value never crosses here. */
    keyStatus: (): Promise<KeyStatus> => ipcRenderer.invoke('llm:key:status'),
    setKey: (
      provider: ProviderId,
      key: string,
    ): Promise<{ ok: true; status: KeyStatus } | { ok: false; message: string }> =>
      ipcRenderer.invoke('llm:key:set', { provider, key }),
    clearKey: (provider: ProviderId): Promise<KeyStatus> =>
      ipcRenderer.invoke('llm:key:clear', { provider }),
    /** Live model catalogue. OpenRouter needs no key; Anthropic and OpenAI
     *  return [] until their key is stored. */
    models: (provider: ProviderId): Promise<ModelChoice[]> =>
      ipcRenderer.invoke('llm:models', provider),
    /** Push the current candidate index so the tool loop grounds counts and
     *  searches in main; called when the identity-stable array changes. */
    syncDataset: (candidates: readonly FilterCandidate[]): Promise<{ received: number }> =>
      ipcRenderer.invoke('llm:dataset:sync', candidates),
    chat: (request: ChatRequest): Promise<ChatResponse> => ipcRenderer.invoke('llm:chat', request),
    /** Abort the in-flight turn — the Stop button. */
    cancelChat: (): Promise<{ cancelled: boolean }> => ipcRenderer.invoke('llm:chat:cancel'),
    /** Subscribe to streamed text/status for the in-flight turn. Returns an
     *  unsubscribe function. */
    onChatDelta: (cb: (delta: ChatDelta) => void): (() => void) => {
      const listener = (_event: unknown, delta: ChatDelta): void => cb(delta)
      ipcRenderer.on('llm:chat:delta', listener)
      return () => ipcRenderer.removeListener('llm:chat:delta', listener)
    },
  },
}

export type AppApi = typeof api

contextBridge.exposeInMainWorld('api', api)

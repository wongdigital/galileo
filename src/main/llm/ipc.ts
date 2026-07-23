/** Electron's thin chat host: channel registration and sender delta plumbing.
 * Validation, inflight state, timeout, keys, models, and transport fallback all
 * live in the platform-neutral shared session. */

import type { ScheduleEvent } from '../../shared/schedule'
import { createChatSession, type ChatSession, type ChatTransport, type KeyStore } from '../../shared/llm'

export interface LlmIpcHost {
  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): void
}

export interface LlmIpcDeps {
  keyStore: KeyStore
  getEvents: () => readonly ScheduleEvent[]
  transport?: ChatTransport
  session?: ChatSession
}

export function registerLlmIpc(ipcMain: LlmIpcHost, dependencies: LlmIpcDeps): void {
  const session = dependencies.session ?? createChatSession({
    keys: dependencies.keyStore,
    getEvents: dependencies.getEvents,
    transport: dependencies.transport ?? { streamFetch: fetch, bufferedRequest: fetch },
  })
  let releaseSender: (() => void) | null = null

  ipcMain.handle('llm:key:status', () => session.keyStatus())
  ipcMain.handle('llm:key:set', (_event, payload: unknown) => {
    const { provider, key } = (payload ?? {}) as { provider?: unknown; key?: unknown }
    return session.setKey(provider, key)
  })
  ipcMain.handle('llm:key:clear', (_event, payload: unknown) => {
    const { provider } = (payload ?? {}) as { provider?: unknown }
    return session.clearKey(provider)
  })
  ipcMain.handle('llm:models', (_event, provider: unknown) => session.models(provider))
  ipcMain.handle('llm:dataset:sync', (_event, candidates: unknown) => session.syncDataset(candidates))
  ipcMain.handle('llm:chat', async (event, request: unknown) => {
    const sender = (event as { sender?: { send(channel: string, ...payload: unknown[]): void } }).sender
    // Supersede the sender subscription in lockstep with the session turn. A
    // prior pending IPC promise must not remain subscribed to the new turn.
    releaseSender?.()
    const unsubscribe = sender
      ? session.onDelta((delta) => sender.send('llm:chat:delta', delta))
      : () => {}
    releaseSender = unsubscribe
    try {
      return await session.chat(request)
    } finally {
      if (releaseSender === unsubscribe) {
        unsubscribe()
        releaseSender = null
      }
    }
  })
  ipcMain.handle('llm:chat:cancel', () => session.cancel())
}

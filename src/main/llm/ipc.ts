/**
 * The chat tab's IPC surface. Follows the self-registering
 * `register*Ipc(ipcMain, deps)` pattern the star and export channels use, so
 * this module never imports `electron` and stays unit-testable against a
 * Map-backed fake ipcMain.
 *
 * The candidate index lives here as closure state: the renderer syncs it
 * (`llm:dataset:sync`) whenever its identity-stable candidate array changes —
 * rarely, on refresh — and every chat turn reads the last synced copy. Keeping
 * it in main means the tool loop grounds counts and searches without the
 * renderer shipping 3,474 events on every message.
 */

import { runChatTurn } from './loop'
import { listModels } from './models'
import type { KeyStore } from './keyStore'
import type { ChatRequest, ProviderId } from '../../shared/chat'
import type { FilterCandidate } from '../../shared/filter/types'
import type { ScheduleEvent } from '../../shared/schedule'

/** Minimal `ipcMain`, typed structurally to keep `electron` out of the module. */
export interface LlmIpcHost {
  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): void
}

export interface LlmIpcDeps {
  keyStore: KeyStore
  getEvents: () => readonly ScheduleEvent[]
}

/** A turn that reaches this without answering is stuck; abort it and surface a
 *  clear timeout rather than a spinner that never stops. Generous, because a
 *  multi-step tool loop on a large model legitimately takes a while. */
const CHAT_TIMEOUT_MS = 90_000

export function registerLlmIpc(ipcMain: LlmIpcHost, deps: LlmIpcDeps): void {
  let candidates: readonly FilterCandidate[] = []
  let inflight: AbortController | null = null

  ipcMain.handle('llm:key:status', () => deps.keyStore.status())

  ipcMain.handle('llm:key:set', (_event, ...args: unknown[]) => {
    const { provider, key } = (args[0] ?? {}) as { provider: ProviderId; key: string }
    try {
      return { ok: true as const, status: deps.keyStore.set(provider, key) }
    } catch (error) {
      return { ok: false as const, message: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle('llm:key:clear', (_event, ...args: unknown[]) => {
    const { provider } = (args[0] ?? {}) as { provider: ProviderId }
    return deps.keyStore.clear(provider)
  })

  ipcMain.handle('llm:models', (_event, ...args: unknown[]) => {
    const provider = args[0] as ProviderId
    // OpenRouter lists publicly; the other two need the stored key.
    return listModels(provider, deps.keyStore.get(provider) ?? undefined)
  })

  ipcMain.handle('llm:dataset:sync', (_event, ...args: unknown[]) => {
    const next = args[0]
    candidates = Array.isArray(next) ? (next as FilterCandidate[]) : []
    return { received: candidates.length }
  })

  ipcMain.handle('llm:chat', async (event, ...args: unknown[]) => {
    // One turn in flight per window; a new send supersedes any prior straggler.
    inflight?.abort(new Error('superseded'))
    const controller = new AbortController()
    inflight = controller
    const timeout = setTimeout(() => controller.abort(new Error('timeout')), CHAT_TIMEOUT_MS)
    // Stream text/status back to the sender as it happens.
    const sender = (event as { sender?: { send(channel: string, ...payload: unknown[]): void } }).sender
    try {
      return await runChatTurn(
        {
          keyStore: deps.keyStore,
          getEvents: deps.getEvents,
          getCandidates: () => candidates,
          signal: controller.signal,
          onDelta: sender ? (delta) => sender.send('llm:chat:delta', delta) : undefined,
        },
        args[0] as ChatRequest,
      )
    } finally {
      clearTimeout(timeout)
      if (inflight === controller) inflight = null
    }
  })

  ipcMain.handle('llm:chat:cancel', () => {
    inflight?.abort(new Error('cancelled'))
    return { cancelled: true }
  })
}

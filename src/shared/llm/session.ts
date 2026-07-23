import { PROVIDERS, type ChatDelta, type ChatRequest, type ChatResponse, type KeyStatus, type ModelChoice, type ProviderId } from '../chat'
import type { FilterCandidate } from '../filter/types'
import type { ScheduleEvent } from '../schedule'
import type { KeyStore } from './keys'
import { runChatTurn, type ChatDeps } from './loop'
import { listModels } from './models'
import { isCorsLikeError, type ChatFetch, type ChatTransport } from './transport'

const MALFORMED: ChatResponse = { ok: false, error: { kind: 'provider', message: 'malformed request' } }
const CHAT_TIMEOUT_MS = 90_000

export type RunChatTurn = (dependencies: ChatDeps, request: ChatRequest) => Promise<ChatResponse>

export interface ChatSessionDeps {
  keys: KeyStore
  getEvents: () => readonly ScheduleEvent[]
  transport: ChatTransport
  runTurn?: RunChatTurn
  timeoutMs?: number
}

export interface ChatSession {
  keyStatus(): Promise<KeyStatus>
  setKey(provider: unknown, key: unknown): Promise<{ ok: true; status: KeyStatus } | { ok: false; message: string }>
  clearKey(provider: unknown): Promise<KeyStatus>
  models(provider: unknown): Promise<ModelChoice[]>
  syncDataset(candidates: unknown): { received: number }
  chat(request: unknown): Promise<ChatResponse>
  cancel(): { cancelled: true }
  onDelta(callback: (delta: ChatDelta) => void): () => void
}

function isProviderId(value: unknown): value is ProviderId {
  return typeof value === 'string' && (PROVIDERS as readonly string[]).includes(value)
}

function isChatRequest(value: unknown): value is ChatRequest {
  if (!value || typeof value !== 'object') return false
  const request = value as Record<string, unknown>
  if (!isProviderId(request.provider) || !Array.isArray(request.messages)) return false
  return request.messages.every((message) => {
    if (!message || typeof message !== 'object') return false
    const row = message as Record<string, unknown>
    return (row.role === 'user' || row.role === 'assistant') && typeof row.content === 'string'
  })
}

/** Platform-neutral chat host. It owns request state and degradation decisions;
 * Electron IPC and the web bridge only translate this API to their callers. */
export function createChatSession(dependencies: ChatSessionDeps): ChatSession {
  const callbacks = new Set<(delta: ChatDelta) => void>()
  const runTurn = dependencies.runTurn ?? runChatTurn
  let candidates: readonly FilterCandidate[] = []
  let inflight: AbortController | null = null

  const notify = (controller: AbortController, delta: ChatDelta): void => {
    if (controller.signal.aborted) return
    for (const callback of callbacks) callback(delta)
  }

  const interrupted = (text: string): ChatResponse => ({
    ok: true,
    turn: {
      interrupted: true,
      message: { role: 'assistant', content: text },
      eventUids: [],
      toolTrace: [],
    },
  })

  const aborted = (signal: AbortSignal): ChatResponse => {
    const timedOut = signal.reason instanceof Error && signal.reason.message === 'timeout'
    return timedOut
      ? { ok: false, error: { kind: 'provider', message: 'The request timed out. Try again, or pick a faster model.' } }
      : { ok: false, error: { kind: 'aborted', message: 'Stopped.' } }
  }

  return {
    keyStatus: () => dependencies.keys.status(),

    async setKey(provider, key) {
      if (!isProviderId(provider)) return { ok: false, message: 'unknown provider' }
      if (typeof key !== 'string') return { ok: false, message: 'invalid key' }
      try {
        return { ok: true, status: await dependencies.keys.set(provider, key) }
      } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : String(error) }
      }
    },

    async clearKey(provider) {
      if (!isProviderId(provider)) return dependencies.keys.status()
      return dependencies.keys.clear(provider)
    },

    async models(provider) {
      if (!isProviderId(provider)) return []
      const key = provider === 'openrouter' ? undefined : (await dependencies.keys.get(provider)) ?? undefined
      return listModels(provider, key, dependencies.transport)
    },

    syncDataset(next) {
      candidates = Array.isArray(next) ? (next as FilterCandidate[]) : []
      return { received: candidates.length }
    },

    async chat(payload) {
      if (!isChatRequest(payload)) return MALFORMED
      inflight?.abort(new Error('superseded'))
      const controller = new AbortController()
      inflight = controller
      const timeout = setTimeout(
        () => controller.abort(new Error('timeout')),
        dependencies.timeoutMs ?? CHAT_TIMEOUT_MS,
      )
      const base: Omit<ChatDeps, 'fetchImpl' | 'generationMode' | 'onDelta'> = {
        keyStore: dependencies.keys,
        getEvents: dependencies.getEvents,
        getCandidates: () => candidates,
        signal: controller.signal,
      }
      try {
        const attempt = async (
          fetchImpl: ChatFetch,
          generationMode: 'stream' | 'buffered',
        ): Promise<{ response: ChatResponse; partial: string; active: boolean }> => {
          let partial = ''
          let active = false
          const onDelta = (delta: ChatDelta): void => {
            if (controller.signal.aborted) return
            active = true
            if (delta.text) partial += delta.text
            notify(controller, delta)
          }
          try {
            const response = await runTurn({ ...base, fetchImpl, generationMode, onDelta }, payload)
            return { response, partial, active }
          } catch (error) {
            return {
              response: {
                ok: false,
                error: {
                  kind: 'provider',
                  message: error instanceof Error ? error.message : String(error),
                  ...(isCorsLikeError(error) ? { transport: 'cors' as const } : {}),
                },
              },
              partial,
              active,
            }
          }
        }

        const streamed = await attempt(dependencies.transport.streamFetch, 'stream')
        if (controller.signal.aborted) {
          return streamed.partial.trim() ? interrupted(streamed.partial) : aborted(controller.signal)
        }
        if (
          !streamed.active &&
          !streamed.response.ok &&
          streamed.response.error.transport === 'cors' &&
          dependencies.transport.bufferedRequest !== dependencies.transport.streamFetch
        ) {
          notify(controller, { status: "This provider's response won't stream." })
          const buffered = await attempt(dependencies.transport.bufferedRequest, 'buffered')
          if (controller.signal.aborted) {
            return buffered.partial.trim() ? interrupted(buffered.partial) : aborted(controller.signal)
          }
          if (!buffered.response.ok && buffered.partial.trim()) return interrupted(buffered.partial)
          return buffered.response
        }
        if (!streamed.response.ok && streamed.partial.trim()) return interrupted(streamed.partial)
        return streamed.response
      } catch (error) {
        return {
          ok: false,
          error: { kind: 'provider', message: error instanceof Error ? error.message : String(error) },
        }
      } finally {
        clearTimeout(timeout)
        if (inflight === controller) inflight = null
      }
    },

    cancel() {
      inflight?.abort(new Error('cancelled'))
      return { cancelled: true }
    },

    onDelta(callback) {
      callbacks.add(callback)
      return () => callbacks.delete(callback)
    },
  }
}

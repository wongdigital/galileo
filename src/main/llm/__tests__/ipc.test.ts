/**
 * The chat IPC surface against Map-backed fakes: the module registers handlers
 * on a structural `ipcMain`, so the tests invoke those handlers directly with a
 * fake event whose `sender.send` records pushes. `runChatTurn` is mocked so the
 * per-turn controller wiring — supersede, cancel, timeout, delta forwarding — is
 * observable without a provider, a key, or the network. Everything else (key
 * set/clear, dataset sync, model dispatch) runs against the real logic.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatDeps } from '../loop'
import { registerLlmIpc, type LlmIpcDeps, type LlmIpcHost } from '../ipc'
import type { KeyStatus, ProviderId } from '../../../shared/chat'

const { runChatTurn } = vi.hoisted(() => ({ runChatTurn: vi.fn() }))
vi.mock('../loop', () => ({ runChatTurn }))

/** A Map-backed `ipcMain`: `handle` records the listener under its channel. */
function makeHost() {
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
  const host: LlmIpcHost = { handle: (channel, listener) => handlers.set(channel, listener) }
  const invoke = (channel: string, ...args: unknown[]) => handlers.get(channel)!(event, ...args)
  return { host, handlers, invoke }
}

/** Records what main streamed back over the push channel. */
let sent: Array<{ channel: string; payload: unknown[] }>
let event: { sender: { send(channel: string, ...payload: unknown[]): void } }

/** A KeyStore stand-in; only the four methods the IPC layer calls are real. */
function makeKeyStore(over: {
  keys?: Partial<Record<ProviderId, string>>
  status?: KeyStatus
  set?: (provider: ProviderId, key: string) => KeyStatus
} = {}): LlmIpcDeps['keyStore'] {
  const status: KeyStatus = over.status ?? { anthropic: false, openai: false, openrouter: false }
  return {
    status: () => status,
    get: (provider: ProviderId) => over.keys?.[provider] ?? null,
    set: over.set ?? ((_p, _k) => status),
    clear: () => status,
  } as unknown as LlmIpcDeps['keyStore']
}

const events = [{ uid: 'a' }] as unknown as ReturnType<LlmIpcDeps['getEvents']>

function register(deps: Partial<LlmIpcDeps> = {}) {
  const host = makeHost()
  const full: LlmIpcDeps = {
    keyStore: deps.keyStore ?? makeKeyStore(),
    getEvents: deps.getEvents ?? (() => events),
  }
  registerLlmIpc(host.host, full)
  return host
}

beforeEach(() => {
  sent = []
  event = { sender: { send: (channel, ...payload) => sent.push({ channel, payload }) } }
  runChatTurn.mockReset()
})

afterEach(() => {
  vi.useRealTimers()
})

const request = { provider: 'anthropic', messages: [], filter: {}, lens: 'ip', view: 'schedule', starredUids: [], changedUids: [] }

describe('registerLlmIpc', () => {
  it('registers every chat channel', () => {
    const { handlers } = register()
    for (const channel of [
      'llm:key:status',
      'llm:key:set',
      'llm:key:clear',
      'llm:models',
      'llm:dataset:sync',
      'llm:chat',
      'llm:chat:cancel',
    ]) {
      expect(handlers.has(channel)).toBe(true)
    }
  })

  it('reports key status straight from the store', () => {
    const status: KeyStatus = { anthropic: true, openai: false, openrouter: false }
    const { invoke } = register({ keyStore: makeKeyStore({ status }) })
    expect(invoke('llm:key:status')).toEqual(status)
  })

  it('returns ok with the new status when a key is stored', () => {
    const status: KeyStatus = { anthropic: true, openai: false, openrouter: false }
    const { invoke } = register({ keyStore: makeKeyStore({ status, set: () => status }) })
    expect(invoke('llm:key:set', { provider: 'anthropic', key: 'sk-ant' })).toEqual({ ok: true, status })
  })

  it('reports a rejected key as an error rather than throwing', () => {
    const set = () => {
      throw new Error('OS keychain is unavailable')
    }
    const { invoke } = register({ keyStore: makeKeyStore({ set }) })
    expect(invoke('llm:key:set', { provider: 'anthropic', key: 'sk-ant' })).toEqual({
      ok: false,
      message: 'OS keychain is unavailable',
    })
  })

  it('clears a key through the store', () => {
    const status: KeyStatus = { anthropic: false, openai: false, openrouter: false }
    const { invoke } = register({ keyStore: makeKeyStore({ status }) })
    expect(invoke('llm:key:clear', { provider: 'anthropic' })).toEqual(status)
  })

  it('lists no models for a keyless gated provider without calling out', async () => {
    // anthropic needs a key; with none stored, listModels returns [] and never
    // touches the network — so this exercises the real dispatch safely.
    const { invoke } = register({ keyStore: makeKeyStore() })
    await expect(invoke('llm:models', 'anthropic')).resolves.toEqual([])
  })

  it('stores a synced candidate array and reports the count', () => {
    const { invoke } = register()
    expect(invoke('llm:dataset:sync', [{ uid: 'a' }, { uid: 'b' }])).toEqual({ received: 2 })
  })

  it('falls back to an empty index when the sync payload is not an array', () => {
    const { invoke } = register()
    expect(invoke('llm:dataset:sync', 'not-an-array')).toEqual({ received: 0 })
  })

  it('hands the turn the synced candidates and the events getter', async () => {
    runChatTurn.mockResolvedValue({ ok: true, turn: { message: { role: 'assistant', content: 'ok' }, eventUids: [], toolTrace: [] } })
    const { invoke } = register()
    invoke('llm:dataset:sync', [{ uid: 'a' }, { uid: 'b' }])
    await invoke('llm:chat', request)
    const deps = runChatTurn.mock.calls[0]![0] as ChatDeps
    expect(deps.getCandidates()).toHaveLength(2)
    expect(deps.getEvents()).toBe(events)
  })

  it('forwards streamed deltas to the sender over the push channel', async () => {
    runChatTurn.mockResolvedValue({ ok: true, turn: { message: { role: 'assistant', content: 'ok' }, eventUids: [], toolTrace: [] } })
    const { invoke } = register()
    await invoke('llm:chat', request)
    const deps = runChatTurn.mock.calls[0]![0] as ChatDeps
    deps.onDelta?.({ text: 'hi' })
    expect(sent).toContainEqual({ channel: 'llm:chat:delta', payload: [{ text: 'hi' }] })
  })

  it('supersedes an in-flight turn when a second one starts', () => {
    runChatTurn.mockReturnValue(new Promise(() => {}))
    const { invoke } = register()
    void invoke('llm:chat', request)
    void invoke('llm:chat', request)
    const first = (runChatTurn.mock.calls[0]![0] as ChatDeps).signal!
    const second = (runChatTurn.mock.calls[1]![0] as ChatDeps).signal!
    expect(first.aborted).toBe(true)
    expect((first.reason as Error).message).toBe('superseded')
    expect(second.aborted).toBe(false)
  })

  it('cancels an in-flight turn with a cancelled reason', () => {
    runChatTurn.mockReturnValue(new Promise(() => {}))
    const { invoke } = register()
    void invoke('llm:chat', request)
    expect(invoke('llm:chat:cancel')).toEqual({ cancelled: true })
    const signal = (runChatTurn.mock.calls[0]![0] as ChatDeps).signal!
    expect(signal.aborted).toBe(true)
    expect((signal.reason as Error).message).toBe('cancelled')
  })

  it('reports cancelled even when nothing is in flight', () => {
    const { invoke } = register()
    expect(invoke('llm:chat:cancel')).toEqual({ cancelled: true })
  })

  it('aborts a turn that runs past the timeout', () => {
    vi.useFakeTimers()
    runChatTurn.mockReturnValue(new Promise(() => {}))
    const { invoke } = register()
    void invoke('llm:chat', request)
    vi.advanceTimersByTime(90_000)
    const signal = (runChatTurn.mock.calls[0]![0] as ChatDeps).signal!
    expect(signal.aborted).toBe(true)
    expect((signal.reason as Error).message).toBe('timeout')
  })

  it('rejects an unknown provider on key:set without touching the store', () => {
    const set = vi.fn()
    const { invoke } = register({ keyStore: makeKeyStore({ set }) })
    expect(invoke('llm:key:set', { provider: 'bogus', key: 'sk' })).toEqual({ ok: false, message: 'unknown provider' })
    expect(set).not.toHaveBeenCalled()
  })

  it('treats an unknown provider on key:clear as a no-op returning current status', () => {
    const status: KeyStatus = { anthropic: true, openai: false, openrouter: false }
    const { invoke } = register({ keyStore: makeKeyStore({ status }) })
    expect(invoke('llm:key:clear', { provider: 'bogus' })).toEqual(status)
  })

  it('lists no models for an unknown provider', () => {
    const { invoke } = register()
    // Rejected before dispatch, so it short-circuits to [] without a fetch.
    expect(invoke('llm:models', 'bogus')).toEqual([])
  })

  it('rejects a malformed chat payload as a structured provider error, never a throw', async () => {
    const { invoke } = register()
    // Missing provider / non-array messages: the loop must never see it.
    await expect(invoke('llm:chat', { provider: 'anthropic', messages: 'nope' })).resolves.toEqual({
      ok: false,
      error: { kind: 'provider', message: 'malformed request' },
    })
    expect(runChatTurn).not.toHaveBeenCalled()
  })

  it('rejects a chat payload whose messages have the wrong shape', async () => {
    const { invoke } = register()
    await expect(
      invoke('llm:chat', { provider: 'anthropic', messages: [{ role: 'system', content: 'x' }], filter: {}, lens: 'ip', view: 'schedule', starredUids: [], changedUids: [] }),
    ).resolves.toEqual({ ok: false, error: { kind: 'provider', message: 'malformed request' } })
    expect(runChatTurn).not.toHaveBeenCalled()
  })

  it('wraps a runChatTurn rejection as a provider error rather than letting it escape', async () => {
    runChatTurn.mockRejectedValue(new Error('kaboom'))
    const { invoke } = register()
    await expect(invoke('llm:chat', request)).resolves.toEqual({
      ok: false,
      error: { kind: 'provider', message: 'kaboom' },
    })
  })

  it('does not stream deltas once its own turn has been superseded', async () => {
    runChatTurn.mockReturnValue(new Promise(() => {}))
    const { invoke } = register()
    void invoke('llm:chat', request)
    const firstDeps = runChatTurn.mock.calls[0]![0] as ChatDeps
    // A second turn supersedes the first, aborting its controller.
    void invoke('llm:chat', request)
    // The straggler's delta must not reach the sender the newer turn now owns.
    firstDeps.onDelta?.({ text: 'stale' })
    expect(sent).not.toContainEqual({ channel: 'llm:chat:delta', payload: [{ text: 'stale' }] })
  })
})

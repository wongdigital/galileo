import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChatRequest, ChatResponse, KeyStatus } from '../../chat'
import { EMPTY_FILTER } from '../../filter/types'
import { createChatSession, type ChatSessionDeps } from '../session'

const request: ChatRequest = {
  provider: 'anthropic',
  messages: [{ role: 'user', content: 'hello' }],
  filter: EMPTY_FILTER,
  lens: 'ip',
  view: 'schedule',
  starredUids: [],
  changedUids: [],
}

const status: KeyStatus = { anthropic: 'present', openai: 'unreadable', openrouter: 'absent' }

function dependencies(overrides: Partial<ChatSessionDeps> = {}): ChatSessionDeps {
  return {
    keys: {
      status: async () => status,
      get: async () => 'sk-test',
      set: async () => status,
      clear: async () => status,
    },
    getEvents: () => [],
    transport: { streamFetch: vi.fn(), bufferedRequest: vi.fn() },
    runTurn: vi.fn(async (): Promise<ChatResponse> => ({
      ok: true,
      turn: { message: { role: 'assistant', content: 'done' }, eventUids: [], toolTrace: [] },
    })),
    ...overrides,
  }
}

afterEach(() => vi.useRealTimers())

describe('createChatSession', () => {
  it('owns payload validation and the candidate index', async () => {
    const runTurn = vi.fn<NonNullable<ChatSessionDeps['runTurn']>>(async () => ({
      ok: true,
      turn: { message: { role: 'assistant', content: 'done' }, eventUids: [], toolTrace: [] },
    }))
    const session = createChatSession(dependencies({ runTurn }))
    expect(session.syncDataset([{ uid: 'a' } as never])).toEqual({ received: 1 })
    await expect(session.chat({ provider: 'anthropic', messages: 'bad' })).resolves.toEqual({
      ok: false,
      error: { kind: 'provider', message: 'malformed request' },
    })
    await session.chat(request)
    expect(runTurn.mock.calls[0]![0].getCandidates()).toHaveLength(1)
  })

  it('supersedes one in-flight turn and cancels without leaking later deltas', async () => {
    const signals: AbortSignal[] = []
    const runTurn = vi.fn<NonNullable<ChatSessionDeps['runTurn']>>(({ signal }) => {
      signals.push(signal!)
      return new Promise<ChatResponse>(() => {})
    })
    const session = createChatSession(dependencies({ runTurn }))
    const deltas: unknown[] = []
    session.onDelta((delta) => deltas.push(delta))
    void session.chat(request)
    void session.chat(request)
    expect(signals[0]?.aborted).toBe(true)
    expect((signals[0]?.reason as Error).message).toBe('superseded')
    expect(session.cancel()).toEqual({ cancelled: true })
    expect(signals[1]?.aborted).toBe(true)
    runTurn.mock.calls[0]![0].onDelta?.({ text: 'stale' })
    expect(deltas).toEqual([])
  })

  it('aborts a turn after 90 seconds', () => {
    vi.useFakeTimers()
    let signal: AbortSignal | undefined
    const runTurn = vi.fn<NonNullable<ChatSessionDeps['runTurn']>>((deps) => {
      signal = deps.signal
      return new Promise<ChatResponse>(() => {})
    })
    const session = createChatSession(dependencies({ runTurn }))
    void session.chat(request)
    vi.advanceTimersByTime(90_000)
    expect(signal?.aborted).toBe(true)
    expect((signal?.reason as Error).message).toBe('timeout')
  })

  it('retries an initial CORS failure once through bufferedRequest with a status delta', async () => {
    const streamFetch = vi.fn()
    const bufferedRequest = vi.fn()
    const runTurn = vi
      .fn<NonNullable<ChatSessionDeps['runTurn']>>()
      .mockResolvedValueOnce({
        ok: false,
        error: { kind: 'provider', message: 'Failed to fetch', transport: 'cors' },
      })
      .mockResolvedValueOnce({
        ok: true,
        turn: { message: { role: 'assistant', content: 'buffered' }, eventUids: [], toolTrace: [] },
      })
    const session = createChatSession(dependencies({
      runTurn,
      transport: { streamFetch: streamFetch as typeof fetch, bufferedRequest: bufferedRequest as typeof fetch },
    }))
    const deltas: unknown[] = []
    session.onDelta((delta) => deltas.push(delta))

    await expect(session.chat(request)).resolves.toMatchObject({ ok: true })
    expect(runTurn).toHaveBeenCalledTimes(2)
    expect(runTurn.mock.calls[0]![0].fetchImpl).toBe(streamFetch)
    expect(runTurn.mock.calls[1]![0].fetchImpl).toBe(bufferedRequest)
    expect(runTurn.mock.calls[0]![0].generationMode).toBe('stream')
    expect(runTurn.mock.calls[1]![0].generationMode).toBe('buffered')
    expect(deltas).toContainEqual({ status: "This provider's response won't stream." })
  })

  it('preserves partial buffered output when the retry ends in a provider error', async () => {
    const streamFetch = vi.fn()
    const bufferedRequest = vi.fn()
    const runTurn = vi
      .fn<NonNullable<ChatSessionDeps['runTurn']>>()
      .mockResolvedValueOnce({
        ok: false,
        error: { kind: 'provider', message: 'Failed to fetch', transport: 'cors' },
      })
      .mockImplementationOnce(async ({ onDelta }) => {
        onDelta?.({ text: 'Buffered partial' })
        return {
          ok: false,
          error: { kind: 'provider', message: 'Provider disconnected' },
        }
      })
    const session = createChatSession(dependencies({
      runTurn,
      transport: { streamFetch: streamFetch as typeof fetch, bufferedRequest: bufferedRequest as typeof fetch },
    }))

    await expect(session.chat(request)).resolves.toEqual({
      ok: true,
      turn: {
        interrupted: true,
        message: { role: 'assistant', content: 'Buffered partial' },
        eventUids: [],
        toolTrace: [],
      },
    })
    expect(runTurn).toHaveBeenCalledTimes(2)
    expect(runTurn.mock.calls[1]![0].fetchImpl).toBe(bufferedRequest)
    expect(runTurn.mock.calls[1]![0].generationMode).toBe('buffered')
  })

  it('does not retry an interrupted turn after partial output', async () => {
    const runTurn = vi.fn<NonNullable<ChatSessionDeps['runTurn']>>(async () => ({
      ok: true,
      turn: {
        message: { role: 'assistant', content: 'partial' },
        eventUids: [],
        toolTrace: [],
        interrupted: true,
      },
    }))
    const session = createChatSession(dependencies({ runTurn }))
    await expect(session.chat(request)).resolves.toMatchObject({ ok: true, turn: { interrupted: true } })
    expect(runTurn).toHaveBeenCalledTimes(1)
  })

  it('does not retry a CORS failure after any text has streamed', async () => {
    const runTurn = vi.fn<NonNullable<ChatSessionDeps['runTurn']>>(async ({ onDelta }) => {
      onDelta?.({ text: 'Partial' })
      return {
        ok: false,
        error: { kind: 'provider', message: 'Failed to fetch', transport: 'cors' },
      }
    })
    const session = createChatSession(dependencies({ runTurn }))

    await expect(session.chat(request)).resolves.toEqual({
      ok: true,
      turn: {
        interrupted: true,
        message: { role: 'assistant', content: 'Partial' },
        eventUids: [],
        toolTrace: [],
      },
    })
    expect(runTurn).toHaveBeenCalledTimes(1)
  })

  it('passes unreadable through without clearing the key', async () => {
    const clear = vi.fn(async () => status)
    const deps = dependencies()
    deps.keys = { ...deps.keys, clear }
    const session = createChatSession(deps)
    await expect(session.keyStatus()).resolves.toEqual(status)
    expect(clear).not.toHaveBeenCalled()
  })
})

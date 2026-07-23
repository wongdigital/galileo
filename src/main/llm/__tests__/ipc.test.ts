import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatDelta, ChatResponse, KeyStatus } from '../../../shared/chat'
import type { ChatSession } from '../../../shared/llm'
import { registerLlmIpc, type LlmIpcHost } from '../ipc'

function makeHost() {
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
  const host: LlmIpcHost = { handle: (channel, listener) => handlers.set(channel, listener) }
  return { host, handlers }
}

function makeSession(): ChatSession {
  let listener: ((delta: ChatDelta) => void) | undefined
  const present: KeyStatus = { anthropic: 'present', openai: 'absent', openrouter: 'absent' }
  const absent: KeyStatus = { anthropic: 'absent', openai: 'absent', openrouter: 'absent' }
  return {
    keyStatus: vi.fn(async () => present),
    setKey: vi.fn(async () => ({ ok: false as const, message: 'unused' })),
    clearKey: vi.fn(async () => absent),
    models: vi.fn(async () => []),
    syncDataset: vi.fn(() => ({ received: 0 })),
    chat: vi.fn(async (): Promise<ChatResponse> => {
      listener?.({ text: 'hello' })
      return { ok: true, turn: { message: { role: 'assistant', content: 'hello' }, eventUids: [], toolTrace: [] } }
    }),
    cancel: vi.fn(() => ({ cancelled: true as const })),
    onDelta: vi.fn((callback) => {
      listener = callback
      return () => { listener = undefined }
    }),
  }
}

let sent: Array<{ channel: string; payload: unknown[] }>

beforeEach(() => { sent = [] })

describe('registerLlmIpc', () => {
  it('registers the complete chat channel surface', () => {
    const { host, handlers } = makeHost()
    registerLlmIpc(host, { session: makeSession(), keyStore: {} as never, getEvents: () => [] })
    expect([...handlers.keys()]).toEqual([
      'llm:key:status',
      'llm:key:set',
      'llm:key:clear',
      'llm:models',
      'llm:dataset:sync',
      'llm:chat',
      'llm:chat:cancel',
    ])
  })

  it('delegates request channels to the shared session', async () => {
    const { host, handlers } = makeHost()
    const session = makeSession()
    registerLlmIpc(host, { session, keyStore: {} as never, getEvents: () => [] })
    const event = {}
    await handlers.get('llm:key:set')!(event, { provider: 'anthropic', key: 'secret' })
    handlers.get('llm:dataset:sync')!(event, [{ uid: 'a' }])
    expect(session.setKey).toHaveBeenCalledWith('anthropic', 'secret')
    expect(session.syncDataset).toHaveBeenCalledWith([{ uid: 'a' }])
  })

  it('forwards deltas only for the lifetime of the invoking chat call', async () => {
    const { host, handlers } = makeHost()
    const session = makeSession()
    registerLlmIpc(host, { session, keyStore: {} as never, getEvents: () => [] })
    const event = { sender: { send: (channel: string, ...payload: unknown[]) => sent.push({ channel, payload }) } }
    await handlers.get('llm:chat')!(event, { provider: 'anthropic', messages: [] })
    expect(sent).toEqual([{ channel: 'llm:chat:delta', payload: [{ text: 'hello' }] }])
    expect(session.onDelta).toHaveBeenCalledOnce()
  })

  it('routes a shared-session delta only to the newest chat sender', async () => {
    const { host, handlers } = makeHost()
    const listeners = new Set<(delta: ChatDelta) => void>()
    const session = makeSession()
    session.onDelta = vi.fn((callback) => {
      listeners.add(callback)
      return () => { listeners.delete(callback) }
    })
    session.chat = vi.fn(() => new Promise<ChatResponse>(() => {}))
    registerLlmIpc(host, { session, keyStore: {} as never, getEvents: () => [] })
    const first: typeof sent = []
    const second: typeof sent = []
    void handlers.get('llm:chat')!({ sender: { send: (channel: string, ...payload: unknown[]) => first.push({ channel, payload }) } }, {})
    void handlers.get('llm:chat')!({ sender: { send: (channel: string, ...payload: unknown[]) => second.push({ channel, payload }) } }, {})
    for (const listener of listeners) listener({ text: 'newest' })
    expect(first).toEqual([])
    expect(second).toEqual([{ channel: 'llm:chat:delta', payload: [{ text: 'newest' }] }])
  })
})

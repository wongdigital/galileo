import { describe, expect, it, vi } from 'vitest'

import type { ChatRequest, ChatResponse, KeyStatus } from '@shared/chat'
import { EMPTY_FILTER } from '@shared/filter/types'
import { createChatSession, type ChatSessionDeps } from '@shared/llm'
import {
  createCapacitorBufferedFetch,
  fetchCapacitorScheduleSources,
  type CapacitorHttpPlugin,
} from '../schedFetch'

const SITE = 'https://comiccon2026.sched.com'
const CHAT_REQUEST: ChatRequest = {
  provider: 'anthropic',
  messages: [{ role: 'user', content: 'hello' }],
  filter: EMPTY_FILTER,
  lens: 'ip',
  view: 'schedule',
  starredUids: [],
  changedUids: [],
}
const KEY_STATUS: KeyStatus = {
  anthropic: 'present',
  openai: 'absent',
  openrouter: 'absent',
}

describe('fetchCapacitorScheduleSources', () => {
  it('maps concurrent native HTTP responses and sends the production identity and timeout', async () => {
    const pending: Array<(value: {
      status: number
      data: string
      headers: Record<string, string>
      url: string
    }) => void> = []
    const http: CapacitorHttpPlugin = {
      request: vi.fn(
        () =>
          new Promise<{
            status: number
            data: string
            headers: Record<string, string>
            url: string
          }>((resolve) => {
            pending.push(resolve)
          }),
      ),
    }

    const result = fetchCapacitorScheduleSources(SITE, http)
    expect(http.request).toHaveBeenCalledTimes(2)
    for (const resolve of pending) {
      resolve({
        status: 200,
        data: pending.indexOf(resolve) === 0 ? 'BEGIN:VCALENDAR\r\nEND:VCALENDAR' : '<main>list</main>',
        headers: { 'content-type': 'text/plain' },
        url: SITE,
      })
    }

    await expect(result).resolves.toEqual({
      ics: 'BEGIN:VCALENDAR\r\nEND:VCALENDAR',
      listHtml: '<main>list</main>',
    })
    expect(http.request).toHaveBeenCalledWith(
      expect.objectContaining({
        url: `${SITE}/all.ics`,
        method: 'GET',
        responseType: 'text',
        connectTimeout: 15_000,
        readTimeout: 15_000,
        headers: {
          'User-Agent': 'Galileo (+https://github.com/wongdigital/galileo; roger@wong.digital)',
        },
      }),
    )
  })

  it('rejects non-2xx and non-string native bodies', async () => {
    const non2xx: CapacitorHttpPlugin = {
      request: vi.fn(async () => ({ status: 503, data: 'down', headers: {}, url: SITE })),
    }
    await expect(fetchCapacitorScheduleSources(SITE, non2xx)).rejects.toThrow('503')

    const garbage: CapacitorHttpPlugin = {
      request: vi.fn(async ({ url }) => ({
        status: 200,
        data: url.endsWith('.ics') ? { unexpected: true } : '<main />',
        headers: {},
        url,
      })),
    }
    await expect(fetchCapacitorScheduleSources(SITE, garbage)).rejects.toThrow('non-text')
  })
})

describe('createCapacitorBufferedFetch', () => {
  it('adapts a native buffered response into the standard Response contract', async () => {
    const http: CapacitorHttpPlugin = {
      request: vi.fn(async () => ({
        status: 200,
        data: { choices: [{ message: { content: 'hello' } }] },
        headers: { 'content-type': 'application/json' },
        url: 'https://api.openai.com/v1/chat/completions',
      })),
    }

    const response = await createCapacitorBufferedFetch(http)(
      'https://api.openai.com/v1/chat/completions',
      {
        method: 'POST',
        headers: { Authorization: 'Bearer secret', 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-test' }),
      },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      choices: [{ message: { content: 'hello' } }],
    })
    expect(http.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        data: { model: 'gpt-test' },
        responseType: 'json',
        headers: expect.objectContaining({ authorization: 'Bearer secret' }),
      }),
    )
  })

  it('stops waiting for an unabortable native request when the chat session cancels', async () => {
    const http: CapacitorHttpPlugin = {
      request: vi.fn(() => new Promise<never>(() => {})),
    }
    const controller = new AbortController()
    const response = createCapacitorBufferedFetch(http)('https://api.example.test', {
      signal: controller.signal,
    })

    controller.abort(new Error('cancelled'))

    await expect(response).rejects.toThrow('cancelled')
  })
})

describe('Capacitor chat transport integration', () => {
  function session(
    streamFetch: typeof fetch,
    http: CapacitorHttpPlugin,
    runTurn: NonNullable<ChatSessionDeps['runTurn']>,
  ) {
    return createChatSession({
      keys: {
        status: async () => KEY_STATUS,
        get: async () => 'sk-test',
        set: async () => KEY_STATUS,
        clear: async () => KEY_STATUS,
      },
      getEvents: () => [],
      transport: {
        streamFetch,
        bufferedRequest: createCapacitorBufferedFetch(http),
      },
      runTurn,
    })
  }

  it('streams directly when WebKit fetch works and uses native HTTP only after an initial CORS failure', async () => {
    const streamFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('streamed'))
      .mockRejectedValueOnce(new TypeError('Load failed'))
    const http: CapacitorHttpPlugin = {
      request: vi.fn(async ({ url }) => ({
        status: 200,
        data: { content: 'buffered' },
        headers: { 'content-type': 'application/json' },
        url,
      })),
    }
    const runTurn = vi.fn<NonNullable<ChatSessionDeps['runTurn']>>(
      async ({ fetchImpl, generationMode, onDelta }): Promise<ChatResponse> => {
        const response = await fetchImpl!('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        })
        const body = await response.text()
        if (generationMode === 'stream') onDelta?.({ text: body })
        return {
          ok: true,
          turn: {
            message: { role: 'assistant', content: body },
            eventUids: [],
            toolTrace: [],
          },
        }
      },
    )
    const chat = session(streamFetch, http, runTurn)

    await expect(chat.chat(CHAT_REQUEST)).resolves.toMatchObject({
      ok: true,
      turn: { message: { content: 'streamed' } },
    })
    expect(http.request).not.toHaveBeenCalled()

    const deltas: unknown[] = []
    chat.onDelta((delta) => deltas.push(delta))
    await expect(chat.chat(CHAT_REQUEST)).resolves.toMatchObject({
      ok: true,
      turn: { message: { content: JSON.stringify({ content: 'buffered' }) } },
    })
    expect(http.request).toHaveBeenCalledOnce()
    expect(runTurn.mock.calls.at(-1)?.[0].generationMode).toBe('buffered')
    expect(deltas).toContainEqual({ status: "This provider's response won't stream." })
  })
})

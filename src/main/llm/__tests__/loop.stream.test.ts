/**
 * The default streaming path of `runChatTurn`, driven against a faked `ai`
 * module. `streamText` is scripted per test so the accumulate-and-finalize
 * behavior — deltas forwarded in order, the forced tools+toolChoice-none summary
 * on an empty final step, and the abort-after-step guard — is observable with no
 * provider, key, or network. `vi.mock('ai')` lives here rather than in loop.test
 * so that file keeps the real `tool()` its tool executes need.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runChatTurn, type ChatDeps } from '../loop'
import { EMPTY_FILTER } from '../../../shared/filter/types'
import type { ChatDelta, ChatRequest } from '../../../shared/chat'

const { streamText } = vi.hoisted(() => ({ streamText: vi.fn() }))
vi.mock('ai', () => ({
  streamText,
  stepCountIs: (n: number) => n,
  tool: (config: unknown) => config,
}))
// Keep the real provider packages out; the model handle is never used by the fake.
vi.mock('../providers', () => ({ languageModel: () => ({}), DEFAULT_MODEL: {} }))

type Part = { type: 'text-delta'; text: string } | { type: 'tool-call'; toolName: string }

/** A scripted streamText result: parts to iterate, the final step's text, and
 *  the response messages the fallback replays. */
function fakeStream(parts: Part[], finalText: string, responseMessages: unknown[] = []) {
  return {
    fullStream: (async function* () {
      for (const part of parts) yield part
    })(),
    text: Promise.resolve(finalText),
    response: Promise.resolve({ messages: responseMessages }),
  }
}

const request: ChatRequest = {
  provider: 'anthropic',
  messages: [{ role: 'user', content: 'hi' }],
  filter: EMPTY_FILTER,
  lens: 'ip',
  view: 'schedule',
  starredUids: [],
  changedUids: [],
}

function deps(over: Partial<ChatDeps> = {}): ChatDeps {
  return {
    keyStore: { get: () => 'sk-test' },
    getEvents: () => [],
    getCandidates: () => [],
    ...over,
  }
}

beforeEach(() => {
  streamText.mockReset()
})

describe('defaultGenerate streaming', () => {
  it('forwards deltas in order and returns the accumulated multi-step text', async () => {
    streamText.mockReturnValueOnce(
      fakeStream(
        [
          { type: 'text-delta', text: 'Hello ' },
          { type: 'tool-call', toolName: 'search_events' },
          { type: 'text-delta', text: 'world' },
        ],
        'world',
      ),
    )
    const deltas: ChatDelta[] = []
    const res = await runChatTurn(deps({ onDelta: (d) => deltas.push(d) }), request)

    expect(res.ok).toBe(true)
    // The accumulation spans every step, not just `first.text` (the final step).
    if (res.ok) expect(res.turn.message.content).toBe('Hello world')
    expect(deltas).toEqual([{ text: 'Hello ' }, { status: 'Searching the schedule…' }, { text: 'world' }])
  })

  it('forces a tools+toolChoice-none summary when the final step wrote no prose', async () => {
    streamText
      .mockReturnValueOnce(fakeStream([{ type: 'tool-call', toolName: 'apply_filters' }], ''))
      .mockReturnValueOnce(fakeStream([{ type: 'text-delta', text: 'Summary.' }], 'Summary.'))

    const res = await runChatTurn(deps(), request)

    expect(res.ok && res.turn.message.content).toBe('Summary.')
    expect(streamText).toHaveBeenCalledTimes(2)
    const summaryArgs = streamText.mock.calls[1]![0] as { tools?: unknown; toolChoice?: unknown }
    // The history replays tool_use/tool_result parts, so tools must ride along.
    expect(summaryArgs.tools).toBeDefined()
    expect(summaryArgs.toolChoice).toBe('none')
  })

  it('separates streamed intermediate prose from the forced summary', async () => {
    streamText
      .mockReturnValueOnce(fakeStream([{ type: 'text-delta', text: 'Looking…' }, { type: 'tool-call', toolName: 'get_event' }], ''))
      .mockReturnValueOnce(fakeStream([{ type: 'text-delta', text: 'Here it is.' }], 'Here it is.'))

    const deltas: ChatDelta[] = []
    const res = await runChatTurn(deps({ onDelta: (d) => deltas.push(d) }), request)

    expect(res.ok && res.turn.message.content).toBe('Looking…\n\nHere it is.')
    expect(deltas).toContainEqual({ text: '\n\n' })
  })

  it('returns the aborted error when the stream resolves but the signal aborted', async () => {
    streamText.mockReturnValueOnce(fakeStream([{ type: 'text-delta', text: 'Half' }], 'Half'))
    const controller = new AbortController()
    controller.abort(new Error('cancelled'))

    const res = await runChatTurn(deps({ signal: controller.signal }), request)

    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error.kind).toBe('aborted')
  })

  it('returns the timeout provider error when the abort reason is timeout', async () => {
    streamText.mockReturnValueOnce(fakeStream([{ type: 'text-delta', text: 'Half' }], 'Half'))
    const controller = new AbortController()
    controller.abort(new Error('timeout'))

    const res = await runChatTurn(deps({ signal: controller.signal }), request)

    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.error.kind).toBe('provider')
      expect(res.error.message).toMatch(/timed out/)
    }
  })

  it('skips the fallback summary call when the signal is already aborted', async () => {
    streamText.mockReturnValueOnce(fakeStream([{ type: 'tool-call', toolName: 'apply_filters' }], ''))
    const controller = new AbortController()
    controller.abort(new Error('cancelled'))

    await runChatTurn(deps({ signal: controller.signal }), request)

    // Empty final text would normally force a second call — but not while aborting.
    expect(streamText).toHaveBeenCalledTimes(1)
  })
})

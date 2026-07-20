/**
 * One user turn: resolve the key, build the tools over the current app state,
 * run the model's tool loop, and hand back the assistant text plus the effects
 * the tools captured (filter to commit, cards to render, action to confirm).
 *
 * The actual model call is injectable. The default wraps AI SDK `generateText`;
 * tests pass a fake that drives specific tool executes, so the whole
 * capture-and-assemble path is exercised without a provider or a key.
 */

import { stepCountIs, streamText, type LanguageModel, type ModelMessage } from 'ai'
import { languageModel } from './providers'
import { SYSTEM_PROMPT } from './systemPrompt'
import { buildTools, type ChatTools, type ToolContext, type TurnCapture } from './tools'
import type { FilterCandidate, MatchContext } from '../../shared/filter/types'
import type { ChatDelta, ChatError, ChatRequest, ChatResponse } from '../../shared/chat'
import type { ScheduleEvent } from '../../shared/schedule'

/** What the model is doing between tool calls, phrased for the user. Streamed as
 *  a status delta so the wait for the first token is never dead air. */
const TOOL_STATUS: Record<string, string> = {
  apply_filters: 'Filtering the schedule…',
  search_events: 'Searching the schedule…',
  list_facet_values: 'Checking the schedule…',
  get_event: 'Reading the details…',
  get_starred: 'Checking your stars…',
  set_view: 'Switching the view…',
  propose_action: 'Preparing that…',
}

/** How many tool rounds the model gets before it must answer. Enough for a
 *  real chain — search, read, then propose or filter — with headroom for a
 *  retry, while still stopping a loop that never converges. */
const MAX_STEPS = 8

export interface GenerateArgs {
  model: LanguageModel
  system: string
  messages: ModelMessage[]
  tools: ChatTools
  signal?: AbortSignal
  /** Streamed output text and between-tool status, as they happen. */
  onDelta?: (delta: ChatDelta) => void
}

export type GenerateFn = (args: GenerateArgs) => Promise<{ text: string }>

const defaultGenerate: GenerateFn = async ({ model, system, messages, tools, signal, onDelta }) => {
  const first = streamText({
    model,
    system,
    messages,
    tools,
    stopWhen: stepCountIs(MAX_STEPS),
    abortSignal: signal,
  })
  // Accumulate what actually streamed. `first.text` is only the FINAL step's
  // text; fullStream deltas span every step, so the accumulation is what the
  // user watched — returning it means finalize never rewrites the screen.
  let streamed = ''
  for await (const part of first.fullStream) {
    if (part.type === 'text-delta') {
      streamed += part.text
      onDelta?.({ text: part.text })
    } else if (part.type === 'tool-call') {
      onDelta?.({ status: TOOL_STATUS[part.toolName] ?? 'Working…' })
    }
  }

  // A written reply in the final step means the turn is complete; return the
  // accumulation (a superset of that text when earlier steps also wrote prose).
  const finalText = await first.text
  if (finalText.trim()) return { text: streamed.trim() ? streamed : finalText }

  // The model stopped on a tool call without a final written reply (step cap,
  // or it just declined to summarize). Don't burn a fallback call if the turn
  // is already being aborted — runChatTurn will surface the stop/timeout.
  if (signal?.aborted) return { text: streamed }

  // Force one final answer from everything it gathered. The history replays
  // tool_use/tool_result parts, so tools MUST be passed (with toolChoice 'none')
  // or the provider rejects the request. Streamed too, so silence never lands.
  const gathered = await first.response
  if (streamed) {
    // Intermediate prose already streamed; separate it from the summary.
    streamed += '\n\n'
    onDelta?.({ text: '\n\n' })
  }
  const summary = streamText({
    model,
    system,
    messages: [...messages, ...gathered.messages],
    tools,
    toolChoice: 'none',
    abortSignal: signal,
  })
  for await (const part of summary.fullStream) {
    if (part.type === 'text-delta') {
      streamed += part.text
      onDelta?.({ text: part.text })
    }
  }
  return { text: streamed }
}

export interface ChatDeps {
  keyStore: { get(provider: ChatRequest['provider']): string | null }
  getEvents: () => readonly ScheduleEvent[]
  getCandidates: () => readonly FilterCandidate[]
  /** Aborts the in-flight model call — the Stop button, and the timeout. */
  signal?: AbortSignal
  /** Streamed text/status forwarded to the renderer over a push channel. */
  onDelta?: (delta: ChatDelta) => void
  /** Injected in tests; production uses AI SDK streamText. */
  generate?: GenerateFn
}

function matchContextFrom(starredUids: string[], changedUids: string[]): MatchContext {
  const starred = new Set(starredUids)
  const changed = new Set(changedUids)
  return {
    isStarred: (uid) => starred.has(uid),
    hasUnseenChanges: (uid) => changed.has(uid),
  }
}

function classifyError(error: unknown): ChatError {
  const message = error instanceof Error ? error.message : String(error)
  // Provider SDKs surface auth failures as 401s; tell those apart so the tab
  // can send the user back to the key field rather than blaming the network.
  const status = (error as { statusCode?: number; status?: number })?.statusCode ??
    (error as { status?: number })?.status
  if (status === 401 || status === 403 || /\b401\b|unauthor|invalid.*api.*key|api.*key.*invalid/i.test(message)) {
    return { kind: 'auth', message: 'The API key was rejected. Check it and try again.' }
  }
  return { kind: 'provider', message }
}

/** An aborted signal is either the user's Stop or the timeout; the reason tells
 *  them apart. A stop is not an error to shout about; a timeout is. */
function abortResponse(signal: AbortSignal): ChatResponse {
  const reason = signal.reason
  const timedOut = reason instanceof Error && reason.message === 'timeout'
  return timedOut
    ? { ok: false, error: { kind: 'provider', message: 'The request timed out. Try again, or pick a faster model.' } }
    : { ok: false, error: { kind: 'aborted', message: 'Stopped.' } }
}

export async function runChatTurn(deps: ChatDeps, request: ChatRequest): Promise<ChatResponse> {
  const key = deps.keyStore.get(request.provider)
  if (!key) {
    return { ok: false, error: { kind: 'no-key', message: `No ${request.provider} API key is stored.` } }
  }

  const capture: TurnCapture = { eventUids: [], toolTrace: [] }
  const ctx: ToolContext = {
    candidates: deps.getCandidates(),
    events: deps.getEvents(),
    filter: request.filter,
    matchContext: matchContextFrom(request.starredUids, request.changedUids),
    lens: request.lens,
    view: request.view,
  }
  const tools = buildTools(ctx, capture)
  const messages: ModelMessage[] = request.messages.map((m) => ({ role: m.role, content: m.content }))

  let model: LanguageModel
  try {
    model = languageModel(request.provider, key, request.model)
  } catch (error) {
    return { ok: false, error: classifyError(error) }
  }

  const generate = deps.generate ?? defaultGenerate
  try {
    const { text } = await generate({ model, system: SYSTEM_PROMPT, messages, tools, signal: deps.signal, onDelta: deps.onDelta })
    // An abort after ≥1 completed step RESOLVES the stream rather than rejecting
    // (AI SDK v7), so a Stop or timeout can land here with a half-answer. Treat
    // an aborted signal as the failure it is, never as a complete turn.
    if (deps.signal?.aborted) return abortResponse(deps.signal)
    return {
      ok: true,
      turn: {
        // A model that ends on a tool call returns undefined text; never let
        // that reach the renderer as a literal "undefined".
        message: { role: 'assistant', content: text ?? '' },
        patch: capture.patch,
        eventUids: capture.eventUids,
        proposedAction: capture.proposedAction,
        toolTrace: capture.toolTrace,
      },
    }
  } catch (error) {
    // The abort can also reject (before any step completed); same handling.
    if (deps.signal?.aborted) return abortResponse(deps.signal)
    return { ok: false, error: classifyError(error) }
  }
}

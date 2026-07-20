/**
 * One user turn: resolve the key, build the tools over the current app state,
 * run the model's tool loop, and hand back the assistant text plus the effects
 * the tools captured (filter to commit, cards to render, action to confirm).
 *
 * The actual model call is injectable. The default wraps AI SDK `generateText`;
 * tests pass a fake that drives specific tool executes, so the whole
 * capture-and-assemble path is exercised without a provider or a key.
 */

import { generateText, stepCountIs, type LanguageModel, type ModelMessage } from 'ai'
import { languageModel } from './providers'
import { SYSTEM_PROMPT } from './systemPrompt'
import { buildTools, type ChatTools, type ToolContext, type TurnCapture } from './tools'
import type { FilterCandidate, MatchContext } from '../../shared/filter/types'
import type { ChatError, ChatRequest, ChatResponse } from '../../shared/chat'
import type { ScheduleEvent } from '../../shared/schedule'

/** A hub the model can call at most this many tool rounds before it must
 *  answer. Six covers "look up values, then filter, then read one event" with
 *  headroom, and stops a loop that never converges. */
const MAX_STEPS = 6

export interface GenerateArgs {
  model: LanguageModel
  system: string
  messages: ModelMessage[]
  tools: ChatTools
}

export type GenerateFn = (args: GenerateArgs) => Promise<{ text: string }>

const defaultGenerate: GenerateFn = async ({ model, system, messages, tools }) => {
  const { text } = await generateText({
    model,
    system,
    messages,
    tools,
    stopWhen: stepCountIs(MAX_STEPS),
  })
  return { text }
}

export interface ChatDeps {
  keyStore: { get(provider: ChatRequest['provider']): string | null }
  getEvents: () => readonly ScheduleEvent[]
  getCandidates: () => readonly FilterCandidate[]
  /** Injected in tests; production uses AI SDK generateText. */
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
    const { text } = await generate({ model, system: SYSTEM_PROMPT, messages, tools })
    return {
      ok: true,
      turn: {
        message: { role: 'assistant', content: text },
        patch: capture.patch,
        eventUids: capture.eventUids,
        proposedAction: capture.proposedAction,
        toolTrace: capture.toolTrace,
      },
    }
  } catch (error) {
    return { ok: false, error: classifyError(error) }
  }
}

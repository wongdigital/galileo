/**
 * The three providers, behind one function. Each is the same Vercel AI SDK
 * tool loop — only the model handle differs — so `runChatTurn` never branches
 * on provider once it holds a `LanguageModel`.
 *
 * Keys arrive per call from the encrypted store; nothing here reads the
 * environment. Model ids are overridable per request (the tab lets the user
 * name one); these defaults are only what a bare "just talk to Claude" gets.
 */

import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'
import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import type { LanguageModel } from 'ai'
import { DEFAULT_MODEL, type ProviderId } from '../../shared/chat'

// The overridable per-provider defaults live in the shared catalogue so main
// and the tab agree on them; re-exported here for the callers that reach for
// them through this module.
export { DEFAULT_MODEL }

export function languageModel(
  provider: ProviderId,
  apiKey: string,
  model?: string,
): LanguageModel {
  const id = model?.trim() || DEFAULT_MODEL[provider]
  switch (provider) {
    case 'anthropic':
      return createAnthropic({ apiKey })(id)
    case 'openai':
      return createOpenAI({ apiKey })(id)
    case 'openrouter':
      return createOpenRouter({ apiKey })(id)
  }
}

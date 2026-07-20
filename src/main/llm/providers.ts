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
import type { ProviderId } from '../../shared/chat'

/** Sensible, overridable defaults. Anthropic is the house provider (the
 *  enrichment pipeline already runs on it), so its default is the current
 *  fast-and-capable Claude; the others are placeholders a user replaces. */
export const DEFAULT_MODEL: Record<ProviderId, string> = {
  anthropic: 'claude-sonnet-5',
  openai: 'gpt-4.1',
  openrouter: 'anthropic/claude-sonnet-5',
}

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

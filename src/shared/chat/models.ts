/**
 * The curated model catalogue, the single source of truth for both main's
 * provider defaults and the tab's fallback dropdown. The tab uses it until a
 * provider's live /models list loads (or when it can't — no key, offline).
 * OpenRouter slugs are namespaced by their upstream provider, so they read
 * "OpenAI: GPT-5.6 Luna". The first entry per provider is that provider's
 * default.
 */

import type { ModelChoice, ProviderId } from './types'

export const MODELS: Record<ProviderId, ModelChoice[]> = {
  anthropic: [
    { id: 'claude-sonnet-5', label: 'Claude Sonnet 5' },
    { id: 'claude-opus-4-8', label: 'Claude Opus 4.8' },
    { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
  ],
  openai: [
    { id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna' },
    { id: 'gpt-5', label: 'GPT-5' },
    { id: 'gpt-4.1', label: 'GPT-4.1' },
  ],
  openrouter: [
    { id: 'anthropic/claude-sonnet-5', label: 'Anthropic: Claude Sonnet 5' },
    { id: 'anthropic/claude-opus-4.8', label: 'Anthropic: Claude Opus 4.8' },
    { id: 'openai/gpt-5.6-luna', label: 'OpenAI: GPT-5.6 Luna' },
    { id: 'google/gemini-2.5-pro', label: 'Google: Gemini 2.5 Pro' },
  ],
}

/** Each provider's default model — the first entry of its curated list. Main's
 *  tool loop falls back to this when a chat request names no model. */
export const DEFAULT_MODEL: Record<ProviderId, string> = {
  anthropic: MODELS.anthropic[0]!.id,
  openai: MODELS.openai[0]!.id,
  openrouter: MODELS.openrouter[0]!.id,
}

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
    // Dateless ids are Anthropic's rolling aliases for the newest snapshot.
    { id: 'claude-opus-4-8', label: 'Claude Opus 4.8' },
    { id: 'claude-sonnet-5', label: 'Claude Sonnet 5' },
    { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
  ],
  openai: [
    { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol' },
    { id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra' },
    { id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna' },
  ],
  openrouter: [
    // `~`-prefixed slugs are OpenRouter's rolling "latest" aliases — they
    // track the newest release so the fallback list never names a stale
    // version. Slugs verified against /api/v1/models, 2026-07-20.
    { id: '~anthropic/claude-sonnet-latest', label: 'Anthropic: Claude Sonnet Latest' },
    { id: '~anthropic/claude-opus-latest', label: 'Anthropic: Claude Opus Latest' },
    { id: 'deepseek/deepseek-v4-flash', label: 'DeepSeek: DeepSeek V4 Flash' },
    { id: 'deepseek/deepseek-v4-pro', label: 'DeepSeek: DeepSeek V4 Pro' },
    { id: '~google/gemini-flash-latest', label: 'Google Gemini Flash' },
    { id: '~google/gemini-pro-latest', label: 'Google Gemini Pro' },
    { id: '~openai/gpt-latest', label: 'OpenAI GPT Latest' },
    { id: '~openai/gpt-mini-latest', label: 'OpenAI GPT Mini Latest' },
  ],
}

/** Each provider's default model — the first entry of its curated list. Main's
 *  tool loop falls back to this when a chat request names no model. */
export const DEFAULT_MODEL: Record<ProviderId, string> = {
  anthropic: MODELS.anthropic[0]!.id,
  openai: MODELS.openai[0]!.id,
  openrouter: MODELS.openrouter[0]!.id,
}

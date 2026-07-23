/**
 * Live model discovery, so the picker offers what a provider actually serves
 * today rather than a list baked in at build time.
 *
 * Who needs a key:
 * - OpenRouter publishes its catalogue at a public endpoint — no key.
 * - Anthropic and OpenAI gate `/v1/models` behind the key, so their lists only
 *   appear once the user has stored one.
 *
 * A failure — no key, offline, a 500 — returns an empty list rather than
 * throwing; the renderer falls back to its curated defaults, which always
 * include a Custom escape hatch. `fetch` is injectable for tests.
 */

import type { ModelChoice, ProviderId } from '../chat'
import { isCorsLikeError, type ChatTransport } from './transport'

interface FetchResponse {
  ok: boolean
  status: number
  json(): Promise<unknown>
}
type FetchLike = (url: string, init?: { headers?: Record<string, string> }) => Promise<FetchResponse>

function asArray(body: unknown): Record<string, unknown>[] {
  const data = (body as { data?: unknown } | null)?.data
  return Array.isArray(data) ? (data as Record<string, unknown>[]) : []
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null
}

/** Anthropic returns display_name and id, newest first — keep that order. */
function normalizeAnthropic(body: unknown): ModelChoice[] {
  return asArray(body)
    .map((m) => {
      const id = str(m.id)
      return id ? { id, label: str(m.display_name) ?? id } : null
    })
    .filter((c): c is ModelChoice => c !== null)
}

/** OpenAI's list is everything the key can touch — embeddings, TTS, moderation.
 *  Keep only the chat-capable families, newest first by created timestamp. */
function normalizeOpenAI(body: unknown): ModelChoice[] {
  return asArray(body)
    .filter((m) => {
      const id = str(m.id)
      return id !== null && /^(gpt|o\d|chatgpt)/i.test(id)
    })
    .sort((a, b) => Number(b.created ?? 0) - Number(a.created ?? 0))
    .map((m) => {
      const id = str(m.id)!
      return { id, label: id }
    })
}

/** OpenRouter already names models "OpenAI: GPT-5.6 Luna"; sort alphabetically
 *  so the long catalogue is scannable. */
function normalizeOpenRouter(body: unknown): ModelChoice[] {
  return asArray(body)
    .map((m) => {
      const id = str(m.id)
      return id ? { id, label: str(m.name) ?? id } : null
    })
    .filter((c): c is ModelChoice => c !== null)
    .sort((a, b) => a.label.localeCompare(b.label))
}

export async function listModels(
  provider: ProviderId,
  apiKey: string | undefined,
  transport: FetchLike | ChatTransport,
): Promise<ModelChoice[]> {
  const primary = typeof transport === 'function' ? transport : (transport.streamFetch as unknown as FetchLike)
  const fallback = typeof transport === 'function' ? null : (transport.bufferedRequest as unknown as FetchLike)
  const load = async (fetchImpl: FetchLike): Promise<ModelChoice[]> => {
    // Exhaustive over ProviderId with no default, so a new provider fails to
    // compile here instead of silently falling through to an OpenAI query.
    switch (provider) {
      case 'openrouter': {
        const res = await fetchImpl('https://openrouter.ai/api/v1/models')
        return res.ok ? normalizeOpenRouter(await res.json()) : []
      }
      case 'anthropic': {
        if (!apiKey) return []
        const res = await fetchImpl('https://api.anthropic.com/v1/models?limit=100', {
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true',
          },
        })
        return res.ok ? normalizeAnthropic(await res.json()) : []
      }
      case 'openai': {
        if (!apiKey) return []
        const res = await fetchImpl('https://api.openai.com/v1/models', {
          headers: { Authorization: `Bearer ${apiKey}` },
        })
        return res.ok ? normalizeOpenAI(await res.json()) : []
      }
    }
  }
  try {
    return await load(primary)
  } catch (error) {
    if (fallback && fallback !== primary && isCorsLikeError(error)) {
      try {
        return await load(fallback)
      } catch {
        return []
      }
    }
    // Offline or a malformed body: defer to the renderer's curated fallback.
    return []
  }
}

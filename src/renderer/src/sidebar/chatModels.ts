/**
 * The Chat tab's model plumbing: the shared catalogue re-exported for the
 * fallback dropdown, the provider display labels, the localStorage helpers that
 * remember which model the user last picked, and the accessor for the llm IPC
 * bridge. The catalogue and per-provider defaults are the shared module's — the
 * renderer only adds its own concerns here.
 */

import { MODELS, PROVIDERS, type ProviderId } from '@shared/chat'

export { MODELS }

const PROVIDER_LABEL: Record<ProviderId, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  openrouter: 'OpenRouter',
}

export { PROVIDER_LABEL }

const MODEL_STORE_KEY = 'sdcc.chat.models'

export function defaultModels(): Record<ProviderId, string> {
  return { anthropic: MODELS.anthropic[0]!.id, openai: MODELS.openai[0]!.id, openrouter: MODELS.openrouter[0]!.id }
}

export function loadModels(): Record<ProviderId, string> {
  const base = defaultModels()
  try {
    const raw = JSON.parse(localStorage.getItem(MODEL_STORE_KEY) ?? '{}') as Partial<Record<ProviderId, string>>
    for (const provider of PROVIDERS) {
      if (typeof raw[provider] === 'string' && raw[provider]) base[provider] = raw[provider] as string
    }
  } catch {
    // No stored preference yet, or corrupt — the defaults stand.
  }
  return base
}

export function saveModels(models: Record<ProviderId, string>): void {
  try {
    localStorage.setItem(MODEL_STORE_KEY, JSON.stringify(models))
  } catch {
    // A private-mode localStorage that rejects writes is not worth failing over;
    // the choice just will not survive a restart.
  }
}

export const bridge = () =>
  typeof window !== 'undefined' && window.api?.llm ? window.api.llm : null

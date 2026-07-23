/**
 * The Chat tab's model plumbing: the shared catalogue re-exported for the
 * fallback dropdown, the provider display labels, and the durable settings
 * helpers that remember which model the user last picked. The catalogue and
 * per-provider defaults are the shared module's — the renderer only adds its
 * own concerns here.
 */

import { DEFAULT_MODEL, MODELS, PROVIDERS, type ProviderId } from '@shared/chat'
import { bridge } from '../bridge'

export { MODELS }

const PROVIDER_LABEL: Record<ProviderId, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  openrouter: 'OpenRouter',
}

export { PROVIDER_LABEL }

const MODEL_SETTING = 'chat.models'
const LEGACY_MODEL_STORE_KEY = 'galileo.chat.models'

export function defaultModels(): Record<ProviderId, string> {
  return { ...DEFAULT_MODEL }
}

export async function loadModels(): Promise<Record<ProviderId, string>> {
  const base = defaultModels()
  try {
    const api = bridge()
    const stored = await api?.settings.get(MODEL_SETTING)
    if (stored === null) {
      const legacy = loadLegacyModels(base)
      if (!legacy) return base
      try {
        await api?.settings.set(MODEL_SETTING, legacy)
        localStorage.removeItem(LEGACY_MODEL_STORE_KEY)
      } catch {
        // Keep the legacy value so a later launch can retry the migration.
      }
      return legacy
    }
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return base
    const raw = stored as Partial<Record<ProviderId, unknown>>
    for (const provider of PROVIDERS) {
      if (typeof raw[provider] === 'string' && raw[provider]) base[provider] = raw[provider]
    }
  } catch {
    // No stored preference yet, or corrupt — the defaults stand.
  }
  return base
}

function loadLegacyModels(defaults: Record<ProviderId, string>): Record<ProviderId, string> | null {
  try {
    const serialized = localStorage.getItem(LEGACY_MODEL_STORE_KEY)
    if (serialized === null) return null
    const raw = JSON.parse(serialized) as Partial<Record<ProviderId, unknown>>
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
    const models = { ...defaults }
    for (const provider of PROVIDERS) {
      if (typeof raw[provider] === 'string' && raw[provider]) models[provider] = raw[provider]
    }
    return models
  } catch {
    return null
  }
}

export async function saveModels(models: Record<ProviderId, string>): Promise<void> {
  try {
    await bridge()?.settings.set(MODEL_SETTING, models)
  } catch {
    // A temporarily unavailable settings adapter is not worth failing over;
    // the choice remains active for this session.
  }
}

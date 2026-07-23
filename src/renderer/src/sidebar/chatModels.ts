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

export function defaultModels(): Record<ProviderId, string> {
  return { ...DEFAULT_MODEL }
}

export async function loadModels(): Promise<Record<ProviderId, string>> {
  const base = defaultModels()
  try {
    const stored = await bridge()?.settings.get(MODEL_SETTING)
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

export async function saveModels(models: Record<ProviderId, string>): Promise<void> {
  try {
    await bridge()?.settings.set(MODEL_SETTING, models)
  } catch {
    // A temporarily unavailable settings adapter is not worth failing over;
    // the choice remains active for this session.
  }
}

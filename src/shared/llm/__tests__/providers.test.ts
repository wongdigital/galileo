import { beforeEach, describe, expect, it, vi } from 'vitest'

const factories = vi.hoisted(() => ({
  anthropic: vi.fn(),
  openai: vi.fn(),
  openrouter: vi.fn(),
}))

vi.mock('@ai-sdk/anthropic', () => ({ createAnthropic: factories.anthropic }))
vi.mock('@ai-sdk/openai', () => ({ createOpenAI: factories.openai }))
vi.mock('@openrouter/ai-sdk-provider', () => ({ createOpenRouter: factories.openrouter }))

import { languageModel } from '../providers'

beforeEach(() => {
  for (const factory of Object.values(factories)) {
    factory.mockReset()
    factory.mockReturnValue(() => ({}))
  }
})

describe('languageModel', () => {
  it('injects fetch and the Anthropic browser-access header', () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch
    languageModel('anthropic', 'sk-ant', 'claude-test', fetchImpl)
    expect(factories.anthropic).toHaveBeenCalledWith({
      apiKey: 'sk-ant',
      fetch: fetchImpl,
      headers: { 'anthropic-dangerous-direct-browser-access': 'true' },
    })
  })

  it('injects the selected transport into OpenAI and OpenRouter clients', () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch
    languageModel('openai', 'sk-openai', undefined, fetchImpl)
    languageModel('openrouter', 'sk-router', undefined, fetchImpl)
    expect(factories.openai).toHaveBeenCalledWith({ apiKey: 'sk-openai', fetch: fetchImpl })
    expect(factories.openrouter).toHaveBeenCalledWith({ apiKey: 'sk-router', fetch: fetchImpl })
  })
})

import { describe, expect, it, vi } from 'vitest'
import { listModels } from '../models'

function ok(body: unknown) {
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) })
}

describe('listModels', () => {
  it('lists OpenRouter without a key, using its namespaced names', async () => {
    const fetchImpl = vi.fn(() =>
      ok({ data: [{ id: 'openai/gpt-5.6-luna', name: 'OpenAI: GPT-5.6 Luna' }, { id: 'anthropic/claude-sonnet-5', name: 'Anthropic: Claude Sonnet 5' }] }),
    )
    const models = await listModels('openrouter', undefined, fetchImpl as never)
    // Sorted alphabetically by label.
    expect(models).toEqual([
      { id: 'anthropic/claude-sonnet-5', label: 'Anthropic: Claude Sonnet 5' },
      { id: 'openai/gpt-5.6-luna', label: 'OpenAI: GPT-5.6 Luna' },
    ])
    expect(fetchImpl).toHaveBeenCalledWith('https://openrouter.ai/api/v1/models')
  })

  it('returns nothing for Anthropic or OpenAI without a key, and never calls out', async () => {
    const fetchImpl = vi.fn()
    expect(await listModels('anthropic', undefined, fetchImpl as never)).toEqual([])
    expect(await listModels('openai', undefined, fetchImpl as never)).toEqual([])
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('normalizes Anthropic display names and passes the key header', async () => {
    const fetchImpl = vi.fn(() =>
      ok({ data: [{ type: 'model', id: 'claude-sonnet-5', display_name: 'Claude Sonnet 5' }] }),
    )
    const models = await listModels('anthropic', 'sk-ant', fetchImpl as never)
    expect(models).toEqual([{ id: 'claude-sonnet-5', label: 'Claude Sonnet 5' }])
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.anthropic.com/v1/models?limit=100',
      expect.objectContaining({ headers: expect.objectContaining({ 'x-api-key': 'sk-ant' }) }),
    )
  })

  it('filters OpenAI to chat families, newest first', async () => {
    const fetchImpl = vi.fn(() =>
      ok({
        data: [
          { id: 'text-embedding-3-large', created: 100 },
          { id: 'gpt-4.1', created: 200 },
          { id: 'gpt-5', created: 300 },
          { id: 'whisper-1', created: 400 },
        ],
      }),
    )
    const models = await listModels('openai', 'sk-oai', fetchImpl as never)
    expect(models.map((m) => m.id)).toEqual(['gpt-5', 'gpt-4.1'])
  })

  it('returns an empty list on a non-ok response instead of throwing', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve({ ok: false, status: 401, json: () => Promise.resolve({}) }))
    expect(await listModels('anthropic', 'bad-key', fetchImpl as never)).toEqual([])
  })

  it('swallows a network error into an empty list', async () => {
    const fetchImpl = vi.fn(() => Promise.reject(new Error('offline')))
    expect(await listModels('openrouter', undefined, fetchImpl as never)).toEqual([])
  })
})

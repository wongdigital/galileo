// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { clearFakeBridge, installFakeBridge, type FakePlatformBridge } from '../../test/fakeBridge'
import { defaultModels, loadModels, saveModels } from '../chatModels'

let api: FakePlatformBridge

beforeEach(() => {
  localStorage.clear()
  api = installFakeBridge()
})

afterEach(() => {
  clearFakeBridge()
})

describe('durable chat model preferences', () => {
  it('restores valid provider choices and defaults invalid fields', async () => {
    api.settings.get.mockResolvedValue({
      anthropic: 'claude-test',
      openai: '',
      openrouter: 42,
    })

    await expect(loadModels()).resolves.toEqual({
      ...defaultModels(),
      anthropic: 'claude-test',
    })
    expect(api.settings.get).toHaveBeenCalledWith('chat.models')
  })

  it('treats a corrupt setting as absent', async () => {
    api.settings.get.mockResolvedValue(['not', 'a', 'model map'])
    await expect(loadModels()).resolves.toEqual(defaultModels())
  })

  it('writes the complete provider map through platform settings', async () => {
    const models = { ...defaultModels(), openai: 'gpt-test' }
    await saveModels(models)
    expect(api.settings.set).toHaveBeenCalledWith('chat.models', models)
  })
})

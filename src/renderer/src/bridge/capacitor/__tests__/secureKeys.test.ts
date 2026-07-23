import { describe, expect, it, vi } from 'vitest'

import { createSecureKeyStore, type SecureStoragePlugin } from '../secureKeys'

function fakeStorage(): SecureStoragePlugin & { values: Map<string, unknown> } {
  const values = new Map<string, unknown>()
  return {
    values,
    setSynchronize: vi.fn(async () => {}),
    setDefaultKeychainAccess: vi.fn(async () => {}),
    get: vi.fn(async (key) => values.get(key) ?? null),
    set: vi.fn(async (key, value) => {
      values.set(key, value)
    }),
    remove: vi.fn(async (key) => values.delete(key)),
  }
}

describe('createSecureKeyStore', () => {
  it('configures local-only synchronization and after-first-unlock accessibility', async () => {
    const storage = fakeStorage()
    const keys = createSecureKeyStore(storage)

    await keys.status()

    expect(storage.setSynchronize).toHaveBeenCalledWith(false)
    expect(storage.setDefaultKeychainAccess).toHaveBeenCalledWith(2)
  })

  it('keeps absent, unreadable, and present states distinct', async () => {
    const storage = fakeStorage()
    storage.values.set('galileo.llm.openai', 'sk-present')
    vi.mocked(storage.get).mockImplementation(async (key) => {
      if (key === 'galileo.llm.anthropic') throw new Error('interaction not allowed')
      return storage.values.get(key) ?? null
    })
    const keys = createSecureKeyStore(storage)

    await expect(keys.status()).resolves.toEqual({
      anthropic: 'unreadable',
      openai: 'present',
      openrouter: 'absent',
    })
    await expect(keys.get('anthropic')).rejects.toThrow('interaction not allowed')
    await expect(keys.get('openai')).resolves.toBe('sk-present')
  })

  it('trims writes, deletes empty writes, and never falls back to plaintext memory', async () => {
    const storage = fakeStorage()
    const keys = createSecureKeyStore(storage)

    await keys.set('anthropic', '  sk-saved  ')
    expect(storage.set).toHaveBeenCalledWith('galileo.llm.anthropic', 'sk-saved')

    vi.mocked(storage.set).mockRejectedValueOnce(new Error('keychain unavailable'))
    await expect(keys.set('openai', 'sk-never-memory')).rejects.toThrow('keychain unavailable')
    expect(storage.values.has('galileo.llm.openai')).toBe(false)

    await keys.set('anthropic', '   ')
    expect(storage.remove).toHaveBeenCalledWith('galileo.llm.anthropic')
  })
})

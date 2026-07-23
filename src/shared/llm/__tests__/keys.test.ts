import { describe, expect, it } from 'vitest'
import { base64ToBytes, bytesToBase64, type KeyStore } from '../keys'

describe('shared key seam', () => {
  it('round-trips arbitrary bytes without Node Buffer', () => {
    const bytes = new Uint8Array([0, 1, 2, 127, 128, 254, 255])
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes)
  })

  it('supports the three provider states asynchronously', async () => {
    const store: KeyStore = {
      status: async () => ({ anthropic: 'absent', openai: 'unreadable', openrouter: 'present' }),
      get: async () => null,
      set: async () => ({ anthropic: 'present', openai: 'unreadable', openrouter: 'present' }),
      clear: async () => ({ anthropic: 'absent', openai: 'unreadable', openrouter: 'present' }),
    }
    expect((await store.status()).openai).toBe('unreadable')
    expect((await store.set('anthropic', 'secret')).anthropic).toBe('present')
  })
})

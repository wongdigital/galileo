import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { KeyStore, type SafeStorage } from '../keyStore'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/** A stand-in for electron.safeStorage: a reversible prefix so a round-trip is
 * observable, and a decrypt that throws on anything it did not write. */
const workingSafe: SafeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (plain) => Buffer.from(encoder.encode(`enc:${plain}`)),
  decryptString: (bytes) => {
    const value = decoder.decode(bytes)
    if (!value.startsWith('enc:')) throw new Error('cannot decrypt')
    return value.slice(4)
  },
}

let base: string

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'galileo-keys-'))
})

afterEach(() => {
  rmSync(base, { recursive: true, force: true })
})

describe('KeyStore', () => {
  it('stores a key encrypted and reads it back', async () => {
    const store = new KeyStore(base, workingSafe)
    await store.set('anthropic', 'sk-ant-123')
    await expect(store.get('anthropic')).resolves.toBe('sk-ant-123')
  })

  it('reports absent, unreadable, and present without exposing key values', async () => {
    const store = new KeyStore(base, workingSafe)
    await store.set('anthropic', 'sk-ant-123')
    await expect(store.status()).resolves.toEqual({
      anthropic: 'present',
      openai: 'absent',
      openrouter: 'absent',
    })
  })

  it('trims whitespace before storing', async () => {
    const store = new KeyStore(base, workingSafe)
    await store.set('openai', '  sk-oai-xyz  ')
    await expect(store.get('openai')).resolves.toBe('sk-oai-xyz')
  })

  it('an empty key deletes the stored one', async () => {
    const store = new KeyStore(base, workingSafe)
    await store.set('anthropic', 'sk-ant-123')
    await store.set('anthropic', '   ')
    await expect(store.get('anthropic')).resolves.toBeNull()
    expect((await store.status()).anthropic).toBe('absent')
  })

  it('clear removes only the named provider', async () => {
    const store = new KeyStore(base, workingSafe)
    await store.set('anthropic', 'a')
    await store.set('openai', 'b')
    await store.clear('anthropic')
    await expect(store.status()).resolves.toEqual({
      anthropic: 'absent',
      openai: 'present',
      openrouter: 'absent',
    })
  })

  it('persists across instances over the same directory', async () => {
    await new KeyStore(base, workingSafe).set('openrouter', 'or-key')
    await expect(new KeyStore(base, workingSafe).get('openrouter')).resolves.toBe('or-key')
  })

  it('maps ciphertext sealed under another Electron credential to absent', async () => {
    await new KeyStore(base, workingSafe).set('anthropic', 'sk-ant-123')
    const foreignSafe: SafeStorage = {
      ...workingSafe,
      decryptString: () => {
        throw new Error('sealed elsewhere')
      },
    }
    const store = new KeyStore(base, foreignSafe)
    await expect(store.get('anthropic')).resolves.toBeNull()
    expect((await store.status()).anthropic).toBe('absent')
  })

  it('refuses to store in plaintext when encryption is unavailable', async () => {
    const noCrypto: SafeStorage = { ...workingSafe, isEncryptionAvailable: () => false }
    const store = new KeyStore(base, noCrypto)
    await expect(store.set('anthropic', 'sk-ant-123')).rejects.toThrow(/keychain/i)
    expect((await store.status()).anthropic).toBe('absent')
  })

  it('returns absent status when nothing is stored', async () => {
    const store = new KeyStore(base, workingSafe)
    await expect(store.status()).resolves.toEqual({
      anthropic: 'absent',
      openai: 'absent',
      openrouter: 'absent',
    })
    await expect(store.get('anthropic')).resolves.toBeNull()
  })
})

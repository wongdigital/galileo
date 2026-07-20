import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { KeyStore, type SafeStorage } from '../keyStore'

/** A stand-in for electron.safeStorage: a reversible prefix so a round-trip is
 *  observable, and a decrypt that throws on anything it did not write — the
 *  "sealed under another credential" case. */
const workingSafe: SafeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (plain) => Buffer.from(`enc:${plain}`, 'utf8'),
  decryptString: (buf) => {
    const s = buf.toString('utf8')
    if (!s.startsWith('enc:')) throw new Error('cannot decrypt')
    return s.slice(4)
  },
}

let base: string

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'sdcc-keys-'))
})

afterEach(() => {
  rmSync(base, { recursive: true, force: true })
})

describe('KeyStore', () => {
  it('stores a key encrypted and reads it back', () => {
    const store = new KeyStore(base, workingSafe)
    store.set('anthropic', 'sk-ant-123')
    expect(store.get('anthropic')).toBe('sk-ant-123')
  })

  it('reports status without exposing the key', () => {
    const store = new KeyStore(base, workingSafe)
    store.set('anthropic', 'sk-ant-123')
    expect(store.status()).toEqual({ anthropic: true, openai: false, openrouter: false })
  })

  it('trims whitespace before storing', () => {
    const store = new KeyStore(base, workingSafe)
    store.set('openai', '  sk-oai-xyz  ')
    expect(store.get('openai')).toBe('sk-oai-xyz')
  })

  it('an empty key deletes the stored one', () => {
    const store = new KeyStore(base, workingSafe)
    store.set('anthropic', 'sk-ant-123')
    store.set('anthropic', '   ')
    expect(store.get('anthropic')).toBeNull()
    expect(store.status().anthropic).toBe(false)
  })

  it('clear removes only the named provider', () => {
    const store = new KeyStore(base, workingSafe)
    store.set('anthropic', 'a')
    store.set('openai', 'b')
    store.clear('anthropic')
    expect(store.status()).toEqual({ anthropic: false, openai: true, openrouter: false })
  })

  it('persists across instances over the same directory', () => {
    new KeyStore(base, workingSafe).set('openrouter', 'or-key')
    expect(new KeyStore(base, workingSafe).get('openrouter')).toBe('or-key')
  })

  it('reads a key sealed under another credential as absent, not a throw', () => {
    new KeyStore(base, workingSafe).set('anthropic', 'sk-ant-123')
    const foreignSafe: SafeStorage = {
      ...workingSafe,
      decryptString: () => {
        throw new Error('sealed elsewhere')
      },
    }
    const store = new KeyStore(base, foreignSafe)
    expect(store.get('anthropic')).toBeNull()
  })

  it('refuses to store in plaintext when encryption is unavailable', () => {
    const noCrypto: SafeStorage = { ...workingSafe, isEncryptionAvailable: () => false }
    const store = new KeyStore(base, noCrypto)
    expect(() => store.set('anthropic', 'sk-ant-123')).toThrow(/keychain/i)
    expect(store.status().anthropic).toBe(false)
  })

  it('returns empty status when nothing is stored', () => {
    const store = new KeyStore(base, workingSafe)
    expect(store.status()).toEqual({ anthropic: false, openai: false, openrouter: false })
    expect(store.get('anthropic')).toBeNull()
  })
})

/**
 * Encrypted storage for the users's provider API keys, under Electron's
 * userData directory.
 *
 * The key never crosses the bridge to the renderer — it is written here by
 * main from a `llm:key:set` payload, decrypted here when a chat call needs it,
 * and the renderer only ever learns *whether* a key exists (`status`), never
 * its value. That is the whole security posture of the chat tab: the sandboxed
 * renderer cannot leak what it never holds.
 *
 * `safeStorage` is injected rather than imported so the store is testable
 * without an Electron runtime — the real one throws off-app, and a top-level
 * `electron` import would make this module unloadable under vitest, the same
 * constraint icsExport works around.
 */

import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PROVIDERS, type KeyStatus, type ProviderId } from '../../shared/chat'

const FILE_NAME = 'llm-keys.json'

/** The subset of `electron.safeStorage` this needs. */
export interface SafeStorage {
  isEncryptionAvailable(): boolean
  encryptString(plainText: string): Buffer
  decryptString(encrypted: Buffer): string
}

/** Per-provider base64 ciphertext. Absent provider = no key. */
interface KeyFile {
  keys: Partial<Record<ProviderId, string>>
}

export class KeyStore {
  private readonly dir: string
  private readonly crypto: SafeStorage

  constructor(baseDir: string, crypto: SafeStorage) {
    this.dir = join(baseDir, 'schedule')
    this.crypto = crypto
    mkdirSync(this.dir, { recursive: true })
  }

  /** Which providers have a stored key — the only key fact the renderer sees. */
  status(): KeyStatus {
    const file = this.readFile()
    const status = {} as KeyStatus
    for (const provider of PROVIDERS) status[provider] = typeof file.keys[provider] === 'string'
    return status
  }

  /** Decrypt on demand. Returns null when absent, and also when decryption
   *  fails — a key sealed under a different OS credential (the app was copied to
   *  another machine) reads as "no key" so the tab prompts for a fresh one
   *  rather than throwing on every message. */
  get(provider: ProviderId): string | null {
    const encrypted = this.readFile().keys[provider]
    if (!encrypted) return null
    try {
      return this.crypto.decryptString(Buffer.from(encrypted, 'base64'))
    } catch {
      return null
    }
  }

  /** Store (or, with an empty string, delete) a provider's key. Throws only
   *  when the OS keychain is unavailable — storing a key in plaintext is not an
   *  acceptable fallback, so the caller surfaces the failure instead. */
  set(provider: ProviderId, key: string): KeyStatus {
    const trimmed = key.trim()
    const file = this.readFile()
    if (!trimmed) {
      delete file.keys[provider]
    } else {
      if (!this.crypto.isEncryptionAvailable()) {
        throw new Error('OS keychain is unavailable, so the API key cannot be stored securely.')
      }
      file.keys[provider] = this.crypto.encryptString(trimmed).toString('base64')
    }
    this.writeFile(file)
    return this.status()
  }

  clear(provider: ProviderId): KeyStatus {
    const file = this.readFile()
    delete file.keys[provider]
    this.writeFile(file)
    return this.status()
  }

  private readFile(): KeyFile {
    try {
      const raw = JSON.parse(readFileSync(join(this.dir, FILE_NAME), 'utf8')) as Partial<KeyFile>
      return { keys: raw.keys ?? {} }
    } catch {
      // Absent and corrupt read the same: no keys yet.
      return { keys: {} }
    }
  }

  private writeFile(file: KeyFile): void {
    const target = join(this.dir, FILE_NAME)
    const temp = `${target}.${process.pid}.tmp`
    try {
      writeFileSync(temp, JSON.stringify(file), 'utf8')
      renameSync(temp, target)
    } catch (error) {
      try {
        unlinkSync(temp)
      } catch {
        // Best effort; the failed write is the error worth reporting.
      }
      throw error
    }
  }
}

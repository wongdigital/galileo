import { PROVIDERS, type KeyStatus, type ProviderId } from '@shared/chat'
import type { KeyStore } from '@shared/llm'

export interface SecureStoragePlugin {
  setSynchronize(sync: boolean): Promise<void>
  setDefaultKeychainAccess(access: number): Promise<void>
  get(key: string): Promise<unknown | null>
  set(key: string, value: string): Promise<void>
  remove(key: string): Promise<boolean>
}

const PREFIX = 'galileo.llm.'
const AFTER_FIRST_UNLOCK = 2

/** Keychain adapter whose errors remain distinct from genuinely missing keys. */
export function createSecureKeyStore(
  storage: SecureStoragePlugin,
  afterFirstUnlock = AFTER_FIRST_UNLOCK,
): KeyStore {
  let initialization: Promise<void> | undefined
  const init = (): Promise<void> => {
    initialization ??= Promise.all([
      storage.setSynchronize(false),
      storage.setDefaultKeychainAccess(afterFirstUnlock),
    ]).then(() => {})
    return initialization
  }

  const keyName = (provider: ProviderId): string => `${PREFIX}${provider}`
  const status = async (): Promise<KeyStatus> => {
    try {
      await init()
    } catch {
      return Object.fromEntries(PROVIDERS.map((provider) => [provider, 'unreadable'])) as KeyStatus
    }

    const rows = await Promise.all(
      PROVIDERS.map(async (provider) => {
        try {
          const value = await storage.get(keyName(provider))
          return [provider, value === null ? 'absent' : 'present'] as const
        } catch {
          return [provider, 'unreadable'] as const
        }
      }),
    )
    return Object.fromEntries(rows) as KeyStatus
  }

  return {
    status,

    async get(provider) {
      await init()
      const value = await storage.get(keyName(provider))
      if (value === null) return null
      if (typeof value !== 'string') {
        throw new Error(`Stored ${provider} API key is unreadable.`)
      }
      return value
    },

    async set(provider, value) {
      await init()
      const trimmed = value.trim()
      if (trimmed) await storage.set(keyName(provider), trimmed)
      else await storage.remove(keyName(provider))
      return status()
    },

    async clear(provider) {
      await init()
      await storage.remove(keyName(provider))
      return status()
    },
  }
}

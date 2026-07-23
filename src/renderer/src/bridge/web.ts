import type { PlatformBridge } from '@shared/bridge/types'
import { PROVIDERS, type KeyStatus, type ProviderId } from '@shared/chat'
import { exportIcs, type IcsExportDeps } from '@shared/ics'
import { createChatSession, type ChatFetch, type ChatTransport, type KeyStore } from '@shared/llm'
import {
  acknowledgeChanges,
  performRefresh,
  type ScheduleEvent,
  type ScheduleSources,
} from '@shared/schedule'
import type { JsonStore } from '@shared/storage/jsonStore'
import { SettingsSlots, SnapshotSlots, StarSlots } from '@shared/storage/slots'

const DEFAULT_SITE = 'https://comiccon2026.sched.com'
const DEFAULT_TIMEOUT_MS = 15_000
const STORAGE_PREFIX = 'galileo:'

interface BrowserStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

class MemoryStorage implements BrowserStorage {
  private readonly values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }

  removeItem(key: string): void {
    this.values.delete(key)
  }
}

/** Browser-local JsonStore used by the development build. localStorage is a
 * cache here, never an authoritative mobile persistence choice. */
export class BrowserJsonStore implements JsonStore {
  private readonly writes = new Map<string, Promise<void>>()

  constructor(private readonly storage: BrowserStorage = availableStorage()) {}

  async read(name: string): Promise<unknown | null> {
    validateArtifactName(name)
    await (this.writes.get(name) ?? Promise.resolve()).catch(() => {})
    const target = parse(this.storage.getItem(key(name)))
    if (target.ok) {
      this.storage.removeItem(tempKey(name))
      return target.value
    }

    const temp = parse(this.storage.getItem(tempKey(name)))
    if (!temp.ok) {
      this.storage.removeItem(tempKey(name))
      return null
    }
    this.storage.setItem(key(name), JSON.stringify(temp.value))
    this.storage.removeItem(tempKey(name))
    return temp.value
  }

  replace(name: string, value: unknown): Promise<void> {
    validateArtifactName(name)
    let bytes: string
    try {
      bytes = stringify(value)
    } catch (error) {
      return Promise.reject(error)
    }
    const previous = this.writes.get(name) ?? Promise.resolve()
    const operation = previous.catch(() => {}).then(() => {
      this.storage.setItem(tempKey(name), bytes)
      this.storage.setItem(key(name), bytes)
      this.storage.removeItem(tempKey(name))
    })
    this.writes.set(name, operation)
    void operation.finally(() => {
      if (this.writes.get(name) === operation) this.writes.delete(name)
    }).catch(() => {})
    return operation
  }
}

class EphemeralKeyStore implements KeyStore {
  private readonly keys = new Map<ProviderId, string>()

  async status(): Promise<KeyStatus> {
    return Object.fromEntries(
      PROVIDERS.map((provider) => [provider, this.keys.has(provider) ? 'present' : 'absent']),
    ) as KeyStatus
  }

  async get(provider: ProviderId): Promise<string | null> {
    return this.keys.get(provider) ?? null
  }

  async set(provider: ProviderId, keyValue: string): Promise<KeyStatus> {
    const trimmed = keyValue.trim()
    if (trimmed) this.keys.set(provider, trimmed)
    else this.keys.delete(provider)
    return this.status()
  }

  async clear(provider: ProviderId): Promise<KeyStatus> {
    this.keys.delete(provider)
    return this.status()
  }
}

export interface WebFetchOptions {
  timeoutMs?: number
  signal?: AbortSignal
}

/** Plain browser fetch deliberately sends no User-Agent: browsers forbid that
 * header. Both endpoints start together and share one cancellation deadline. */
export async function fetchWebScheduleSources(
  site: string,
  fetchImpl: ChatFetch = fetch,
  options: WebFetchOptions = {},
): Promise<ScheduleSources> {
  const controller = new AbortController()
  const timeout = setTimeout(
    () => controller.abort(new Error('Schedule request timed out.')),
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  )
  const relayAbort = (): void => controller.abort(options.signal?.reason)
  if (options.signal?.aborted) relayAbort()
  else options.signal?.addEventListener('abort', relayAbort, { once: true })

  const base = site.replace(/\/$/, '')
  const get = async (path: string): Promise<string> => {
    const response = await fetchImpl(`${base}${path}`, { signal: controller.signal })
    if (!response.ok) throw new Error(`GET ${path} -> ${response.status}`)
    return response.text()
  }

  try {
    const [ics, listHtml] = await Promise.all([get('/all.ics'), get('/list/descriptions')])
    return { ics, listHtml }
  } finally {
    clearTimeout(timeout)
    options.signal?.removeEventListener('abort', relayAbort)
  }
}

interface ObjectUrls {
  createObjectURL(value: Blob): string
  revokeObjectURL(url: string): void
}

/** Browser delivery adapter: a same-document Blob download, with no server or
 * filesystem bridge involved. */
export function createBrowserDeliver(urls: ObjectUrls = URL): IcsExportDeps['deliver'] {
  return async (defaultName, contents) => {
    const blob = new Blob([contents], { type: 'text/calendar;charset=utf-8' })
    const url = urls.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = defaultName
    anchor.hidden = true
    document.body.append(anchor)
    try {
      anchor.click()
    } finally {
      anchor.remove()
      urls.revokeObjectURL(url)
    }
    return defaultName
  }
}

export interface WebBridgeOptions {
  site?: string
  store?: JsonStore
  fetchImpl?: ChatFetch
  transport?: ChatTransport
  keys?: KeyStore
  deliver?: IcsExportDeps['deliver']
  version?: string
  timeoutMs?: number
}

/** Compose the same renderer contract as Electron entirely from portable
 * shared cores and browser-owned adapters. */
export function createWebBridge(options: WebBridgeOptions = {}): PlatformBridge {
  const site = options.site ?? webSchedSite()
  const store = options.store ?? new BrowserJsonStore()
  const snapshots = new SnapshotSlots(store)
  const stars = new StarSlots(store)
  const settings = new SettingsSlots(store)
  const keys = options.keys ?? new EphemeralKeyStore()
  const streamFetch = options.fetchImpl ?? fetch
  const transport = options.transport ?? { streamFetch, bufferedRequest: streamFetch }
  const deliver = options.deliver ?? createBrowserDeliver()
  let canonicalEvents: readonly ScheduleEvent[] = []
  const session = createChatSession({ keys, getEvents: () => canonicalEvents, transport })

  return {
    app: {
      version: async () => options.version ?? webVersion(),
    },
    schedule: {
      refresh: async (refreshOptions) => {
        const projection = await performRefresh(
          {
            site,
            slots: snapshots,
            fetchSources: () =>
              fetchWebScheduleSources(site, streamFetch, { timeoutMs: options.timeoutMs }),
            warn: (error) => console.warn('[schedule] browser refresh failed; using cache:', error),
          },
          refreshOptions,
        )
        canonicalEvents = projection.events
        return projection
      },
    },
    changes: {
      acknowledge: async (uids) => {
        const log = acknowledgeChanges(await snapshots.readChangeLog(), uids)
        await snapshots.writeChangeLog(log)
        return log.entries
      },
    },
    stars: {
      get: () => stars.read(),
      set: (next) => stars.write(next),
    },
    export: {
      ics: (request) => exportIcs(request, () => canonicalEvents, { deliver }),
    },
    llm: {
      keyStatus: () => session.keyStatus(),
      setKey: (provider, keyValue) => session.setKey(provider, keyValue),
      clearKey: (provider) => session.clearKey(provider),
      models: (provider) => session.models(provider),
      syncDataset: async (candidates) => session.syncDataset(candidates),
      chat: (request) => session.chat(request),
      cancelChat: async () => session.cancel(),
      onChatDelta: (callback) => session.onDelta(callback),
    },
    settings: {
      get: (name) => settings.get(name),
      set: (name, value) => settings.set(name, value),
    },
  }
}

let singleton: PlatformBridge | undefined

export function webBridge(): PlatformBridge {
  singleton ??= createWebBridge()
  return singleton
}

function availableStorage(): BrowserStorage {
  try {
    if (typeof localStorage !== 'undefined') return localStorage
  } catch {
    // Sandboxed or opaque origins can reject localStorage access.
  }
  return new MemoryStorage()
}

function validateArtifactName(name: string): void {
  if (name.length === 0 || name.includes('/') || name.includes('\\') || name === '.' || name === '..') {
    throw new Error(`Invalid JSON artifact name: ${name}`)
  }
}

function key(name: string): string {
  return `${STORAGE_PREFIX}${name}`
}

function tempKey(name: string): string {
  return `${key(name)}.tmp`
}

function stringify(value: unknown): string {
  const bytes = JSON.stringify(value)
  if (bytes === undefined) throw new TypeError('JsonStore cannot persist undefined')
  return bytes
}

function parse(value: string | null): { ok: true; value: unknown } | { ok: false } {
  if (value === null) return { ok: false }
  try {
    return { ok: true, value: JSON.parse(value) }
  } catch {
    return { ok: false }
  }
}

function webVersion(): string {
  return typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'development'
}

function webSchedSite(): string {
  return typeof __SCHED_SITE__ === 'string' ? __SCHED_SITE__ : DEFAULT_SITE
}

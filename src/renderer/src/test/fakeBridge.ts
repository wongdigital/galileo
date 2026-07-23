import { vi, type MockedObject } from 'vitest'
import type { PlatformBridge } from '@shared/bridge/types'
import { setBridgeForTesting } from '../bridge'

export type FakePlatformBridge = {
  [K in keyof PlatformBridge]: MockedObject<PlatformBridge[K]>
}

export type FakeBridgeOverrides = {
  [K in keyof PlatformBridge]?: Partial<FakePlatformBridge[K]>
}

/** Complete, typed renderer bridge fake. Tests override only the operations
 * they exercise while every new contract method remains compiler-visible. */
export function installFakeBridge(overrides: FakeBridgeOverrides = {}): FakePlatformBridge {
  const fake: FakePlatformBridge = {
    app: {
      version: vi.fn<PlatformBridge['app']['version']>(async () => ''),
      ...overrides.app,
    },
    schedule: {
      refresh: vi.fn<PlatformBridge['schedule']['refresh']>(async () => ({
        events: [],
        changes: {},
        fetchedAt: null,
        stale: true,
      })),
      ...overrides.schedule,
    },
    changes: {
      acknowledge: vi.fn<PlatformBridge['changes']['acknowledge']>(async () => ({})),
      ...overrides.changes,
    },
    stars: {
      get: vi.fn<PlatformBridge['stars']['get']>(async () => []),
      set: vi.fn<PlatformBridge['stars']['set']>(async (stars) => stars),
      ...overrides.stars,
    },
    export: {
      ics: vi.fn<PlatformBridge['export']['ics']>(async () => ({
        status: 'cancelled',
        path: null,
        exported: 0,
        excluded: [],
      })),
      ...overrides.export,
    },
    llm: {
      keyStatus: vi.fn<PlatformBridge['llm']['keyStatus']>(async () => ({
        anthropic: false,
        openai: false,
        openrouter: false,
      })),
      setKey: vi.fn<PlatformBridge['llm']['setKey']>(async () => ({
        ok: false,
        message: 'not configured',
      })),
      clearKey: vi.fn<PlatformBridge['llm']['clearKey']>(async () => ({
        anthropic: false,
        openai: false,
        openrouter: false,
      })),
      models: vi.fn<PlatformBridge['llm']['models']>(async () => []),
      syncDataset: vi.fn<PlatformBridge['llm']['syncDataset']>(async (candidates) => ({
        received: candidates.length,
      })),
      chat: vi.fn<PlatformBridge['llm']['chat']>(async () => ({
        ok: false,
        error: { kind: 'provider', message: 'not configured' },
      })),
      cancelChat: vi.fn<PlatformBridge['llm']['cancelChat']>(async () => ({ cancelled: false })),
      onChatDelta: vi.fn<PlatformBridge['llm']['onChatDelta']>(() => () => {}),
      ...overrides.llm,
    },
    settings: {
      get: vi.fn<PlatformBridge['settings']['get']>(async () => null),
      set: vi.fn<PlatformBridge['settings']['set']>(async () => {}),
      ...overrides.settings,
    },
  }
  setBridgeForTesting(fake)
  return fake
}

export function clearFakeBridge(): void {
  setBridgeForTesting(undefined)
}

export function installMissingBridge(): void {
  setBridgeForTesting(null)
}

// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../App'
import { bridge, setBridgeForTesting } from '../../bridge'
import type { PlatformBridge } from '@shared/bridge/types'
import { CURRENT_SCHEMA_VERSION, type ScheduleEvent, type Snapshot } from '@shared/schedule'
import { ICS, LIST_HTML } from '@shared/schedule/__tests__/fixtures'
import { SnapshotSlots } from '@shared/storage/slots'
import {
  BrowserJsonStore,
  createBrowserDeliver,
  createWebBridge,
  fetchWebScheduleSources,
} from '../web'

vi.mock('@data/enrichment.json', () => ({
  default: {
    schema_version: 1,
    generated_at: '2026-07-18T00:00:00Z',
    provenance: {
      model: 'test',
      batch_id: 'test',
      franchise_seed_version: 1,
      system_prompt_sha: 'test',
      event_count: 0,
    },
    entries: {},
  },
}))

const EVENT: ScheduleEvent = {
  uid: 'a'.repeat(32),
  shortId: 'synthetic',
  title: 'Synthetic Browser Session',
  start: '2026-07-25T10:00:00-07:00',
  end: '2026-07-25T10:50:00-07:00',
  track: '1: PROGRAMS',
  subtypes: ['Comics'],
  flags: [],
  room: 'Room 5AB',
  location: 'Room 5AB',
  description: 'A synthetic fixture, not fetched schedule prose.',
  url: null,
}

const SNAPSHOT: Snapshot = {
  schemaVersion: CURRENT_SCHEMA_VERSION,
  fetchedAt: '2026-07-20T18:00:00.000Z',
  site: 'https://example.test',
  events: [EVENT],
  stats: { eventCount: 1, joinedWithListView: 1, joinRate: 1 },
}

function giveTheDomASize(): void {
  globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  for (const [property, value] of [
    ['offsetHeight', 900],
    ['offsetWidth', 800],
    ['clientHeight', 900],
  ] as const) {
    Object.defineProperty(HTMLElement.prototype, property, {
      configurable: true,
      get: () => value,
    })
  }
}

beforeEach(() => {
  giveTheDomASize()
  localStorage.clear()
  setBridgeForTesting(undefined)
})

afterEach(() => {
  cleanup()
  setBridgeForTesting(undefined)
  delete window.api
  vi.restoreAllMocks()
})

describe('browser bridge composition', () => {
  it('boots the full renderer from a cached fixture when browser fetch is unavailable', async () => {
    const store = new BrowserJsonStore()
    await new SnapshotSlots(store).writeSnapshot('last-known-good', SNAPSHOT)
    setBridgeForTesting(
      createWebBridge({
        site: SNAPSHOT.site,
        store,
        fetchImpl: vi.fn().mockRejectedValue(new TypeError('Failed to fetch')),
      }),
    )

    render(<App />)

    expect(await screen.findByText(EVENT.title)).toBeTruthy()
    expect(screen.getByText('Showing the last saved schedule.')).toBeTruthy()
  })

  it('persists stars through the browser store and echoes durable truth', async () => {
    const store = new BrowserJsonStore()
    const first = createWebBridge({ store, fetchImpl: vi.fn().mockRejectedValue(new Error('offline')) })
    const star = { uid: EVENT.uid, title: EVENT.title, start: EVENT.start, room: EVENT.room, starredAt: 'now' }

    expect(await first.stars.set([star])).toEqual([star])
    const restarted = createWebBridge({
      store: new BrowserJsonStore(),
      fetchImpl: vi.fn().mockRejectedValue(new Error('offline')),
    })
    expect(await restarted.stars.get()).toEqual([star])
  })

  it('echoes the previous durable stars when a browser write fails', async () => {
    const values = new Map<string, string>()
    let failWrites = false
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (failWrites) throw new Error('quota exceeded')
        values.set(key, value)
      },
      removeItem: (key: string) => {
        values.delete(key)
      },
    }
    const api = createWebBridge({ store: new BrowserJsonStore(storage) })
    const first = { uid: EVENT.uid, title: EVENT.title, start: EVENT.start, room: EVENT.room, starredAt: 'one' }
    const second = { ...first, uid: 'b'.repeat(32), starredAt: 'two' }

    expect(await api.stars.set([first])).toEqual([first])
    failWrites = true
    expect(await api.stars.set([first, second])).toEqual([first])
    expect(await api.stars.get()).toEqual([first])
  })

  it('persists named settings across browser bridge instances', async () => {
    const first = createWebBridge({ store: new BrowserJsonStore() })
    await first.settings.set('filters', { text: 'robots', starredOnly: true })

    const restarted = createWebBridge({ store: new BrowserJsonStore() })
    await expect(restarted.settings.get('filters')).resolves.toEqual({
      text: 'robots',
      starredOnly: true,
    })
  })

  it('keeps browser API keys ephemeral while reporting the shared three-state contract', async () => {
    const api = createWebBridge({ store: new BrowserJsonStore() })
    expect((await api.llm.keyStatus()).anthropic).toBe('absent')
    expect(await api.llm.setKey('anthropic', 'test-key')).toEqual({
      ok: true,
      status: { anthropic: 'present', openai: 'absent', openrouter: 'absent' },
    })
    expect((await api.llm.clearKey('anthropic')).anthropic).toBe('absent')
  })

  it('downloads ICS through a calendar Blob with the suggested filename', async () => {
    const capture: { blob: Blob | null } = { blob: null }
    const createObjectURL = vi.fn((blob: Blob) => {
      capture.blob = blob
      return 'blob:calendar'
    })
    const revokeObjectURL = vi.fn()
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    const path = await createBrowserDeliver({ createObjectURL, revokeObjectURL })(
      'comic-con.ics',
      'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n',
    )

    expect(path).toBe('comic-con.ics')
    expect(click).toHaveBeenCalledOnce()
    expect(capture.blob).toBeInstanceOf(Blob)
    expect(capture.blob?.type).toBe('text/calendar;charset=utf-8')
    expect(await capture.blob?.text()).toContain('BEGIN:VCALENDAR')
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:calendar')
  })

  it('uses test override, then Electron preload, then the web singleton', () => {
    const electron = { marker: 'electron' } as unknown as PlatformBridge
    const override = { marker: 'override' } as unknown as PlatformBridge
    window.api = electron

    expect(bridge()).toBe(electron)
    setBridgeForTesting(override)
    expect(bridge()).toBe(override)
    setBridgeForTesting(null)
    expect(bridge()).toBeNull()
    setBridgeForTesting(undefined)
    delete window.api
    const fallback = bridge()
    expect(fallback).not.toBeNull()
    expect(bridge()).toBe(fallback)
  })

  it('promotes a valid refresh and falls back to it when the next refresh is offline', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) =>
      new Response(String(input).endsWith('/all.ics') ? ICS : LIST_HTML),
    )
    const api = createWebBridge({
      site: 'https://example.test',
      store: new BrowserJsonStore(),
      fetchImpl,
    })

    const fresh = await api.schedule.refresh()
    expect(fresh.stale).toBe(false)
    expect(fresh.events.some((event) => event.title === 'Drawing Robots for Fun')).toBe(true)

    fetchImpl.mockRejectedValue(new TypeError('Failed to fetch'))
    const cached = await api.schedule.refresh()
    expect(cached.stale).toBe(true)
    expect(cached.events).toEqual(fresh.events)
  })
})

describe('browser schedule fetch', () => {
  it('starts both endpoints concurrently with a timeout signal and no forbidden User-Agent', async () => {
    const bodies = new Map<string, (value: Response) => void>()
    const fetchImpl = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      return new Promise<Response>((resolve) => {
        bodies.set(url, resolve)
        expect(init?.signal).toBeInstanceOf(AbortSignal)
        expect(init?.headers).toBeUndefined()
      })
    })

    const pending = fetchWebScheduleSources('https://example.test', fetchImpl, { timeoutMs: 1_000 })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    bodies.get('https://example.test/all.ics')?.(new Response('ICS'))
    bodies.get('https://example.test/list/descriptions')?.(new Response('HTML'))

    await expect(pending).resolves.toEqual({ ics: 'ICS', listHtml: 'HTML' })
  })

  it('rejects a non-success response with its endpoint', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) =>
      new Response('', { status: String(input).endsWith('.ics') ? 503 : 200 }),
    )
    await expect(fetchWebScheduleSources('https://example.test', fetchImpl)).rejects.toThrow('/all.ics -> 503')
  })

  it('aborts both endpoint requests when the browser deadline expires', async () => {
    vi.useFakeTimers()
    const signals: AbortSignal[] = []
    const fetchImpl = vi.fn((_input: string | URL | Request, init?: RequestInit) => {
      const signal = init?.signal as AbortSignal
      signals.push(signal)
      return new Promise<Response>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
    })

    try {
      const pending = fetchWebScheduleSources('https://example.test', fetchImpl, { timeoutMs: 25 })
      const rejection = expect(pending).rejects.toThrow('Schedule request timed out')
      await vi.advanceTimersByTimeAsync(25)
      await rejection
      expect(signals).toHaveLength(2)
      expect(signals.every((signal) => signal.aborted)).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })
})

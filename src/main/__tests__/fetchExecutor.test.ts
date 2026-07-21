/**
 * fetchExecutor imports no electron, only global fetch/AbortSignal — so unlike
 * the rest of src/main's wiring it qualifies for standard coverage.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchScheduleSources } from '../fetchExecutor'

const ok = (body: string) => ({ ok: true, status: 200, text: async () => body })

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fetchScheduleSources', () => {
  it('requests both sources with the identifying User-Agent and a timeout signal', async () => {
    const calls: { url: string; init: RequestInit }[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, init })
        return url.endsWith('.ics') ? ok('ICS') : ok('HTML')
      }),
    )

    const result = await fetchScheduleSources('https://example.test')
    expect(result).toEqual({ ics: 'ICS', listHtml: 'HTML' })
    expect(calls.map((c) => c.url).sort()).toEqual([
      'https://example.test/all.ics',
      'https://example.test/list/descriptions',
    ])
    for (const call of calls) {
      // The politeness posture: a UA that names the project and a contact.
      const headers = call.init.headers as Record<string, string>
      expect(headers['User-Agent']).toContain('github.com/wongdigital/galileo')
      // Every request carries the composed abort signal (timeout at minimum).
      expect(call.init.signal).toBeInstanceOf(AbortSignal)
    }
  })

  it('throws with the path and status on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503, text: async () => '' })))
    // Both requests fail; whichever rejection wins carries its path + status.
    await expect(fetchScheduleSources('https://example.test')).rejects.toThrow('-> 503')
  })

  it("composes the caller's abort signal into the request", async () => {
    const seen: AbortSignal[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        seen.push(init.signal as AbortSignal)
        return ok('x')
      }),
    )

    const controller = new AbortController()
    controller.abort()
    await fetchScheduleSources('https://example.test', controller.signal)
    // An already-aborted caller aborts the combined signal immediately —
    // AbortSignal.any propagates it; the stubbed fetch just doesn't enforce it.
    expect(seen).toHaveLength(2)
    expect(seen.every((signal) => signal.aborted)).toBe(true)
  })
})

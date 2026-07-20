/**
 * Live evals — the concierge against a real model, not a mock.
 *
 * These are NOT part of the normal suite. They are non-deterministic (an LLM
 * never answers the same way twice), they cost money, and they need secrets, so
 * they are gated twice: `RUN_LIVE=1` in the environment AND a provider key. A
 * plain `npm test` and CI load this file, evaluate the gate, and skip every
 * case at zero cost.
 *
 *   npm run test:live            # runs whichever providers have keys in .env
 *
 * Keys come from `.env` at the repo root (ANTHROPIC_API_KEY, OPENAI_API_KEY,
 * OPENROUTER_API_KEY), the same file scripts/enrich.mjs uses. Model per provider
 * is overridable: LIVE_ANTHROPIC_MODEL, LIVE_OPENAI_MODEL, LIVE_OPENROUTER_MODEL.
 *
 * Because the output is non-deterministic, every assertion is on BEHAVIOUR, not
 * prose: which tools the model called, whether a filter patch came back, whether
 * the count is engine-derived, whether a mutation was only proposed. What the
 * model actually said is logged for a human to read, never asserted on.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runChatTurn } from '../loop'
import { DEFAULT_MODEL } from '../providers'
import { EMPTY_FILTER, type FilterCandidate } from '../../../shared/filter/types'
import type { ChatRequest, ProviderId } from '../../../shared/chat'
import type { ScheduleEvent } from '../../../shared/schedule'

// --- .env loader (no dependency; only fills vars not already set) ------------
function loadEnv(): void {
  try {
    const text = readFileSync(join(process.cwd(), '.env'), 'utf8')
    for (const line of text.split('\n')) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (match && !process.env[match[1]!]) {
        process.env[match[1]!] = match[2]!.replace(/^["']|["']$/g, '').trim()
      }
    }
  } catch {
    // No .env — the gate below skips everything.
  }
}
loadEnv()

const RUN = process.env.RUN_LIVE === '1'

const KEY_ENV: Record<ProviderId, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
}
const MODEL_ENV: Record<ProviderId, string> = {
  anthropic: 'LIVE_ANTHROPIC_MODEL',
  openai: 'LIVE_OPENAI_MODEL',
  openrouter: 'LIVE_OPENROUTER_MODEL',
}

// --- a small but real corpus for the tools to ground on ----------------------
const CANDIDATES: FilterCandidate[] = [
  { uid: 'p1', dimensions: { genre: ['Horror'], ip: ['Star Wars'], person: ['Ada Vance'], venue: ['Convention Center'] }, haystack: 'p1 star wars horror ada vance lucasfilm' },
  { uid: 'p2', dimensions: { genre: ['Comedy'], ip: ['Star Wars'], venue: ['Marriott Marquis'] }, haystack: 'p2 star wars comedy marriott' },
  { uid: 'p3', dimensions: { genre: ['Horror'] }, haystack: 'p3 horror night terrors' },
  { uid: 'p4', dimensions: { ip: ['Marvel'], person: ['Bo Idris'], venue: ['Convention Center'] }, haystack: 'p4 marvel bo idris hall h' },
]
const EVENTS: ScheduleEvent[] = CANDIDATES.map((c, i) => ({
  uid: c.uid,
  shortId: null,
  title: `Panel ${c.uid.toUpperCase()}`,
  start: '2026-07-24T10:00:00-07:00',
  end: '2026-07-24T11:00:00-07:00',
  track: '1: Programs',
  subtypes: [],
  flags: [],
  room: i === 3 ? 'Hall H' : `Room ${i}`,
  location: '',
  description:
    c.uid === 'p1'
      ? 'A Star Wars retrospective with Ada Vance.'
      : c.uid === 'p4'
        ? 'The Marvel Studios panel featuring Bo Idris in Hall H.'
        : `Description for ${c.uid}.`,
  url: null,
}))

function makeDeps(key: string, candidates: readonly FilterCandidate[] = CANDIDATES, events: readonly ScheduleEvent[] = EVENTS) {
  return {
    keyStore: { get: () => key },
    getEvents: () => events,
    getCandidates: () => candidates,
  }
}

function request(provider: ProviderId, content: string): ChatRequest {
  return {
    provider,
    model: process.env[MODEL_ENV[provider]] || DEFAULT_MODEL[provider],
    messages: [{ role: 'user', content }],
    filter: EMPTY_FILTER,
    lens: 'ip',
    view: 'schedule',
    starredUids: [],
    changedUids: [],
  }
}

const TIMEOUT = 45_000

for (const provider of ['anthropic', 'openai', 'openrouter'] as ProviderId[]) {
  const key = process.env[KEY_ENV[provider]]

  describe.skipIf(!RUN || !key)(`live: ${provider} concierge`, () => {
    const deps = makeDeps(key ?? '')

    it(
      'turns an interest utterance into a filter patch',
      async () => {
        const res = await runChatTurn(deps, request(provider, "I'm into horror and Star Wars"))
        expect(res.ok).toBe(true)
        if (!res.ok) return
        console.log(`[${provider}] interest →`, res.turn.toolTrace, '·', res.turn.message.content)
        expect(res.turn.toolTrace).toContain('apply_filters')
        expect(res.turn.patch?.filter?.chips.length ?? 0).toBeGreaterThan(0)
      },
      TIMEOUT,
    )

    it(
      'discovers real franchise values rather than guessing',
      async () => {
        const res = await runChatTurn(deps, request(provider, 'what franchises are in this schedule?'))
        expect(res.ok).toBe(true)
        if (!res.ok) return
        console.log(`[${provider}] franchises →`, res.turn.toolTrace, '·', res.turn.message.content)
        // It should reach for the corpus (list values or search), not answer from memory.
        expect(res.turn.toolTrace.some((t) => ['list_facet_values', 'search_events', 'apply_filters'].includes(t))).toBe(true)
      },
      TIMEOUT,
    )

    it(
      'answers a content question from a tool and surfaces the card',
      async () => {
        const res = await runChatTurn(deps, request(provider, 'who is on the Marvel panel in Hall H?'))
        expect(res.ok).toBe(true)
        if (!res.ok) return
        console.log(`[${provider}] content →`, res.turn.toolTrace, '· uids', res.turn.eventUids, '·', res.turn.message.content)
        expect(res.turn.toolTrace.some((t) => ['search_events', 'get_event'].includes(t))).toBe(true)
      },
      TIMEOUT,
    )

    it(
      'answers a judgment question directly, as advice',
      async () => {
        const res = await runChatTurn(deps, request(provider, 'should I line up early to get into Hall H on Saturday?'))
        expect(res.ok).toBe(true)
        if (!res.ok) return
        console.log(`[${provider}] judgment →`, res.turn.toolTrace, '·', res.turn.message.content)
        expect(res.turn.message.content.trim().length).toBeGreaterThan(0)
      },
      TIMEOUT,
    )

    it(
      'proposes a star mutation without committing it',
      async () => {
        const res = await runChatTurn(deps, request(provider, 'star the horror panel with Ada Vance'))
        expect(res.ok).toBe(true)
        if (!res.ok) return
        console.log(`[${provider}] mutation →`, res.turn.toolTrace, '·', JSON.stringify(res.turn.proposedAction))
        expect(res.turn.toolTrace).toContain('propose_action')
        expect(res.turn.proposedAction?.kind).toBe('star')
      },
      TIMEOUT,
    )

    it(
      'stays honest when the data has nothing to offer',
      async () => {
        const emptyDeps = makeDeps(key ?? '', [], [])
        const res = await runChatTurn(emptyDeps, request(provider, 'who is on the Pokemon panel?'))
        expect(res.ok).toBe(true)
        if (!res.ok) return
        console.log(`[${provider}] empty-data →`, res.turn.toolTrace, '·', res.turn.message.content)
        // With an empty corpus it must consult a tool (which returns nothing)
        // rather than answer from memory; no event card should appear.
        expect(res.turn.toolTrace.length).toBeGreaterThan(0)
        expect(res.turn.eventUids).toEqual([])
      },
      TIMEOUT,
    )

    it(
      'reports a rejected key as an auth error',
      async () => {
        const badDeps = { ...deps, keyStore: { get: () => 'sk-definitely-invalid-000' } }
        const res = await runChatTurn(badDeps, request(provider, 'hello'))
        expect(res.ok).toBe(false)
        if (res.ok) return
        console.log(`[${provider}] bad-key →`, res.error.kind, res.error.message)
        // Anthropic/OpenAI return 401 (→ auth); some gateways wrap it as a
        // generic provider error, which is still a correct "not ok".
        expect(['auth', 'provider']).toContain(res.error.kind)
      },
      TIMEOUT,
    )
  })
}

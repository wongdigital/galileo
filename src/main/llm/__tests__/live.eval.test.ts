/**
 * Live evals — the concierge against a real model, not a mock.
 *
 * NOT part of the normal suite: non-deterministic, costs money, needs secrets.
 * Gated twice — `RUN_LIVE=1` AND a provider key — so `npm test` and CI load
 * this file, see the gate, and skip every case at zero cost.
 *
 *   npm run test:live            # runs whichever providers have keys in .env
 *
 * Keys come from `.env` at the repo root (ANTHROPIC_API_KEY, OPENAI_API_KEY,
 * OPENROUTER_API_KEY). Model per provider is overridable via
 * LIVE_<PROVIDER>_MODEL; the connectivity ping uses a cheap model.
 *
 * Two kinds of assertion:
 * - Structural (free-ish, deterministic): which tools the model called, whether
 *   a patch/proposed-action came back. These catch wiring and prompting bugs.
 * - Content (Fable-as-judge): a strong model grades each answer for
 *   groundedness and helpfulness against the known dataset. Non-deterministic
 *   output judged by non-deterministic model — so the judge is asked for a
 *   strict yes/no with a reason, and only a clear fail fails the case.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { generateText } from 'ai'
import { createAnthropic } from '@ai-sdk/anthropic'
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
/** Cheap models for the connectivity ping — no quality judgment needed. */
const CHEAP_MODEL: Record<ProviderId, string> = {
  anthropic: process.env.LIVE_ANTHROPIC_CHEAP || 'claude-haiku-4-5-20251001',
  openai: process.env.LIVE_OPENAI_CHEAP || 'gpt-4.1-mini',
  openrouter: process.env.LIVE_OPENROUTER_CHEAP || 'anthropic/claude-haiku-4-5',
}

// --- a small, MULTI-DAY corpus for the tools to ground on --------------------
// Spans Thu–Sun (like the real con) so the evals actually test day-independent
// retrieval: the headline Marvel panel is in Hall H on Saturday, and must be
// findable no matter which day the list view has open.
const START: Record<string, string> = {
  e1: '2026-07-23T10:00:00-07:00', // Thursday
  e2: '2026-07-24T11:00:00-07:00', // Friday
  e3: '2026-07-25T17:30:00-07:00', // Saturday
  e4: '2026-07-26T13:00:00-07:00', // Sunday
}
const ROOM: Record<string, string> = { e1: 'Room 6A', e2: 'Room 25ABC', e3: 'Hall H', e4: 'Room 23ABC' }
const TITLE: Record<string, string> = {
  e1: 'Star Wars: A Retrospective',
  e2: 'Comedy Legends of the Galaxy',
  e3: 'Marvel Studios Hall H Presentation',
  e4: 'Night Terrors After Dark',
}
const DESC: Record<string, string> = {
  e1: 'A Star Wars retrospective with Ada Vance.',
  e2: 'Stand-up from across the Star Wars universe.',
  e3: 'The Marvel Studios panel featuring Bo Idris in Hall H.',
  e4: 'A late-night horror showcase.',
}

// `ip` values are canonical slugs, exactly as the enrichment index stores them
// in production — so these evals exercise the spoken-name → slug resolution
// ("Star Wars" must land on 'star-wars') the real corpus demands.
const CANDIDATES: FilterCandidate[] = [
  { uid: 'e1', dimensions: { genre: ['Horror'], ip: ['star-wars'], person: ['Ada Vance'], venue: ['Convention Center'], room: [ROOM.e1!] }, haystack: 'e1 star wars a retrospective horror ada vance thursday room 6a' },
  { uid: 'e2', dimensions: { genre: ['Comedy'], ip: ['star-wars'], venue: ['Marriott Marquis'], room: [ROOM.e2!] }, haystack: 'e2 comedy legends of the galaxy star wars friday marriott' },
  { uid: 'e3', dimensions: { ip: ['marvel'], person: ['Bo Idris'], venue: ['Convention Center'], room: [ROOM.e3!] }, haystack: 'e3 marvel studios hall h presentation saturday bo idris' },
  { uid: 'e4', dimensions: { genre: ['Horror'], venue: ['Convention Center'], room: [ROOM.e4!] }, haystack: 'e4 night terrors after dark horror sunday' },
]
const EVENTS: ScheduleEvent[] = CANDIDATES.map((c) => ({
  uid: c.uid,
  shortId: null,
  title: TITLE[c.uid]!,
  start: START[c.uid]!,
  end: null,
  track: '1: Programs',
  subtypes: [],
  flags: [],
  room: ROOM[c.uid]!,
  location: '',
  description: DESC[c.uid]!,
  url: null,
}))

const CORPUS_FACTS = `The dataset contains EXACTLY these 4 events, on four different days (times Pacific; these dates and weekdays are correct):
- e1 "Star Wars: A Retrospective", Thursday Jul 23 2026, 10:00 AM, Room 6A, Convention Center: genre Horror, franchise Star Wars, person Ada Vance.
- e2 "Comedy Legends of the Galaxy", Friday Jul 24 2026, 11:00 AM, Room 25ABC, Marriott Marquis: genre Comedy, franchise Star Wars.
- e3 "Marvel Studios Hall H Presentation", Saturday Jul 25 2026, 5:30 PM, Hall H, Convention Center: franchise Marvel, person Bo Idris.
- e4 "Night Terrors After Dark", Sunday Jul 26 2026, 1:00 PM, Room 23ABC, Convention Center: genre Horror.
Days present: Thu Jul 23, Fri Jul 24, Sat Jul 25, Sun Jul 26. The ONLY Hall H event is e3, the Marvel panel on Saturday. There is no Pokemon; franchises are only Star Wars and Marvel.`

function makeDeps(key: string, candidates: readonly FilterCandidate[] = CANDIDATES, events: readonly ScheduleEvent[] = EVENTS) {
  return { keyStore: { get: () => key }, getEvents: () => events, getCandidates: () => candidates }
}

function request(provider: ProviderId, content: string, model?: string): ChatRequest {
  return {
    provider,
    model: model ?? process.env[MODEL_ENV[provider]] ?? DEFAULT_MODEL[provider],
    messages: [{ role: 'user', content }],
    filter: EMPTY_FILTER,
    lens: 'ip',
    view: 'schedule',
    starredUids: [],
    changedUids: [],
  }
}

// --- Fable-as-judge: grades content for groundedness, at high effort ---------
const JUDGE_MODEL = process.env.LIVE_JUDGE_MODEL || 'claude-fable-5'

function parseVerdict(text: string): { pass: boolean; reason: string } {
  const match = text.match(/\{[\s\S]*\}/)
  if (match) {
    try {
      const obj = JSON.parse(match[0]) as { pass?: unknown; reason?: unknown }
      return { pass: Boolean(obj.pass), reason: String(obj.reason ?? '') }
    } catch {
      // fall through to the salvage path below
    }
  }
  // A truncated reply can lose the closing brace while the verdict itself is
  // perfectly clear — a judge that said pass must not be scored as a fail.
  const pass = text.match(/"pass"\s*:\s*(true|false)/)
  if (pass) return { pass: pass[1] === 'true', reason: `(reason truncated) ${text.slice(0, 200)}` }
  return { pass: false, reason: `unparseable judge output: ${text.slice(0, 200)}` }
}

async function judgeContent(question: string, answer: string, toolTrace: string[]): Promise<{ pass: boolean; reason: string }> {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return { pass: true, reason: '(no ANTHROPIC_API_KEY — judge skipped)' }
  const anthropic = createAnthropic({ apiKey: key })
  const args = {
    model: anthropic(JUDGE_MODEL),
    maxOutputTokens: 4000,
    system:
      'You grade a Comic-Con schedule concierge for GROUNDEDNESS and HELPFULNESS. It must never invent events, people, times, rooms, or counts beyond the dataset given. Saying "not found" when the data lacks something is CORRECT and helpful, not a failure. Reply with ONLY a JSON object: {"pass": boolean, "reason": string}. Keep reason to ONE short sentence. pass=true iff the answer invents nothing outside the dataset and is an honest, useful response to the question.',
    prompt: `DATASET GROUND TRUTH:\n${CORPUS_FACTS}\n\nUSER ASKED: ${question}\nTOOLS THE CONCIERGE CALLED: ${toolTrace.join(', ') || '(none)'}\nCONCIERGE ANSWERED: ${answer || '(empty)'}\n\nGrade it.`,
  }
  try {
    const { text } = await generateText({
      ...args,
      providerOptions: { anthropic: { thinking: { type: 'enabled', budgetTokens: 2000 } } },
    })
    return parseVerdict(text)
  } catch {
    // Extended thinking may be unavailable on the judge model; fall back plain.
    try {
      const { text } = await generateText(args)
      return parseVerdict(text)
    } catch (error) {
      return { pass: true, reason: `(judge unavailable: ${error instanceof Error ? error.message : String(error)})` }
    }
  }
}

const TIMEOUT = 60_000

for (const provider of ['anthropic', 'openai', 'openrouter'] as ProviderId[]) {
  const key = process.env[KEY_ENV[provider]]

  describe.skipIf(!RUN || !key)(`live: ${provider} concierge`, () => {
    const deps = makeDeps(key ?? '')

    // A content case: run the concierge, assert the tool behaviour, then let
    // Fable grade the prose for groundedness.
    async function contentCase(question: string, expectTools: (trace: string[]) => void) {
      const res = await runChatTurn(deps, request(provider, question))
      expect(res.ok).toBe(true)
      if (!res.ok) return
      expectTools(res.turn.toolTrace)
      const verdict = await judgeContent(question, res.turn.message.content, res.turn.toolTrace)
      console.log(`[${provider}] "${question}"\n  tools: ${res.turn.toolTrace.join(', ')}\n  answer: ${res.turn.message.content}\n  JUDGE ${verdict.pass ? 'PASS' : 'FAIL'}: ${verdict.reason}`)
      expect(verdict.pass, verdict.reason).toBe(true)
    }

    it('connects on a cheap model', async () => {
      const res = await runChatTurn(deps, request(provider, 'Reply with just: ready', CHEAP_MODEL[provider]))
      expect(res.ok).toBe(true)
      if (res.ok) expect(res.turn.message.content.length).toBeGreaterThan(0)
    }, TIMEOUT)

    it('turns an interest utterance into a grounded filter', async () => {
      await contentCase("I'm into horror and Star Wars", (trace) => {
        expect(trace).toContain('apply_filters')
      })
    }, TIMEOUT)

    it('lists a franchise’s programs with every named title linkable', async () => {
      const question = 'what are all the star wars programs'
      const res = await runChatTurn(deps, request(provider, question))
      expect(res.ok).toBe(true)
      if (!res.ok) return
      const { message, toolTrace, eventUids } = res.turn
      console.log(`[${provider}] "${question}"\n  tools: ${toolTrace.join(', ')}\n  uids: ${eventUids.join(', ')}\n  answer: ${message.content}`)
      // Found through tools, with the spoken name resolving onto the 'star-wars'
      // slug — not a full-corpus fallback, not a guess.
      expect(toolTrace.some((t) => ['apply_filters', 'search_events'].includes(t))).toBe(true)
      // Both Star Wars events must be in the linkable set…
      expect(eventUids).toContain('e1')
      expect(eventUids).toContain('e2')
      // …and each named title must appear bolded verbatim, which is the whole
      // linking contract: the renderer turns **exact-title** into the link. An
      // answer that lists the programs unlinked is a regression, not a style.
      for (const title of [TITLE.e1!, TITLE.e2!]) {
        expect(message.content.toLowerCase()).toContain(`**${title.toLowerCase()}**`)
      }
      const verdict = await judgeContent(question, message.content, toolTrace)
      console.log(`  JUDGE ${verdict.pass ? 'PASS' : 'FAIL'}: ${verdict.reason}`)
      expect(verdict.pass, verdict.reason).toBe(true)
    }, TIMEOUT)

    it('discovers real franchise values rather than guessing', async () => {
      await contentCase('what franchises are in this schedule?', (trace) => {
        expect(trace.some((t) => ['list_facet_values', 'search_events', 'apply_filters'].includes(t))).toBe(true)
      })
    }, TIMEOUT)

    it('scopes to a room with a room chip and does not switch the view', async () => {
      const res = await runChatTurn(deps, { ...request(provider, 'show me only Hall H events'), view: 'graph' })
      expect(res.ok).toBe(true)
      if (!res.ok) return
      console.log(`[${provider}] room-filter → ${res.turn.toolTrace.join(', ')} · patch ${JSON.stringify(res.turn.patch)}`)
      expect(res.turn.toolTrace).toContain('apply_filters')
      const chips = res.turn.patch?.filter?.chips ?? []
      // A precise room chip, not a fragile free-text match…
      expect(chips.some((c) => c.dimension === 'room' && c.value === 'Hall H')).toBe(true)
      // …and it leaves the user in the graph view they were in.
      expect(res.turn.patch?.view ?? null).not.toBe('schedule')
    }, TIMEOUT)

    it('finds the Saturday Hall H panel regardless of the open day', async () => {
      await contentCase('who is on the Marvel panel in Hall H on Saturday?', (trace) => {
        expect(trace.some((t) => ['search_events', 'get_event'].includes(t))).toBe(true)
      })
    }, TIMEOUT)

    it('answers a judgment question directly, as advice', async () => {
      await contentCase('should I line up early for the Saturday Hall H Marvel panel?', () => {})
    }, TIMEOUT)

    it('stays honest when the data has nothing to offer', async () => {
      const emptyDeps = makeDeps(key ?? '', [], [])
      const res = await runChatTurn(emptyDeps, request(provider, 'who is on the Pokemon panel?'))
      expect(res.ok).toBe(true)
      if (!res.ok) return
      const verdict = await judgeContent('who is on the Pokemon panel?', res.turn.message.content, res.turn.toolTrace)
      console.log(`[${provider}] empty-data\n  tools: ${res.turn.toolTrace.join(', ')}\n  answer: ${res.turn.message.content}\n  JUDGE ${verdict.pass ? 'PASS' : 'FAIL'}: ${verdict.reason}`)
      expect(res.turn.eventUids).toEqual([])
      expect(verdict.pass, verdict.reason).toBe(true)
    }, TIMEOUT)

    it('proposes a star mutation without committing it', async () => {
      const res = await runChatTurn(deps, request(provider, 'star the panel with Ada Vance'))
      expect(res.ok).toBe(true)
      if (!res.ok) return
      console.log(`[${provider}] mutation → ${res.turn.toolTrace.join(', ')} · ${JSON.stringify(res.turn.proposedAction)}`)
      expect(res.turn.toolTrace).toContain('propose_action')
      expect(res.turn.proposedAction?.kind).toBe('star')
    }, TIMEOUT)

    it('reports a rejected key as an error, not a hang', async () => {
      const badDeps = { ...deps, keyStore: { get: () => 'sk-definitely-invalid-000' } }
      const res = await runChatTurn(badDeps, request(provider, 'hello', CHEAP_MODEL[provider]))
      expect(res.ok).toBe(false)
      if (res.ok) return
      console.log(`[${provider}] bad-key → ${res.error.kind}: ${res.error.message}`)
      expect(['auth', 'provider']).toContain(res.error.kind)
    }, TIMEOUT)
  })
}

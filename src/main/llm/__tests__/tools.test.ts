import { describe, expect, it } from 'vitest'
import { buildTools, type ToolContext, type TurnCapture } from '../tools'
import { EMPTY_FILTER, type FilterCandidate, type MatchContext } from '../../../shared/filter/types'
import type { ScheduleEvent } from '../../../shared/schedule'

// `ip` values are canonical slugs, exactly as the enrichment index stores them —
// the tools must resolve the model's spoken "Star Wars" onto them and label
// them back to a human name on the way out.
const candidates: FilterCandidate[] = [
  {
    uid: 'a',
    dimensions: { genre: ['Horror'], ip: ['star-wars'], person: ['Ada Vance', 'Bo Idris'] },
    haystack: 'panel a lucasfilm horror star wars',
  },
  { uid: 'b', dimensions: { genre: ['Comedy'], ip: ['star-wars'] }, haystack: 'panel b star wars comedy' },
  { uid: 'c', dimensions: { genre: ['Horror'] }, haystack: 'panel c horror' },
]

const events: ScheduleEvent[] = candidates.map((candidate, i) => ({
  uid: candidate.uid,
  shortId: null,
  title: `Panel ${candidate.uid.toUpperCase()}`,
  start: '2026-07-24T10:00:00-07:00',
  end: null,
  track: '1: Programs',
  subtypes: [],
  flags: [],
  room: `Room ${i}`,
  location: '',
  description: `Description for ${candidate.uid}`,
  url: null,
}))

const starred = new Set(['a'])
const matchContext: MatchContext = {
  isStarred: (uid) => starred.has(uid),
  hasUnseenChanges: () => false,
}

function setup(overrides: Partial<ToolContext> = {}): { tools: ReturnType<typeof buildTools>; capture: TurnCapture } {
  const capture: TurnCapture = { eventUids: [], toolTrace: [] }
  const ctx: ToolContext = {
    candidates,
    events,
    filter: EMPTY_FILTER,
    matchContext,
    lens: 'ip',
    view: 'schedule',
    ...overrides,
  }
  return { tools: buildTools(ctx, capture), capture }
}

// AI SDK's execute is (input, options); tests only supply input.
const run = (t: { execute?: unknown }, input: unknown): Promise<any> =>
  (t.execute as (i: unknown, o: unknown) => Promise<unknown>)(input, {
    toolCallId: 't',
    messages: [],
  }) as Promise<any>

describe('apply_filters', () => {
  it('resolves a loose value, returns the real count, and captures the filter patch', async () => {
    const { tools, capture } = setup()
    const result = await run(tools.apply_filters, { add: [{ dimension: 'genre', value: 'horror' }] })

    expect(result.count).toBe(2) // a and c
    expect(result.unresolved).toEqual([])
    expect(result.applied).toContain('Genre: Horror')
    expect(capture.patch?.filter?.chips).toEqual([{ dimension: 'genre', value: 'Horror' }])
    expect(capture.toolTrace).toEqual(['apply_filters'])
  })

  it('reports a value it could not resolve rather than inventing one', async () => {
    const { tools, capture } = setup()
    const result = await run(tools.apply_filters, { add: [{ dimension: 'ip', value: 'Pokemon' }] })

    expect(result.unresolved).toEqual(['ip: Pokemon'])
    expect(capture.patch?.filter?.chips).toEqual([]) // nothing added
  })

  it('marks every matched sample event linkable, not just the first', async () => {
    const { tools, capture } = setup()
    await run(tools.apply_filters, { add: [{ dimension: 'genre', value: 'horror' }] })
    // Both horror events (a and c) become linkable, so the model's bolded names
    // for either one resolve — the bug was only the first surviving the cap.
    expect(capture.eventUids).toEqual(['a', 'c'])
  })

  it('does not touch the view or lens — that is set_view territory', async () => {
    const { tools, capture } = setup()
    await run(tools.apply_filters, { add: [{ dimension: 'genre', value: 'horror' }] })
    expect(capture.patch?.view).toBeUndefined()
    expect(capture.patch?.lens).toBeUndefined()
  })

  it('compounds a second apply_filters onto the first within the same turn', async () => {
    const { tools, capture } = setup()
    await run(tools.apply_filters, { add: [{ dimension: 'genre', value: 'horror' }] })
    // The second call builds on the chips the first added, not the turn-start
    // snapshot — otherwise last-wins would drop the horror chip.
    await run(tools.apply_filters, { add: [{ dimension: 'ip', value: 'star wars' }] })
    expect(capture.patch?.filter?.chips).toEqual([
      { dimension: 'genre', value: 'Horror' },
      // The spoken name resolves onto the canonical slug the corpus carries.
      { dimension: 'ip', value: 'star-wars' },
    ])
  })
})

describe('set_view', () => {
  it('carries view and lens into the patch, and merges with a filter already set', async () => {
    const { tools, capture } = setup()
    await run(tools.apply_filters, { add: [{ dimension: 'genre', value: 'horror' }] })
    const result = await run(tools.set_view, { view: 'graph', lens: 'people' })
    expect(result.view).toBe('graph')
    expect(result.lens).toBe('people')
    expect(capture.patch?.view).toBe('graph')
    expect(capture.patch?.lens).toBe('people')
    // The earlier filter survives the merge.
    expect(capture.patch?.filter?.chips).toEqual([{ dimension: 'genre', value: 'Horror' }])
    expect(capture.toolTrace).toEqual(['apply_filters', 'set_view'])
  })

  it('keeps a field an earlier call set when a later call omits it', async () => {
    const { tools, capture } = setup()
    await run(tools.set_view, { view: 'graph' })
    await run(tools.set_view, { lens: 'people' })
    // The second call named only the lens; the view from the first must survive.
    expect(capture.patch?.view).toBe('graph')
    expect(capture.patch?.lens).toBe('people')
  })
})

describe('list_facet_values', () => {
  it('returns the real values in a dimension with counts and human labels', async () => {
    const { tools } = setup()
    const result = await run(tools.list_facet_values, { dimension: 'ip' })
    // The slug is the chip token; the label is what the model should quote.
    expect(result.values).toEqual([{ value: 'star-wars', label: 'Star Wars', count: 2 }])
  })
})

describe('search_events', () => {
  it('searches by free text and returns the true total', async () => {
    const { tools } = setup()
    const result = await run(tools.search_events, { text: 'lucasfilm' })
    expect(result.count).toBe(1)
    expect(result.events[0]).toMatchObject({
      uid: 'a',
      title: 'Panel A',
      start: '2026-07-24T10:00:00-07:00',
      room: 'Room 0',
      track: '1: Programs',
    })
    // Model-facing rows carry a preformatted, correct-weekday time.
    expect(result.events[0].when).toBe('Fri, Jul 24, 10:00 AM')
  })

  it('caps the shown list while reporting the full count', async () => {
    const { tools } = setup()
    const result = await run(tools.search_events, { add: [{ dimension: 'ip', value: 'Star Wars' }], limit: 1 })
    expect(result.count).toBe(2) // a and b
    expect(result.shown).toBe(1)
  })
})

describe('get_event', () => {
  it('returns the description and people, and captures the uid to render its card', async () => {
    const { tools, capture } = setup()
    const result = await run(tools.get_event, { uid: 'a' })
    expect(result.found).toBe(true)
    expect(result.description).toBe('Description for a')
    expect(result.people).toEqual(['Ada Vance', 'Bo Idris'])
    // Labeled from the slug — the model quotes "Star Wars", never "star-wars".
    expect(result.franchises).toEqual(['Star Wars'])
    expect(result.starred).toBe(true)
    expect(capture.eventUids).toEqual(['a'])
  })

  it('reports a missing uid without capturing a card', async () => {
    const { tools, capture } = setup()
    const result = await run(tools.get_event, { uid: 'zzz' })
    expect(result.found).toBe(false)
    expect(capture.eventUids).toEqual([])
  })
})

describe('get_starred', () => {
  it('lists the starred events', async () => {
    const { tools } = setup()
    const result = await run(tools.get_starred, {})
    expect(result.count).toBe(1)
    expect(result.events[0].uid).toBe('a')
  })

  it('captures the starred uids so their titles are linkable in the reply', async () => {
    const { tools, capture } = setup()
    await run(tools.get_starred, {})
    expect(capture.eventUids).toEqual(['a'])
  })
})

describe('propose_action', () => {
  it('captures a proposed mutation without committing it', async () => {
    const { tools, capture } = setup()
    const result = await run(tools.propose_action, { kind: 'star', uids: ['a', 'b'], note: 'your Star Wars picks' })
    expect(result.awaitingConfirmation).toBe(true)
    expect(result.count).toBe(2)
    expect(capture.proposedAction).toEqual({
      kind: 'star',
      note: 'your Star Wars picks',
      events: [
        { uid: 'a', title: 'Panel A', start: '2026-07-24T10:00:00-07:00', room: 'Room 0', track: '1: Programs' },
        { uid: 'b', title: 'Panel B', start: '2026-07-24T10:00:00-07:00', room: 'Room 1', track: '1: Programs' },
      ],
    })
  })

  it('dedupes a repeated uid to one summary per event', async () => {
    const { tools, capture } = setup()
    const result = await run(tools.propose_action, { kind: 'star', uids: ['a', 'a', 'b'] })
    expect(result.count).toBe(2)
    expect(capture.proposedAction?.events.map((e) => e.uid)).toEqual(['a', 'b'])
  })
})

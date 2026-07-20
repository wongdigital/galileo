/**
 * The tools the model calls to ground every schedule fact (rule 1) and to
 * propose — never perform — mutations (rule 2).
 *
 * All six execute in main against the synced candidate index and main's own
 * canonical event bodies. They are the tested heart of the concierge: given a
 * context and a capture object, calling `execute` directly reproduces exactly
 * what the model would trigger, no provider required.
 *
 * `capture` is the side channel. A tool's return value goes to the *model*; its
 * effect on the *app* (the filter to commit, the cards to render, the action to
 * confirm) is recorded on `capture`, which the loop reads once the turn ends.
 */

import { tool } from 'ai'
import { z } from 'zod'
import { applyFilter, describeFilter, facetOptions } from '../../shared/filter/engine'
import { EMPTY_FILTER, type FilterCandidate, type FilterChip, type FilterState, type MatchContext } from '../../shared/filter/types'
import { applyFilterIntent, resolveFacetValue } from '../../shared/chat'
import type { AppStatePatch, EventSummary, ProposedAction, ViewName } from '../../shared/chat'
import type { LensId } from '../../shared/graph/types'
import type { ScheduleEvent } from '../../shared/schedule'

export interface ToolContext {
  /** The filter index, synced from the renderer. Empty until the first sync. */
  candidates: readonly FilterCandidate[]
  /** Canonical event bodies — main's own, the same the ICS export trusts. */
  events: readonly ScheduleEvent[]
  /** The filter the user currently has applied; intents build on it. */
  filter: FilterState
  matchContext: MatchContext
  lens: LensId
  view: ViewName
}

/** The app-facing effects of a turn, filled by tool executes and read once the
 *  turn ends. `eventUids` and `toolTrace` accumulate; the rest is last-wins. */
export interface TurnCapture {
  patch?: AppStatePatch
  eventUids: string[]
  proposedAction?: ProposedAction
  toolTrace: string[]
}

const chipShape = {
  dimension: z
    .string()
    .describe(
      'One of: genre, ip (franchise), person, strand, community, day, track, format, venue, time, duration, audience, accessibility',
    ),
  value: z.string().describe('The value; loose casing is fine — it is resolved to the real corpus value'),
  negated: z.boolean().optional().describe('Constraints only: exclude events with this value'),
}

const chipSchema = z.object(chipShape)

export function buildTools(ctx: ToolContext, capture: TurnCapture) {
  const eventByUid = new Map(ctx.events.map((event) => [event.uid, event]))
  const candByUid = new Map(ctx.candidates.map((candidate) => [candidate.uid, candidate]))

  const summarize = (uid: string): EventSummary | null => {
    const event = eventByUid.get(uid)
    if (!event) return null
    return { uid, title: event.title, start: event.start, room: event.room, track: event.track }
  }
  const summaries = (uids: readonly string[]): EventSummary[] =>
    uids.map(summarize).filter((s): s is EventSummary => s !== null)

  /** Distinct values present in the corpus for a dimension — the pool
   *  `resolveFacetValue` maps a loose model token onto. */
  const valuesFor = (dimension: string): string[] => {
    const set = new Set<string>()
    for (const candidate of ctx.candidates) {
      for (const value of candidate.dimensions[dimension] ?? []) set.add(value)
    }
    return [...set]
  }

  const resolveChips = (chips: readonly z.infer<typeof chipSchema>[]): {
    resolved: FilterChip[]
    unresolved: string[]
  } => {
    const resolved: FilterChip[] = []
    const unresolved: string[] = []
    for (const chip of chips) {
      const value = resolveFacetValue(chip.value, valuesFor(chip.dimension))
      if (value) resolved.push({ dimension: chip.dimension, value, negated: chip.negated })
      else unresolved.push(`${chip.dimension}: ${chip.value}`)
    }
    return { resolved, unresolved }
  }

  return {
    apply_filters: tool({
      description:
        'Set the filter, lens, and/or view. Returns the real matched count and the resolved filter. Use the count it reports, never your own.',
      inputSchema: z.object({
        clear: z.boolean().optional().describe('Reset to an empty filter before applying the rest'),
        add: z.array(chipSchema).optional(),
        remove: z.array(z.object({ dimension: z.string(), value: z.string() })).optional(),
        text: z.string().nullable().optional().describe('Free-text search; null or "" clears it'),
        starredOnly: z.boolean().optional(),
        changedOnly: z.boolean().optional(),
        lens: z.enum(['ip', 'people', 'facets']).optional(),
        view: z.enum(['graph', 'schedule']).optional(),
      }),
      execute: async (intent) => {
        capture.toolTrace.push('apply_filters')
        const { resolved, unresolved } = resolveChips(intent.add ?? [])
        const nextFilter = applyFilterIntent(ctx.filter, { ...intent, add: resolved })
        const count = applyFilter(ctx.candidates, nextFilter, ctx.matchContext).length
        capture.patch = { filter: nextFilter, lens: intent.lens, view: intent.view }
        return {
          count,
          applied: describeFilter(nextFilter).map((part) => part.label),
          unresolved,
          lens: intent.lens ?? null,
          view: intent.view ?? null,
        }
      },
    }),

    list_facet_values: tool({
      description:
        'List the real values in a dimension (e.g. which franchises or genres exist) with how many events carry each, under the current filter.',
      inputSchema: z.object({
        dimension: z.string(),
        limit: z.number().int().positive().optional(),
      }),
      execute: async ({ dimension, limit }) => {
        capture.toolTrace.push('list_facet_values')
        const options = facetOptions(ctx.candidates, ctx.filter, ctx.matchContext, dimension).slice(
          0,
          limit ?? 25,
        )
        return { dimension, values: options.map((o) => ({ value: o.value, count: o.count })) }
      },
    }),

    search_events: tool({
      description:
        'Find events by free text and/or chips. Returns a capped list of matches plus the true total count.',
      inputSchema: z.object({
        text: z.string().optional(),
        add: z.array(chipSchema).optional(),
        limit: z.number().int().positive().optional(),
      }),
      execute: async ({ text, add, limit }) => {
        capture.toolTrace.push('search_events')
        const { resolved, unresolved } = resolveChips(add ?? [])
        const state = applyFilterIntent(EMPTY_FILTER, { text: text ?? undefined, add: resolved })
        const hits = applyFilter(ctx.candidates, state, ctx.matchContext)
        const shown = summaries(hits.slice(0, limit ?? 10).map((c) => c.uid))
        return { count: hits.length, shown: shown.length, events: shown, unresolved }
      },
    }),

    get_event: tool({
      description:
        "Read one event's full description and people. Its card is rendered next to your reply — summarize and add judgment rather than repeating every field.",
      inputSchema: z.object({ uid: z.string() }),
      execute: async ({ uid }) => {
        capture.toolTrace.push('get_event')
        const event = eventByUid.get(uid)
        if (!event) return { found: false as const }
        if (!capture.eventUids.includes(uid)) capture.eventUids.push(uid)
        const candidate = candByUid.get(uid)
        return {
          found: true as const,
          uid,
          title: event.title,
          start: event.start,
          room: event.room,
          track: event.track,
          description: event.description,
          people: candidate?.dimensions.person ?? [],
          franchises: candidate?.dimensions.ip ?? [],
          starred: ctx.matchContext.isStarred(uid),
        }
      },
    }),

    get_starred: tool({
      description: "The user's starred events.",
      inputSchema: z.object({}),
      execute: async () => {
        capture.toolTrace.push('get_starred')
        const events = summaries(
          ctx.candidates.filter((c) => ctx.matchContext.isStarred(c.uid)).map((c) => c.uid),
        )
        return { count: events.length, events }
      },
    }),

    propose_action: tool({
      description:
        'Propose starring or exporting specific events. The app shows a confirm card; the user commits with one tap. Never assume it is done.',
      inputSchema: z.object({
        kind: z.enum(['star', 'export']),
        uids: z.array(z.string()),
        note: z.string().optional().describe('One-line rationale shown above the confirm buttons'),
      }),
      execute: async ({ kind, uids, note }) => {
        capture.toolTrace.push('propose_action')
        const events = summaries(uids)
        capture.proposedAction = { kind, events, note }
        return { proposed: kind, count: events.length, note: note ?? null, awaitingConfirmation: true }
      },
    }),
  }
}

export type ChatTools = ReturnType<typeof buildTools>

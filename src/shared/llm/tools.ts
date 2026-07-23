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
import { applyFilter, describeFilter, facetOptions } from '../filter/engine'
import { facetValueLabel } from '../filter/labels'
import { EMPTY_FILTER, type FilterCandidate, type FilterChip, type FilterState, type MatchContext } from '../filter/types'
import { applyFilterIntent, resolveFacetValue } from '../chat'
import type { AppStatePatch, EventSummary, ProposedAction, ViewName } from '../chat'
import type { LensId } from '../graph/types'
import type { ScheduleEvent } from '../schedule'

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
      'One of: genre, ip (franchise), person, strand, community, day, track, format, venue (building), room (exact room, e.g. "Hall H"), time, duration, audience, accessibility',
    ),
  value: z.string().describe('The value; loose casing is fine — it is resolved to the real corpus value'),
  negated: z.boolean().optional().describe('Constraints only: exclude events with this value'),
}

const chipSchema = z.object(chipShape)

/** How many event uids a turn may mark linkable. Generous, because the set only
 *  powers inline links — a name the model does not write is never rendered — so
 *  a big scope costs nothing, and a tight cap is what dropped the real results
 *  after an exploratory search filled it first. */
const LINKABLE_CAP = 60

/** ISO → "Fri, Jul 24, 10:00 AM", in Pacific (where the con runs). Given to the
 *  model so it repeats a correct time instead of computing a weekday itself. */
function formatWhen(iso: string | null): string | null {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/Los_Angeles',
  }).format(date)
}

export function buildTools(ctx: ToolContext, capture: TurnCapture) {
  const eventByUid = new Map(ctx.events.map((event) => [event.uid, event]))
  const candByUid = new Map(ctx.candidates.map((candidate) => [candidate.uid, candidate]))
  const valueSets = new Map<string, Set<string>>()
  for (const candidate of ctx.candidates) {
    for (const [dimension, values] of Object.entries(candidate.dimensions)) {
      let set = valueSets.get(dimension)
      if (!set) {
        set = new Set()
        valueSets.set(dimension, set)
      }
      for (const value of values) set.add(value)
    }
  }
  const facetIndexes = new Map(
    [...valueSets].map(([dimension, set]) => {
      const values = [...set]
      const valuesByLabel = new Map<string, string[]>()
      for (const value of values) {
        const label = facetValueLabel(dimension, value)
        const bucket = valuesByLabel.get(label)
        if (bucket) bucket.push(value)
        else valuesByLabel.set(label, [value])
      }
      return [dimension, { values, valuesByLabel }] as const
    }),
  )

  // Human names, not machine ids — whatever appears in a tool result is what
  // the model will quote in prose, and the user should never read
  // "star-wars-lego".
  const labelAll = (dimension: string, values: readonly string[]): string[] =>
    values.map((value) => facetValueLabel(dimension, value))

  const summarize = (uid: string): EventSummary | null => {
    const event = eventByUid.get(uid)
    if (!event) return null
    return { uid, title: event.title, start: event.start, room: event.room, track: event.track }
  }
  const summaries = (uids: readonly string[]): EventSummary[] =>
    uids.map(summarize).filter((s): s is EventSummary => s !== null)

  // Model-facing rows carry a ready-to-read time so the model never computes a
  // weekday from a raw ISO string — models get that wrong (2026-07-24 is a
  // Friday, and more than one guessed Thursday). Pacific, because the con is.
  const toolRow = (uid: string): (EventSummary & { when: string | null }) | null => {
    const summary = summarize(uid)
    return summary ? { ...summary, when: formatWhen(summary.start) } : null
  }
  const toolRows = (uids: readonly string[]): (EventSummary & { when: string | null })[] =>
    uids.map(toolRow).filter((r): r is EventSummary & { when: string | null } => r !== null)

  // Mark uids linkable — deduped, capped — so the model's bolded names resolve
  // to cards without a broad search flooding the transcript.
  const markLinkable = (uids: readonly string[]): void => {
    for (const uid of uids) {
      if (capture.eventUids.length >= LINKABLE_CAP) break
      if (!capture.eventUids.includes(uid)) capture.eventUids.push(uid)
    }
  }

  /**
   * Resolve a loose model token to a corpus value — directly, or via the value's
   * human label. The prompt tells the model to quote labels in prose
   * ("Sci-Fi & Fantasy"), and several labels spell differently from their slugs
   * ('scifi-fantasy'), so a label echoed back as a chip value must still land.
   */
  const resolveValue = (dimension: string, requested: string): string | null => {
    const index = facetIndexes.get(dimension)
    const values = index?.values ?? []
    const direct = resolveFacetValue(requested, values)
    if (direct) return direct
    const valuesByLabel = index?.valuesByLabel ?? new Map<string, string[]>()
    const label = resolveFacetValue(requested, [...valuesByLabel.keys()])
    const hits = label ? (valuesByLabel.get(label) ?? []) : []
    return hits.length === 1 ? hits[0]! : null
  }

  const resolveChips = (chips: readonly z.infer<typeof chipSchema>[]): {
    resolved: FilterChip[]
    unresolved: string[]
  } => {
    const resolved: FilterChip[] = []
    const unresolved: string[] = []
    for (const chip of chips) {
      const value = resolveValue(chip.dimension, chip.value)
      if (value) resolved.push({ dimension: chip.dimension, value, negated: chip.negated })
      else unresolved.push(`${chip.dimension}: ${chip.value}`)
    }
    return { resolved, unresolved }
  }

  /** The remove path needs the same resolution as add: the model knows a chip
   *  by its label, but the stored chip carries the slug — an unresolved remove
   *  falls back to the raw string so exact removals keep working. */
  const resolveRemovals = (
    targets: readonly { dimension: string; value: string }[] | undefined,
  ): { dimension: string; value: string }[] | undefined =>
    targets?.map((target) => ({
      dimension: target.dimension,
      value: resolveValue(target.dimension, target.value) ?? target.value,
    }))

  return {
    apply_filters: tool({
      description:
        'Filter the schedule (chips, text, starred/changed). Does NOT change the view or lens — those have their own tool. Returns the real matched count, the resolved filter, and a small sample of the actual matched events (with genres and franchises). Use the count it reports, and describe only the events in the sample — do not guess the composition of the rest.',
      inputSchema: z.object({
        clear: z.boolean().optional().describe('Reset to an empty filter before applying the rest'),
        add: z.array(chipSchema).optional(),
        remove: z.array(z.object({ dimension: z.string(), value: z.string() })).optional(),
        text: z.string().nullable().optional().describe('Free-text search; null or "" clears it'),
        starredOnly: z.boolean().optional(),
        changedOnly: z.boolean().optional(),
      }),
      execute: async (intent) => {
        capture.toolTrace.push('apply_filters')
        const { resolved, unresolved } = resolveChips(intent.add ?? [])
        // Build on any filter an earlier apply_filters set this turn, not the
        // turn-start snapshot — two calls in one turn must compound.
        const base = capture.patch?.filter ?? ctx.filter
        const nextFilter = applyFilterIntent(base, {
          ...intent,
          add: resolved,
          remove: resolveRemovals(intent.remove),
        })
        const matched = applyFilter(ctx.candidates, nextFilter, ctx.matchContext)
        // Merge into the patch — a turn may also set the view via set_view.
        capture.patch = { ...capture.patch, filter: nextFilter }
        // Return the real matched events (a sample), so the model describes what
        // actually matched instead of inventing which franchise each one carries.
        const sample = matched.slice(0, 6).flatMap((c) => {
          const row = toolRow(c.uid)
          return row
            ? [{
                uid: row.uid,
                title: row.title,
                when: row.when,
                room: row.room,
                genres: labelAll('genre', c.dimensions.genre ?? []),
                franchises: labelAll('ip', c.dimensions.ip ?? []),
              }]
            : []
        })
        // The events the model will name in its reply — make them linkable.
        markLinkable(sample.map((s) => s.uid))
        return {
          count: matched.length,
          applied: describeFilter(nextFilter).map((part) => part.label),
          sample,
          sampleNote: matched.length > sample.length ? `showing ${sample.length} of ${matched.length}` : 'complete',
          unresolved,
        }
      },
    }),

    set_view: tool({
      description:
        'Switch the main view (graph or schedule/5-day list) and/or the graph lens (ip / people / facets). ONLY call this when the user explicitly asks to change the view or the lens — never as a side effect of filtering. Leaving both unset is a no-op.',
      inputSchema: z.object({
        view: z.enum(['graph', 'schedule']).optional(),
        lens: z.enum(['ip', 'people', 'facets']).optional(),
      }),
      execute: async ({ view, lens }) => {
        capture.toolTrace.push('set_view')
        // Merge only the fields this call provided — a second set_view that names
        // just the lens must not blank out a view an earlier call set.
        capture.patch = {
          ...capture.patch,
          ...(view !== undefined ? { view } : {}),
          ...(lens !== undefined ? { lens } : {}),
        }
        return { view: view ?? null, lens: lens ?? null }
      },
    }),

    list_facet_values: tool({
      description:
        'List the real values in a dimension (e.g. which franchises or genres exist) with how many events carry each, under the current filter.',
      inputSchema: z.object({
        dimension: z.string(),
        // Capped: one tool call must not be able to flood the turn's context.
        limit: z.number().int().positive().max(50).optional(),
      }),
      execute: async ({ dimension, limit }) => {
        capture.toolTrace.push('list_facet_values')
        // Reflect any filter applied earlier this turn, not just the snapshot.
        const base = capture.patch?.filter ?? ctx.filter
        const options = facetOptions(ctx.candidates, base, ctx.matchContext, dimension).slice(
          0,
          limit ?? 25,
        )
        return {
          dimension,
          // `label` is the human name to use in prose; `value` is the token a
          // chip carries (though resolution accepts either form).
          values: options.map((o) => ({
            value: o.value,
            label: facetValueLabel(dimension, o.value),
            count: o.count,
          })),
        }
      },
    }),

    search_events: tool({
      description:
        'Find events by free text and/or chips. Returns a capped list of matches plus the true total count.',
      inputSchema: z.object({
        text: z.string().optional(),
        add: z.array(chipSchema).optional(),
        // Capped: one tool call must not be able to flood the turn's context.
        limit: z.number().int().positive().max(50).optional(),
      }),
      execute: async ({ text, add, limit }) => {
        capture.toolTrace.push('search_events')
        const { resolved, unresolved } = resolveChips(add ?? [])
        const state = applyFilterIntent(EMPTY_FILTER, { text: text ?? undefined, add: resolved })
        const hits = applyFilter(ctx.candidates, state, ctx.matchContext)
        const shown = toolRows(hits.slice(0, limit ?? 10).map((c) => c.uid))
        // Surface the found events as linked cards in the chat (capped so a broad
        // search doesn't flood the transcript), deduped against get_event's.
        markLinkable(shown.map((row) => row.uid))
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
          when: formatWhen(event.start),
          start: event.start,
          room: event.room,
          track: event.track,
          description: event.description,
          people: candidate?.dimensions.person ?? [],
          franchises: labelAll('ip', candidate?.dimensions.ip ?? []),
          starred: ctx.matchContext.isStarred(uid),
        }
      },
    }),

    get_starred: tool({
      description: "The user's starred events.",
      inputSchema: z.object({}),
      execute: async () => {
        capture.toolTrace.push('get_starred')
        const events = toolRows(
          ctx.candidates.filter((c) => ctx.matchContext.isStarred(c.uid)).map((c) => c.uid),
        )
        // Starred titles get named in the reply too — make them linkable.
        markLinkable(events.map((e) => e.uid))
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
        // Dedupe first: a repeated uid would double-toggle a star on confirm and
        // collide as a React key in the confirm card.
        const events = summaries([...new Set(uids)])
        capture.proposedAction = { kind, events, note }
        return { proposed: kind, count: events.length, note: note ?? null, awaitingConfirmation: true }
      },
    }),
  }
}

export type ChatTools = ReturnType<typeof buildTools>

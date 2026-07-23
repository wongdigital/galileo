import type { SnapshotSlots } from '../storage/slots'
import { buildDataset } from './join'
import { CURRENT_SCHEMA_VERSION, resolveRefresh } from './guard'
import type { FetchedDataset } from './guard'
import type { DatasetProjection, Snapshot } from './types'

/** Complete raw responses from one schedule fetch. */
export interface ScheduleSources {
  ics: string
  listHtml: string
}

export interface RefreshDependencies {
  site: string
  fetchSources: () => Promise<ScheduleSources>
  slots: SnapshotSlots
  /** Injected so shared refresh logic has no ambient clock in tests or hosts. */
  now?: () => Date
  warn?: (error: unknown) => void
}

export interface RefreshOptions {
  acceptAnyway?: boolean
}

interface FlightState {
  readonly byOption: Map<boolean, Promise<DatasetProjection>>
  tail: Promise<DatasetProjection> | null
}

const flights = new WeakMap<SnapshotSlots, FlightState>()

/**
 * Fetch, validate, guard, and commit a schedule refresh for any platform.
 *
 * The persistence order is a prefix-consistency invariant: last-fetched,
 * verdict, last-known-good promotion, then change log. Every await is a
 * possible process-suspension boundary, so do not reorder these steps.
 */
export function performRefresh(
  dependencies: RefreshDependencies,
  options: RefreshOptions = {},
): Promise<DatasetProjection> {
  const acceptAnyway = options.acceptAnyway ?? false
  let state = flights.get(dependencies.slots)
  if (!state) {
    state = { byOption: new Map(), tail: null }
    flights.set(dependencies.slots, state)
  }

  const existing = state.byOption.get(acceptAnyway)
  if (existing) return existing

  const run = () => runRefresh(dependencies, acceptAnyway)
  const promise = state.tail ? state.tail.then(run, run) : run()
  state.byOption.set(acceptAnyway, promise)
  state.tail = promise

  const cleanup = (): void => {
    if (state?.byOption.get(acceptAnyway) === promise) state.byOption.delete(acceptAnyway)
    if (state?.tail === promise && state.byOption.size === 0) flights.delete(dependencies.slots)
  }
  void promise.then(cleanup, cleanup)
  return promise
}

async function runRefresh(dependencies: RefreshDependencies, acceptAnyway: boolean): Promise<DatasetProjection> {
  const fetched = await fetchAndBuild(dependencies)

  if (!fetched) {
    // A rejected or incomplete fetch is not a commit attempt: even the
    // advisory change log stays untouched.
    const lastKnownGood = await dependencies.slots.readSnapshot('last-known-good')
    const log = await dependencies.slots.readChangeLog()
    return resolveRefresh({ fetched: null, lastKnownGood, log, acceptAnyway }).projection
  }

  const fetchedSnapshot = toSnapshot(fetched)

  // Prefix 1: preserve the complete candidate for inspection before deciding
  // whether it is safe to promote. Promotion copies; it never vacates this.
  await dependencies.slots.writeSnapshot('last-fetched', fetchedSnapshot)

  // Prefix 2: the verdict is pure and computed against durable prior state.
  const lastKnownGood = await dependencies.slots.readSnapshot('last-known-good')
  const log = await dependencies.slots.readChangeLog()
  const outcome = resolveRefresh({ fetched, lastKnownGood, log, acceptAnyway })

  // Prefix 3: correct served data matters more than perfectly current badges.
  if (outcome.promote) await dependencies.slots.writeSnapshot('last-known-good', outcome.promote)

  // Prefix 4: the advisory log lands last and is recomputable from snapshots.
  try {
    await dependencies.slots.writeChangeLog(outcome.log)
  } catch (error) {
    dependencies.warn?.(error)
  }
  return outcome.projection
}

async function fetchAndBuild(dependencies: RefreshDependencies): Promise<FetchedDataset | null> {
  try {
    const sources = await dependencies.fetchSources()
    assertCompleteSources(sources)
    // Stamp only after both source requests have resolved. A request suspended
    // for hours must not report the time at which it started as freshness.
    const fetchedAt = (dependencies.now?.() ?? new Date()).toISOString()
    const { events, stats } = buildDataset(sources.ics, sources.listHtml, { site: dependencies.site })
    return { events, stats, site: dependencies.site, fetchedAt }
  } catch (error) {
    dependencies.warn?.(error)
    return null
  }
}

function assertCompleteSources(sources: ScheduleSources): void {
  if (
    !sources ||
    typeof sources.ics !== 'string' ||
    typeof sources.listHtml !== 'string' ||
    !/(^|\r?\n)BEGIN:VCALENDAR(?:\r?\n|$)/.test(sources.ics) ||
    !/(^|\r?\n)END:VCALENDAR(?:\r?\n|$)/.test(sources.ics)
  ) {
    throw new Error('Incomplete or invalid schedule source payload')
  }
}

function toSnapshot(fetched: FetchedDataset): Snapshot {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    fetchedAt: fetched.fetchedAt,
    site: fetched.site,
    events: fetched.events,
    stats: fetched.stats,
  }
}

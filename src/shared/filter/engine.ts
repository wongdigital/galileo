/**
 * The match engine. One implementation of "interests union, constraints
 * intersect", inherited identically by the sidebar chips and (Phase B) chat.
 *
 * The rule in full:
 *
 *   match = (no interests OR event matches ANY interest chip)
 *         AND (for each constrained dimension: event matches ANY of its values)
 *         AND text AND starred AND changed
 *
 * Two levels of OR, and they mean different things. Across interest dimensions
 * it is the union of what you like. Within one constraint dimension it is
 * "Saturday or Sunday" — because nothing is both, so intersecting there would
 * always return zero and a filter UI that returns zero when you click twice is
 * a broken filter UI.
 */

import {
  dimensionKind,
  findDimension,
  type FilterCandidate,
  type FilterChip,
  type FilterState,
  type MatchContext,
} from './types'

function candidateHas(candidate: FilterCandidate, chip: FilterChip): boolean {
  return candidate.dimensions[chip.dimension]?.includes(chip.value) ?? false
}

interface PartitionedFilter {
  interests: FilterChip[]
  /** Constraint chips grouped by dimension so each group ORs internally. */
  constraints: Map<string, FilterChip[]>
}

export function partitionChips(chips: readonly FilterChip[]): PartitionedFilter {
  const interests: FilterChip[] = []
  const constraints = new Map<string, FilterChip[]>()
  for (const chip of chips) {
    if (dimensionKind(chip.dimension) === 'interest') {
      interests.push(chip)
      continue
    }
    const bucket = constraints.get(chip.dimension)
    if (bucket) bucket.push(chip)
    else constraints.set(chip.dimension, [chip])
  }
  return { interests, constraints }
}

function matchesConstraintGroup(candidate: FilterCandidate, group: FilterChip[]): boolean {
  // Negations are conjunctive even inside a dimension: "not Marriott, not Hilton"
  // has to exclude both. Only the positive members of the group OR together.
  const positives = group.filter((c) => !c.negated)
  for (const chip of group) {
    if (chip.negated && candidateHas(candidate, chip)) return false
  }
  if (positives.length === 0) return true
  return positives.some((chip) => candidateHas(candidate, chip))
}

export function matchesFilter(
  candidate: FilterCandidate,
  state: FilterState,
  ctx: MatchContext
): boolean {
  if (state.starredOnly && !ctx.isStarred(candidate.uid)) return false
  if (state.changedOnly && !ctx.hasUnseenChanges(candidate.uid)) return false

  const text = state.text.trim().toLowerCase()
  if (text.length > 0 && !candidate.haystack.includes(text)) return false

  const { interests, constraints } = partitionChips(state.chips)

  if (interests.length > 0 && !interests.some((chip) => candidateHas(candidate, chip))) {
    return false
  }

  for (const group of constraints.values()) {
    if (!matchesConstraintGroup(candidate, group)) return false
  }

  return true
}

export function applyFilter(
  candidates: readonly FilterCandidate[],
  state: FilterState,
  ctx: MatchContext
): FilterCandidate[] {
  return candidates.filter((c) => matchesFilter(c, state, ctx))
}

export function filteredUids(
  candidates: readonly FilterCandidate[],
  state: FilterState,
  ctx: MatchContext
): string[] {
  return applyFilter(candidates, state, ctx).map((c) => c.uid)
}

export function isEmptyFilter(state: FilterState): boolean {
  return (
    state.chips.length === 0 &&
    state.text.trim().length === 0 &&
    !state.starredOnly &&
    !state.changedOnly
  )
}

// ---------- chip editing ----------

export function sameChip(a: FilterChip, b: FilterChip): boolean {
  return a.dimension === b.dimension && a.value === b.value && !a.negated === !b.negated
}

export function hasChip(state: FilterState, chip: FilterChip): boolean {
  return state.chips.some((c) => sameChip(c, chip))
}

export function addChip(state: FilterState, chip: FilterChip): FilterState {
  if (hasChip(state, chip)) return state
  // A chip and its negation are the same statement twice with opposite signs;
  // the newer one wins rather than producing an unsatisfiable pair.
  const kept = state.chips.filter(
    (c) => !(c.dimension === chip.dimension && c.value === chip.value)
  )
  return { ...state, chips: [...kept, chip] }
}

export function removeChip(state: FilterState, chip: FilterChip): FilterState {
  return { ...state, chips: state.chips.filter((c) => !sameChip(c, chip)) }
}

export function toggleChip(state: FilterState, chip: FilterChip): FilterState {
  return hasChip(state, chip) ? removeChip(state, chip) : addChip(state, chip)
}

// ---------- describing the active filter ----------

export type ChipLabeler = (chip: FilterChip) => string

/** Fallback labels: `late-night` reads as "Late night". Good enough for a
 *  dimension whose values the UI has no curated label for. */
export const defaultChipLabeler: ChipLabeler = (chip) => {
  const words = chip.value.replace(/[-_]+/g, ' ').trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

export interface FilterDescriptionPart {
  chip?: FilterChip
  /** Which pseudo-chip this is, for the ones that aren't facet chips. */
  kind: 'chip' | 'text' | 'starred' | 'changed'
  label: string
}

/**
 * The zero-result state has to name what is actually excluding things, which
 * means every active input gets a part — including the ones that aren't chips.
 * "No events match" is a dead end; "No events match Horror, Saturday, starred"
 * tells you which one to drop.
 */
export function describeFilter(
  state: FilterState,
  labeler: ChipLabeler = defaultChipLabeler
): FilterDescriptionPart[] {
  const parts: FilterDescriptionPart[] = []
  for (const chip of state.chips) {
    const dimension = findDimension(chip.dimension)
    const label = labeler(chip)
    parts.push({
      chip,
      kind: 'chip',
      label: chip.negated
        ? `not ${label}`
        : dimension
          ? `${dimension.label}: ${label}`
          : label,
    })
  }
  if (state.text.trim().length > 0) {
    parts.push({ kind: 'text', label: `"${state.text.trim()}"` })
  }
  if (state.starredOnly) parts.push({ kind: 'starred', label: 'starred only' })
  if (state.changedOnly) parts.push({ kind: 'changed', label: 'changed only' })
  return parts
}

// ---------- relaxation ----------

export interface Relaxation {
  part: FilterDescriptionPart
  /** How many events come back if this one input is dropped. */
  count: number
}

/**
 * "Removing Saturday gives you 47." Computed by re-running the engine once per
 * active input, which is O(inputs x events) — fine at 3,474 events and a
 * handful of chips, and it means the number offered is the number delivered
 * rather than an estimate that can be wrong.
 */
export function relaxations(
  candidates: readonly FilterCandidate[],
  state: FilterState,
  ctx: MatchContext
): Relaxation[] {
  const out: Relaxation[] = []
  for (const part of describeFilter(state)) {
    const relaxed = relaxPart(state, part)
    out.push({ part, count: applyFilter(candidates, relaxed, ctx).length })
  }
  return out.filter((r) => r.count > 0).sort((a, b) => b.count - a.count)
}

function relaxPart(state: FilterState, part: FilterDescriptionPart): FilterState {
  switch (part.kind) {
    case 'chip':
      return part.chip ? removeChip(state, part.chip) : state
    case 'text':
      return { ...state, text: '' }
    case 'starred':
      return { ...state, starredOnly: false }
    case 'changed':
      return { ...state, changedOnly: false }
  }
}

// ---------- available values ----------

export interface FacetOption {
  dimension: string
  value: string
  /** Events carrying this value under the *rest* of the active filter, so the
   *  count previews what clicking actually gets you. */
  count: number
}

/**
 * Counts are computed against the filter with this dimension's own chips
 * removed — the standard facet-count rule. Counting against the full active
 * filter would zero out every unselected value in a single-select dimension
 * (pick Saturday and Sunday reads 0), which makes the counts useless exactly
 * when the user needs them.
 */
export function facetOptions(
  candidates: readonly FilterCandidate[],
  state: FilterState,
  ctx: MatchContext,
  dimension: string
): FacetOption[] {
  const withoutDimension: FilterState = {
    ...state,
    chips: state.chips.filter((c) => c.dimension !== dimension),
  }
  const pool = applyFilter(candidates, withoutDimension, ctx)

  const counts = new Map<string, number>()
  for (const candidate of pool) {
    for (const value of candidate.dimensions[dimension] ?? []) {
      counts.set(value, (counts.get(value) ?? 0) + 1)
    }
  }

  return [...counts.entries()]
    .map(([value, count]) => ({ dimension, value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
}

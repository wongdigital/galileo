/**
 * The pure half of `apply_filters`: turning a model's `FilterIntent` into the
 * exact `FilterState` a chip click would have produced, and resolving the
 * loose value strings the model emits ("star wars") to the real corpus tokens
 * ("Star Wars") the engine matches on.
 *
 * Kept pure and here so it is tested without a provider, a key, or Electron —
 * main's tool `execute` does the value resolution against the live candidate
 * index, then hands resolved chips to `applyFilterIntent`.
 */

import { addChip } from '../filter/engine'
import { dimensionKind, EMPTY_FILTER, type FilterChip, type FilterState } from '../filter/types'
import type { FilterIntent } from './types'

export function applyFilterIntent(current: FilterState, intent: FilterIntent): FilterState {
  let next: FilterState = intent.clear ? EMPTY_FILTER : current

  for (const raw of intent.add ?? []) {
    // Negation is meaningless on an interest union — it would exclude nothing,
    // since the union is additive — so drop it before it becomes a chip the
    // engine silently ignores and the user cannot explain.
    const chip: FilterChip =
      dimensionKind(raw.dimension) === 'interest'
        ? { dimension: raw.dimension, value: raw.value }
        : raw
    next = addChip(next, chip)
  }

  for (const target of intent.remove ?? []) {
    next = {
      ...next,
      chips: next.chips.filter(
        (c) => !(c.dimension === target.dimension && c.value === target.value),
      ),
    }
  }

  if (intent.text !== undefined) next = { ...next, text: intent.text ?? '' }
  if (intent.starredOnly !== undefined) next = { ...next, starredOnly: intent.starredOnly }
  if (intent.changedOnly !== undefined) next = { ...next, changedOnly: intent.changedOnly }

  return next
}

/**
 * Map a value the model asked for to a real value present in the corpus for
 * that dimension. Exact case-insensitive match first — the model usually gets
 * the token right — then a *unique* substring match so "star wars" finds
 * "Star Wars" without a lookup round-trip. Two or more substring hits is
 * ambiguous and returns null rather than guessing; the caller reports it back
 * so the model can disambiguate or ask.
 */
export function resolveFacetValue(requested: string, available: readonly string[]): string | null {
  const want = requested.trim().toLowerCase()
  if (!want) return null

  for (const value of available) {
    if (value.toLowerCase() === want) return value
  }

  const matches = available.filter((value) => {
    const v = value.toLowerCase()
    return v.includes(want) || want.includes(v)
  })
  return matches.length === 1 ? matches[0]! : null
}

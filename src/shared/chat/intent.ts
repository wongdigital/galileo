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
    // Value casing drifts between what the model emits and the corpus token the
    // chip stored ("horror" vs "Horror"), so match it case-insensitively;
    // dimension is a fixed key and stays exact.
    const wantValue = target.value.toLowerCase()
    next = {
      ...next,
      chips: next.chips.filter(
        (c) => !(c.dimension === target.dimension && c.value.toLowerCase() === wantValue),
      ),
    }
  }

  if (intent.text !== undefined) next = { ...next, text: intent.text ?? '' }
  if (intent.starredOnly !== undefined) next = { ...next, starredOnly: intent.starredOnly }
  if (intent.changedOnly !== undefined) next = { ...next, changedOnly: intent.changedOnly }

  return next
}

/**
 * Lowercased with every run of punctuation and whitespace collapsed to one
 * space, so casing and separator differences cannot defeat a match — "Star
 * Wars" and the canonical slug "star-wars" normalize identically. Collapsed to
 * a *space*, not to nothing: word boundaries have to survive, or the substring
 * stage would let "art" match "Star Trek". Unicode-aware so "Pokémon" keeps
 * its é rather than splitting on it.
 */
const normalize = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()

/**
 * Map a value the model asked for to a real value present in the corpus for
 * that dimension. Exact match on the normalized form first — so "Star Wars"
 * finds the slug "star-wars" directly — then a *unique* substring match so
 * "lego" finds "star-wars-lego" without a lookup round-trip. Two or more
 * substring hits is ambiguous and returns null rather than guessing; the
 * caller reports it back so the model can disambiguate or ask.
 */
export function resolveFacetValue(requested: string, available: readonly string[]): string | null {
  const want = normalize(requested)
  if (!want) return null

  for (const value of available) {
    if (normalize(value) === want) return value
  }

  const matches = available.filter((value) => {
    const v = normalize(value)
    return v.includes(want) || want.includes(v)
  })
  return matches.length === 1 ? matches[0]! : null
}

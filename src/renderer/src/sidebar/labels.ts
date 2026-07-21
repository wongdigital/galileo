/**
 * Human labels for facet values, renderer edition.
 *
 * The table itself lives in `src/shared/filter/labels.ts` so the chat tools in
 * main quote the same names the chips show. The one thing the renderer adds is
 * day formatting: day values are ISO dates, not vocabulary, and the shared
 * layer passes them through so each surface can format them for its own space.
 */

import { dayLabel } from '@renderer/state/derive'
import { facetValueLabel, type FilterChip } from '@shared/filter'

export function valueLabel(dimension: string, value: string): string {
  if (dimension === 'day') {
    const { weekday, date } = dayLabel(value)
    return `${weekday} ${date}`
  }
  return facetValueLabel(dimension, value)
}

export const chipLabel = (chip: FilterChip): string => valueLabel(chip.dimension, chip.value)

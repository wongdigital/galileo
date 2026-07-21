/**
 * Human labels for facet values, renderer edition.
 *
 * The table — and the day formatting — live in `src/shared/filter/labels.ts`
 * so the chat tools in main quote the same names the chips show. This module
 * survives only as the sidebar's established import site.
 */

import { facetValueLabel, type FilterChip } from '@shared/filter'

export const valueLabel = facetValueLabel

export const chipLabel = (chip: FilterChip): string => valueLabel(chip.dimension, chip.value)

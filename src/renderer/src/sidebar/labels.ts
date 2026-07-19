/**
 * Human labels for facet values.
 *
 * The facet map stores machine ids (`scifi-fantasy`, `lgbtqia`, `ccg-tcg`)
 * because that is what filter state should serialize as. Title-casing them
 * mechanically gets most of the way there and gets the ones that matter wrong:
 * "Lgbtqia", "Ccg Tcg", "Bipoc". The overrides below are only for the ids that
 * mechanical casing mangles, so a new facet value added to the table renders
 * acceptably without anyone having to remember to come back here.
 */

import { dayLabel } from '@renderer/state/derive'
import type { FilterChip } from '@shared/filter'

const OVERRIDES: Record<string, string> = {
  // Acronyms and stylized names, which casing cannot recover.
  'scifi-fantasy': 'Sci-Fi & Fantasy',
  'anime-manga': 'Anime & Manga',
  lgbtqia: 'LGBTQIA+',
  bipoc: 'BIPOC',
  'ccg-tcg': 'CCG / TCG',
  rpg: 'RPG',
  cbldf: 'CBLDF',
  'cci-iff': 'CCI Independent Film Festival',
  'comics-arts-conference': 'Comics Arts Conference',
  'college-of-comics': 'College of Comics',
  'creator-connection': 'Creator Connection',
  'exclusive-portal': 'Exclusive Portal',
  'art-illustration': 'Art & Illustration',
  'toys-collectibles': 'Toys & Collectibles',
  'mystery-crime': 'Mystery & Crime',
  'science-tech': 'Science & Tech',
  'anniversaries-tributes': 'Anniversaries & Tributes',
  'web-digital': 'Web & Digital',
  'action-adventure': 'Action & Adventure',
  'video-games': 'Video Games',
  'video-game-play': 'Video Game Play',
  'board-game': 'Board Game',
  'card-game': 'Card Game',
  'model-kit': 'Model Kit',
  'open-captions': 'Open Captions',
  'open-captions-maybe': 'Open Captions (maybe)',
  'no-captions': 'No Captions',

  // Computed dimensions.
  'convention-center': 'Convention Center',
  'late-night': 'Late Night',
  'all-ages': 'All Ages',
  supported: 'Has a player count',
  block: 'All-day block',
  short: 'Under 30m',
  standard: '30m – 90m',
  long: '90m – 4h',
  'not-enriched': 'Not enriched',
}

const titleCase = (id: string): string =>
  id
    .split(/[-_]/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')

export function valueLabel(dimension: string, value: string): string {
  // Days are the one dimension whose values are data, not vocabulary — there is
  // no table entry to write, so they format rather than look up.
  if (dimension === 'day') {
    const { weekday, date } = dayLabel(value)
    return `${weekday} ${date}`
  }
  return OVERRIDES[value] ?? titleCase(value)
}

export const chipLabel = (chip: FilterChip): string => valueLabel(chip.dimension, chip.value)

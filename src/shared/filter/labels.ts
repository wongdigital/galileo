/**
 * Human labels for facet values.
 *
 * The facet map and the enrichment index store machine ids (`scifi-fantasy`,
 * `star-wars-lego`) because that is what filter state should serialize as.
 * Shared because two surfaces quote values back to the user — the sidebar's
 * chips and the chat's tool results — and neither should leak a machine id
 * into prose.
 *
 * Title-casing the ids mechanically gets most of the way there and gets the
 * ones that matter wrong: "Lgbtqia", "Ccg Tcg", "Bipoc". The overrides below
 * are only for the ids that mechanical casing mangles, so a new facet value
 * added to the table renders acceptably without anyone having to remember to
 * come back here.
 */

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

/**
 * Dimensions whose values are not vocabulary ids: person values are real names
 * ("Scott Snyder" — title-casing would mangle a hyphenated surname), room
 * values are Sched's verbatim strings, and day values are ISO dates that a
 * caller may want to format its own way. They pass through untouched.
 */
const VERBATIM_DIMENSIONS = new Set(['person', 'room', 'day'])

const titleCase = (id: string): string =>
  id
    .split(/[-_]/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')

export function facetValueLabel(dimension: string, value: string): string {
  if (VERBATIM_DIMENSIONS.has(dimension)) return value
  return OVERRIDES[value] ?? titleCase(value)
}

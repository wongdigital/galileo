#!/usr/bin/env node
/**
 * Regenerate the local live-corpus fixtures from the last fetch.
 *
 * These are gitignored (tests/fixtures/live/): the descriptions are
 * Sched-authored prose and never get committed. Committed tests use the
 * synthetic fixtures in src/shared/schedule/__tests__/fixtures.ts. This corpus
 * is for characterization work on a real machine — checking a parser change
 * against 3,474 events before trusting it.
 *
 * Two files: the full corpus, and a redacted one (descriptions stripped) that
 * is safe to read in a terminal or paste into an issue.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises'

const source = new URL('../data/events.json', import.meta.url)
const outDir = new URL('../tests/fixtures/live/', import.meta.url)

let events
try {
  events = JSON.parse(await readFile(source, 'utf8'))
} catch {
  console.error('No data/events.json — run `npm run fetch` first.')
  process.exit(1)
}

await mkdir(outDir, { recursive: true })
await writeFile(new URL('events.json', outDir), JSON.stringify(events, null, 1))
await writeFile(
  new URL('events.redacted.json', outDir),
  JSON.stringify(
    events.map(({ description, ...rest }) => ({ ...rest, descriptionLength: description.length })),
    null,
    1,
  ),
)

const clamped = events.filter((e) => e.sanitized)
console.log(
  `tests/fixtures/live/: ${events.length} events ` +
    `(${events.filter((e) => e.shortId).length} joined, ${clamped.length} clamped)`,
)

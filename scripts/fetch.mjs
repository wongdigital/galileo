#!/usr/bin/env node
/**
 * Fetch the full Comic-Con schedule from Sched's public endpoints and emit a
 * single joined dataset at data/events.json.
 *
 * Sources (2 requests total, no auth):
 *   /all.ics            — every event: UID, title, UTC times, track, room, full description
 *   /list/descriptions  — short event ID, sub-category tags, local-time strings
 *
 * A thin wrapper now: parse, sanitize, and join all live in
 * src/shared/schedule/, shared with the app. Only the fetch and the file writes
 * are here, which is the same ten lines src/main/fetchExecutor.ts carries — the
 * shared library stays pure, so fetch execution is duplicated on purpose.
 *
 * Run via tsx (`npm run fetch`); Node cannot import the .ts library unflagged.
 */

import { writeFile, mkdir } from 'node:fs/promises'
import { buildDataset } from '../src/shared/schedule/index.ts'

const SITE = process.env.SCHED_SITE ?? 'https://comiccon2026.sched.com'
const TZ = 'America/Los_Angeles'
const UA = { 'User-Agent': 'sdcc-schedule personal fetcher (roger@wong.digital)' }

async function get(path) {
  const res = await fetch(`${SITE}${path}`, { headers: UA })
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status}`)
  return res.text()
}

const [ics, listHtml] = await Promise.all([get('/all.ics'), get('/list/descriptions')])
const { events, stats } = buildDataset(ics, listHtml, { site: SITE })

await mkdir(new URL('../data/', import.meta.url), { recursive: true })
await writeFile(new URL('../data/events.json', import.meta.url), JSON.stringify(events, null, 1))
await writeFile(
  new URL('../data/meta.json', import.meta.url),
  JSON.stringify(
    {
      fetchedAt: new Date().toISOString(),
      site: SITE,
      timezone: TZ,
      eventCount: stats.eventCount,
      joinedWithListView: stats.joinedWithListView,
      tracks: [...new Set(events.map((e) => e.track).filter(Boolean))].sort(),
    },
    null,
    1,
  ),
)

const clamped = events.filter((e) => e.sanitized).length
console.log(
  `${stats.eventCount} events written to data/events.json ` +
    `(${stats.joinedWithListView} joined with list view, ${clamped} end times clamped)`,
)

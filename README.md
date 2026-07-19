# sdcc-schedule

A better way to browse the Comic-Con San Diego program schedule. Sched's site and app are painful; the underlying data is not.

> **Unofficial.** This project is not affiliated with, endorsed by, or connected to San Diego Comic Convention (Comic-Con International) or Sched. Convention program data is fetched from Sched's public endpoints at runtime for personal use and is **never committed to this repository**—see `.gitignore`. Any future code license covers the code only, not convention data.

## The hybrid data model (read this before contributing)

This repo ships **code and derived facts**. It never ships Sched's program data.

| Committed | Local-only (gitignored) |
| --- | --- |
| Code | `data/events.json`, `data/meta.json` |
| `data/enrichment.json`—extracted people and franchise ids | App snapshots, star file |
| `data/facet-map.json`, `data/aliases.json`, `data/franchise-seed.json` | Enrichment batch request/response intermediates |
| Synthetic test fixtures | Live-corpus test fixtures |

Each instance fetches raw schedule data itself at runtime and joins it against the committed enrichment index. If you are tempted to "helpfully" commit `data/events.json` so others don't have to fetch it—don't. That file is Sched-authored prose and is the one thing this repo must not contain.

## Setup

```sh
npm install
node node_modules/electron/install.js   # if Electron's binary postinstall was skipped
npm run fetch                           # pull today's schedule
npm run dev                             # launch the app
```

Vite is pinned to `^7` and `@vitejs/plugin-react` to `^5`: electron-vite 5 peers Vite ≤7, while current defaults resolve Vite 8.

## Data pipeline

`npm run fetch` pulls the full schedule from Sched's public endpoints (2 requests, no auth) and writes a joined dataset:

- `data/events.json`—all events with title, Pacific-time start/end, track, sub-category tags, room, full description, and canonical Sched URL
- `data/meta.json`—fetch timestamp, counts, track list

Sources:

- `https://comiccon2026.sched.com/all.ics`—public iCal export: every event with UID, UTC times, track, room, full description
- `https://comiccon2026.sched.com/list/descriptions`—adds short event IDs and the sub-category taxonomy (Comics, Horror, Kids, 30 Minutes, etc.)

The two are joined by event UID. The CLI is a thin wrapper over `src/shared/schedule/`—the same parse/sanitize/join the app uses, so the two can't drift.

For a different year, set `SCHED_SITE` (e.g. `SCHED_SITE=https://comiccon2027.sched.com npm run fetch`).

### Why the app diffs snapshots instead of trusting Sched's flags

Categories carry `NEW`/`UPDATED`/`CANCELLED` flags, but they are a static editorial annotation, not a change feed. Measured across two fetches 31 hours apart: the flag counts were byte-identical (86/11/1) while nine events changed title or description underneath them, and two events vanished from the feed without ever being flagged cancelled. So the app persists a snapshot each fetch and diffs prior→current per UID. See `docs/solutions/2026-07-18-uid-is-the-identity-key.md`.

## Maintainer runbook: compiling the enrichment index

Speaker and franchise data is not structured in Sched—names appear only inside description prose, and franchises mostly appear in descriptions rather than titles (Spider-Man is in 37 events but only 4 titles; Jurassic and Stranger Things in zero). A title string-match finds a fraction of the real connections, which is why this step exists.

Everything else—event classes, offering clusters, facets—is **deterministic and needs no compile step**. It is computed at runtime in `src/shared/enrichment/`. Only people and franchises come from the LLM.

Requires an `ANTHROPIC_API_KEY` in `.env` (gitignored). One full run costs roughly $4–5 and takes well under an hour.

```sh
npm run scan-franchises          # candidate franchises, ranked by IP-lens value
npm run enrich submit            # fire the batch
npm run enrich poll              # check status
npm run enrich merge             # validate spans, write data/enrichment.json
# or: npm run enrich run         # submit, wait, merge
```

**Reviewing the result before you commit it.** The index serializes deterministically, so a rerun should produce a small readable `git diff`. If a rerun rewrites the whole file, something changed in the schema or prompt—find out what before committing.

Check these after every compile:

- **Coverage by track, not in aggregate.** Aggregate people coverage is ~35% and that is expected: GAMES and ANIME are demos and screenings that name nobody. The number that matters is PROGRAMS (91%) and AUTOGRAPHS (100%).
- **The review bucket** (`data/review-bucket.json`, gitignored) holds spans rejected as non-verbatim—roughly 1% of extractions. Every extracted name and franchise surface must appear literally in the source text; anything that doesn't is a hallucination regardless of how plausible it reads, and never enters the index.
- **`other`-bucketed franchises.** About half of franchise mentions land in `other`, mostly long-tail anime and board-game titles. That's by design: `surface_text` is always preserved.

**Promoting an `other` to a canonical** does not require a batch rerun. Add the lowercased surface text to `data/aliases.json`:

```json
{ "franchises": { "mando": "star-wars" } }
```

Aliases are applied **last** in the merge, so a rerun never clobbers a correction.

**Curating `data/facet-map.json`.** 144 of Sched's ~181 sub-category tags map to facet dimensions. Unmapped tags surface in a review bucket rather than being silently dropped—most are guest names and small publishers used as sub-categories, which are correctly not facets. Add genuinely new tags as the con approaches; facets are applied at runtime, so con-week NEW events keep working facets without a recompile.

## The entity map

The second view is a bipartite map: **entities** — a person, a franchise, a genre, an offering cluster — are hubs sized by how many events they cover, **events** are dots, and one link joins each event to each entity it carries. A lens picks which kind of entity is drawn; the active filter is the map's only scope, so what the sidebar holds is what the map draws.

It replaced an ego-network model that drew events only and connected two events sharing an entity. That shape does not survive the real corpus: a shared entity becomes a clique, so the Comics slice under the IP lens produced 659 links, a single 256-node component, and 215 isolated events. Linking through entities instead makes links scale linearly with the corpus rather than quadratically, and it makes "which programs is this person in" a dot you can point at. See `docs/plans/2026-07-19-001-feat-entity-map-graph-plan.md`.

Two rules keep the picture readable. An entity needs at least two in-scope events to be drawn at all — a franchise covering one event adds a dot and a line that say nothing the event's own label does not. And events no hub claims are never hidden; a weak radial force gathers them into a dim halo at the rim, where they stay hoverable like everything else.

Clicking a hub or a dot pins it and opens a card. Event cards are shared with the 5-day list, so the same click opens the same card in either view, and star and change encodings are read from one place — a starred, moved event looks the same as a row, as a dot, and on the card.

## Exporting to your phone

Export starred sessions for a single day or the whole con. Import the generated `.ics` into a **dedicated calendar**, not your main one. To refresh after schedule changes, delete that calendar and re-import—event UIDs are stable, so unchanged events keep their identity.

Panels and screenings export with a 15-minute alarm. All-day and drop-in blocks (games tables, autograph lines) export without one—a 15-minute warning for a room that has been open since 10am is noise. Cancelled sessions and stars whose events have left the schedule are skipped, and the app names what it skipped rather than quietly exporting five of your six stars.

Times carry `TZID=America/Los_Angeles` on each event. Apple Calendar is the target; Google Calendar ignores imported alarms.

## Notes

- Event record shape: see `data/events.json`; `shortId` builds the public URL (`/event/<shortId>`), `uid` is the stable 32-hex identifier used for joins, diffs, stars, graph nodes, and exported calendar entries.
- `src/shared/` is pure—no I/O, no `node:` imports. All I/O lives in `src/main/`. This is what keeps the renderer's sandbox from ever needing to be relaxed.

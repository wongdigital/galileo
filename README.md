# sdcc-schedule

A better way to browse the Comic-Con San Diego program schedule. Sched's site and app are painful; the underlying data is not.

> **Unofficial.** This project is not affiliated with, endorsed by, or connected to San Diego Comic Convention (Comic-Con International) or Sched. Convention program data is fetched from Sched's public endpoints at runtime for personal use and is **never committed to this repository**—see `.gitignore`. Any future code license covers the code only, not convention data.

## Data pipeline

`npm run fetch` pulls the full schedule from Sched's public endpoints (2 requests, no auth) and writes a joined dataset:

- `data/events.json`—all events with title, Pacific-time start/end, track, sub-category tags, room, full description, and canonical Sched URL
- `data/meta.json`—fetch timestamp, counts, track list

Sources:

- `https://comiccon2026.sched.com/all.ics`—public iCal export: every event with UID, UTC times, track, room, full description
- `https://comiccon2026.sched.com/list/descriptions`—adds short event IDs and the sub-category taxonomy (Comics, Horror, Kids, 30 Minutes, etc.)

The two are joined by event UID. Categories carry `NEW`/`UPDATED`/`CANCELLED` flags, so re-fetching and diffing `data/events.json` in git shows schedule changes over time.

For a different year, set `SCHED_SITE` (e.g. `SCHED_SITE=https://comiccon2027.sched.com npm run fetch`).

## Notes

- Speaker/panelist data is not structured in Sched for SDCC—names only appear inside description text.
- Event record shape: see `data/events.json`; `shortId` builds the public URL (`/event/<shortId>`), `uid` is the stable 32-hex identifier used for joins and diffs.

## App

TBD—an Electron app consuming `data/events.json`.

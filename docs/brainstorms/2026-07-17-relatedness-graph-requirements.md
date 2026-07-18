---
date: 2026-07-17
topic: relatedness-graph-app
---

# Relatedness Graph: an SDCC Schedule App

## Problem Frame

SDCC's official schedule tooling (Sched) fails at the con's actual scale: 3,476 events over 5 days across 51 rooms in ~6 buildings, 8 tracks, ~181 flat subtype tags. Browsing is hopeless, filters don't persist, and discovery by the con's real axes—franchise, people, genre—is impossible. Roger (longtime attendee, design leader) is building a desktop app on the repo's existing data pipeline that makes discovery pleasant (a relatedness graph with switchable edge lenses), planning reliable (persistent starring, 5-day view), and execution simple (ICS export to phone). Released open source as a share-and-portfolio piece; Roger is the primary user and sole funder of nothing but his own usage.

Ideation record: `docs/ideation/2026-07-17-schedule-display-ideation.md` (Synthesized Concept section).

---

## Actors

- A1. Roger: primary user, maintainer, and enrichment compiler operator. Optimizes for his own con.
- A2. Keyless open-source user: technical SDCC fan who clones/installs. Gets the full graph and planning experience with no API key.
- A3. Keyed open-source user: adds their own LLM API key (OpenAI, Anthropic, or OpenRouter) to enable chat.
- A4. Sched (external system): source of raw schedule data via public endpoints; not a partner, not guaranteed stable.

---

## Key Flows

- F1. First run
  - **Trigger:** User launches the app with no local data.
  - **Actors:** A1/A2, A4
  - **Steps:** App fetches raw schedule directly from Sched's public endpoints → joins the repo-shipped enrichment index by event UID → renders the 5-day view; daily refresh thereafter re-fetches and re-joins.
  - **Outcome:** Full browsable schedule with enriched lenses, no key required, no server involved.
  - **Covered by:** R1, R2, R3

- F2. Discovery via the graph
  - **Trigger:** User seeds the graph from a session, person, franchise, or filter result.
  - **Actors:** A1/A2
  - **Steps:** Ego-network renders 1–2 hops of neighbors under the active lens → user switches lens (e.g., facets → IP); layout animates with persistent nodes → user inspects an edge to see why two sessions connect → stars sessions worth attending.
  - **Outcome:** Sessions discovered by relation rather than by list-scanning; stars accumulate.
  - **Covered by:** R5–R9, R11

- F3. Chat as filter compiler
  - **Trigger:** Keyed user types natural language ("horror stuff, by people").
  - **Actors:** A3
  - **Steps:** Chat compiles the utterance via app tools → filter/lens state appears as inspectable chips → views update → the reply confirms with the engine-computed count; non-filter questions are answered directly, grounded in tool results for anything schedule-factual.
  - **Outcome:** Filter state is always inspectable and hand-adjustable; schedule facts always trace to tools, never model memory.
  - **Covered by:** R14, R15

- F4. Export to the con floor
  - **Trigger:** User finishes planning a day (or the whole con).
  - **Actors:** A1/A2/A3
  - **Steps:** User exports starred sessions → app emits an .ics feed with lead-time alarms → user imports into their phone's native calendar.
  - **Outcome:** The at-con execution surface is the phone's own calendar—offline, battery-cheap, state-loss-proof.
  - **Covered by:** R13

---

## Requirements

**Data and pipeline**
- R1. Each app instance fetches raw schedule data (events, titles, descriptions, times, rooms) directly from Sched's public endpoints, on demand plus a daily refresh. No central server.
- R2. The public repo ships only a derived enrichment index keyed by event UID—extracted people, franchise/IP entities, facet mappings, offering clusters, event classes. No Sched-authored prose is committed to the repo.
- R3. Enrichment is a maintainer-side compile: Roger runs the extraction (his API key, occasional cadence) and commits the index. Instances join it locally; events missing from the index (new/changed since last compile) degrade gracefully to heuristic treatment.
- R4. Schedule changes surface in-view: NEW/UPDATED/CANCELLED flags render on affected events, and a starred event that gets cancelled or moved is visibly flagged wherever it appears.

**Graph (the centerpiece)**
- R5. The graph renders as an ego-network—seeded by a session, person, franchise, or filter result, showing 1–2 hops—never the whole corpus at once.
- R6. Edge lenses are user-switchable, one soloed at a time: IP/franchise, people, shared facets, same-offering.
- R7. Switching lenses animates the re-layout with persistent nodes, so cluster reformation is visible.
- R8. Events with no edge under the active lens gather as a dim fringe rather than disappearing.
- R9. Selecting an edge explains the connection (which person, which franchise, which shared facet).

**Views and state**
- R10. The main display toggles between graph view and a standard 5-day schedule view; selection and filter state are shared across both.
- R11. Starring persists in a plain local file keyed by UID. Stars are never lost to filtering, view switches, or app restart.
- R12. The sidebar's Filters tab shows facet filter chips and the lens selector—the single source of truth for view state. Facet dimensions: curated from tags (genre/topic, format, audience-age bands, community, player count), computed from event data (day, time band, duration band, building—never trusting the inconsistent duration/time/venue tags), and extracted (IP/franchise, people). Filter semantics: interest terms (genre, IP, people) union; constraint terms (day, venue, duration, time, audience) intersect.
- R13. Starred sessions export as an .ics file with per-event lead-time alarms, importable into any calendar app.

**Chat**
- R14. The Chat tab is disabled until the user supplies their own API key (OpenAI, Anthropic, or OpenRouter supported). Keys are stored locally only.
- R15. Chat is a tool-using concierge with one grounding rule: schedule facts come only from app tools (filter/search/event/starred), never from model memory. Filter intents render as the same inspectable chips, with the reply carrying the engine-computed count ("173 programs match Horror and Star Wars—filtered for you"). World-knowledge and judgment questions (franchise lore, Hall H line strategy) are answered directly, with advice framed as advice. Mutations require an in-UI confirmation card. Event descriptions may be sent to the user's own LLM provider—a documented, deliberate choice.

**Look and feel**
- R16. Visual direction is "The Observatory": dark ground, luminous nodes, precision typography, one restrained accent, density presented as intentional. The graph reads as a constellation map; the 5-day view as an instrument panel.
- R17. Craft is a requirement, not a polish pass: deliberate motion, spacing, and type hierarchy throughout—portfolio-grade.

**Open source and legal posture**
- R18. The app's name does not include "Comic-Con"; the README carries an unofficial/not-affiliated disclaimer; no CCI or Sched marks or logos appear anywhere.
- R19. Code ships under a permissive license with a note that convention data is not covered by it. Fetching stays polite (low request count, honest user agent).

---

## Acceptance Examples

- AE1. **Covers R1, R2, R3.** Given a fresh clone and no API key, when the app first launches, it fetches the schedule from Sched, joins the shipped enrichment index, and the IP and People lenses work fully.
- AE2. **Covers R6, R7.** Given a graph seeded on a horror panel under the facets lens, when the user switches to the IP lens, the same nodes animate into franchise clusters and a dim fringe collects events with no detected franchise.
- AE3. **Covers R14.** Given no stored API key, the Chat tab renders disabled with a one-line explanation; adding an OpenRouter key enables it without restart.
- AE4. **Covers R4, R11.** Given a starred event that Sched cancels, after the next refresh the star survives and the event renders flagged as cancelled in both views.
- AE5. **Covers R13.** Given six starred sessions on Saturday, exporting produces an .ics that imports into iOS Calendar with alarms firing ahead of each session.

---

## Success Criteria

- Roger plans SDCC 2026 in the sprint cut: triages to a starred list and exports .ics to his phone before preview night (July 22).
- The graph earns its place: during real planning, Roger reaches for it over the list at least some of the time—the "does the spatial layout beat a related-sessions rail" bet gets a real-world verdict.
- A keyless user cloning the repo gets the complete non-chat experience with zero configuration beyond install.
- Handoff quality: `/ce-plan` can plan the build from this document without inventing product behavior, scope, or success criteria.

---

## Scope Boundaries

### Deferred for later

- Chat tab (first cut from the 2-day sprint if time runs short; cut order is chat → extra lenses → list polish; the graph survives).
- Additional lenses: walkability edges, my-picks overlap.
- Queue/getability modeling, room-residency logic, leave-time departures board.
- Triage states beyond starring (seen/dismissed/kill-list), person profile pages, volatility scores, taste profiles across years.
- Plan sharing between friends; con-agnostic support for other Sched conventions (engine may allow it; not a v1 goal).
- Auto-update mechanism for the app itself.

### Outside this product's identity

- Any central server, hosted service, accounts, or telemetry—the app is local-first, full stop.
- Funding other users' LLM usage in any form.
- A mobile app: the phone is served by exported artifacts (.ics), not a second frontend.
- Auto-generated itineraries (solver-built days)—a different product; this one keeps the human choosing.
- Official affiliation with, or branding from, CCI or Sched.

---

## Key Decisions

- Primary user is Roger; open source is share-plus-portfolio, not a growth goal: protects against scope creep toward audience-pleasing infrastructure.
- Hybrid data model (raw data fetched per-instance, derived index shipped in repo): reconciles the no-server constraint, the keyless full experience, and legal exposure in one structure—no copyrighted prose is ever redistributed.
- Chat is key-gated and state-compiling only: keeps the AI inspectable, optional, and free to the maintainer.
- Two-phase delivery: a 2-day sprint cut aimed at personal use at SDCC 2026 (July 22–26), possibly unreleased; the full vision ships on a sane timeline afterward.
- The graph is the sprint's protected centerpiece (user-ranked #1), with IP as the flagship lens.
- Visual direction: The Observatory (dark instrument), chosen over editorial-print and quiet-gallery directions.

---

## Dependencies / Assumptions

- Sched's public endpoints (`all.ics`, `list/descriptions`) remain accessible and stable through the con. Unverified assumption; the fetch layer already works today and is isolated in `scripts/fetch.mjs`, limiting blast radius if formats shift.
- LLM extraction (people, franchises) reaches useful accuracy on the 3,476-description corpus; a hand-correctable alias table absorbs the error rate.
- The 2-day sprint is sufficient for a personally usable cut (fetch pipeline and dataset already exist; enrichment compile is hours, not days).
- Electron remains the intended shell (also conveniently sidesteps browser CORS limits on direct Sched fetches); final shell choice is a planning concern.
- Annual cadence: the 2027 schedule will differ in rooms/tags; the facet mapping and alias tables are designed to be re-triaged, not rebuilt.

---

## Outstanding Questions

### Resolve Before Planning

- (none)

### Deferred to Planning

- [Affects R5–R9][Technical] Graph rendering approach and library; performance target for animated lens transitions at realistic node counts.
- [Affects R2, R3][Technical] Enrichment compile design: extraction prompts, model choice, index file format, offering-cluster similarity threshold.
- [Affects R12][Needs research] Final facet dimensions: curate the 181-tag mapping against the real tag list.
- [Affects R13][Technical] ICS alarm defaults (lead times per building? fixed?) and export granularity (per-day vs whole-con).
- [Affects R18][User decision, pre-release] App name. Does not block the sprint build; must be settled before public release.

---

## Next Steps

→ `/ce-plan` for structured implementation planning (sprint cut first: fetch-join, enrichment compile, 5-day view, starring, .ics, then the graph's first lens).

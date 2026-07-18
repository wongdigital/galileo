---
date: 2026-07-17
topic: schedule-display-visualization
focus: do better than Sched; display is difficult because of multiple venues and many tracks
mode: repo-grounded
---

# Ideation: Displaying the SDCC Schedule Better Than Sched

## Grounding Context

**Codebase context:** `sdcc-schedule` is a fresh repo with a working data pipeline (`scripts/fetch.mjs`, 2 unauthenticated requests to Sched's public endpoints) producing `data/events.json`: 3,476 events over 5 days (Jul 22–26, 2026), 51 rooms across ~6 buildings (Convention Center incl. Hall H/Ballroom 20, Marriott Marquis, Hyatt, Hilton, Omni, San Diego Central Library), 8 top-level tracks, ~181 flat subtype tags with no hierarchy, durations 30min–6h+, NEW/UPDATED/CANCELLED flags, stable UIDs (git-diffable), full descriptions with panelist names unstructured in text, "(Capacity: N)" hints in some descriptions. Peak density ~987 events/day. Planned surface: Electron desktop app; data is local JSON (~3MB), no backend required.

**External context:** Clashfinder (festival grid: highlighting, conflict surfacing, stage auto-pagination), EventFahrplan/CCC Fahrplan (day×room grid, favorites, per-session alarms, change tracking), DateLens (fisheye/semantic-zoom calendar research), virtualized grid rendering + greedy overlap-track layout, dual-pane frozen-axis scrolling, EPG lesson that temporal state (now/ending/starting-soon) needs its own visual channel, and commercial conference apps' notification fatigue (changes must be visible in the schedule surface itself). Sched's documented failure modes: scroll position resets, date-tab desync, filters don't persist into agenda-building, back-navigation loss, data loss on close.

**Past learnings:** none — brand-new repo, no `docs/solutions/`.

## Ranked Ideas

### 1. Model repair: offerings and ambient lanes
**Description:** Stop treating all 3,476 events as the same species. Cluster repeated sessions (the same game demo running many times) into one "offering" with N sessions, and classify events as *attend* (fixed panels) vs. *ambient* (6-hour drop-in blocks). Ambient events render as background lanes or an "open now" shelf—only fixed sessions compete for grid space. Conflicts with one session of a repeated offering don't count if another session fits.
**Warrant:** `direct:` Games is 1,173 events—a third of the corpus—with durations to 6h+ running past midnight; a drop-in play block is not the same planning object as a 50-minute panel, but Sched renders them identically.
**Rationale:** A large share of the density problem is a category mistake in the data model, not a rendering challenge. Fixing it de-clutters the grid, the conflict logic, and the counts at once.
**Downsides:** Clustering needs tuning against real data; misclassified events could hide things.
**Confidence:** 90%
**Complexity:** Medium
**Status:** Unexplored

### 2. Unmix the taxonomy: 181 flat tags → orthogonal facets
**Description:** The subtype tags mix age ratings ("8+"), durations ("30 Minutes"), formats ("Board"), genres ("Horror"), and time bands ("Daytime") in one flat namespace. A small hand-curated mapping file splits them into ~5 clean dimensions so filtering becomes per-dimension queries ("genre: Horror AND age: adult AND duration: ≤1h") instead of a 181-checkbox wall. Unmapped tags fall through visibly for annual re-triage.
**Warrant:** `direct:` the tag list itself—those five examples coexist in one flat field with no hierarchy.
**Rationale:** The direct answer to "so many tracks." Faceted browse is only as good as its facets; Sched structurally cannot offer this. An afternoon of curation, durable across years.
**Downsides:** Manual mapping needs annual maintenance for new tags.
**Confidence:** 85%
**Complexity:** Low-Medium
**Status:** Unexplored

### 3. Track Mixer: mute/solo/lock as the grid's interaction layer
**Description:** Treat tracks and buildings like timeline lanes in Premiere/Logic: per-lane **mute** (hide), **solo** (show only), **lock** (my picks, exempt from all filtering), and grouping (collapse all Marriott rooms into one summary lane). Keyboard-driven, stateful, saved—an instrument, not a transient filter panel.
**Warrant:** `external:` NLE track headers (Premiere/Logic/Ableton) are the standard solution to "dozens of parallel lanes, only some relevant now"; `direct:` Sched's documented filter/agenda desync—**lock** makes it structurally impossible to filter your own plan out from under you.
**Rationale:** The display instrument for the exact venues×tracks problem; turns filtering from a form into an always-on surface a designer can make feel great.
**Downsides:** Novel interaction needs onboarding; solo/mute semantics must stay legible.
**Confidence:** 75%
**Complexity:** Medium
**Status:** Unexplored

### 4. The People Index
**Description:** Import-time extraction of panelist names from the 3,476 descriptions into a person→events index. Person pages join Programs panels to Autographs sessions ("panel at 2, signing at 4:30"); follow a person to surface all their appearances across the con.
**Warrant:** `direct:` panelist names exist only as unstructured description text, and the 200-event Autographs track is person-keyed but disconnected from panels featuring the same people.
**Rationale:** Five of six ideation frames independently generated this—the strongest convergence signal in the run. "When can I see this creator" is a primary fan question no room×time view can answer.
**Downsides:** NER accuracy needs a correction affordance; the most speculative data work here.
**Confidence:** 85%
**Complexity:** Medium
**Status:** Unexplored

### 5. Queue-time made visible: getability and line blocks
**Description:** Every event gets a quiet getability badge (walk-in / arrive early / camp) from parsed "(Capacity: N)" hints, a hand-built room-size table, and time slot. Adding a high-demand event drops a LINE block onto the timeline alongside the event—a 1-hour Hall H panel honestly renders as ~5 hours. Includes room-residency logic: SDCC rooms don't clear between panels, so the app can compute the "entry event" you actually need to walk into.
**Warrant:** `direct:` capacity hints and room names are in the dataset; `external:` TouringPlans/theme-park touring model of waiting as explicit time-cost; SDCC's documented no-room-clearing camping culture.
**Rationale:** Makes the display *SDCC-correct* rather than calendar-correct—the con's dominant real constraint is invisible in every existing tool.
**Downsides:** Heuristics can err in both directions; needs user-tunable weights and per-event overrides.
**Confidence:** 70%
**Complexity:** Medium-High
**Status:** Unexplored

### 6. The Con Editor: triage state as the document
**Description:** Invert the IA: the persistent document is *your con*, and every event carries durable triage state (unseen / seen / dismissed / starred). The grid renders untriaged territory bright and processed territory receded (fog-of-war), with an exclusion-first "kill list" (don't play tabletop games? 1,173 events cease to exist) and progress meters ("Sat Programs: 61% triaged"). Every view becomes a picker feeding the plan.
**Warrant:** `direct:` 987 events on peak day makes exhaustive re-browsing unworkable, and every documented Sched failure (scroll reset, filter/agenda disconnect, data loss) is a symptom of treating browse state as transient.
**Rationale:** Decides the app's architecture at the root and structurally immunizes it against Sched's failure class. Evaluating each event at most once is the biggest planning time-saver available.
**Downsides:** A commitment—the whole app inherits this model; must feel like power, not homework.
**Confidence:** 85%
**Complexity:** Medium
**Status:** Unexplored

### 7. Compile the plan: execution artifacts and the leave-time board
**Description:** The desktop app is the IDE; the con floor gets compiled artifacts: offline single-file HTML for the phone, an .ics feed with lead-time alarms, a print-ready pocket grid or zine. The at-con live view is a departures board sorted by **leave time** (start − walk time − line buffer), not start time—"LEAVE 12:40 → 1:15 Indigo Ballroom, 9 min walk"—with room changes as amber gate-change row states. Optional menu-bar "leave-by" sliver.
**Warrant:** `external:` airport FIDS design (the actionable time is boarding, not departure) and EventFahrplan's exported alarms; `reasoned:` con-floor connectivity and battery make any interaction-heavy surface the wrong runtime, and a static artifact cannot lose data.
**Rationale:** Resolves the "desktop app at a walking-around event" objection; leave-time is the one computation you can't do in your head across 6 buildings.
**Downsides:** Multiple artifact formats to maintain; the live board still needs a phone-visible form.
**Confidence:** 80%
**Complexity:** Medium
**Status:** Unexplored

## Cross-Cutting Synthesis

Ideas 1, 2, 4, and 5 all ship through one **Enrichment Compiler**—a single pipeline stage after fetch that derives people, capacity values, tag facets, event classes, and offering clusters into a second, richer JSON. The app becomes a renderer of *our* data model, not Sched's.

## Synthesized Concept: The Relatedness Graph (Roger's direction, 2026-07-17)

**Description:** The discovery surface is a node graph of sessions, where the user selects which relation the layout physicalizes—a multigraph with switchable **edge lenses**: *IP/franchise* (entity extraction over titles/descriptions, with a hand-correctable alias table), *people* (the People Index as connective tissue joining Programs, Autographs, and Films), *facets* (shared genre/format/audience from the unmixed taxonomy), and *same offering* (repeated-session clusters from Model Repair). One lens solos at a time; switching animates the re-layout with persistent nodes, so the user watches clusters reform (the genre clusters scatter and the Star Wars constellation pulls together). Rendering is ego-network/neighborhood (seed a session, person, or filter result; show 1–2 hops), never the whole 3,476-node corpus. Events with no edge under the current lens gather as a dim fringe—honest sparseness that doubles as an extraction-correction queue.

**Sidebar:** two tabs, one state. *Filters* shows filter chips and the lens selector; *Chat* is a natural-language compiler that writes the same state ("I'm interested in horror" → genre filter; "rearrange to show IP connections" → lens switch; "the horror cluster by people" → both). Chat never answers in prose—it manipulates inspectable filter/lens state. (This un-rejects the "Ask the Program Book" idea in scoped form: NL → structured state, not a semantic answer engine.)

**Main display toggle:** graph view (discovery—time-blind on purpose) ⇄ standard 5-day view (planning—time-first). Selection state is shared across both: starred sessions persist everywhere, structurally avoiding Sched's filter/agenda desync. Starred sessions export as an .ics feed for the phone's native calendar (with lead-time alarms), which doubles as the execution handoff from idea #7.

**Dependencies:** the Enrichment Compiler substrate—offering clusters and event classes (#1), tag facets (#2), people extraction (#4), plus a new franchise/entity extraction pass. The lens architecture extends without redesign (future lenses: walkability edges, my-picks overlap).

**Risk to validate first:** whether the spatial layout earns its pixels against a "related sessions" rail on event cards. The lens-switching transition is the graph's strongest claim—it shows the *difference* between relations, which no list can.

**Warrant:** `direct:` user-stated direction synthesized with ideas #1, #2, #4; `reasoned:` browsing 3,476 events is hopeless but wandering a typed-edge neighborhood graph makes discovery the pleasant part, and IP is the con's native taxonomy that Sched structurally lacks.

**Confidence:** 75%
**Complexity:** High (graph rendering + entity extraction; the substrate ideas are prerequisites)
**Status:** Explored (brainstormed 2026-07-17)

## Rejection Summary

| # | Idea | Reason Rejected |
|---|------|-----------------|
| 1 | Itinerary solver / auto-generated days | Different product bet (plan generation vs. display); revisit after the display core exists |
| 2 | Contingency-tree plans (branches with triggers) | Heavy plan-model cost relative to v1 value; brainstorm variant of the plan model |
| 3 | Regret ledger (opportunity-cost shadows) | Reasoned-only warrant, speculative value; a lens on the picks view, not a direction |
| 4 | Bloomberg-style screeners/watchlists | Covered by facet saved-queries (#2) plus Mixer state (#3) |
| 5 | Cmd-K everything + day minimap | Feature-level; folds into #4 search and grid navigation |
| 6 | Day-as-route / journey legs / plan linter | Folds into #5 (time-cost) and #7 (leave-time); route rendering is the display form of the already-tabled walking matrix |
| 7 | Plan-scoped change repair / self-healing agenda / blast radius | Changes feed already tabled in conversation; deepen inside #6's brainstorm |
| 8 | Party files (shareable plans, group overlays) | Real but off the display focus; nearly free later once the plan is a file |
| 9 | Ask the Program Book (local semantic search) | Architecture fork (semantic layer); defer until facets (#2) prove insufficient |
| 10 | Taste profile / con-agnostic engine / volatility scores | Leverage plays, not display; backlog |

---
date: 2026-08-03
topic: affinity-explorer
---

# Affinity Explorer — browsing by "what else is like it"

## Problem Frame

Onsite iPad usage surfaced that the Related view (the narrow-width stand-in for the node
graph) preserved the graph's data but not its value. The navigation is broken — drilling
event → hub → event traps the user in a loop that survives view toggles and required a
force quit — and even fixed, a flat hubs-and-lists panel doesn't serve the actual job,
which Roger named from real use: **"I loved this panel, what else is like it?"** Affinity
browsing is the deliberate foil to the chronological 5-Day view, and it deserves a
first-class shape, not a graph fallback. Separately, two detail-card touch targets are too
tight for fingers.

This supersedes the related-panels expression from
`docs/brainstorms/2026-07-22-capacitor-ipad-port-requirements.md`.

---

## Key Flows

- F1. Rabbit hole from a loved event
  - **Trigger:** User taps an event anywhere (5-Day list, Browse, search) and its detail card opens.
  - **Steps:** Card shows a Related section — ranked related events plus person/franchise chips → tap a chip → that hub's page (its events, adjacent hubs) → tap an event → its detail card, with its own Related section → continue arbitrarily deep.
  - **Outcome:** Every hop is reversible; Back retraces the exact path; dismissing returns to the originating view untouched.
  - **Covered by:** R1, R2, R3, R4, R5

- F2. Cold-start browse (narrow widths)
  - **Trigger:** On a width too narrow for the graph, user opens the Browse view (replaces the Related tab there) without a seed event.
  - **Steps:** Browse page lists top franchises and people (and, if useful, vibe clusters) → tap a hub → hub page → drill per F1.
  - **Outcome:** Exploration works from curiosity alone; no seed event required.
  - **Covered by:** R6, R7

- F3. Escape hatch
  - **Trigger:** User leaves Browse/explorer mid-drill (switches view, backgrounds the app).
  - **Steps:** Return to Browse later.
  - **Outcome:** No stale drill state can trap the user; a fresh visit starts at a usable root (or a restorable trail with Back still functional). Force quit is never the way out.
  - **Covered by:** R4, R5

---

## Requirements

**Navigation model**
- R1. Event detail cards gain a Related section: a short ranked list of related events and tappable chips for the event's people and franchises.
- R2. Person/franchise hubs are real pages: the hub's events (grouped usefully, e.g. by day) plus adjacent hubs ("often appears with…").
- R3. Event ⇄ hub navigation forms a single stack; from a hub's event list, tapping an event shows that event's detail (never the hub again — the onsite loop case).
- R4. Back always works and retraces the visited path; dismissal returns to the view the user came from.
- R5. Drill state never traps: leaving and re-entering the explorer yields a usable state with no force quit required.

**Browse (cold start) and the graph**
- R6. At widths too narrow for the graph, a Browse view replaces the Related tab as the standalone entry point: top franchises and people at minimum, ranked by connectedness within the active filter/lens.
- R7. The card Related section and hub pages (R1–R5) are universal — every width and platform, one navigation model. Only the *destination* differs by width: the graph on wide screens, Browse on narrow ones. Chips push hub pages in the card stack on all widths; the graph is an ambient view, not a chip target.

**Relatedness signals**
- R8. "Related events" ranking may draw on all committed/derived signals — shared people, shared franchises, event classes, offering clusters, facets — not only the graph's hub edges. Exact ranking is a planning concern; the requirement is that "like this" reflects more than co-occurrence of a single hub.
- R9. Each related event states *why* it's related (e.g., "also with Deborah Ann Woll", "more tabletop actual-play") — the connective tissue is visible, not implied.

**Touch targets (independent fixes, ship with or before the explorer)**
- R10. Detail-card event rows meet comfortable touch sizing — larger targets and/or spacing than the current desktop-derived density.
- R11. The detail card's close and star controls are separated far enough that a thumb cannot plausibly hit the wrong one.

---

## Acceptance Examples

- AE1. **Covers R3, R4.** Given the *Party Wanted* card with a *Dungeons & Dragons* chip, when the user taps the chip and then taps *Party Wanted* in the hub's list, the *Party Wanted* detail is shown again (not the hub), and Back steps hub → original card.
- AE2. **Covers R5.** Given a user three levels deep in a drill, when they switch to the 5-Day view and later return to Browse, they land in a usable state and can navigate freely — the pre-switch drill state cannot re-trap them.
- AE3. **Covers R9.** Given an event related to the seed through a shared performer, the related row names that performer rather than showing a bare title.

---

## Success Criteria

- The onsite failure cannot recur: no sequence of taps in the explorer requires a force quit or leaves Back nonfunctional.
- Roger can start from a loved panel and, within a few taps, find and star an event he didn't know about — the "what else is like it" job observably works.
- The Browse page makes the con's shape visible cold (top franchises/people) without picking an event first.
- Handoff quality: planning can proceed without inventing product behavior — flows, escape semantics, and ranking-signal scope are all specified here.

---

## Scope Boundaries

- The node graph is retained as the wide-screen relatedness destination — it is not under evaluation for retirement in this work. A list-based Browse page on a wide screen is a less visually interesting version of the graph; Browse exists only where the graph cannot.
- The deck/affinity-triage concept (swipeable suggested events tuned by star/pass) is explicitly deferred — a possible future layer on the same ranking machinery, not part of this scope.
- No new enrichment compile step: ranking uses signals already committed or computed at runtime.
- No scheduling intelligence ("fits your 3pm gap") — this is affinity browsing, not gap-filling.

---

## Key Decisions

- The rabbit-hole navigation (card Related section, hub pages, back stack) is universal; the Browse destination is narrow-only and the graph keeps the wide-screen destination role. The job ("what else is like it") is platform-independent, but as a destination a hub list is a less visually interesting graph — so the shared piece is the navigation model, not the destination. Chips push hub pages on all widths rather than deep-linking into the graph, keeping one predictable chip behavior everywhere.
- Card-anchored rabbit hole (A) is the spine with hub pages (B) as the drill-down, over a standalone catalog or the deck: it starts browsing where love happens — on the event card — and the two compose into one back stack instead of two features.
- The loop bug is not patched in the old panel; the new navigation model subsumes it. The state-reset requirement (R5) is captured so the *class* of bug dies, not just the instance.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R1, R8][Technical] Ranking formula and how many related events a card shows per width.
- [Affects R2][Technical] Hub-page grouping (by day vs. by adjacency strength) and whether vibe clusters appear on Browse v1 or only franchises/people.
- [Affects R4][Technical] Whether the back stack persists across app restarts or resets to the Browse root (AE2 requires only that it never traps).
- [Affects R10, R11][Technical] Whether touch sizing is a platform-conditional density or a single touch-first sizing everywhere.

---

## Next Steps

-> /ce-plan for structured implementation planning

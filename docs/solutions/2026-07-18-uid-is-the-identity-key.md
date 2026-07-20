---
title: "Sched UIDs survive edits—UID is the identity key"
type: decision
date: 2026-07-18
unit: U3
requirements: [R4, R11]
---

# Sched UIDs survive edits—UID is the identity key

## The question

The plan (`docs/plans/2026-07-17-001-feat-relatedness-graph-app-plan.md`, U3 execution note)
gated the whole data layer on one unknown: **does Sched regenerate an event's UID when the
event is edited?**

Five subsystems key identity to UID—the star store, the snapshot diff, the unseen-change
log, the graph's node-object cache, and exported ICS UIDs. If UIDs churned on edit, every one
of them would silently lose track of an event the moment a panel moved rooms, and the fallback
key would have to be the list-view `shortId`.

## The check

Compared the `2026-07-17T20:35Z` snapshot (3,476 events) against a live refetch ~31h later
(3,474 events). The test looked for the churn signature: a UID that disappeared from the feed
while its `shortId` reappeared attached to a *different* UID.

## Result: UID is stable

| Measure | Result |
|---|---|
| UIDs survived | 3,474 of 3,476 |
| UID churn (same shortId, new UID) | **0** |
| Events that changed content while keeping their UID | **9** |
| `shortId` missing or duplicated in new feed | 0 |

Nine events were genuinely edited in the window (4 title changes, 8 description changes) and
**every one kept its UID**. That is direct positive evidence, not just absence of churn.

**Decision: UID remains the identity key across all five subsystems.** `shortId` is a viable
backup—it was also stable, unique, and present on all 3,474 events—but nothing requires
switching.

## Two findings that validate other plan decisions

**1. Sched's change flags are not a change feed.** Flag counts were byte-identical across the
two fetches (86 UPDATED, 11 NEW, 1 CANCELLED) while nine events demonstrably changed content.
The flags are a static editorial annotation, not a diff signal. This is the empirical case for
the plan's *snapshot-and-diff is the change engine* decision: if the app trusted Sched's flags,
those nine edits would have been invisible.

**2. Events vanish without a CANCELLED flag.** Two events left the feed entirely and neither
was flagged cancelled first—they were simply gone. This is exactly the failure class the
ghost-star design exists to catch (R11): a bare-UID star would have silently evaporated. The
star record's snapshot fields (title/start/room/starredAt) are what let a vanished event render
as a visible ghost instead of nothing.

## How to re-run

The check script is disposable—regenerate it from this doc's method if the question comes
back (e.g. for a different con year, where Sched's behavior is unverified). Preserve a snapshot
of `data/events.json` before a refetch, then compare old vs new on the churn signature above.

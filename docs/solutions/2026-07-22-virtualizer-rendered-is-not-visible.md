---
title: "A virtualizer's first rendered row is not its first visible row"
type: bug
date: 2026-07-22
---

# A virtualizer's first rendered row is not its first visible row

## The symptom

Star an event twenty or thirty rows into a day and the list jumped part way back up—not to
the top, but close to a dozen rows shy of where the user was. Unstarring did it too, and so
did starring from the detail card, which doesn't even touch the list. Fixed in PR #1
(`fix/star-scroll-jump`).

## Why it happens

Two defects in `useUidAnchor` compounded, and a test fake hid both.

**The restore fired when nothing moved.** The hook detects a dataset swap by comparing uid
arrays by identity. But a star click rebuilds `rows` in `useSchedule`—one row's `starred`
flag changed, so the rebuild is legitimate—without changing which uids are in the list or
their order. Identity said "swap"; content said "nothing happened." The hook believed
identity and scroll-restored a list that hadn't moved.

**The restore landed in the wrong place.** The anchor was captured as
`getVirtualItems()[0]`. TanStack's `defaultRangeExtractor` returns
`startIndex - overscan` as its first index, and the schedule view runs `overscan: 12`—so
the "anchor" was a row up to twelve rows *above* the viewport. Every restore aligned an
off-screen row to the top. That is the exact "part way up" distance in the symptom.

**The suite stayed green** because the fake virtualizer in `useUidAnchor.test.tsx` modeled
`getVirtualItems()` as returning only the row the user had scrolled to. The fake encoded
the same wrong assumption as the code under test, so the tests confirmed the bug's
worldview instead of checking it.

## The rules

**Rendered is not visible.** Anything a virtualizer renders for smooth scrolling
(overscan) is part of `getVirtualItems()`. A decision about what the user is *looking at*
must consult `scrollOffset`—skip items whose `end` sits at or above it:

```ts
const offset = virtualizer.scrollOffset ?? 0
for (const item of virtualizer.getVirtualItems()) {
  if (item.end <= offset) continue // overscan row above the viewport
  // first visible item
}
```

**Identity churn at a consumer is answered with a content comparison, not a suppressed
rebuild.** The companion rule to `2026-07-19-memo-identity-is-the-graph-contract.md`, which
prescribes the opposite—stabilizing identity at the producer. The decision rule: when the
producer's rebuild is *illegitimate* (contents truly unchanged, as with `filteredUids`
built outside a memo), fix the producer and assert with `toBe`. When the rebuild is
*legitimate* (a row's flag really changed) but a consumer only cares about a projection of
it (the uid sequence), the consumer compares that projection by content:

```ts
const unchanged = a.length === b.length && a.every((uid, i) => uid === b[i])
```

**A fake must model the library's inconvenient truths.** Same boundary as
`2026-07-19-testing-a-canvas-view-in-jsdom.md`: a stub that quietly becomes a second
implementation stops testing anything. Here the fake's contract was too kind—the fix
made it model overscan and `scrollOffset`, at which point the old anchor logic failed on
its own suite. When a fake stands in for a library surface, read what the library actually
returns (in this case, `defaultRangeExtractor` in `@tanstack/virtual-core`) rather than
what the consuming code wishes it returned.

## See also

- `src/renderer/src/views/schedule/useUidAnchor.ts`—both fixes, with the reasoning in comments.
- `src/renderer/src/views/schedule/__tests__/useUidAnchor.test.tsx`—the honest fake.
- `2026-07-19-memo-identity-is-the-graph-contract.md`—the producer-side half of the identity rule.
- `2026-07-19-testing-a-canvas-view-in-jsdom.md`—the stub-boundary principle this bug violated.

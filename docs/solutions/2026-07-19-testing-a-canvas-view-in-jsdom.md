---
title: "Testing a canvas view in jsdom: stub the renderer, assert the contract"
type: convention
date: 2026-07-19
unit: U5
requirements: [R6, R7]
---

# Testing a canvas view in jsdom: stub the renderer, assert the contract

## The problem

The graph draws to a canvas through `react-force-graph-2d`. jsdom has no canvas, no layout
engine, and no `ResizeObserver`. So the honest position is that the *rendering* is feel-tested
against live data and always will be.

The trap is concluding that the view is therefore untestable. It is not. Everything around the
canvas—what mounts, what pins, what dismisses, whether exactly one card is open—is ordinary
React that breaks in ordinary ways, and "the graph tab throws" is not something to discover at
the con.

## Three stubs, and what each is for

**1. Give the DOM a size, or nothing renders.**

The canvas host measures 0 in jsdom, and the view guards on `size.width > 0`, so without this
the graph never mounts and every assertion silently passes against an empty pane.

```tsx
function sizeTheDom(): void {
  globalThis.ResizeObserver = class {
    constructor(private readonly cb: ResizeObserverCallback) {}
    observe(target: Element): void {
      this.cb([{ contentRect: { width: 1200, height: 800 } } as ResizeObserverEntry], this)
    }
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver
}
```

The virtualized list needs the same treatment for a different reason—it measures
`clientHeight`—so the schedule suite stubs `HTMLElement.prototype` metrics instead.

**2. Stub the force graph as buttons, not as a blank div.**

A stub that renders `<div data-testid="force-canvas" />` proves the view mounts and nothing
else. Rendering one button per node makes every interaction handler reachable without a canvas:

```tsx
vi.mock('react-force-graph-2d', () => ({
  default: ({ graphData, onNodeClick, onBackgroundClick }) => (
    <div data-testid="force-canvas">
      <button data-testid="background" onClick={() => onBackgroundClick?.()} />
      {graphData.nodes.map((node) => (
        <button key={node.id} data-testid={`node:${node.id}`} onClick={() => onNodeClick?.(node)} />
      ))}
    </div>
  ),
}))
```

This is deliberately **not** a fake force layout. It has no positions, and nothing asserted
through it may depend on any—that boundary is what keeps the stub from quietly becoming a
second implementation to maintain.

**3. Mock `@data/enrichment.json`—and keep fixture descriptions empty.**

The real file is ~1.2 MB and has no business in a suite. The synthetic replacement has one
non-obvious constraint: **the enrichment index drops any entry whose `description_hash`
disagrees with the event's current description.** Give a fixture event prose without
recomputing its hash and the entry is treated as stale, its people and franchises vanish, and
the map builds with no hubs—which presents as a confusing assertion failure several layers
from the cause. Fixture descriptions stay `''`, and every entry carries the hash of the empty
string.

## What to assert

Identify cards by their close control (`Close event card`), not by their contents. Titles
appear in entity-card rows and node tooltips too, so `getByText('Panel One')` is ambiguous the
moment a second surface renders the same event—which is the whole point of a shared card.

Where a readout is assembled from several interpolated values, give it a `data-testid` and
assert on `textContent`. `getByText(/3 events/)` fails on text split across nodes, in a way
that reads as a logic bug rather than a query bug.

## What not to test here

Force behaviour, label collision, halo geometry, glow. Those are judged by hand against the
live corpus, per the parent plan's convention. A test that pins them would encode one tuning
pass as a requirement and break on the next.

## See also

- `src/renderer/src/views/graph/__tests__/GraphView.test.tsx`
- `src/renderer/src/views/schedule/__tests__/ScheduleView.test.tsx`
- `8fa6443`—the canvas-mount regression the size stub exists to catch.

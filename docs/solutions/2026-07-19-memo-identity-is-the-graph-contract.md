---
title: "Memo identity, not contents, is what a force layout depends on"
type: bug
date: 2026-07-19
unit: U2
requirements: [R3]
---

# Memo identity, not contents, is what a force layout depends on

## The symptom

With the graph open, the layout restarted at moments that had nothing to do with the graph.
Hovering a row. Setting a selection. Anything that moved unrelated state. Nodes flew back in
from the origin and the constellation the user was reading was gone.

Nothing about the *data* had changed. Every node was the same node, with the same title, the
same star, the same everything. The arrays holding them were new.

## Why it happens

Two layers compound, and each is individually reasonable.

**d3-force keys identity on object identity.** Every node object carries its own `x`, `y`,
`vx`, `vy`, and the simulation reads and writes them in place. Hand it a freshly-mapped array
and every node is a new object with no position, so the whole layout re-enters from nothing.
This is what `useNodeCache` exists to prevent—a `Map` that outlives renders, mutated in
place, so surviving nodes keep their objects.

**But a cache keyed on a memo dependency is only as stable as that dependency.** The original
bug (`1900183`) was one line: `useSchedule` built `filteredUids` inside its return literal
rather than in a `useMemo`. Contents were always correct. Identity was fresh on every render.
So every consumer holding it as a dependency rebuilt, the node cache was handed a "new" model
array each time, and the layout reset—from a hover.

The tell is that the bug is invisible in every test that checks contents. `toEqual` passes
throughout. Only `toBe` catches it.

## The rule

**Any array or object that crosses into the graph layer must be identity-stable when its
inputs have not changed, and that stability must be asserted with `toBe`.**

In practice that means three things:

1. Derived collections are built in `useMemo` with honest dependencies—never inside a return
   literal, and never inside a component body that runs every render.
2. A hook that reshapes upstream data (`useEntityMap` joining the builder to schedule state)
   reuses its previous element objects wherever nothing about them moved. Only `degree` and
   `fringe` are lens-dependent on an event dot, so a lens switch legitimately keeps most of
   them; handing back fresh objects would churn identities the cache below exists to preserve.
3. Where a common case can return the upstream array *itself* rather than a filtered copy, it
   should—`useEntityMap`'s scope restriction allocates nothing when every uid resolves.

## The enforcement

`toBe` assertions, in the hook's own suite rather than the view's:

```ts
it('hands back the same arrays when selection moves — the hover case', async () => {
  const { hubs, events, nodes, links, scopeUids } = view.result.current.map
  act(() => view.result.current.spine.setSelectedUid('p1'))
  expect(view.result.current.map.nodes).toBe(nodes)
  // …and the rest
})
```

These read as pedantic and are not. They are the only thing standing between a correct-looking
refactor and a graph that resets itself under the cursor—a symptom that only appears with the
graph open, at the moment unrelated state moves, which is exactly when nobody is looking for it.

## See also

- `src/renderer/src/views/graph/useNodeCache.ts`—the object-constancy contract, in its header.
- `src/renderer/src/state/useEntityMap.ts`—the element-reuse pass, and why it is keyed by node id.
- `1900183`—the original one-line fix.

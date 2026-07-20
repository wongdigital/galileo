---
title: "A light theme for a canvas instrument: the three things that broke"
type: bug
date: 2026-07-20
unit: U9
requirements: [R16, R17]
---

# A light theme for a canvas instrument: the three things that broke

## The setup

The Observatory theme is a Tailwind v4 `@theme` block of custom properties, and
everything reads tokens—utilities, scrollbars, selection, and the graph painter
(via `getComputedStyle`). So a light mode is "just" a `:root[data-theme='light']`
block overriding the values. That part worked first try. What shipped broken was
three places where a token or a canvas was quietly doing two jobs.

## 1. Text tokens and mark tokens must split

`--color-lumen` was both the accent *text* color (counts, links) and the graph's
*node* color. Text on paper must darken to reach 4.5:1—so the light override
darkened it, and the map filled with near-black teal blobs. A luminous
instrument draws light marks, whatever the ground; text obeys the opposite law.

The fix is a parallel token family (`--color-node-hub`, `--color-node-glow`,
`--color-node-glow-soft`, `--color-node-event`) whose **dark values are
byte-identical to the text tokens they split from**—so the split changes
nothing in the theme it came from—and whose light values go *lighter* while
text-lumen goes darker. Same split for event dots, which had been borrowing
`--color-ink-dim`, a text token that turned dark navy on paper.

The rule: any token consumed by both prose and canvas marks will eventually be
wrong in one of them. Split before theming, and preserve the loudness
*relationships* (hubs loud, dots quiet, fringe quietest) rather than the hues.

## 2. AA yellow on white is brown

There is no yellow that reaches 4.5:1 on a light ground—by the time it gets
there it is olive. The star color proved it: the "yellow" that passed text
contrast rendered as brown, and the user called it immediately.

The way out is noticing that color rarely needs to be on the *text*. The star
is a graphic almost everywhere (icon fill, ring on a map dot), and graphics
need only 3:1—at 3:1 a real gold (`#a87c00`, 3.3:1) survives. The one text use
("★ 3") was split: the glyph carries the gold, the number reads in AA ink.

Generalizes to any warm accent on a light theme: put the color on the shape,
the ink on the words.

## 3. Canvases cache and idle

Two separate staleness bugs, one lesson: a canvas is outside React's render
model, and theming it means *pushing* invalidation.

- The painter caches resolved token values (`getComputedStyle` per frame is
  not free). Theme switch → `resetPalette()` before notifying subscribers, so
  the next read is fresh.
- That's not enough: `react-force-graph-2d`'s `autoPauseRedraw` idles the
  render loop once the simulation settles, so nothing *asks* for a frame—the
  graph stayed in the old palette until the user panned. The wake signal is a
  prop change: the theme joins the paint callback's `useCallback` deps, and
  the new function identity triggers a repaint without `d3ReheatSimulation()`
  (which would re-jiggle the layout). The MiniMap draws in its own effect, so
  the theme joins those deps directly.

```ts
// theme.ts — order matters: cache clear before listeners
function apply(theme: ThemeId): void {
  current = theme
  document.documentElement.dataset.theme = theme === 'light' ? 'light' : undefined
  resetPalette()               // painter re-reads tokens on next frame
  for (const l of listeners) l() // subscribers re-render → new paint identity → repaint
}
```

The checklist for "does the whole app follow a token flip": every utility ✓
(they read vars), every canvas ✗ until you (a) invalidate its color cache and
(b) force one repaint on every canvas that idles.

## Prevention

- New canvas paint code takes colors from `palette()`, never hex literals—the
  header comment in `paint.ts` says why.
- Contrast is computed, not eyeballed: the WCAG relative-luminance math is
  four lines of Python; every token pair in both themes was verified numerically
  before shipping (see the ratios annotated in `observatory.css`).
- Deliberate sub-floor choices (map nodes below the 3:1 graphics floor, by
  the user's explicit call) are logged in `docs/EXCEPTIONS.md` with their
  mitigations, per the A11Y ruleset CLAUDE.md points at.

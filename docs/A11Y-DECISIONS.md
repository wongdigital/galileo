# A11Y-DECISIONS

Decisions between equally conformant alternatives, indexed by pattern, per the
[A11Y.md ruleset](https://github.com/fecarrico/A11Y.md/blob/main/docs/en/A11Y.md)
(Complex Component Protocol and decision-logging requirement). Target profile:
Standard (AA).

## docked-card (EventCard / EntityCard)

**Decision:** non-modal complementary panel (`<aside>`), no focus trap, Escape
closes, no focus return.

The card docks over a live surface that stays interactive—clicking another row
or node *replaces* the card's contents. A `dialog` with a trap would break that
model and would be the wrong ARIA pattern for content that never blocks the
page. Escape mirrors the canvas background-click dismissal for keyboard parity.
Focus is not force-moved into the card on open, because opening is a side
effect of browsing (row click, dot click) and yanking focus would break the
scan-through-rows flow.

## chip-tri-state (filter facet chips)

**Decision:** `aria-pressed` on/off with the negated state expressed in the
accessible name (the visible "not" prefix), rather than `aria-pressed="mixed"`.

"Mixed" announces as a partially-checked state, which is not what an exclusion
is. "not Wednesday, pressed" reads correctly through the visible text alone,
with color as a redundant channel (Icon + Text + Color rule).

## theme-toggle

**Decision:** a toggle button whose accessible name states the *action*
("Switch to light theme"), re-labelled after each press, rather than
`aria-pressed` state on a fixed label.

Both are conformant; action-naming avoids the double-negative of "Dark theme,
pressed: false" and matches the visual (the icon shows the destination, not
the current state).

## graph-canvas

**Decision:** the force-directed map is a visual alternative, not the sole
path—every event and entity it draws is reachable through the 5-Day list, the
filter chips, and the chat, all fully keyboard-operable. Canvas hit-testing is
mouse-only; the equivalent-task rule (Task Completion as the metric) is
satisfied by the list route. Hub/dot hover tooltips duplicate onto the pinned
card, which is real DOM.

## live-regions

**Decision:** `role="status"` (implicit polite) for filter result counts,
stale-data banner, chat tool-loop progress, and index loading; `role="alert"`
only for the chat error banner. Result counts change on every chip click, so
assertive would be hostile; the error banner is the one surface where missing
it means a silently failed turn.

## inline-event-link (ChatBubble bolded titles)

**Decision:** `<span role="link" tabIndex={0}>` with an Enter-only key handler
for the clickable event titles inside chat replies, rather than a `<button>` or
an `<a>`.

All three are conformant; the span is the one that renders correctly. A button
is an atomic inline box that cannot fragment across lines—a long title wrapping
inside a list item dragged the bullet marker to the title's last line, because
an inline-block's baseline is its final line box. An `<a>` without `href` is
not focusable (and `anchor-is-valid` rightly rejects `href="#"`); giving it the
event's Sched URL would make middle-click navigate away from the in-app card
the click is meant to open. `role="link"` matches the interaction (navigate to
the event's card) and the WAI-ARIA link pattern's Enter-only activation—Space
is a button convention, not a link one. The accessible name is the visible
title text; focus styling is the browser's default focus-visible outline.

## lint-gate (eslint-plugin-jsx-a11y)

**Decision:** a static a11y lint gate at the `strict` profile (`npm run lint`,
`eslint.config.js`), parsing TSX with `@babel/eslint-parser` rather than
typescript-eslint.

The gate exists so the AA work above cannot silently regress as the renderer
changes; `strict` (not `recommended`) because the renderer already passes it
with no changes, so there is no reason to lint below the AA target. The babel
parser is deliberate: the repo pins `typescript@7` (native compiler), which
typescript-eslint's peer range excludes and whose JS-API compatibility with
typescript-estree is unproven—babel parses TSX from its own grammar with no
dependency on the `typescript` package, and jsx-a11y needs only the JSX AST.

Two findings surfaced on first run, both handled without lowering the bar: the
Markdown link renderer in `ChatBubble` now pulls `children` out of the prop
spread so the anchor's content is statically visible (behaviour-identical), and
the `EventCard` shell's `onClick` carries a scoped disable—it is a propagation
boundary, not an affordance (no action to key-trigger), and the panel already
has keyboard parity through Escape-to-close.

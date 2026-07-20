# EXCEPTIONS

Deliberate relaxations from the Standard (AA) profile of the
[A11Y.md ruleset](https://github.com/fecarrico/A11Y.md/blob/main/docs/en/A11Y.md),
each with its mitigation. Everything not listed here targets full AA.

## Density exception: sub-12px metadata type

**Rule:** minimum font 12px (Standard). **Relaxation:** secondary metadata
renders at 10–11.5px—chip counts, mono timestamps, eyebrow labels, day-tab
sublines. This is the ruleset's own dashboard/density carve-out.

**Mitigation (required 7:1):** the quiet end of the ink scale was rebuilt so
small text meets the exception's raised floor: `--color-ink-dim` measures
7.65:1 (dark) / 7.32:1 (light) against the main ground, and carries the
sub-12px metadata. `--color-ink-faint` (4.86:1 dark / 4.87:1 light) appears at
small sizes only for de-emphasized hints that repeat information available
elsewhere (e.g. the shelf's "drop-in" aside, ghost-row remnants). Nothing
below 10px anywhere. Primary content—titles, prose, chat—is 12.5px+.

## ink-fringe: graphics only

`--color-ink-fringe` (1.94:1 dark) fails every text floor by design—it exists
to dim unconnected map nodes toward the rim (R8) and for decorative separators
(`·`) and chevrons, all `aria-hidden` or purely visual. The conformance pass
removed every prose use. The dimmed rim nodes stay below the 3:1 graphics
floor deliberately: de-emphasis is their meaning, they remain hoverable, and
every rimmed event is fully readable in the list view.

## Light-theme map nodes: below the 3:1 graphics floor

Hubs paint in medium blue (`--color-node-hub` #4f9dc7, 2.66:1 on the light
ground) with pale halos, by explicit design choice: the map is a luminous
instrument and its marks stay light on paper rather than darkening to the
graphics floor. Mitigations: the map is a secondary, redundant surface — every
event and entity is fully reachable at AA contrast through the 5-Day list,
filters, and chat; hub labels and all text on the canvas use the AA ink scale;
hover and pinned-card interactions name any mark. Dark theme is unaffected
(node colors measure 11:1+ there).

## Search field: no visible label element

The sidebar search input is labelled by `aria-label` + placeholder, not a
visible `<label>`. The field is self-describing by position and icon-free
placeholder text; a visible label would duplicate the placeholder verbatim.
Placeholder contrast was raised to the 4.5:1 text floor so the de facto label
is itself readable. Format instructions do not apply (free text).

## Boot background color

The BrowserWindow `backgroundColor` is the dark ground, so light-theme users
see a dark frame for the instant before first paint. Cosmetic (LOW), visible
only at launch; the renderer applies the stored theme before React mounts.

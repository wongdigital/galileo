# Concepts

Shared domain vocabulary for this project — entities, named processes, and
status concepts with project-specific meaning. Seeded with core domain
vocabulary, then accretes as ce-compound and ce-compound-refresh process
learnings; direct edits are fine. Glossary only, not a spec or catch-all.

## Responsive layout

### Viewport Tier

The shared responsive classification that determines whether Galileo uses its
docked application structure or its space-constrained structure, with
directional hysteresis preventing jitter near a boundary.

### Layout Spine

The single source of viewport measurement and Viewport Tier transitions that
structural components consume; CSS remains responsible for cosmetic
adaptation.

### Overlay Layout

The space-constrained application structure in which planning tools become a
dismissible overlay and graph context is presented through a list-oriented
fallback.

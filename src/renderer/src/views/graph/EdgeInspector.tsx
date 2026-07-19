/**
 * What an edge means (R9).
 *
 * Docked, not modal. The plan is explicit about why: the inspector must never
 * block a node click that re-seeds, or a lens switch, or another edge click. So
 * it is a panel inside the graph column that updates in place — clicking a
 * second edge replaces its contents rather than stacking a second thing to
 * dismiss, and the canvas underneath stays fully live the whole time.
 */

import { valueLabel } from '@renderer/sidebar/labels'
import type { GraphEntity, GraphLink } from '@shared/graph'

interface EdgeInspectorProps {
  link: GraphLink
  sourceTitle: string
  targetTitle: string
  onDismiss: () => void
}

/** Genre entities carry machine ids, and the sidebar already owns the table
 *  that renders `scifi-fantasy` as "Sci-Fi & Fantasy". People and franchises
 *  arrive as prose and are shown as extracted. */
function entityLabel(entity: GraphEntity): string {
  return entity.lens === 'facets' ? valueLabel('genre', entity.id.replace(/^genre:/, '')) : entity.label
}

export function EdgeInspector({ link, sourceTitle, targetTitle, onDismiss }: EdgeInspectorProps) {
  return (
    <aside
      className="pointer-events-auto absolute right-4 bottom-4 z-10 w-[280px] rounded-xl border border-line-strong bg-ground-850/95 p-3.5 shadow-[0_18px_40px_-20px_rgba(0,0,0,0.9)] backdrop-blur"
      // The canvas sits underneath and stays interactive; clicks inside the
      // panel must not travel down to it and re-seed by accident.
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="font-mono text-[10px] tracking-[0.12em] text-ink-faint">CONNECTED BY</span>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Close edge inspector"
          className="-m-1 rounded p-1 text-ink-faint transition-colors hover:text-ink"
        >
          <svg viewBox="0 0 12 12" className="h-3 w-3" aria-hidden="true">
            <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <ul className="mt-2 flex flex-col gap-1">
        {link.entities.map((entity) => (
          <li key={entity.id} className="flex items-baseline gap-1.5">
            <span className="text-[13px] leading-snug text-ink-bright">{entityLabel(entity)}</span>
            {entity.provisional ? (
              // Unseeded surface text, not a curated canonical — worth saying,
              // because it is the difference between "Star Wars" and whatever
              // spelling the description happened to use.
              <span className="font-mono text-[9px] text-ink-fringe" title="Matched on the extracted name, not a curated franchise id">
                UNSEEDED
              </span>
            ) : null}
          </li>
        ))}
      </ul>

      <div className="mt-3 flex flex-col gap-1 border-t border-line-soft pt-2.5 text-[11.5px] leading-snug text-ink-dim">
        <span className="truncate" title={sourceTitle}>
          {sourceTitle}
        </span>
        <span className="truncate" title={targetTitle}>
          {targetTitle}
        </span>
      </div>
    </aside>
  )
}

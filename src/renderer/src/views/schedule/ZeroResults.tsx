/**
 * The zero-result state.
 *
 * "No events match" is a dead end — it tells you the filter is wrong without
 * telling you which part. So this names every active input by name, offers the
 * single removals that actually recover something with the count they recover,
 * and puts a clear-everything button under it. The counts come from the engine
 * re-run, not an estimate, so the number offered is the number delivered.
 */

import { describeFilter, removeChip, type FilterState, type Relaxation } from '@shared/filter'
import { chipLabel } from '@renderer/sidebar/labels'

interface ZeroResultsProps {
  filter: FilterState
  relaxations: Relaxation[]
  onApply: (next: FilterState) => void
  onClear: () => void
}

export function ZeroResults({ filter, relaxations, onApply, onClear }: ZeroResultsProps) {
  const parts = describeFilter(filter, chipLabel)

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-5 px-8 py-16 text-center">
      <div className="max-w-md">
        <p className="text-[13.5px] text-ink">
          Nothing matches{' '}
          {parts.map((part, i) => (
            <span key={`${part.kind}-${i}`}>
              {i > 0 ? <span className="text-ink-faint"> · </span> : null}
              <span className="text-ink-bright">{part.label}</span>
            </span>
          ))}
          .
        </p>
      </div>

      {relaxations.length > 0 ? (
        <div className="flex flex-col items-center gap-2">
          <p className="text-[11px] uppercase tracking-[0.14em] text-ink-faint">Try dropping one</p>
          <div className="flex flex-wrap justify-center gap-2">
            {relaxations.slice(0, 4).map((relaxation) => (
              <button
                key={`${relaxation.part.kind}-${relaxation.part.label}`}
                type="button"
                onClick={() => onApply(relax(filter, relaxation))}
                className="rounded-full border border-line bg-ground-850 px-3 py-1.5 text-[12px] text-ink-dim transition-colors duration-150 hover:border-lumen-dim hover:text-ink-bright"
              >
                {relaxation.part.label}{' '}
                <span className="font-mono text-[11px] text-lumen">+{relaxation.count.toLocaleString()}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <button
        type="button"
        onClick={onClear}
        className="rounded-md border border-line-strong px-3.5 py-1.5 text-[12px] text-ink transition-colors duration-150 hover:bg-ground-800 hover:text-ink-bright"
      >
        Clear all filters
      </button>
    </div>
  )
}

/**
 * Mirrors the engine's own relaxation, applied to the live state. Kept here
 * rather than exported from the engine because the engine only ever needs to
 * *count* a relaxation; the UI is the only caller that commits one.
 */
function relax(filter: FilterState, relaxation: Relaxation): FilterState {
  switch (relaxation.part.kind) {
    case 'chip':
      // By value, not by reference: the part's chip came from this same state
      // object today, but a filter that arrives from the chat compiler later
      // will not be the same objects.
      return relaxation.part.chip ? removeChip(filter, relaxation.part.chip) : filter
    case 'text':
      return { ...filter, text: '' }
    case 'starred':
      return { ...filter, starredOnly: false }
    case 'changed':
      return { ...filter, changedOnly: false }
  }
}

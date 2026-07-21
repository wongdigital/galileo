/**
 * The lens control.
 *
 * The per-lens count column is optional and currently unused: the entity map
 * answers "this lens has nothing for you" with the all-fringe overlay, which can
 * quote hub counts for the whole scope rather than for one seed. The prop stays
 * because a count beside each lens is still the right shape for that hint if it
 * ever moves back up here.
 */

import type { LensId } from '@shared/graph'
import { SegmentedThumb } from '@renderer/components/SegmentedThumb'
import { useSlidingIndicator } from '@renderer/components/useSlidingIndicator'

const LABELS: Record<LensId, { label: string; hint: string }> = {
  // "Franchises", not "IP": attendees say franchise; IP is trade-press jargon.
  // The lens id stays `ip` — it is an identity, not a label.
  ip: { label: 'Franchises', hint: 'shares a franchise' },
  people: { label: 'People', hint: 'shares a named person' },
  facets: { label: 'Genres', hint: 'shares a genre' },
}

export const LENS_LABEL = (lens: LensId): string => LABELS[lens].label
export const LENS_HINT = (lens: LensId): string => LABELS[lens].hint

interface LensSelectorProps {
  lenses: readonly LensId[]
  active: LensId
  onSelect: (lens: LensId) => void
  /** Optional count per lens, shown beside its label. */
  degrees?: { lens: LensId; degree: number }[]
}

export function LensSelector({ lenses, active, onSelect, degrees = [] }: LensSelectorProps) {
  const degreeFor = (lens: LensId): number | null =>
    degrees.find((d) => d.lens === lens)?.degree ?? null
  const { itemRef, box } = useSlidingIndicator(active)

  return (
    <div className="relative flex items-center gap-px rounded-lg border border-line bg-ground-850 p-px">
      <SegmentedThumb box={box} />
      {lenses.map((lens) => {
        const isActive = lens === active
        const degree = degreeFor(lens)
        return (
          <button
            key={lens}
            type="button"
            ref={itemRef(lens)}
            onClick={() => onSelect(lens)}
            title={LABELS[lens].hint}
            aria-pressed={isActive}
            className={[
              'relative flex items-center gap-1.5 rounded-[7px] px-3 py-1.5 text-[12px] font-medium',
              'transition-colors duration-(--duration-toggle) ease-(--ease-instrument)',
              isActive ? 'text-ink-bright' : 'text-ink-dim hover:text-ink',
            ].join(' ')}
          >
            {LABELS[lens].label}
            {degree !== null ? (
              <span
                className={`font-mono text-[10px] ${
                  degree === 0 ? 'text-ink-faint' : isActive ? 'text-lumen' : 'text-ink-faint'
                }`}
              >
                {degree.toLocaleString()}
              </span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}

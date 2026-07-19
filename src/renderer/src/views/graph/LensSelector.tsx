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

const LABELS: Record<LensId, { label: string; hint: string }> = {
  ip: { label: 'IP', hint: 'shares a franchise' },
  people: { label: 'People', hint: 'shares a named person' },
  facets: { label: 'Genre', hint: 'shares a genre' },
  offering: { label: 'Offering', hint: 'another sitting of the same thing' },
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

  return (
    <div className="flex items-center gap-px rounded-lg border border-line bg-ground-850 p-px">
      {lenses.map((lens) => {
        const isActive = lens === active
        const degree = degreeFor(lens)
        return (
          <button
            key={lens}
            type="button"
            onClick={() => onSelect(lens)}
            title={LABELS[lens].hint}
            aria-pressed={isActive}
            className={[
              'flex items-center gap-1.5 rounded-[7px] px-3 py-1.5 text-[12px] font-medium',
              'transition-all duration-[--duration-toggle] ease-[--ease-instrument]',
              isActive
                ? 'bg-ground-700 text-ink-bright shadow-[0_0_0_1px_var(--color-line-strong),0_0_18px_-6px_var(--color-lumen)]'
                : 'text-ink-dim hover:text-ink',
            ].join(' ')}
          >
            {LABELS[lens].label}
            {degree !== null ? (
              <span
                className={`font-mono text-[10px] ${
                  degree === 0 ? 'text-ink-fringe' : isActive ? 'text-lumen' : 'text-ink-faint'
                }`}
              >
                {degree}
              </span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}

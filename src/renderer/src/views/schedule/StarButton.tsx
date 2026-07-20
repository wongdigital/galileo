/**
 * The star. Warm against the cold ground — it is the one mark on screen the
 * user made themselves, so it is the one thing that is not instrument-cyan.
 */

interface StarButtonProps {
  starred: boolean
  onToggle: () => void
  label: string
  /** Ghost stars are still starred, but the row underneath them is gone. */
  muted?: boolean
}

export function StarButton({ starred, onToggle, label, muted = false }: StarButtonProps) {
  return (
    <button
      type="button"
      aria-pressed={starred}
      aria-label={starred ? `Unstar ${label}` : `Star ${label}`}
      title={starred ? 'Unstar' : 'Star'}
      onClick={(e) => {
        // The row itself is a click target for selection; starring is not a
        // selection, so it must not also re-seed the graph.
        e.stopPropagation()
        onToggle()
      }}
      className="group/star -m-1 shrink-0 rounded p-1 transition-transform duration-150 active:scale-90"
    >
      <svg viewBox="0 0 20 20" className="h-4 w-4" aria-hidden="true">
        <path
          d="M10 1.6l2.47 5.3 5.53.72-4.07 3.9 1.05 5.6L10 14.4l-4.98 2.72 1.05-5.6L2 7.62l5.53-.72L10 1.6z"
          fill={starred ? 'var(--color-star)' : 'none'}
          stroke={starred ? 'var(--color-star)' : 'currentColor'}
          strokeWidth="1.3"
          strokeLinejoin="round"
          className={
            starred
              ? muted
                ? 'opacity-50'
                : ''
              : 'text-ink-faint transition-colors group-hover/star:text-ink-dim'
          }
        />
      </svg>
    </button>
  )
}

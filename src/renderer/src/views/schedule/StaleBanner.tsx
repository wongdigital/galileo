/**
 * The staleness and drift surface.
 *
 * Three distinct conditions, kept distinct because the user's next move differs
 * for each: the fetch failed (nothing to decide, the list below is last-known-
 * good), the drift guard held new data back (there *is* a decision — accept it
 * anyway), and a star write did not land (the list is fine, the plan is not).
 *
 * All three render as a band above the list rather than a dialog. A modal over
 * a schedule you are mid-triage on is worse than the problem it reports.
 */

import { useSpine } from '@renderer/state/spine'

function fetchedAgo(fetchedAt: string | null): string {
  if (!fetchedAt) return 'never'
  const then = Date.parse(fetchedAt)
  if (Number.isNaN(then)) return 'unknown'
  const minutes = Math.floor((Date.now() - then) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

export function StaleBanner() {
  const { dataset, refreshError, refresh, starError } = useSpine()

  const warning = dataset?.warning
  const stale = dataset?.stale ?? false
  if (!warning && !stale && !refreshError && !starError) return null

  return (
    <div className="flex flex-col">
      {warning ? (
        <div className="flex items-center gap-3 border-b border-moved/30 bg-moved/10 px-4 py-2">
          <span className="text-[12px] text-moved">
            New data looks wrong — {warning.detail}. Showing the last known good schedule.
          </span>
          <button
            type="button"
            onClick={() => void refresh({ acceptAnyway: true })}
            className="ml-auto shrink-0 rounded border border-moved/50 px-2 py-0.5 text-[11px] text-moved transition-colors duration-150 hover:bg-moved/15"
          >
            Accept new data anyway
          </button>
        </div>
      ) : null}

      {(stale || refreshError) && !warning ? (
        <div className="flex items-center gap-3 border-b border-line bg-ground-850 px-4 py-2">
          <span className="text-[12px] text-ink-dim">
            {refreshError
              ? `Refresh failed — ${refreshError}`
              : 'Showing the last saved schedule.'}{' '}
            <span className="text-ink-faint">
              Fetched {fetchedAgo(dataset?.fetchedAt ?? null)}.
            </span>
          </span>
        </div>
      ) : null}

      {starError ? (
        <div className="border-b border-cancelled/30 bg-cancelled/10 px-4 py-2 text-[12px] text-cancelled">
          {starError}
        </div>
      ) : null}
    </div>
  )
}

/**
 * The 5-day planning surface.
 *
 * Virtualized over the active day only. That is the plan's call and it is the
 * right one twice over: ~1,000 rows is the worst day in the corpus, which a
 * virtualizer handles without breaking a sweat, and a single-day window means
 * the scroll position means something — "where I am in Saturday" rather than
 * "where I am in 3,474 events".
 */

import { useMemo, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useSpine } from '@renderer/state/spine'
import { useSchedule } from '@renderer/state/useSchedule'
import { EMPTY_FILTER } from '@shared/filter'
import { AmbientShelf } from './AmbientShelf'
import { EventRow, ROW_HEIGHT } from './EventRow'
import { GhostBand } from './GhostBand'
import { StaleBanner } from './StaleBanner'
import { ZeroResults } from './ZeroResults'
import { useUidAnchor } from './useUidAnchor'

function DayRail() {
  const { setActiveDay } = useSpine()
  const { days, activeDay: resolvedDay } = useSchedule()

  return (
    <div className="flex shrink-0 items-stretch gap-px border-b border-line px-4">
      {days.map((bucket) => {
        const active = bucket.day === resolvedDay
        return (
          <button
            key={bucket.day}
            type="button"
            onClick={() => setActiveDay(bucket.day)}
            className={[
              'relative flex flex-col items-start gap-0.5 px-4 py-2.5 transition-colors duration-200',
              active ? 'text-ink-bright' : 'text-ink-faint hover:text-ink-dim',
            ].join(' ')}
          >
            <span className="text-[12.5px] font-medium">{bucket.weekday}</span>
            <span className="font-mono text-[10.5px]">
              {bucket.date} · {bucket.count}
            </span>
            {active ? (
              <span className="absolute inset-x-2 -bottom-px h-px bg-lumen shadow-[0_0_10px_1px_var(--color-lumen-dim)]" />
            ) : null}
          </button>
        )
      })}
    </div>
  )
}

export function ScheduleView() {
  const spine = useSpine()
  const model = useSchedule()
  const scrollRef = useRef<HTMLDivElement>(null)

  const uids = useMemo(() => model.rows.map((r) => r.uid), [model.rows])

  const virtualizer = useVirtualizer({
    count: model.rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
    // Identity is UID everywhere, including here — keying by index would make
    // every row a different row the moment the filtered array changes length.
    getItemKey: (index) => uids[index] ?? index,
  })

  useUidAnchor(virtualizer, uids, model.activeDay)

  const empty = model.rows.length === 0 && model.ambient.length === 0 && model.ghosts.length === 0

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <DayRail />
      <StaleBanner />

      {empty ? (
        model.filterActive ? (
          <ZeroResults
            filter={spine.filter}
            relaxations={model.relaxations}
            onApply={spine.setFilter}
            onClear={() => spine.setFilter(EMPTY_FILTER)}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center px-8 text-center text-[13px] text-ink-faint">
            {spine.status === 'loading'
              ? 'Fetching the schedule…'
              : 'No schedule data yet. Refresh to fetch from Sched.'}
          </div>
        )
      ) : (
        <>
          <GhostBand ghosts={model.ghosts} onRemove={(uid) => void spine.removeStar(uid)} />
          <AmbientShelf
            rows={model.ambient}
            selectedUid={spine.selectedUid}
            onSelect={(uid) => spine.setSelectedUid(uid === spine.selectedUid ? null : uid)}
            onToggleStar={(uid) => {
              const event = model.byUid.get(uid)
              if (event) void spine.toggleStar(event)
            }}
          />

          <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
            <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
              {virtualizer.getVirtualItems().map((item) => {
                const row = model.rows[item.index]
                if (!row) return null
                return (
                  <div
                    key={item.key}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      transform: `translateY(${item.start}px)`,
                    }}
                  >
                    <EventRow
                      row={row}
                      selected={spine.selectedUid === row.uid}
                      onSelect={() =>
                        spine.setSelectedUid(spine.selectedUid === row.uid ? null : row.uid)
                      }
                      onToggleStar={() => void spine.toggleStar(row.event)}
                      onAcknowledge={() => void spine.acknowledge([row.uid])}
                    />
                  </div>
                )
              })}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

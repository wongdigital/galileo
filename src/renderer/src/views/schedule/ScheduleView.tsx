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
import { CardPresence } from '@renderer/components/CardPresence'
import { EventCard } from '@renderer/components/EventCard'
import { useSlidingIndicator } from '@renderer/components/useSlidingIndicator'
import { useSpine } from '@renderer/state/spine'
import { useSchedule } from '@renderer/state/useSchedule'
import { ALL_DAYS } from '@renderer/state/derive'
import { EMPTY_FILTER } from '@shared/filter'
import { AmbientShelf } from './AmbientShelf'
import { EventRow, ROW_HEIGHT } from './EventRow'
import { GhostBand } from './GhostBand'
import { StaleBanner } from './StaleBanner'
import { ZeroResults } from './ZeroResults'
import { useUidAnchor } from './useUidAnchor'

function DayTab({
  weekday,
  sub,
  active,
  onClick,
  buttonRef,
}: {
  weekday: string
  sub: string
  active: boolean
  onClick: () => void
  buttonRef: (el: HTMLElement | null) => void
}) {
  return (
    <button
      type="button"
      ref={buttonRef}
      onClick={onClick}
      className={[
        'relative flex flex-col items-start justify-center gap-0.5 px-4 transition-colors duration-200',
        active ? 'text-ink-bright' : 'text-ink-faint hover:text-ink-dim',
      ].join(' ')}
    >
      <span className="text-[12.5px] font-medium">{weekday}</span>
      <span className="font-mono text-[10.5px]">{sub}</span>
    </button>
  )
}

function DayRail() {
  const { setActiveDay } = useSpine()
  const { days, activeDay: resolvedDay, filteredCount } = useSchedule()
  const { itemRef, box } = useSlidingIndicator(resolvedDay)

  return (
    // h-rail: shares the titlebar's 52px beat with the sidebar tab row, so
    // the two bottom hairlines meet as one line across the seam.
    <div className="relative flex h-rail shrink-0 items-stretch gap-px border-b border-line px-4">
      {/* Every filtered event across the con — pairs with the Starred toggle to
          give "all my stars, any day". */}
      <DayTab
        weekday="All"
        sub={`days · ${filteredCount.toLocaleString()}`}
        active={resolvedDay === ALL_DAYS}
        onClick={() => setActiveDay(ALL_DAYS)}
        buttonRef={itemRef(ALL_DAYS)}
      />
      {days.map((bucket) => (
        <DayTab
          key={bucket.day}
          weekday={bucket.weekday}
          sub={`${bucket.date} · ${bucket.count.toLocaleString()}`}
          active={bucket.day === resolvedDay}
          onClick={() => setActiveDay(bucket.day)}
          buttonRef={itemRef(bucket.day)}
        />
      ))}
      {/* One underline that travels to the active tab (U9). Inset 8px per
          side, mirroring the old per-tab `inset-x-2`. */}
      {box && box.width > 16 ? (
        <span
          aria-hidden="true"
          className="absolute -bottom-px h-px bg-lumen shadow-[0_0_10px_1px_var(--color-lumen-dim)] transition-[left,width] duration-(--duration-toggle) ease-(--ease-instrument) motion-reduce:transition-none"
          style={{ left: box.left + 8, width: box.width - 16 }}
        />
      ) : null}
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

          {/* The card docks against this wrapper, not against the scroll element
              itself: an absolute child of a scrolling box is positioned in the
              scrolled content, so it would ride up and out of view on the first
              wheel event. A sibling of the scroller stays put. */}
          <div className="relative flex min-h-0 flex-1 flex-col">
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

            {/* Selection is the pin (R11): the same `selectedUid` a row click
                toggles is what the map pins, so a uid chosen in either view
                opens the same card in the other. Dismissal clears the
                selection, which is also what clicking the row again does. */}
            <CardPresence>
              {spine.selectedUid ? (
                <EventCard uid={spine.selectedUid} onDismiss={() => spine.setSelectedUid(null)} />
              ) : null}
            </CardPresence>
          </div>
        </>
      )}
    </div>
  )
}

/**
 * The 5-day planning surface.
 *
 * Virtualized over the active day only. That is the plan's call and it is the
 * right one twice over: ~1,000 rows is the worst day in the corpus, which a
 * virtualizer handles without breaking a sweat, and a single-day window means
 * the scroll position means something — "where I am in Saturday" rather than
 * "where I am in 3,474 events".
 */

import { useCallback, useMemo, useRef } from 'react'
import { defaultRangeExtractor, useVirtualizer, type Range } from '@tanstack/react-virtual'
import { CardPresence } from '@renderer/components/CardPresence'
import { EventCard } from '@renderer/components/EventCard'
import { InstrumentState } from '@renderer/components/InstrumentState'
import { useSlidingIndicator } from '@renderer/components/useSlidingIndicator'
import { useSpine } from '@renderer/state/spine'
import { useSchedule } from '@renderer/state/useSchedule'
import { ALL_DAYS, dayLabel, withDayHeaders, type ScheduleListItem } from '@renderer/state/derive'
import { EMPTY_FILTER } from '@shared/filter'
import { AmbientShelf } from './AmbientShelf'
import { EventRow, ROW_HEIGHT } from './EventRow'
import { GhostBand } from './GhostBand'
import { StaleBanner } from './StaleBanner'
import { ZeroResults } from './ZeroResults'
import { useUidAnchor } from './useUidAnchor'

const HEADER_HEIGHT = 32

const FULL_WEEKDAY: Record<string, string> = {
  Sun: 'Sunday',
  Mon: 'Monday',
  Tue: 'Tuesday',
  Wed: 'Wednesday',
  Thu: 'Thursday',
  Fri: 'Friday',
  Sat: 'Saturday',
}

/** The sticky day divider in the All view. Opaque so rows scroll under it.
 *  A null day is the dateless tail of the list — "Unscheduled", so those rows
 *  don't read as belonging to the last real day. */
function DayHeader({ day }: { day: string | null }) {
  const label = day ? dayLabel(day) : null
  return (
    <div className="flex h-8 items-center gap-2 border-b border-line-soft bg-ground-900/95 px-4 backdrop-blur-sm">
      <span className="font-mono text-[10.5px] tracking-[0.15em] text-ink-dim uppercase">
        {label ? (FULL_WEEKDAY[label.weekday] ?? label.weekday) : 'Unscheduled'}
      </span>
      {label ? (
        <>
          <span className="text-ink-fringe">·</span>
          <span className="font-mono text-[10.5px] text-ink-faint">{label.date}</span>
        </>
      ) : null}
    </div>
  )
}

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

  // The All view interleaves a sticky day divider before each day's first row;
  // a single day needs none (the day rail already names it). Rows stay sorted
  // by start, so grouping consecutive rows by their computed day is clean.
  const isAll = model.activeDay === ALL_DAYS
  const items = useMemo<ScheduleListItem[]>(
    () =>
      isAll
        ? withDayHeaders(model.rows, model.dayByUid)
        : model.rows.map((row) => ({ kind: 'row', row })),
    [isAll, model.rows, model.dayByUid],
  )

  // One key per virtual index — a uid for rows, a day sentinel for headers.
  // Doubles as the anchor key set (useUidAnchor just does indexOf on strings).
  const itemKeys = useMemo(
    () => items.map((it) => (it.kind === 'header' ? `hdr:${it.day}` : it.row.uid)),
    [items],
  )
  const stickyIndexes = useMemo(
    () =>
      items.reduce<number[]>((acc, it, i) => {
        if (it.kind === 'header') acc.push(i)
        return acc
      }, []),
    [items],
  )
  const activeStickyRef = useRef(-1)

  // Keep the day header for the current section rendered even when it has
  // scrolled above the window, so it can pin to the top (the Contacts effect).
  const stickyRangeExtractor = useCallback(
    (range: Range) => {
      const active = [...stickyIndexes].reverse().find((i) => range.startIndex >= i) ?? -1
      activeStickyRef.current = active
      const next = new Set(defaultRangeExtractor(range))
      if (active >= 0) next.add(active)
      return [...next].sort((a, b) => a - b)
    },
    [stickyIndexes],
  )

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => (items[index]?.kind === 'header' ? HEADER_HEIGHT : ROW_HEIGHT),
    overscan: 12,
    getItemKey: (index) => itemKeys[index] ?? index,
    // Only the All view has headers to pin; the single-day path keeps the
    // library's zero-overhead default extractor.
    rangeExtractor: isAll ? stickyRangeExtractor : defaultRangeExtractor,
  })

  useUidAnchor(virtualizer, itemKeys, model.activeDay, (key) => !key.startsWith('hdr:'))

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
          <div className="flex flex-1 items-center justify-center">
            <InstrumentState eyebrow="5-Day schedule" loading={spine.status === 'loading'}>
              {spine.status === 'loading'
                ? 'Fetching the schedule…'
                : 'No schedule data yet. Refresh to fetch from Sched.'}
            </InstrumentState>
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
                  const entry = items[item.index]
                  if (!entry) return null
                  // The active section header pins to the top with position:
                  // sticky; everything else is absolutely placed at its offset.
                  const pinned = entry.kind === 'header' && activeStickyRef.current === item.index
                  const style = pinned
                    ? ({ position: 'sticky', top: 0, left: 0, width: '100%', zIndex: 1 } as const)
                    : ({
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        transform: `translateY(${item.start}px)`,
                        ...(entry.kind === 'header' ? { zIndex: 1 } : {}),
                      } as const)
                  return (
                    <div key={item.key} style={style}>
                      {entry.kind === 'header' ? (
                        <DayHeader day={entry.day} />
                      ) : (
                        <EventRow
                          row={entry.row}
                          selected={spine.selectedUid === entry.row.uid}
                          onSelect={() =>
                            spine.setSelectedUid(
                              spine.selectedUid === entry.row.uid ? null : entry.row.uid,
                            )
                          }
                          onToggleStar={() => void spine.toggleStar(entry.row.event)}
                          onAcknowledge={() => void spine.acknowledge([entry.row.uid])}
                        />
                      )}
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

import { useEffect, useMemo, useRef } from 'react'
import { eventNodeId } from '@shared/graph'
import { useSpine } from '@renderer/state/spine'
import {
  useEntityMap,
  type EntityMapEvent,
  type EntityMapHub,
} from '@renderer/state/useEntityMap'
import { LENS_LABEL } from '../graph/LensSelector'

const TOP_HUB_LIMIT = 8

function byDegreeThenLabel(a: EntityMapHub, b: EntityMapHub): number {
  return b.degree - a.degree || a.label.localeCompare(b.label)
}

function HubButton({
  hub,
  onSelect,
}: {
  hub: EntityMapHub
  onSelect: (id: string) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(hub.id)}
      className="flex min-h-11 w-full items-center justify-between gap-4 rounded-lg border border-line bg-ground-850 px-4 py-3 text-left transition-colors hover:border-line-strong hover:bg-ground-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lumen"
    >
      <span className="min-w-0 truncate text-[14px] font-medium text-ink-bright">
        {hub.label}
      </span>
      <span className="shrink-0 font-mono text-[11px] text-ink-faint">
        {hub.degree.toLocaleString()} {hub.degree === 1 ? 'event' : 'events'}
      </span>
    </button>
  )
}

function EventButton({
  event,
  onSelect,
}: {
  event: EntityMapEvent
  onSelect: (uid: string) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(event.uid)}
      className="flex min-h-11 w-full items-start justify-between gap-4 rounded-lg border border-line bg-ground-850 px-4 py-3 text-left transition-colors hover:border-line-strong hover:bg-ground-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lumen"
    >
      <span className="min-w-0">
        <span className="block truncate text-[14px] font-medium text-ink-bright">
          {event.title}
        </span>
        <span className="mt-0.5 block truncate text-[11px] text-ink-faint">
          {event.room || 'Room TBD'}
        </span>
      </span>
      <span className="shrink-0 font-mono text-[11px] text-ink-dim">{event.time}</span>
    </button>
  )
}

export function RelatedPanel({ focusHeading = false }: { focusHeading?: boolean }) {
  const {
    selectedUid,
    setSelectedUid,
    focusedEntityId,
    setFocusedEntityId,
  } = useSpine()
  const map = useEntityMap()
  const headingRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    if (focusHeading) headingRef.current?.focus()
  }, [focusHeading])

  const hubsById = useMemo(
    () => new Map(map.hubs.map((hub) => [hub.id, hub])),
    [map.hubs],
  )
  const eventsByUid = useMemo(
    () => new Map(map.events.map((event) => [event.uid, event])),
    [map.events],
  )
  const selectedEvent = selectedUid ? eventsByUid.get(selectedUid) : undefined
  const focusedHub = focusedEntityId ? hubsById.get(focusedEntityId) : undefined

  const relatedHubs = useMemo(() => {
    if (!selectedUid) return []
    const source = eventNodeId(selectedUid)
    const ids = map.links
      .filter((link) => link.source === source)
      .map((link) => link.target)
    return ids.flatMap((id) => {
      const hub = hubsById.get(id)
      return hub ? [hub] : []
    }).sort(byDegreeThenLabel)
  }, [hubsById, map.links, selectedUid])

  const relatedEvents = useMemo(() => {
    if (!focusedEntityId) return []
    const uids = map.links
      .filter((link) => link.target === focusedEntityId)
      .map((link) => link.source.replace(/^event:/, ''))
    return uids.flatMap((uid) => {
      const event = eventsByUid.get(uid)
      return event ? [event] : []
    })
  }, [eventsByUid, focusedEntityId, map.links])

  const topHubs = useMemo(
    () => [...map.hubs].sort(byDegreeThenLabel).slice(0, TOP_HUB_LIMIT),
    [map.hubs],
  )

  const chooseHub = (id: string): void => {
    setSelectedUid(null)
    setFocusedEntityId(id)
  }

  const chooseEvent = (uid: string): void => {
    setFocusedEntityId(null)
    setSelectedUid(uid)
  }

  const heading = focusedHub
    ? `Related to ${focusedHub.label}`
    : selectedEvent
      ? `Related to ${selectedEvent.title}`
      : 'Related'

  return (
    <section
      aria-labelledby="related-panel-heading"
      className="flex min-h-0 flex-1 flex-col overflow-y-auto px-[max(1rem,env(safe-area-inset-left))] py-5 pr-[max(1rem,env(safe-area-inset-right))]"
    >
      <div className="mx-auto flex w-full max-w-3xl flex-col">
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-faint">
          {LENS_LABEL(map.lens)}
        </p>
        <h1
          ref={headingRef}
          id="related-panel-heading"
          tabIndex={-1}
          className="mt-1 font-display text-xl font-semibold text-ink-bright focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-lumen"
        >
          {heading}
        </h1>

        {!map.ready ? (
          <p role="status" className="mt-4 text-[13px] text-ink-faint">
            Loading related events…
          </p>
        ) : focusedHub ? (
          <>
            <p className="mt-2 text-[13px] leading-relaxed text-ink-dim">
              Events connected through {focusedHub.label}.
            </p>
            {relatedEvents.length > 0 ? (
              <ul className="mt-5 space-y-2">
                {relatedEvents.map((event) => (
                  <li key={event.uid}>
                    <EventButton event={event} onSelect={chooseEvent} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-5 rounded-lg border border-line bg-ground-850 px-4 py-5 text-[13px] text-ink-faint">
                This hub is outside the current filter. Adjust the filter or choose another hub.
              </p>
            )}
          </>
        ) : selectedEvent ? (
          <>
            <p className="mt-2 text-[13px] leading-relaxed text-ink-dim">
              Hubs shared with this event under {LENS_LABEL(map.lens).toLowerCase()}.
            </p>
            {relatedHubs.length > 0 ? (
              <ul className="mt-5 space-y-2">
                {relatedHubs.map((hub) => (
                  <li key={hub.id}>
                    <HubButton hub={hub} onSelect={chooseHub} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-5 rounded-lg border border-line bg-ground-850 px-4 py-5 text-[13px] text-ink-faint">
                No shared hubs under this lens. The event remains selected.
              </p>
            )}
          </>
        ) : (
          <>
            <p className="mt-2 max-w-xl text-[13px] leading-relaxed text-ink-dim">
              Choose a hub to explore the events it connects, or select an event in the
              5-Day view to see what it shares.
            </p>
            {topHubs.length > 0 ? (
              <>
                <h2 className="mt-6 text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-faint">
                  Top hubs in this view
                </h2>
                <ul className="mt-2 space-y-2">
                  {topHubs.map((hub) => (
                    <li key={hub.id}>
                      <HubButton hub={hub} onSelect={chooseHub} />
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="mt-5 rounded-lg border border-line bg-ground-850 px-4 py-5 text-[13px] text-ink-faint">
                No hubs are available under the current lens and filter. The 5-Day view
                still contains every matching event.
              </p>
            )}
          </>
        )}
      </div>
    </section>
  )
}

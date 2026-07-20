/**
 * The "open now / all day" shelf.
 *
 * Ambient-class events are rooms that are simply open for a stretch — a games
 * table staffed for six hours, an autograph line, a portfolio review queue. As
 * list rows they are noise at the top of every day and they push the things you
 * actually have to be somewhere for off the screen. As a collapsed shelf they
 * are one line you can open when you want to wander.
 */

import { useState } from 'react'
import type { RowModel } from '@renderer/state/derive'
import { StarButton } from './StarButton'

interface AmbientShelfProps {
  rows: RowModel[]
  onSelect: (uid: string) => void
  onToggleStar: (uid: string) => void
  selectedUid: string | null
}

export function AmbientShelf({ rows, onSelect, onToggleStar, selectedUid }: AmbientShelfProps) {
  const [open, setOpen] = useState(false)
  if (rows.length === 0) return null

  const starred = rows.filter((r) => r.starred).length

  return (
    <div className="bg-ground-950/60">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        // h-rail: second-beat chrome — level with the sidebar's count row so
        // the hairline under each meets as one line at the seam. The border
        // lives on the button (inside the border-box 52px, matching the
        // sidebar rows) — on the wrapper it would add a 53rd pixel.
        className="flex h-rail w-full items-center gap-2.5 border-b border-line px-4 text-left transition-colors duration-150 hover:bg-ground-850"
      >
        <span
          className={`text-ink-fringe transition-transform duration-200 ${open ? 'rotate-90' : ''}`}
          aria-hidden="true"
        >
          ▸
        </span>
        <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-ink-dim">
          Open all day
        </span>
        <span className="font-mono text-[11px] text-ink-faint">{rows.length.toLocaleString()}</span>
        {starred > 0 ? (
          <span className="font-mono text-[11px] text-ink-dim">
            <span aria-hidden="true" className="text-star">★</span> {starred.toLocaleString()} starred
          </span>
        ) : null}
        <span className="ml-auto text-[11px] text-ink-faint">
          drop-in — no start time to make
        </span>
      </button>

      {open ? (
        // The header's own border-b already divides header from rows; this
        // container carries the band's soft bottom edge instead.
        <div className="flex flex-col border-b border-line-soft">
          {rows.map((row) => (
            <div
              key={row.uid}
              role="button"
              tabIndex={0}
              onClick={() => onSelect(row.uid)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onSelect(row.uid)
                }
              }}
              className={`flex cursor-default items-center gap-3.5 px-4 py-2 pl-10 transition-colors duration-150 ${
                selectedUid === row.uid ? 'bg-ground-800' : 'hover:bg-ground-850'
              }`}
            >
              <span className="w-20 shrink-0 text-right font-mono text-[11px] text-ink-faint">
                {row.time} · {row.duration}
              </span>
              <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">
                {row.event.title}
              </span>
              <span className="max-w-[180px] shrink-0 truncate text-[11px] text-ink-faint">
                {row.event.room}
              </span>
              <StarButton
                starred={row.starred}
                onToggle={() => onToggleStar(row.uid)}
                label={row.event.title}
              />
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

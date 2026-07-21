import { useMemo, type ReactNode } from 'react'
import Markdown from 'react-markdown'
import type { ChatMessage, ProposedAction } from '@shared/chat'
import type { ScheduleEvent } from '@shared/schedule'
import { ActionCard } from './ChatActionCard'

/** One rendered turn: the message plus whatever the tool loop attached to it. */
export interface ChatEntry {
  message: ChatMessage
  eventUids?: string[]
  proposedAction?: ProposedAction
  actionState?: 'pending' | 'done' | 'cancelled'
  /** A note about the action's outcome — a partial star failure, or an empty
   *  export — shown on the confirm card alongside its state. */
  actionNote?: string
  /** True while text is still streaming in; `status` is the between-tool label
   *  shown until the first token arrives. */
  streaming?: boolean
  status?: string
}

/** Flatten a Markdown node's children to their plain text, for matching a
 *  bolded run against a known event title. */
function nodeText(children: ReactNode): string {
  if (typeof children === 'string') return children
  if (typeof children === 'number') return String(children)
  if (Array.isArray(children)) return children.map(nodeText).join('')
  return ''
}

export function Bubble({
  entry,
  byUid,
  onOpen,
  onConfirm,
  onDismiss,
}: {
  entry: ChatEntry
  byUid: Map<string, ScheduleEvent>
  onOpen: (uid: string) => void
  onConfirm: () => void
  onDismiss: () => void
}) {
  const isUser = entry.message.role === 'user'

  // Title -> uid for the events this turn's tools returned, so the model's own
  // bolded event names become clickable in place (matching the user's mental
  // model — the name in the sentence is the link). A title shared by several
  // uids is the same program's repeated sittings, so it links to the earliest
  // one — whose card lists the rest under "Also runs" — rather than going
  // inert, which read as "only some of these are links".
  const eventByTitle = useMemo(() => {
    const uidsByTitle = new Map<string, string[]>()
    for (const uid of entry.eventUids ?? []) {
      const event = byUid.get(uid)
      if (event) {
        const key = event.title.trim().toLowerCase()
        const uids = uidsByTitle.get(key)
        if (uids) uids.push(uid)
        else uidsByTitle.set(key, [uid])
      }
    }
    const map = new Map<string, string>()
    for (const [key, uids] of uidsByTitle) {
      // '~' sorts after every ISO date, so a dateless sitting never wins over
      // a scheduled one.
      const startOf = (uid: string) => byUid.get(uid)?.start ?? '~'
      map.set(
        key,
        uids.reduce((a, b) => (startOf(b) < startOf(a) ? b : a)),
      )
    }
    return map
  }, [entry.eventUids, byUid])

  return (
    <div className={isUser ? 'flex justify-end' : 'flex flex-col gap-2'}>
      {isUser ? (
        <div className="max-w-[90%] self-end whitespace-pre-wrap rounded-lg bg-lumen/10 px-3 py-2 text-[12.5px] leading-relaxed text-ink-bright">
          {entry.message.content}
        </div>
      ) : (
        <div
          className={[
            'max-w-[90%] rounded-lg bg-ground-850 px-3 py-2 text-[12.5px] leading-relaxed text-ink',
            // The concierge replies in Markdown; render it. Arbitrary variants
            // rather than a typography plugin — the element set here is small.
            '[&_p]:my-1 first:[&_p]:mt-0 last:[&_p]:mb-0',
            '[&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:my-1 [&_ol]:list-decimal [&_ol]:pl-4 [&_li]:my-0.5',
            '[&_strong]:font-semibold [&_strong]:text-ink-bright [&_em]:italic',
            '[&_a]:text-lumen [&_a]:underline [&_code]:rounded [&_code]:bg-ground-900 [&_code]:px-1 [&_code]:font-mono [&_code]:text-[11.5px]',
            '[&_h1]:text-[13px] [&_h1]:font-semibold [&_h2]:text-[13px] [&_h2]:font-semibold [&_h3]:font-semibold',
          ].join(' ')}
        >
          {entry.streaming && !entry.message.content ? (
            // role=status: tool-loop progress ("Searching the schedule…")
            // reaches assistive tech, not just sighted eyes (SC 4.1.3).
            <span role="status" className="animate-pulse italic text-ink-faint motion-reduce:animate-none">
              {entry.status ?? 'Thinking…'}
            </span>
          ) : (
          <Markdown
            components={{
              // Links open in the user's browser, never navigate the app window.
              // children is pulled out explicitly (not left in the spread) so the
              // anchor's link text is visible to a11y tooling, not just at runtime.
              a: ({ node: _node, children, ...props }) => (
                <a {...props} target="_blank" rel="noreferrer">
                  {children}
                </a>
              ),
              // A bolded event name we recognize becomes a link to its card.
              strong: ({ node: _node, children }) => {
                const uid = eventByTitle.get(nodeText(children).trim().toLowerCase())
                return uid ? (
                  // White like the surrounding bold, with the link affordance
                  // held back to hover — a wall of blue in a list is noise.
                  // A span with role="link", not a <button>: form controls are
                  // atomic inline boxes that cannot fragment across lines, and
                  // an atomic box's baseline is its *last* line — so a long
                  // title wrapping inside a list item dragged the bullet down
                  // to its final line. A span wraps like the text around it.
                  <span
                    role="link"
                    tabIndex={0}
                    onClick={() => onOpen(uid)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') onOpen(uid)
                    }}
                    className="cursor-pointer font-semibold text-ink-bright underline-offset-2 transition-all duration-150 hover:underline"
                  >
                    {children}
                  </span>
                ) : (
                  <strong>{children}</strong>
                )
              },
            }}
          >
            {entry.message.content}
          </Markdown>
          )}
        </div>
      )}

      {entry.proposedAction ? (
        <ActionCard
          action={entry.proposedAction}
          state={entry.actionState ?? 'pending'}
          resultNote={entry.actionNote}
          onConfirm={onConfirm}
          onDismiss={onDismiss}
        />
      ) : null}
    </div>
  )
}

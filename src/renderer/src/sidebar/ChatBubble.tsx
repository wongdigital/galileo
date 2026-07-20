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
  // model — the name in the sentence is the link).
  const eventByTitle = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const uid of entry.eventUids ?? []) {
      const event = byUid.get(uid)
      if (event) {
        const key = event.title.trim().toLowerCase()
        const uids = map.get(key)
        if (uids) uids.push(uid)
        else map.set(key, [uid])
      }
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
              a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noreferrer" />,
              // A bolded event name we recognize becomes a link to its card.
              strong: ({ node: _node, children }) => {
                // Only link when the title resolves to exactly one event — two
                // same-titled events (a panel and its repeat) would send the
                // click to whichever happened to be last, so leave those bold.
                const uids = eventByTitle.get(nodeText(children).trim().toLowerCase())
                const uid = uids?.length === 1 ? uids[0] : undefined
                return uid ? (
                  // White like the surrounding bold, with the link affordance
                  // held back to hover — a wall of blue in a list is noise.
                  <button
                    type="button"
                    onClick={() => onOpen(uid)}
                    // `inline` + `text-left`: a button defaults to inline-block
                    // and text-align:center, so a title that wraps two lines
                    // centers. Flow it like the surrounding text instead.
                    className="inline cursor-pointer bg-transparent p-0 text-left align-baseline font-semibold text-ink-bright underline-offset-2 transition-all duration-150 hover:underline"
                  >
                    {children}
                  </button>
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

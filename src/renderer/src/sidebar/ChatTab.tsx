/**
 * The Chat tab — the concierge, sitting beside Filters as another way to shape
 * what the views show. It never holds the API key and never fabricates a
 * schedule fact: it sends the conversation plus a snapshot of the current
 * state to main, and main's tool loop does the grounding.
 *
 * Everything the model decided this turn arrives as a `ChatTurn`: prose to
 * show, a filter/lens/view patch to commit through the same spine setters a
 * chip click uses (R15 — chat produces the same state as the chips), event
 * uids to render as references, and a proposed mutation that waits for a tap.
 * Nothing here stars or exports without that tap (rule 2).
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useSpine } from '@renderer/state/spine'
import { useSchedule } from '@renderer/state/useSchedule'
import { dayLabel, formatTime, localParts } from '@renderer/state/derive'
import { PROVIDERS, type ChatMessage, type KeyStatus, type ProposedAction, type ProviderId } from '@shared/chat'

const PROVIDER_LABEL: Record<ProviderId, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  openrouter: 'OpenRouter',
}

/** One rendered turn: the message plus whatever the tool loop attached to it. */
interface ChatEntry {
  message: ChatMessage
  eventUids?: string[]
  proposedAction?: ProposedAction
  actionState?: 'pending' | 'done' | 'cancelled'
}

function whenLabel(iso: string | null): string {
  const parts = localParts(iso)
  const time = formatTime(iso)
  return parts ? `${dayLabel(parts.date).weekday} ${time}` : time
}

const bridge = () =>
  typeof window !== 'undefined' && window.api?.llm ? window.api.llm : null

export function ChatTab() {
  const spine = useSpine()
  const { candidates, byUid } = useSchedule()

  const [entries, setEntries] = useState<ChatEntry[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [keyStatus, setKeyStatus] = useState<KeyStatus | null>(null)
  const [provider, setProvider] = useState<ProviderId>('anthropic')
  const [showKeys, setShowKeys] = useState(false)

  const scrollRef = useRef<HTMLDivElement | null>(null)

  // Load which providers have a key, and pick the first one that does.
  useEffect(() => {
    const api = bridge()
    if (!api) return
    void api.keyStatus().then((status) => {
      setKeyStatus(status)
      const firstWithKey = PROVIDERS.find((p) => status[p])
      if (firstWithKey) setProvider(firstWithKey)
    })
  }, [])

  // Keep main's tool-loop index in step with the renderer's. The candidate
  // array is identity-stable, so this fires on dataset changes, not renders.
  useEffect(() => {
    const api = bridge()
    if (!api || candidates.length === 0) return
    void api.syncDataset(candidates)
  }, [candidates])

  useEffect(() => {
    // Guarded: jsdom elements have no scrollTo, and a new transcript entry
    // should not be the thing that throws in a test.
    scrollRef.current?.scrollTo?.({ top: scrollRef.current.scrollHeight })
  }, [entries])

  const hasAnyKey = keyStatus ? PROVIDERS.some((p) => keyStatus[p]) : false

  const send = useCallback(async () => {
    const text = input.trim()
    if (!text || sending) return
    const api = bridge()
    if (!api) {
      setError('The app is running outside its Electron shell — chat is unavailable.')
      return
    }

    const history: ChatMessage[] = [
      ...entries.map((e) => e.message),
      { role: 'user', content: text },
    ]
    setEntries((prev) => [...prev, { message: { role: 'user', content: text } }])
    setInput('')
    setSending(true)
    setError(null)

    try {
      const response = await api.chat({
        provider,
        messages: history,
        filter: spine.filter,
        lens: spine.lens,
        view: spine.view,
        starredUids: spine.stars.map((s) => s.uid),
        changedUids: Object.keys(spine.dataset?.changes ?? {}),
      })

      if (!response.ok) {
        setError(response.error.message)
        // A missing or rejected key sends the user straight to the key field.
        if (response.error.kind === 'no-key' || response.error.kind === 'auth') setShowKeys(true)
        return
      }

      const { turn } = response
      // Commit state through the same setters the chips use — one path in.
      if (turn.patch?.filter) spine.setFilter(turn.patch.filter)
      if (turn.patch?.lens) spine.setLens(turn.patch.lens)
      if (turn.patch?.view) spine.setView(turn.patch.view)

      setEntries((prev) => [
        ...prev,
        {
          message: turn.message,
          eventUids: turn.eventUids.length > 0 ? turn.eventUids : undefined,
          proposedAction: turn.proposedAction,
          actionState: turn.proposedAction ? 'pending' : undefined,
        },
      ])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSending(false)
    }
  }, [input, sending, entries, provider, spine])

  const confirmAction = useCallback(
    async (index: number, action: ProposedAction) => {
      if (action.kind === 'star') {
        for (const summary of action.events) {
          const event = byUid.get(summary.uid)
          if (event && !spine.stars.some((s) => s.uid === summary.uid)) {
            await spine.toggleStar(event)
          }
        }
      } else {
        const api = window.api
        if (api) await api.export.ics({ uids: action.events.map((e) => e.uid) })
      }
      setEntries((prev) =>
        prev.map((entry, i) => (i === index ? { ...entry, actionState: 'done' } : entry)),
      )
    },
    [byUid, spine],
  )

  const dismissAction = useCallback((index: number) => {
    setEntries((prev) =>
      prev.map((entry, i) => (i === index ? { ...entry, actionState: 'cancelled' } : entry)),
    )
  }, [])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-2.5">
        <span className="text-[12px] font-medium text-ink-bright">Concierge</span>
        {hasAnyKey ? (
          <span className="rounded-full border border-line bg-ground-850 px-2 py-0.5 text-[10px] text-ink-dim">
            {PROVIDER_LABEL[provider]}
          </span>
        ) : null}
        <button
          type="button"
          onClick={() => setShowKeys((v) => !v)}
          title="Manage API keys"
          className="ml-auto rounded-md border border-line px-2 py-1 text-[11px] text-ink-dim transition-colors duration-150 hover:border-lumen-dim hover:text-lumen"
        >
          Keys
        </button>
      </div>

      {showKeys || !hasAnyKey ? (
        <KeyPanel
          keyStatus={keyStatus}
          activeProvider={provider}
          onSelectProvider={setProvider}
          onChanged={(status) => {
            setKeyStatus(status)
            if (PROVIDERS.some((p) => status[p])) setShowKeys(false)
          }}
        />
      ) : null}

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {entries.length === 0 ? (
          <EmptyState enabled={hasAnyKey} />
        ) : (
          <div className="flex flex-col gap-3">
            {entries.map((entry, i) => (
              <Bubble
                key={i}
                entry={entry}
                byUid={byUid}
                onOpen={(uid) => spine.setSelectedUid(uid)}
                onConfirm={() => entry.proposedAction && confirmAction(i, entry.proposedAction)}
                onDismiss={() => dismissAction(i)}
              />
            ))}
            {sending ? <p className="text-[12px] text-ink-faint">Thinking…</p> : null}
          </div>
        )}
      </div>

      {error ? (
        <p className="shrink-0 border-t border-line px-4 py-2 text-[11.5px] text-cancelled">{error}</p>
      ) : null}

      <div className="shrink-0 border-t border-line px-3 py-3">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void send()
            }
          }}
          disabled={!hasAnyKey || sending}
          rows={2}
          placeholder={hasAnyKey ? 'Ask, filter, or plan…' : 'Add an API key to start'}
          className="w-full resize-none rounded-md border border-line bg-ground-850 px-2.5 py-2 text-[12.5px] text-ink placeholder:text-ink-fringe focus:border-lumen-dim focus:outline-none disabled:opacity-50"
        />
        <div className="mt-2 flex justify-end">
          <button
            type="button"
            onClick={() => void send()}
            disabled={!hasAnyKey || sending || input.trim().length === 0}
            className="rounded-md border border-lumen-dim bg-lumen/10 px-3 py-1.5 text-[12px] text-ink-bright transition-colors duration-150 hover:bg-lumen/20 disabled:opacity-40"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  )
}

function EmptyState({ enabled }: { enabled: boolean }) {
  if (!enabled) {
    return (
      <p className="text-[12px] leading-relaxed text-ink-faint">
        The concierge grounds every schedule answer in the app's own data. Add an API key above to
        turn it on — your key is stored encrypted on this machine and never leaves it except to your
        chosen provider.
      </p>
    )
  }
  return (
    <div className="text-[12px] leading-relaxed text-ink-faint">
      <p className="mb-2">Try:</p>
      <ul className="flex flex-col gap-1.5">
        <li>"I'm into horror and Star Wars"</li>
        <li>"nothing before noon, not the Marriott"</li>
        <li>"who's on the Lucasfilm panel?"</li>
        <li>"show these as a people graph"</li>
      </ul>
    </div>
  )
}

function Bubble({
  entry,
  byUid,
  onOpen,
  onConfirm,
  onDismiss,
}: {
  entry: ChatEntry
  byUid: Map<string, import('@shared/schedule').ScheduleEvent>
  onOpen: (uid: string) => void
  onConfirm: () => void
  onDismiss: () => void
}) {
  const isUser = entry.message.role === 'user'
  return (
    <div className={isUser ? 'flex justify-end' : 'flex flex-col gap-2'}>
      <div
        className={[
          'max-w-[90%] whitespace-pre-wrap rounded-lg px-3 py-2 text-[12.5px] leading-relaxed',
          isUser
            ? 'self-end bg-lumen/10 text-ink-bright'
            : 'bg-ground-850 text-ink',
        ].join(' ')}
      >
        {entry.message.content}
      </div>

      {entry.eventUids && entry.eventUids.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          {entry.eventUids.map((uid) => {
            const event = byUid.get(uid)
            if (!event) return null
            return (
              <button
                key={uid}
                type="button"
                onClick={() => onOpen(uid)}
                className="rounded-md border border-line bg-ground-900 px-2.5 py-1.5 text-left transition-colors duration-150 hover:border-lumen-dim"
              >
                <div className="truncate text-[12px] text-ink-bright">{event.title}</div>
                <div className="text-[10.5px] text-ink-faint">
                  {whenLabel(event.start)} · {event.room}
                </div>
              </button>
            )
          })}
        </div>
      ) : null}

      {entry.proposedAction ? (
        <ActionCard
          action={entry.proposedAction}
          state={entry.actionState ?? 'pending'}
          onConfirm={onConfirm}
          onDismiss={onDismiss}
        />
      ) : null}
    </div>
  )
}

function ActionCard({
  action,
  state,
  onConfirm,
  onDismiss,
}: {
  action: ProposedAction
  state: 'pending' | 'done' | 'cancelled'
  onConfirm: () => void
  onDismiss: () => void
}) {
  const verb = action.kind === 'star' ? 'Star' : 'Export'
  return (
    <div className="rounded-lg border border-line bg-ground-900 px-3 py-2.5">
      {action.note ? <p className="mb-1.5 text-[11.5px] text-ink-dim">{action.note}</p> : null}
      <ul className="mb-2 flex flex-col gap-0.5">
        {action.events.map((e) => (
          <li key={e.uid} className="truncate text-[11.5px] text-ink">
            {e.title} <span className="text-ink-faint">· {whenLabel(e.start)}</span>
          </li>
        ))}
      </ul>
      {state === 'pending' ? (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-md border border-lumen-dim bg-lumen/10 px-2.5 py-1 text-[11.5px] text-ink-bright hover:bg-lumen/20"
          >
            {verb} {action.events.length}
          </button>
          <button
            type="button"
            onClick={onDismiss}
            className="rounded-md px-2.5 py-1 text-[11.5px] text-ink-faint hover:text-ink"
          >
            Dismiss
          </button>
        </div>
      ) : (
        <p className="text-[11px] text-ink-faint">
          {state === 'done' ? `${verb === 'Star' ? 'Starred' : 'Exported'}.` : 'Dismissed.'}
        </p>
      )}
    </div>
  )
}

function KeyPanel({
  keyStatus,
  activeProvider,
  onSelectProvider,
  onChanged,
}: {
  keyStatus: KeyStatus | null
  activeProvider: ProviderId
  onSelectProvider: (provider: ProviderId) => void
  onChanged: (status: KeyStatus) => void
}) {
  const [draftProvider, setDraftProvider] = useState<ProviderId>(activeProvider)
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  const save = async () => {
    const api = bridge()
    if (!api || !key.trim()) return
    setBusy(true)
    setNote(null)
    try {
      const result = await api.setKey(draftProvider, key.trim())
      if (result.ok) {
        setKey('')
        onSelectProvider(draftProvider)
        onChanged(result.status)
        setNote('Saved.')
      } else {
        setNote(result.message)
      }
    } finally {
      setBusy(false)
    }
  }

  const clear = async () => {
    const api = bridge()
    if (!api) return
    setBusy(true)
    try {
      onChanged(await api.clearKey(draftProvider))
      setNote('Cleared.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="shrink-0 border-b border-line bg-ground-950 px-4 py-3">
      <div className="mb-2 flex gap-1">
        {PROVIDERS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setDraftProvider(p)}
            className={[
              'flex-1 rounded-md border px-2 py-1 text-[11px] transition-colors duration-150',
              draftProvider === p
                ? 'border-lumen-dim text-ink-bright'
                : 'border-line text-ink-dim hover:text-ink',
            ].join(' ')}
          >
            {PROVIDER_LABEL[p]}
            {keyStatus?.[p] ? <span className="ml-1 text-lumen">•</span> : null}
          </button>
        ))}
      </div>
      <input
        type="password"
        value={key}
        onChange={(e) => setKey(e.target.value)}
        placeholder={`${PROVIDER_LABEL[draftProvider]} API key`}
        className="w-full rounded-md border border-line bg-ground-850 px-2.5 py-1.5 text-[12px] text-ink placeholder:text-ink-fringe focus:border-lumen-dim focus:outline-none"
      />
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy || key.trim().length === 0}
          className="rounded-md border border-lumen-dim bg-lumen/10 px-2.5 py-1 text-[11.5px] text-ink-bright hover:bg-lumen/20 disabled:opacity-40"
        >
          Save
        </button>
        {keyStatus?.[draftProvider] ? (
          <button
            type="button"
            onClick={() => void clear()}
            disabled={busy}
            className="rounded-md px-2.5 py-1 text-[11.5px] text-ink-faint hover:text-cancelled"
          >
            Clear
          </button>
        ) : null}
        {note ? <span className="text-[11px] text-ink-faint">{note}</span> : null}
      </div>
      <p className="mt-2 text-[10.5px] leading-relaxed text-ink-fringe">
        Stored encrypted on this machine. Event descriptions are sent to your chosen provider when
        you ask about them.
      </p>
    </div>
  )
}

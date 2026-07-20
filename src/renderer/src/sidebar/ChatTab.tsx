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
 *
 * Keys and model live in a setup screen the gear under the composer opens.
 * The API key is stored encrypted in main and never read back here; the model
 * choice per provider is not secret and persists in localStorage.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import Markdown from 'react-markdown'
import { useSpine } from '@renderer/state/spine'
import { useSchedule } from '@renderer/state/useSchedule'
import { dayLabel, formatTime, localParts } from '@renderer/state/derive'
import {
  PROVIDERS,
  type ChatMessage,
  type KeyStatus,
  type ModelChoice,
  type ProposedAction,
  type ProviderId,
} from '@shared/chat'

const PROVIDER_LABEL: Record<ProviderId, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  openrouter: 'OpenRouter',
}

/** Curated fallback model choices per provider, used until the live catalogue
 *  loads (or when it can't — no key, offline). A dropdown plus a Custom escape
 *  hatch, so a stale list never traps a user on a retired model. OpenRouter
 *  slugs are namespaced by their upstream provider, so they read
 *  "OpenAI: GPT-5.6 Luna". The first entry is the default. */
const MODELS: Record<ProviderId, ModelChoice[]> = {
  anthropic: [
    { id: 'claude-sonnet-5', label: 'Claude Sonnet 5' },
    { id: 'claude-opus-4-8', label: 'Claude Opus 4.8' },
    { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
  ],
  openai: [
    { id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna' },
    { id: 'gpt-5', label: 'GPT-5' },
    { id: 'gpt-4.1', label: 'GPT-4.1' },
  ],
  openrouter: [
    { id: 'anthropic/claude-sonnet-5', label: 'Anthropic: Claude Sonnet 5' },
    { id: 'anthropic/claude-opus-4.8', label: 'Anthropic: Claude Opus 4.8' },
    { id: 'openai/gpt-5.6-luna', label: 'OpenAI: GPT-5.6 Luna' },
    { id: 'google/gemini-2.5-pro', label: 'Google: Gemini 2.5 Pro' },
  ],
}

const MODEL_STORE_KEY = 'sdcc.chat.models'

function defaultModels(): Record<ProviderId, string> {
  return { anthropic: MODELS.anthropic[0]!.id, openai: MODELS.openai[0]!.id, openrouter: MODELS.openrouter[0]!.id }
}

function loadModels(): Record<ProviderId, string> {
  const base = defaultModels()
  try {
    const raw = JSON.parse(localStorage.getItem(MODEL_STORE_KEY) ?? '{}') as Partial<Record<ProviderId, string>>
    for (const provider of PROVIDERS) {
      if (typeof raw[provider] === 'string' && raw[provider]) base[provider] = raw[provider] as string
    }
  } catch {
    // No stored preference yet, or corrupt — the defaults stand.
  }
  return base
}

function saveModels(models: Record<ProviderId, string>): void {
  try {
    localStorage.setItem(MODEL_STORE_KEY, JSON.stringify(models))
  } catch {
    // A private-mode localStorage that rejects writes is not worth failing over;
    // the choice just will not survive a restart.
  }
}

/** One rendered turn: the message plus whatever the tool loop attached to it. */
interface ChatEntry {
  message: ChatMessage
  eventUids?: string[]
  proposedAction?: ProposedAction
  actionState?: 'pending' | 'done' | 'cancelled'
  /** True while text is still streaming in; `status` is the between-tool label
   *  shown until the first token arrives. */
  streaming?: boolean
  status?: string
}

function whenLabel(iso: string | null): string {
  const parts = localParts(iso)
  const time = formatTime(iso)
  return parts ? `${dayLabel(parts.date).weekday} ${time}` : time
}

/** Flatten a Markdown node's children to their plain text, for matching a
 *  bolded run against a known event title. */
function nodeText(children: ReactNode): string {
  if (typeof children === 'string') return children
  if (typeof children === 'number') return String(children)
  if (Array.isArray(children)) return children.map(nodeText).join('')
  return ''
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
  const [models, setModels] = useState<Record<ProviderId, string>>(defaultModels)
  const [liveModels, setLiveModels] = useState<Partial<Record<ProviderId, ModelChoice[]>>>({})
  const [setupOpen, setSetupOpen] = useState(false)

  const scrollRef = useRef<HTMLDivElement | null>(null)

  // Load the persisted model choices once.
  useEffect(() => {
    setModels(loadModels())
  }, [])

  // Load which providers have a key; pick the first that does, and open setup
  // straight away when none do — there is nothing else to do until a key exists.
  useEffect(() => {
    const api = bridge()
    if (!api) return
    void api.keyStatus().then((status) => {
      setKeyStatus(status)
      const firstWithKey = PROVIDERS.find((p) => status[p])
      if (firstWithKey) setProvider(firstWithKey)
      else setSetupOpen(true)
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

  // Pull the live catalogue for a provider — OpenRouter always, the other two
  // once their key exists (their /models endpoint needs it). A miss leaves the
  // curated fallback in place.
  const refreshModels = useCallback(async (target: ProviderId) => {
    const api = bridge()
    if (!api) return
    const list = await api.models(target)
    if (list.length > 0) setLiveModels((prev) => ({ ...prev, [target]: list }))
  }, [])

  useEffect(() => {
    if (provider === 'openrouter' || keyStatus?.[provider]) void refreshModels(provider)
  }, [provider, keyStatus, refreshModels])

  const modelChoices = liveModels[provider] ?? MODELS[provider]

  const setModelFor = useCallback((target: ProviderId, id: string) => {
    setModels((prev) => {
      const next = { ...prev, [target]: id }
      saveModels(next)
      return next
    })
  }, [])

  const send = useCallback(async () => {
    const text = input.trim()
    if (!text || sending) return
    const api = bridge()
    if (!api) {
      setError('The app is running outside its Electron shell — chat is unavailable.')
      return
    }

    const history: ChatMessage[] = [...entries.map((e) => e.message), { role: 'user', content: text }]
    // The user message, and an empty assistant placeholder that streams in.
    setEntries((prev) => [
      ...prev,
      { message: { role: 'user', content: text } },
      { message: { role: 'assistant', content: '' }, streaming: true, status: 'Thinking…' },
    ])
    setInput('')
    setSending(true)
    setError(null)

    // Append streamed text/status to the trailing streaming placeholder.
    const unsubscribe =
      api.onChatDelta?.((delta) => {
        setEntries((prev) => {
          const i = prev.length - 1
          const last = prev[i]
          if (!last?.streaming) return prev
          const next = [...prev]
          if (delta.text) {
            next[i] = { ...last, message: { ...last.message, content: last.message.content + delta.text }, status: undefined }
          } else if (delta.status) {
            next[i] = { ...last, status: delta.status }
          }
          return next
        })
      }) ?? (() => {})

    try {
      const response = await api.chat({
        provider,
        model: models[provider] || undefined,
        messages: history,
        filter: spine.filter,
        lens: spine.lens,
        view: spine.view,
        starredUids: spine.stars.map((s) => s.uid),
        changedUids: Object.keys(spine.dataset?.changes ?? {}),
      })

      if (!response.ok) {
        // A user Stop is expected, not an error to shout about.
        if (response.error.kind !== 'aborted') {
          setError(response.error.message)
          if (response.error.kind === 'no-key' || response.error.kind === 'auth') setSetupOpen(true)
        }
        // Keep a partial answer if the user stopped mid-stream; otherwise drop
        // the empty placeholder.
        setEntries((prev) => {
          const i = prev.length - 1
          const last = prev[i]
          if (!last?.streaming) return prev
          const next = [...prev]
          if (response.error.kind === 'aborted' && last.message.content.trim()) {
            next[i] = { ...last, streaming: false, status: undefined }
          } else {
            next.splice(i, 1)
          }
          return next
        })
        return
      }

      const { turn } = response
      // Commit state through the same setters the chips use — one path in.
      if (turn.patch?.filter) spine.setFilter(turn.patch.filter)
      if (turn.patch?.lens) spine.setLens(turn.patch.lens)
      if (turn.patch?.view) spine.setView(turn.patch.view)

      // Finalize the placeholder: the returned turn is canonical, falling back
      // to whatever streamed if it came back empty.
      setEntries((prev) => {
        const i = prev.length - 1
        const last = prev[i]
        if (!last?.streaming) return prev
        const next = [...prev]
        next[i] = {
          message: {
            role: 'assistant',
            content: turn.message.content.trim() || last.message.content.trim() || 'I finished without a reply — try rephrasing.',
          },
          streaming: false,
          eventUids: turn.eventUids.length > 0 ? turn.eventUids : undefined,
          proposedAction: turn.proposedAction,
          actionState: turn.proposedAction ? 'pending' : undefined,
        }
        return next
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setEntries((prev) => {
        const i = prev.length - 1
        if (!prev[i]?.streaming) return prev
        const next = [...prev]
        next.splice(i, 1)
        return next
      })
    } finally {
      unsubscribe()
      setSending(false)
    }
  }, [input, sending, entries, provider, models, spine])

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
      setEntries((prev) => prev.map((entry, i) => (i === index ? { ...entry, actionState: 'done' } : entry)))
    },
    [byUid, spine],
  )

  const dismissAction = useCallback((index: number) => {
    setEntries((prev) => prev.map((entry, i) => (i === index ? { ...entry, actionState: 'cancelled' } : entry)))
  }, [])

  const stop = useCallback(() => {
    void bridge()?.cancelChat()
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
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {setupOpen ? (
          <KeySetup
            keyStatus={keyStatus}
            provider={provider}
            selectedModel={models[provider]}
            modelChoices={modelChoices}
            onProviderChange={setProvider}
            onModelChange={setModelFor}
            onRefreshModels={() => void refreshModels(provider)}
            onStatus={(status) => {
              setKeyStatus(status)
              // A freshly saved key unlocks that provider's live catalogue.
              void refreshModels(provider)
            }}
            onDone={() => setSetupOpen(false)}
          />
        ) : entries.length === 0 ? (
          <EmptyState />
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
        <div className="mt-2 flex items-center justify-between">
          <button
            type="button"
            onClick={() => setSetupOpen((v) => !v)}
            aria-label="Model and API keys"
            aria-pressed={setupOpen}
            title="Model & API keys"
            className={[
              'rounded-md border px-2 py-1.5 text-[13px] leading-none transition-colors duration-150',
              setupOpen
                ? 'border-lumen-dim text-lumen'
                : 'border-line text-ink-dim hover:border-lumen-dim hover:text-lumen',
            ].join(' ')}
          >
            <span aria-hidden="true">⚙</span>
          </button>
          {sending ? (
            <button
              type="button"
              onClick={stop}
              className="rounded-md border border-line px-3 py-1.5 text-[12px] text-ink-dim transition-colors duration-150 hover:border-cancelled/60 hover:text-cancelled"
            >
              Stop
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void send()}
              disabled={!hasAnyKey || input.trim().length === 0}
              className="rounded-md border border-lumen-dim bg-lumen/10 px-3 py-1.5 text-[12px] text-ink-bright transition-colors duration-150 hover:bg-lumen/20 disabled:opacity-40"
            >
              Send
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function EmptyState() {
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

  // Title -> uid for the events this turn's tools returned, so the model's own
  // bolded event names become clickable in place (matching the user's mental
  // model — the name in the sentence is the link).
  const eventByTitle = useMemo(() => {
    const map = new Map<string, string>()
    for (const uid of entry.eventUids ?? []) {
      const event = byUid.get(uid)
      if (event) map.set(event.title.trim().toLowerCase(), uid)
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
            <span className="animate-pulse italic text-ink-faint">{entry.status ?? 'Thinking…'}</span>
          ) : (
          <Markdown
            components={{
              // Links open in the user's browser, never navigate the app window.
              a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noreferrer" />,
              // A bolded event name we recognize becomes a link to its card.
              strong: ({ node: _node, children }) => {
                const uid = eventByTitle.get(nodeText(children).trim().toLowerCase())
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

/**
 * The model-and-keys screen. Provider → model → key, top to bottom. Draft keys
 * are held per provider so switching providers to enter a second key never
 * clears the first; on Save every provider with a typed key is persisted and
 * the screen closes back to the chat.
 */
function KeySetup({
  keyStatus,
  provider,
  selectedModel,
  modelChoices,
  onProviderChange,
  onModelChange,
  onRefreshModels,
  onStatus,
  onDone,
}: {
  keyStatus: KeyStatus | null
  provider: ProviderId
  selectedModel: string
  modelChoices: ModelChoice[]
  onProviderChange: (provider: ProviderId) => void
  onModelChange: (provider: ProviderId, id: string) => void
  onRefreshModels: () => void
  onStatus: (status: KeyStatus) => void
  onDone: () => void
}) {
  // Draft keys the user has typed this session, one slot per provider. Never
  // pre-filled from storage — main does not hand stored keys back.
  const [draftKeys, setDraftKeys] = useState<Partial<Record<ProviderId, string>>>({})
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  const isCustomModel = !modelChoices.some((m) => m.id === selectedModel)

  const save = async () => {
    setBusy(true)
    setNote(null)
    try {
      const api = bridge()
      if (api) {
        let status: KeyStatus | null = null
        let failure: string | null = null
        for (const p of PROVIDERS) {
          const draft = draftKeys[p]?.trim()
          if (!draft) continue
          const result = await api.setKey(p, draft)
          if (result.ok) status = result.status
          else failure = result.message
        }
        // A rejected key keeps setup open so it can be fixed; anything else
        // (including a model-only change, or no bridge at all) closes.
        if (failure) {
          setNote(failure)
          return
        }
        if (status) onStatus(status)
      }
      onDone()
    } finally {
      setBusy(false)
    }
  }

  const clear = async () => {
    const api = bridge()
    if (!api) return
    setBusy(true)
    try {
      onStatus(await api.clearKey(provider))
      setDraftKeys((prev) => ({ ...prev, [provider]: '' }))
      setNote(`${PROVIDER_LABEL[provider]} key cleared.`)
    } finally {
      setBusy(false)
    }
  }

  const saved = keyStatus?.[provider] ?? false

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-ink-dim">Model &amp; keys</p>

      <label className="flex flex-col gap-1">
        <span className="text-[11px] text-ink-faint">Provider</span>
        <select
          value={provider}
          onChange={(e) => onProviderChange(e.target.value as ProviderId)}
          className="rounded-md border border-line bg-ground-850 px-2.5 py-1.5 text-[12.5px] text-ink focus:border-lumen-dim focus:outline-none"
        >
          {PROVIDERS.map((p) => (
            <option key={p} value={p}>
              {PROVIDER_LABEL[p]}
              {keyStatus?.[p] ? ' •' : ''}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="flex items-center gap-2 text-[11px] text-ink-faint">
          Model
          <button
            type="button"
            onClick={onRefreshModels}
            title="Refresh the model list from the provider"
            className="text-ink-fringe transition-colors duration-150 hover:text-lumen"
          >
            ↻
          </button>
        </span>
        <select
          value={isCustomModel ? 'custom' : selectedModel}
          onChange={(e) => {
            const value = e.target.value
            onModelChange(provider, value === 'custom' ? '' : value)
          }}
          className="rounded-md border border-line bg-ground-850 px-2.5 py-1.5 text-[12.5px] text-ink focus:border-lumen-dim focus:outline-none"
        >
          {modelChoices.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
          <option value="custom">Custom…</option>
        </select>
      </label>

      {isCustomModel ? (
        <input
          type="text"
          value={selectedModel}
          onChange={(e) => onModelChange(provider, e.target.value)}
          placeholder="Exact model id"
          className="rounded-md border border-line bg-ground-850 px-2.5 py-1.5 text-[12px] text-ink placeholder:text-ink-fringe focus:border-lumen-dim focus:outline-none"
        />
      ) : null}

      <label className="flex flex-col gap-1">
        <span className="text-[11px] text-ink-faint">API key</span>
        <input
          type="password"
          value={draftKeys[provider] ?? ''}
          onChange={(e) => setDraftKeys((prev) => ({ ...prev, [provider]: e.target.value }))}
          placeholder={saved ? `${PROVIDER_LABEL[provider]} key saved — enter to replace` : `${PROVIDER_LABEL[provider]} API key`}
          className="rounded-md border border-line bg-ground-850 px-2.5 py-1.5 text-[12px] text-ink placeholder:text-ink-fringe focus:border-lumen-dim focus:outline-none"
        />
      </label>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy}
          className="rounded-md border border-lumen-dim bg-lumen/10 px-3 py-1.5 text-[12px] text-ink-bright hover:bg-lumen/20 disabled:opacity-40"
        >
          Save
        </button>
        {saved ? (
          <button
            type="button"
            onClick={() => void clear()}
            disabled={busy}
            className="rounded-md px-2.5 py-1.5 text-[11.5px] text-ink-faint hover:text-cancelled"
          >
            Clear key
          </button>
        ) : null}
        {note ? <span className="text-[11px] text-ink-faint">{note}</span> : null}
      </div>

      <p className="text-[10.5px] leading-relaxed text-ink-fringe">
        Keys are stored encrypted on this machine. Event descriptions are sent to your chosen
        provider when you ask about them.
      </p>
    </div>
  )
}

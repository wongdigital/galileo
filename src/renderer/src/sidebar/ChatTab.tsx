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

/** Curated model choices per provider — a dropdown, plus a Custom escape hatch
 *  for anything not listed. OpenRouter slugs are namespaced by their upstream
 *  provider, so they read "OpenAI: GPT-5.6 Luna". The first entry is the
 *  default. Any id can be overridden via Custom, so a stale list never traps
 *  a user on a retired model. */
interface ModelChoice {
  id: string
  label: string
}

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
  const [models, setModels] = useState<Record<ProviderId, string>>(defaultModels)
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
    setEntries((prev) => [...prev, { message: { role: 'user', content: text } }])
    setInput('')
    setSending(true)
    setError(null)

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
        setError(response.error.message)
        // A missing or rejected key sends the user straight to setup.
        if (response.error.kind === 'no-key' || response.error.kind === 'auth') setSetupOpen(true)
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
            models={models}
            onProviderChange={setProvider}
            onModelChange={setModelFor}
            onStatus={setKeyStatus}
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
  return (
    <div className={isUser ? 'flex justify-end' : 'flex flex-col gap-2'}>
      <div
        className={[
          'max-w-[90%] whitespace-pre-wrap rounded-lg px-3 py-2 text-[12.5px] leading-relaxed',
          isUser ? 'self-end bg-lumen/10 text-ink-bright' : 'bg-ground-850 text-ink',
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

/**
 * The model-and-keys screen. Provider → model → key, top to bottom. Draft keys
 * are held per provider so switching providers to enter a second key never
 * clears the first; on Save every provider with a typed key is persisted and
 * the screen closes back to the chat.
 */
function KeySetup({
  keyStatus,
  provider,
  models,
  onProviderChange,
  onModelChange,
  onStatus,
  onDone,
}: {
  keyStatus: KeyStatus | null
  provider: ProviderId
  models: Record<ProviderId, string>
  onProviderChange: (provider: ProviderId) => void
  onModelChange: (provider: ProviderId, id: string) => void
  onStatus: (status: KeyStatus) => void
  onDone: () => void
}) {
  // Draft keys the user has typed this session, one slot per provider. Never
  // pre-filled from storage — main does not hand stored keys back.
  const [draftKeys, setDraftKeys] = useState<Partial<Record<ProviderId, string>>>({})
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  const selectedModel = models[provider]
  const modelList = MODELS[provider]
  const isCustomModel = !modelList.some((m) => m.id === selectedModel)

  const save = async () => {
    const api = bridge()
    if (!api) return
    setBusy(true)
    setNote(null)
    try {
      let status: KeyStatus | null = null
      let failure: string | null = null
      for (const p of PROVIDERS) {
        const draft = draftKeys[p]?.trim()
        if (!draft) continue
        const result = await api.setKey(p, draft)
        if (result.ok) status = result.status
        else failure = result.message
      }
      if (failure) {
        setNote(failure)
        return
      }
      if (status) onStatus(status)
      // Save even if no new key was typed — the user may have only changed the
      // model — and return to the chat.
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
        <span className="text-[11px] text-ink-faint">Model</span>
        <select
          value={isCustomModel ? 'custom' : selectedModel}
          onChange={(e) => {
            const value = e.target.value
            onModelChange(provider, value === 'custom' ? '' : value)
          }}
          className="rounded-md border border-line bg-ground-850 px-2.5 py-1.5 text-[12.5px] text-ink focus:border-lumen-dim focus:outline-none"
        >
          {modelList.map((m) => (
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

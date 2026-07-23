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
 * choice per provider is not secret and persists in the settings artifact.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useSpine } from '@renderer/state/spine'
import { useSchedule } from '@renderer/state/useSchedule'
import {
  PROVIDERS,
  type AppStatePatch,
  type ChatMessage,
  type KeyStatus,
  type ModelChoice,
  type ProposedAction,
  type ProviderId,
} from '@shared/chat'
import type { ScheduleEvent } from '@shared/schedule'
import { MODELS, defaultModels, loadModels, saveModels } from './chatModels'
import { Bubble, type ChatEntry } from './ChatBubble'
import { KeySetup } from './ChatKeySetup'
import { bridge } from '../bridge'

export function ChatTab() {
  const spine = useSpine()
  const { candidates, byUid, enrichmentReady } = useSchedule()

  const [entries, setEntries] = useState<ChatEntry[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [keyStatus, setKeyStatus] = useState<KeyStatus | null>(null)
  const [provider, setProvider] = useState<ProviderId>('anthropic')
  const [models, setModels] = useState<Record<ProviderId, string>>(defaultModels)
  const [liveModels, setLiveModels] = useState<Partial<Record<ProviderId, ModelChoice[]>>>({})
  const [setupOpen, setSetupOpen] = useState(false)
  // The tool loop grounds its answers in the candidate index it was last synced.
  // Until that first sync lands, a turn would run against an empty schedule, so
  // the composer stays disabled — same gate as a missing key.
  const [datasetReady, setDatasetReady] = useState(false)

  const scrollRef = useRef<HTMLDivElement | null>(null)
  const modelRevision = useRef(0)

  // Load the persisted model choices once. A slow read may not replace a
  // selection the user already made while it was pending.
  useEffect(() => {
    const revisionAtStart = modelRevision.current
    void loadModels().then((stored) => {
      if (modelRevision.current === revisionAtStart) setModels(stored)
    })
  }, [])

  // Load which providers have a key; pick the first that does, and open setup
  // straight away when none do — there is nothing else to do until a key exists.
  useEffect(() => {
    const api = bridge()?.llm
    if (!api) return
    void api.keyStatus().then((status) => {
      setKeyStatus(status)
      const firstWithKey = PROVIDERS.find((p) => status[p] === 'present')
      if (firstWithKey) setProvider(firstWithKey)
      else {
        const unreadable = PROVIDERS.find((p) => status[p] === 'unreadable')
        if (unreadable) setProvider(unreadable)
        else setSetupOpen(true)
      }
    })
  }, [])

  // Keep main's tool-loop index in step with the renderer's. Candidates change
  // identity twice per dataset — once immediately (no person/ip dimensions
  // yet) and once when the compiled enrichment index resolves — and both are
  // synced. The composer only unlocks on the ENRICHED sync: a turn grounded on
  // the pre-enrichment index would answer "who is Scott Snyder?" with a
  // confident, false "not in this schedule".
  useEffect(() => {
    const api = bridge()?.llm
    if (!api || candidates.length === 0) return
    void api.syncDataset(candidates).then((result) => {
      if ((result?.received ?? 0) > 0 && enrichmentReady) setDatasetReady(true)
    })
  }, [candidates, enrichmentReady])

  useEffect(() => {
    // Guarded: jsdom elements have no scrollTo, and a new transcript entry
    // should not be the thing that throws in a test.
    scrollRef.current?.scrollTo?.({ top: scrollRef.current.scrollHeight })
  }, [entries])

  const selectedKeyState = keyStatus?.[provider]
  const canChat = selectedKeyState === 'present'

  // Pull the live catalogue for a provider — OpenRouter always, the other two
  // once their key exists (their /models endpoint needs it). A miss leaves the
  // curated fallback in place.
  const refreshModels = useCallback(async (target: ProviderId) => {
    const api = bridge()?.llm
    if (!api) return
    const list = await api.models(target)
    if (list.length > 0) setLiveModels((prev) => ({ ...prev, [target]: list }))
  }, [])

  useEffect(() => {
    if (provider === 'openrouter' || keyStatus?.[provider] === 'present') void refreshModels(provider)
  }, [provider, keyStatus, refreshModels])

  const modelChoices = liveModels[provider] ?? MODELS[provider]

  const setModelFor = useCallback((target: ProviderId, id: string) => {
    modelRevision.current += 1
    setModels((prev) => {
      const next = { ...prev, [target]: id }
      void saveModels(next)
      return next
    })
  }, [])

  // Commit a turn's state patch through the same spine setters a chip click
  // uses — one path into the store. Destructuring every field with a rest catch
  // turns a newly added AppStatePatch field into a compile error here, so a new
  // kind of state can never be silently dropped on the floor.
  const applyPatch = useCallback(
    (patch: AppStatePatch) => {
      const { filter, lens, view, ...rest } = patch
      const _exhaustive: Record<string, never> = rest
      void _exhaustive
      if (filter) spine.setFilter(filter)
      if (lens) spine.setLens(lens)
      if (view) spine.setView(view)
    },
    [spine],
  )

  const send = useCallback(async (retryText?: string, retryEntryIndex?: number) => {
    const text = (retryText ?? input).trim()
    if (!text || sending) return
    const api = bridge()?.llm
    if (!api) {
      setError('The app is running outside its Electron shell — chat is unavailable.')
      return
    }

    const historyEntries = retryEntryIndex === undefined
      ? entries
      : entries.slice(0, Math.max(0, retryEntryIndex - 1))
    const history: ChatMessage[] = [
      ...historyEntries.filter((entry) => !entry.interrupted).map((entry) => entry.message),
      { role: 'user', content: text },
    ]
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
        // Keep whatever streamed if the placeholder holds text — a timeout or a
        // provider error mid-stream still leaves a real partial answer worth
        // showing (with the banner above it); only an empty placeholder is dropped.
        setEntries((prev) => {
          const i = prev.length - 1
          const last = prev[i]
          if (!last?.streaming) return prev
          const next = [...prev]
          if (last.message.content.trim()) {
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
      if (!turn.interrupted && turn.patch) applyPatch(turn.patch)

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
          proposedAction: turn.interrupted ? undefined : turn.proposedAction,
          actionState: !turn.interrupted && turn.proposedAction ? 'pending' : undefined,
          interrupted: turn.interrupted,
        }
        return next
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setEntries((prev) => {
        const i = prev.length - 1
        const last = prev[i]
        if (!last?.streaming) return prev
        const next = [...prev]
        // Same rule as the ok:false branch: a partial answer that streamed in
        // survives the error; only an empty placeholder is removed.
        if (last.message.content.trim()) next[i] = { ...last, streaming: false, status: undefined }
        else next.splice(i, 1)
        return next
      })
    } finally {
      unsubscribe()
      setSending(false)
    }
  }, [input, sending, entries, provider, models, spine, applyPatch])

  const confirmAction = useCallback(
    async (index: number, action: ProposedAction) => {
      let state: ChatEntry['actionState'] = 'done'
      let note: string | undefined

      if (action.kind === 'star') {
        // One persist for the whole set, not a toggle per event: N toggles each
        // fold into a stale pre-confirm list and stars:set replaces, so only the
        // last would survive. Resolve uids to events and star them together.
        const events = action.events
          .map((summary) => byUid.get(summary.uid))
          .filter((event): event is ScheduleEvent => event !== undefined)
        const persisted = await spine.starMany(events)
        const landed = action.events.every((s) => persisted.some((p) => p.uid === s.uid))
        if (!landed) {
          // Leave the card actionable so a failed write can be retried.
          state = 'pending'
          note = 'Some stars did not save — try again.'
        }
      } else {
        const api = bridge()
        const result = api ? await api.export.ics({ uids: action.events.map((e) => e.uid) }) : null
        const status = (result as { status?: string } | null)?.status
        if (status === 'saved') {
          state = 'done'
        } else if (status === 'empty') {
          state = 'done'
          note = 'Nothing to export.'
        } else {
          // 'cancelled' (dialog dismissed) or 'failed' — keep the card actionable
          // rather than claiming an export that never wrote a file.
          state = 'pending'
        }
      }

      setEntries((prev) =>
        prev.map((entry, i) => (i === index ? { ...entry, actionState: state, actionNote: note } : entry)),
      )
    },
    [byUid, spine],
  )

  const dismissAction = useCallback((index: number) => {
    setEntries((prev) => prev.map((entry, i) => (i === index ? { ...entry, actionState: 'cancelled' } : entry)))
  }, [])

  const stop = useCallback(() => {
    void bridge()?.llm.cancelChat()
  }, [])

  // Key presence is unknown until the first status load, then explicitly
  // absent/unreadable/present. Missing-key affordances key off "all absent"
  // so neither startup nor a transient keychain lock prompts replacement.
  const keysMissing = keyStatus !== null && PROVIDERS.every((p) => keyStatus[p] === 'absent')
  const selectedKeyUnavailable = selectedKeyState === 'unreadable'
  let composerPlaceholder = 'Ask, filter, or plan…'
  if (!canChat) {
    composerPlaceholder = selectedKeyUnavailable
      ? 'API key temporarily unavailable'
      : 'Add an API key to start'
  } else if (!datasetReady) {
    composerPlaceholder = 'Loading the schedule…'
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
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
            // Updating key status activates the option-aware catalogue effect
            // above; calling refresh here as well would issue the same request
            // twice after a successful save.
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
                onResend={() => {
                  const prior = entries[i - 1]
                  if (prior?.message.role === 'user') void send(prior.message.content, i)
                }}
              />
            ))}
          </div>
        )}
      </div>

      {error ? (
        <p role="alert" className="shrink-0 border-t border-line px-4 py-2 text-[11.5px] text-cancelled">
          {error}
        </p>
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
          disabled={!canChat || !datasetReady || sending}
          rows={2}
          aria-label="Message the concierge"
          placeholder={composerPlaceholder}
          className="w-full resize-none rounded-md border border-line bg-ground-850 px-2.5 py-2 text-[12.5px] text-ink placeholder:text-ink-faint focus:border-lumen-dim focus:outline-none disabled:opacity-50"
        />
        <div className="mt-2 flex items-center justify-between">
          <button
            type="button"
            onClick={() => setSetupOpen((v) => !v)}
            aria-label="Model and API keys"
            aria-pressed={setupOpen}
            title={keysMissing ? 'No API key set — add one to chat' : 'Model & API keys'}
            className={[
              // h-8 matches the Send/Stop buttons across the row.
              'relative flex h-8 w-8 items-center justify-center rounded-md border text-[13px] leading-none transition-colors duration-150',
              setupOpen
                ? 'border-lumen-dim text-lumen'
                : 'border-line text-ink-dim hover:border-lumen-dim hover:text-lumen',
            ].join(' ')}
          >
            <span aria-hidden="true">⚙</span>
            {keysMissing ? (
              <span
                aria-hidden="true"
                className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-cancelled shadow-[0_0_6px_var(--color-cancelled)]"
              />
            ) : null}
          </button>
          {sending ? (
            <button
              type="button"
              onClick={stop}
              className="h-8 rounded-md border border-line px-3 text-[12px] text-ink-dim transition-colors duration-150 hover:border-cancelled/60 hover:text-cancelled"
            >
              Stop
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void send()}
              disabled={!canChat || !datasetReady || input.trim().length === 0}
              title={selectedKeyUnavailable ? 'API key temporarily unavailable' : !canChat ? 'Add a valid LLM API key to chat' : undefined}
              className="h-8 rounded-md border border-lumen-dim bg-lumen/10 px-3 text-[12px] text-ink-bright transition-colors duration-150 hover:bg-lumen/20 disabled:opacity-40 disabled:hover:bg-lumen/10"
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
      {/* ink-faint, not ink-fringe: fringe is reserved for decorative marks
          and sits below AA contrast for readable text. */}
      <p className="mt-3 text-[11px]">AI may make mistakes.</p>
    </div>
  )
}

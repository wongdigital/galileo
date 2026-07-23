import { useState } from 'react'
import { PROVIDERS, type KeyStatus, type ModelChoice, type ProviderId } from '@shared/chat'
import { PROVIDER_LABEL } from './chatModels'
import { bridge } from '../bridge'

/** The selects run `appearance-none` — Chromium's built-in arrow is the one
 *  browser-drawn mark in the app, and the stock-look audit (U9) evicts it.
 *  This chevron is the replacement, positioned over the select's pr-8. */
function SelectChevron() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 10 6"
      className="pointer-events-none absolute top-1/2 right-3 h-1.5 w-2.5 -translate-y-1/2 text-ink-faint"
    >
      <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/**
 * The model-and-keys screen. Provider → model → key, top to bottom. Draft keys
 * are held per provider so switching providers to enter a second key never
 * clears the first; on Save every provider with a typed key is persisted and
 * the screen closes back to the chat.
 */
export function KeySetup({
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
      const api = bridge()?.llm
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
    const api = bridge()?.llm
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

  const state = keyStatus?.[provider]
  const saved = state === 'present'
  const unreadable = state === 'unreadable'

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-ink-dim">Model &amp; keys</p>

      <label className="flex flex-col gap-1">
        <span className="text-[11px] text-ink-faint">Provider</span>
        <span className="relative">
          <select
            value={provider}
            onChange={(e) => onProviderChange(e.target.value as ProviderId)}
            className="w-full appearance-none rounded-md border border-line bg-ground-850 py-1.5 pl-2.5 pr-8 text-[12.5px] text-ink focus:border-lumen-dim focus:outline-none"
          >
            {PROVIDERS.map((p) => (
              <option key={p} value={p}>
                {PROVIDER_LABEL[p]}
                {keyStatus?.[p] === 'present' ? ' •' : keyStatus?.[p] === 'unreadable' ? ' ◌' : ''}
              </option>
            ))}
          </select>
          <SelectChevron />
        </span>
      </label>

      <label className="flex flex-col gap-1">
        <span className="flex items-center gap-2 text-[11px] text-ink-faint">
          Model
          <button
            type="button"
            onClick={onRefreshModels}
            title="Refresh the model list from the provider"
            className="touch-hit-24 text-ink-faint transition-colors duration-150 hover:text-lumen"
          >
            ↻
          </button>
        </span>
        <span className="relative">
          <select
            value={isCustomModel ? 'custom' : selectedModel}
            onChange={(e) => {
              const value = e.target.value
              onModelChange(provider, value === 'custom' ? '' : value)
            }}
            className="w-full appearance-none rounded-md border border-line bg-ground-850 py-1.5 pl-2.5 pr-8 text-[12.5px] text-ink focus:border-lumen-dim focus:outline-none"
          >
            {modelChoices.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
            <option value="custom">Custom…</option>
          </select>
          <SelectChevron />
        </span>
      </label>

      {isCustomModel ? (
        <input
          type="text"
          value={selectedModel}
          onChange={(e) => onModelChange(provider, e.target.value)}
          placeholder="Exact model id"
          className="rounded-md border border-line bg-ground-850 px-2.5 py-1.5 text-[12px] text-ink placeholder:text-ink-faint focus:border-lumen-dim focus:outline-none"
        />
      ) : null}

      <label className="flex flex-col gap-1">
        <span className="text-[11px] text-ink-faint">API key</span>
        <input
          type="password"
          disabled={unreadable}
          value={draftKeys[provider] ?? ''}
          onChange={(e) => setDraftKeys((prev) => ({ ...prev, [provider]: e.target.value }))}
          placeholder={unreadable ? `${PROVIDER_LABEL[provider]} key is temporarily unavailable` : saved ? `${PROVIDER_LABEL[provider]} key saved — enter to replace` : `${PROVIDER_LABEL[provider]} API key`}
          className="rounded-md border border-line bg-ground-850 px-2.5 py-1.5 text-[12px] text-ink placeholder:text-ink-faint focus:border-lumen-dim focus:outline-none disabled:opacity-60"
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

      <p className="text-[10.5px] leading-relaxed text-ink-faint">
        Keys are stored encrypted on this machine. Event descriptions are sent to your chosen
        provider when you ask about them.
      </p>
    </div>
  )
}

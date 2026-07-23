import { useEffect, useState } from 'react'
import { APP_NAME, APP_TAGLINE, APP_AUTHOR, APP_AUTHOR_URL, GITHUB_URL } from '@shared/app'
// Tracks the real shipped icon, so swapping build/icon.png updates this too.
import appIcon from '../../../build/icon.png'
import { bridge } from './bridge'

/**
 * The About window's body — the whole document, not a modal. It fills its own
 * small BrowserWindow (src/main/aboutWindow.ts); the window's traffic lights
 * close it, so there is no in-content close control, backdrop, or focus trap.
 * External links open in the browser via the window's setWindowOpenHandler.
 */
export function AboutApp() {
  const [version, setVersion] = useState<string | null>(null)

  useEffect(() => {
    const api = bridge()
    if (!api?.app?.version) return
    void api.app.version().then(setVersion).catch(() => setVersion(null))
  }, [])

  return (
    <main className="relative flex h-screen w-screen flex-col items-center justify-center bg-ground-950 px-8 text-center">
      {/* Drag strip under the traffic lights, so the frameless window can be
          moved. Interactive elements below opt back out with titlebar-no-drag. */}
      <div className="titlebar-drag absolute inset-x-0 top-0 h-8" />

      <img src={appIcon} alt="" width={112} height={112} className="h-28 w-28" aria-hidden="true" />

      <h1 className="font-display mt-4 text-[22px] font-bold tracking-tight text-ink-bright">
        {APP_NAME}
      </h1>
      <p className="mt-2 max-w-[16rem] text-[13px] leading-relaxed text-ink-dim">{APP_TAGLINE}</p>

      <dl className="mt-6 flex items-baseline justify-center gap-2 font-mono text-[12px]">
        <dt className="text-ink-faint">Version</dt>
        <dd className="text-ink">{version ?? '—'}</dd>
      </dl>

      <p className="mt-5 text-[12px] text-ink-faint">
        Made by{' '}
        <a
          href={APP_AUTHOR_URL}
          target="_blank"
          rel="noreferrer"
          className="titlebar-no-drag text-ink-dim underline-offset-2 transition-colors hover:text-ink hover:underline"
        >
          {APP_AUTHOR}
        </a>
      </p>

      <div className="mt-6">
        <a
          href={GITHUB_URL}
          target="_blank"
          rel="noreferrer"
          className="titlebar-no-drag rounded-lg border border-line px-4 py-1.5 text-[13px] font-medium text-ink-dim transition-colors hover:border-line-strong hover:text-ink"
        >
          GitHub
        </a>
      </div>
    </main>
  )
}

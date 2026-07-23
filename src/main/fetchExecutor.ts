/**
 * The app's fetch execution. Deliberately tiny and deliberately duplicated —
 * scripts/fetch.mjs has its own copy of these few lines, because the
 * alternative is putting `fetch` in src/shared/ and giving up the purity rule
 * that keeps the renderer's sandbox closed.
 *
 * Politeness posture, deliberate: exactly two requests per refresh, only when
 * the user asks (no polling, no background timer), a User-Agent that names the
 * project and a contact so Sched's admins can identify and reach us, no
 * retries, and a timeout so a stalled connection is dropped rather than held
 * open. This is somebody else's server and a schedule that changes hourly at
 * worst.
 */

import type { ScheduleSources } from '../shared/schedule'

const USER_AGENT = 'Galileo (+https://github.com/wongdigital/galileo; roger@wong.digital)'

/** Drop a stalled request rather than hold the socket open on Sched's side. */
const TIMEOUT_MS = 15_000

export async function fetchScheduleSources(site: string, signal?: AbortSignal): Promise<ScheduleSources> {
  const get = async (path: string): Promise<string> => {
    // The caller's abort (if any) OR the timeout ends the request, whichever
    // fires first.
    const timeout = AbortSignal.timeout(TIMEOUT_MS)
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout
    const res = await fetch(`${site}${path}`, { headers: { 'User-Agent': USER_AGENT }, signal: combined })
    if (!res.ok) throw new Error(`GET ${path} -> ${res.status}`)
    return res.text()
  }
  const [ics, listHtml] = await Promise.all([get('/all.ics'), get('/list/descriptions')])
  return { ics, listHtml }
}

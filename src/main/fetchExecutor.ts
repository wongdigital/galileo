/**
 * The app's fetch execution. Deliberately tiny and deliberately duplicated —
 * scripts/fetch.mjs has its own copy of these few lines, because the
 * alternative is putting `fetch` in src/shared/ and giving up the purity rule
 * that keeps the renderer's sandbox closed.
 *
 * Exactly two requests per refresh, an honest user agent, and no retries: this
 * is somebody else's server and a schedule that changes hourly at worst.
 */

const USER_AGENT = 'sdcc-schedule personal fetcher (roger@wong.digital)'

export interface ScheduleSources {
  ics: string
  listHtml: string
}

export async function fetchScheduleSources(site: string, signal?: AbortSignal): Promise<ScheduleSources> {
  const get = async (path: string): Promise<string> => {
    const res = await fetch(`${site}${path}`, { headers: { 'User-Agent': USER_AGENT }, signal })
    if (!res.ok) throw new Error(`GET ${path} -> ${res.status}`)
    return res.text()
  }
  const [ics, listHtml] = await Promise.all([get('/all.ics'), get('/list/descriptions')])
  return { ics, listHtml }
}

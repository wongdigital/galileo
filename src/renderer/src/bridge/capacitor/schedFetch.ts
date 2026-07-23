import type { ChatFetch } from '@shared/llm'
import type { ScheduleSources } from '@shared/schedule'

export interface CapacitorHttpOptions {
  url: string
  method?: string
  data?: unknown
  headers?: Record<string, string>
  readTimeout?: number
  connectTimeout?: number
  responseType?: 'json' | 'text'
}

export interface CapacitorHttpResponse {
  data: unknown
  status: number
  headers: Record<string, string>
  url: string
}

export interface CapacitorHttpPlugin {
  request(options: CapacitorHttpOptions): Promise<CapacitorHttpResponse>
}

const USER_AGENT = 'Galileo (+https://github.com/wongdigital/galileo; roger@wong.digital)'
const TIMEOUT_MS = 15_000

/** Exactly two native requests per refresh, matching Electron's server-friendly posture. */
export async function fetchCapacitorScheduleSources(
  site: string,
  http: CapacitorHttpPlugin,
): Promise<ScheduleSources> {
  const base = site.replace(/\/$/, '')
  const get = async (path: string): Promise<string> => {
    const response = await http.request({
      url: `${base}${path}`,
      method: 'GET',
      headers: { 'User-Agent': USER_AGENT },
      connectTimeout: TIMEOUT_MS,
      readTimeout: TIMEOUT_MS,
      responseType: 'text',
    })
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`GET ${path} -> ${response.status}`)
    }
    if (typeof response.data !== 'string') {
      throw new Error(`GET ${path} returned a non-text response`)
    }
    return response.data
  }

  const [ics, listHtml] = await Promise.all([get('/all.ics'), get('/list/descriptions')])
  return { ics, listHtml }
}

/**
 * Fetch-shaped adapter for the decided non-streaming CORS fallback. Native
 * HTTP is used explicitly; Capacitor's global fetch patch remains disabled.
 */
export function createCapacitorBufferedFetch(http: CapacitorHttpPlugin): ChatFetch {
  return async (input, init = {}) => {
    const request = input instanceof Request ? input : null
    const url = request?.url ?? String(input)
    const method = init.method ?? request?.method ?? 'GET'
    const headers = mergeHeaders(request?.headers, init.headers)
    const rawBody = init.body ?? (request ? await request.clone().text() : undefined)
    const data = decodeBody(rawBody, headers)
    const response = await abortable(
      http.request({
        url,
        method,
        ...(data === undefined ? {} : { data }),
        headers,
        responseType: isJson(headers) ? 'json' : 'text',
        connectTimeout: TIMEOUT_MS,
        readTimeout: 90_000,
      }),
      init.signal ?? request?.signal,
    )
    const body =
      typeof response.data === 'string' ? response.data : JSON.stringify(response.data)
    return new Response(body, {
      status: response.status,
      headers: response.headers,
    })
  }
}

function abortable<T>(operation: Promise<T>, signal?: AbortSignal | null): Promise<T> {
  if (!signal) return operation
  if (signal.aborted) return Promise.reject(signal.reason)
  return new Promise<T>((resolve, reject) => {
    let settled = false
    const finish = (complete: () => void): void => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', onAbort)
      complete()
    }
    const onAbort = (): void => finish(() => reject(signal.reason))
    signal.addEventListener('abort', onAbort, { once: true })
    void operation.then(
      (value) => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(error)),
    )
  })
}

function mergeHeaders(
  requestHeaders: Headers | undefined,
  initHeaders: HeadersInit | undefined,
): Record<string, string> {
  const merged = new Headers(requestHeaders)
  new Headers(initHeaders).forEach((value, key) => merged.set(key, value))
  return Object.fromEntries(merged.entries())
}

function isJson(headers: Record<string, string>): boolean {
  return Object.entries(headers).some(
    ([name, value]) => name.toLowerCase() === 'content-type' && /json/i.test(value),
  )
}

function decodeBody(
  body: BodyInit | null | undefined,
  headers: Record<string, string>,
): unknown {
  if (body === null || body === undefined) return undefined
  if (typeof body !== 'string') {
    throw new TypeError('Capacitor buffered transport only supports string request bodies.')
  }
  if (!isJson(headers)) return body
  try {
    return JSON.parse(body)
  } catch {
    return body
  }
}

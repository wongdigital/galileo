/**
 * Durable JSON storage supplied by a platform adapter.
 *
 * `replace` is intentionally not described as atomic: Capacitor's iOS rename
 * has a target-absent kill window. Instead every adapter must provide these
 * observable guarantees:
 *
 * - a failed or interrupted replace never leaves corrupt JSON as the only copy;
 * - either the previous or the newly requested bytes remain recoverable;
 * - `read` recovers a parseable interrupted temp when the target is absent or
 *   corrupt, then removes obsolete temps for that name;
 * - overlapping replaces for one name execute in invocation order; and
 * - a rejected replace leaves the previous value readable.
 *
 * Names are adapter-local artifact names, never filesystem paths. Shared slot
 * logic owns schemas and generations; adapters own only JSON bytes and durable
 * replacement mechanics.
 */
export interface JsonStore {
  read(name: string): Promise<unknown | null>
  replace(name: string, value: unknown): Promise<void>
}

export type JsonParseResult =
  | { ok: true; value: unknown }
  | { ok: false }

export function isValidJsonArtifactName(name: string): boolean {
  return !(
    name.length === 0 ||
    name === '.' ||
    name === '..' ||
    name.includes('/') ||
    name.includes('\\')
  )
}

export function validateJsonArtifactName(name: string): void {
  if (!isValidJsonArtifactName(name)) throw new Error(`Invalid JSON artifact name: ${name}`)
}

export function stringifyJson(value: unknown): string {
  const bytes = JSON.stringify(value)
  if (bytes === undefined) throw new TypeError('JsonStore cannot persist undefined')
  return bytes
}

export function parseJson(value: string | null): JsonParseResult {
  if (value === null) return { ok: false }
  try {
    return { ok: true, value: JSON.parse(value) }
  } catch {
    return { ok: false }
  }
}

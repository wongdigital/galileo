import { describe, expect, it } from 'vitest'
import { failedUids, validateEnrichmentIndex } from '../schema'
import { index, UID_PANEL } from './fixtures'

describe('validateEnrichmentIndex', () => {
  it('accepts the envelope the compiler writes', () => {
    const result = validateEnrichmentIndex(index())
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.warnings).toEqual([])
  })

  it('rejects a missing envelope field by name', () => {
    const { schema_version: _drop, ...rest } = index()
    const result = validateEnrichmentIndex(rest)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors).toContain('schema_version missing or not a number')
  })

  it('rejects a non-object', () => {
    expect(validateEnrichmentIndex('nope').ok).toBe(false)
    expect(validateEnrichmentIndex(null).ok).toBe(false)
  })

  it('degrades one bad entry to a warning instead of failing the whole index', () => {
    const bad = index({
      entries: {
        [UID_PANEL]: { status: 'ok', description_hash: 'x', people: [], franchises: [] },
        broken: { status: 'ok', people: 'not-an-array', franchises: [] } as never
      }
    })
    const result = validateEnrichmentIndex(bad)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.warnings).toContain('entry broken: people is not an array')
  })

  it('warns on an unknown status and an unknown role', () => {
    const odd = index({
      entries: {
        a: { status: 'weird' as never, people: [{ name: 'X', role: 'wizard' as never }], franchises: [] }
      }
    })
    const result = validateEnrichmentIndex(odd)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.warnings.some((w) => w.includes('unknown status'))).toBe(true)
      expect(result.warnings).toContain('entry a: unknown role wizard')
    }
  })

  it('warns rather than errors on a schema version it does not recognize', () => {
    const result = validateEnrichmentIndex(index({ schema_version: 99 }))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.warnings.some((w) => w.includes('schema_version 99'))).toBe(true)
  })
})

describe('failedUids', () => {
  it('lists the entries a rerun should target', () => {
    const withFailures = index({
      entries: {
        good: { status: 'ok', description_hash: 'h', people: [], franchises: [] },
        bad: { status: 'errored', people: [], franchises: [] },
        gone: { status: 'expired', people: [], franchises: [] }
      }
    })
    expect(failedUids(withFailures).sort()).toEqual(['bad', 'gone'])
  })
})

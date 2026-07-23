import { describe, expect, it } from 'vitest'
import {
  isValidJsonArtifactName,
  parseJson,
  stringifyJson,
  validateJsonArtifactName,
} from '../jsonStore'

describe('durable JSON boundaries', () => {
  it('accepts artifact names but rejects paths and navigation segments', () => {
    expect(isValidJsonArtifactName('stars.json')).toBe(true)
    for (const name of ['', '.', '..', '../stars.json', 'schedule/stars.json', 'schedule\\stars.json']) {
      expect(isValidJsonArtifactName(name)).toBe(false)
      expect(() => validateJsonArtifactName(name)).toThrow(`Invalid JSON artifact name: ${name}`)
    }
  })

  it('rejects undefined while preserving normal JSON serialization', () => {
    expect(stringifyJson({ stars: ['p1'] })).toBe('{"stars":["p1"]}')
    expect(() => stringifyJson(undefined)).toThrow('JsonStore cannot persist undefined')
  })

  it('parses valid JSON and treats missing or corrupt bytes as unavailable', () => {
    expect(parseJson('{"ready":true}')).toEqual({ ok: true, value: { ready: true } })
    expect(parseJson(null)).toEqual({ ok: false })
    expect(parseJson('{not json')).toEqual({ ok: false })
  })
})

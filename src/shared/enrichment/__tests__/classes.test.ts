import { describe, expect, it } from 'vitest'
import { classifyAll, classifyEvent, durationMinutes, trackKey } from '../classes'
import { event, GAMES_BLOCK, PANEL } from './fixtures'

describe('trackKey', () => {
  it('strips the sort prefix Sched puts on track names', () => {
    expect(trackKey('6: GAMES')).toBe('GAMES')
    expect(trackKey('P: PROGRAMS')).toBe('PROGRAMS')
    expect(trackKey(null)).toBe('')
  })
})

describe('classifyEvent', () => {
  it('calls a 50-minute panel attend', () => {
    const result = classifyEvent(PANEL)
    expect(result.eventClass).toBe('attend')
    expect(result.durationMinutes).toBe(50)
    expect(result.reason).toBe('scheduled')
  })

  it('calls a 6-hour games block ambient', () => {
    const result = classifyEvent(GAMES_BLOCK)
    expect(result.eventClass).toBe('ambient')
    expect(result.durationMinutes).toBe(360)
    expect(result.reason).toBe('long-drop-in-track')
  })

  it('keeps a long Programs event attend — a film block still has a start time', () => {
    const e = event('x', {
      track: '1: PROGRAMS',
      start: '2026-07-23T10:00:00-07:00',
      end: '2026-07-23T15:00:00-07:00'
    })
    expect(classifyEvent(e).eventClass).toBe('attend')
  })

  it('calls any 8h+ event ambient regardless of track', () => {
    const e = event('x', {
      track: '2: ANIME',
      start: '2026-07-23T10:00:00-07:00',
      end: '2026-07-23T20:00:00-07:00'
    })
    const result = classifyEvent(e)
    expect(result.eventClass).toBe('ambient')
    expect(result.reason).toBe('all-day-block')
  })

  it('treats autographs and portfolio review as drop-in floors', () => {
    for (const track of ['3: AUTOGRAPHS', '7: PORTFOLIO REVIEW']) {
      const e = event('x', {
        track,
        start: '2026-07-23T10:00:00-07:00',
        end: '2026-07-23T14:30:00-07:00'
      })
      expect(classifyEvent(e).eventClass, track).toBe('ambient')
    }
  })

  it('is exclusive at the 4h boundary — 3h59 games is still a sitting', () => {
    const e = event('x', {
      track: '6: GAMES',
      start: '2026-07-23T10:00:00-07:00',
      end: '2026-07-23T13:59:00-07:00'
    })
    expect(classifyEvent(e).eventClass).toBe('attend')
  })

  it('defaults to attend when duration is unknown, so no alarm is lost silently', () => {
    const result = classifyEvent(event('x', { start: null, end: null }))
    expect(result.eventClass).toBe('attend')
    expect(result.reason).toBe('unknown-duration')
    expect(result.durationMinutes).toBeNull()
  })

  it('honours overridden thresholds', () => {
    expect(classifyEvent(PANEL, { allDayThresholdMinutes: 30 }).eventClass).toBe('ambient')
  })
})

describe('durationMinutes', () => {
  it('spans midnight without going negative', () => {
    const e = event('x', {
      start: '2026-07-24T23:30:00-07:00',
      end: '2026-07-25T01:00:00-07:00'
    })
    expect(durationMinutes(e)).toBe(90)
  })

  it('returns null for an unparseable timestamp', () => {
    expect(durationMinutes(event('x', { start: 'not-a-date' }))).toBeNull()
  })
})

describe('classifyAll', () => {
  it('keys results by uid', () => {
    const map = classifyAll([PANEL, GAMES_BLOCK])
    expect(map.get(PANEL.uid)?.eventClass).toBe('attend')
    expect(map.get(GAMES_BLOCK.uid)?.eventClass).toBe('ambient')
  })
})

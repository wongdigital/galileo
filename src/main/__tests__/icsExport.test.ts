import { describe, expect, it } from 'vitest'
import { defaultFileName, exportIcs, registerIcsIpc } from '../icsExport'
import type { IcsExportDeps, IcsExportRequest, IcsExportResult } from '../icsExport'
import { event, saturdaySessions } from '../../shared/ics/__tests__/fixtures'
import type { ScheduleEvent } from '../../shared/schedule'

interface Recorder extends IcsExportDeps {
  deliveries: Array<{ defaultName: string; contents: string }>
}

function recorder(path: string | null): Recorder {
  const deliveries: Array<{ defaultName: string; contents: string }> = []
  return {
    deliveries,
    deliver: async (defaultName, contents) => {
      deliveries.push({ defaultName, contents })
      return path
    }
  }
}

const dataset = (events: readonly ScheduleEvent[]) => () => events

describe('defaultFileName', () => {
  it('names day exports distinctly so one does not overwrite the last', () => {
    expect(defaultFileName('2026-07-25')).toBe('comic-con-2026-07-25.ics')
    expect(defaultFileName()).toBe('comic-con.ics')
  })
})

describe('exportIcs', () => {
  it('writes the chosen path and reports what it exported', async () => {
    const events = saturdaySessions()
    const deps = recorder('/tmp/stars.ics')
    const result = await exportIcs({ uids: events.map((e) => e.uid) }, dataset(events), deps)

    expect(result.status).toBe('saved')
    expect(result.exported).toBe(6)
    expect(deps.deliveries).toHaveLength(1)
    expect(deps.deliveries[0]?.defaultName).toBe('comic-con.ics')
    expect(deps.deliveries[0]?.contents).toContain('BEGIN:VCALENDAR')
  })

  it('resolves UIDs against main’s dataset — the renderer never supplies event bodies', async () => {
    const events = saturdaySessions()
    const deps = recorder('/tmp/stars.ics')
    // The renderer asks for one star; main decides what that UID actually is.
    await exportIcs({ uids: [events[2]!.uid] }, dataset(events), deps)

    expect(deps.deliveries[0]?.contents).toContain(events[2]!.title)
    expect(deps.deliveries[0]?.contents).not.toContain(events[0]!.title)
  })

  it('reports a starred UID that has left the dataset as a ghost', async () => {
    const events = saturdaySessions()
    const deps = recorder('/tmp/stars.ics')
    const result = await exportIcs(
      { uids: ['9'.repeat(32), events[0]!.uid] },
      dataset(events),
      deps
    )

    expect(result.exported).toBe(1)
    expect(result.excluded).toEqual([{ uid: '9'.repeat(32), title: null, reason: 'not-found' }])
  })

  it('writes nothing and raises no error when the save dialog is cancelled', async () => {
    const events = saturdaySessions()
    const deps = recorder(null)
    const result = await exportIcs({ uids: events.map((e) => e.uid) }, dataset(events), deps)

    expect(result.status).toBe('cancelled')
    expect(result.path).toBeNull()
    expect(deps.deliveries).toHaveLength(1)
  })

  it('never opens a dialog when every star was excluded', async () => {
    const dead = event('a'.repeat(32), { flags: ['CANCELLED'] })
    const deps = recorder('/tmp/stars.ics')
    const result = await exportIcs({ uids: [dead.uid] }, dataset([dead]), deps)

    expect(result.status).toBe('empty')
    expect(deps.deliveries).toEqual([])
    expect(result.excluded.map((x) => x.reason)).toEqual(['cancelled'])
  })

  it('passes the day through to the filename and the builder', async () => {
    const saturday = event('a'.repeat(32))
    const sunday = event('b'.repeat(32), {
      start: '2026-07-26T10:00:00-07:00',
      end: '2026-07-26T10:50:00-07:00'
    })
    const deps = recorder('/tmp/sat.ics')
    const result = await exportIcs(
      { uids: [saturday.uid, sunday.uid], options: { day: '2026-07-25' } },
      dataset([saturday, sunday]),
      deps
    )

    expect(deps.deliveries[0]?.defaultName).toBe('comic-con-2026-07-25.ics')
    expect(result.exported).toBe(1)
    expect(result.excluded.map((x) => x.reason)).toEqual(['other-day'])
  })

  it('surfaces a write failure instead of claiming a save', async () => {
    const events = saturdaySessions()
    const deps: IcsExportDeps = {
      deliver: async () => {
        throw new Error('EACCES: permission denied')
      }
    }
    const result = await exportIcs({ uids: events.map((e) => e.uid) }, dataset(events), deps)

    expect(result.status).toBe('failed')
    expect(result.path).toBeNull()
    expect(result).toHaveProperty('message', 'EACCES: permission denied')
  })
})

describe('registerIcsIpc', () => {
  it('handles export:ics with the injected dataset resolver', async () => {
    const events = saturdaySessions()
    const handlers = new Map<string, (event: unknown, payload: IcsExportRequest) => unknown>()
    const deps = recorder('/tmp/stars.ics')

    registerIcsIpc({ handle: (channel, listener) => void handlers.set(channel, listener) }, dataset(events), deps)

    const handler = handlers.get('export:ics')
    expect(handler).toBeDefined()

    const result = (await handler?.(null, { uids: [events[0]!.uid] })) as IcsExportResult
    expect(result.status).toBe('saved')
    expect(result.exported).toBe(1)
  })
})

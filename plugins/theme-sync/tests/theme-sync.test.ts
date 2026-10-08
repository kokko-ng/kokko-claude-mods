import { expect, mock, test } from 'claude-code/testing'
import type { ConfigRow, On } from 'claude-code'

const PATH = '/home/me/.claude/settings.json'

// A fake settings.json and /config theme row beneath the plugin.
function world(on: On, initial: { file: string; row: string }) {
  const clock = mock.clock(on)
  mock.env(on, { HOME: '/home/me' })
  const state = { file: initial.file, mtime: 1, row: initial.row, sets: [] as string[], toasts: [] as string[] }

  on('fs.stat', () => ({ value: { kind: 'file', size: state.file.length, mtimeMs: state.mtime } }) as never)
  on('fs.read', () => ({ value: state.file }))
  on('config.list', () => ({
    value: [{ key: 'theme', label: 'Theme', kind: 'choice', value: state.row, provider: { kind: 'core' }, isLocked: false }] as unknown as ConfigRow[],
  }))
  on('config.set', (_$, e) => {
    state.row = String(e.value)
    state.sets.push(state.row)
    return { value: e.value }
  })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('ui.toast', (_$, e) => {
    state.toasts.push(e.text)
    return { value: undefined }
  })

  const write = (theme: string) => {
    state.file = JSON.stringify({ theme })
    state.mtime += 1
  }
  return { clock, state, write }
}

const start = { cwd: '/', surface: 'terminal', isInteractive: true } as const

test('applies the settings.json theme at start and on every change', async ($, on) => {
  const { clock, state, write } = world(on, { file: '{"theme":"dark-ansi"}', row: 'light' })

  await $.session.start(start)
  await clock.advance(10)
  expect(state.sets).toEqual(['dark-ansi'])

  write('light-ansi')
  await clock.advance(1000)
  expect(state.row).toBe('light-ansi')
  expect(state.toasts).toEqual(['Theme: dark-ansi', 'Theme: light-ansi'])
})

test('does nothing while the file and the theme agree', async ($, on) => {
  const { clock, state } = world(on, { file: '{"theme":"dark-ansi"}', row: 'dark-ansi' })

  await $.session.start(start)
  await clock.advance(5000)
  expect(state.sets).toEqual([])
  expect(state.toasts).toEqual([])
})

test('a half-written file is skipped, then picked up once valid', async ($, on) => {
  const { clock, state, write } = world(on, { file: '{"theme":', row: 'dark-ansi' })

  await $.session.start(start)
  await clock.advance(1000)
  expect(state.sets).toEqual([])

  write('light-ansi')
  await clock.advance(1000)
  expect(state.sets).toEqual(['light-ansi'])
})

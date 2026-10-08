import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

type Result = { exitCode: number; stdout: string; stderr: string }
type Git = (args: string[]) => Partial<Result> | undefined

// A fake host beneath the plugin: git answered by `answer`, files by `files`.
function host(on: On, answer: Git, files: Set<string>) {
  const clock = mock.clock(on)
  mock.env(on, { HOME: '/home/me' })
  const calls: string[] = []
  const toasts: string[] = []

  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('fs.exists', (_$, e) => ({ value: files.has(e.path) }))
  on('fs.write', (_$, e) => {
    files.add(e.path)
    return { value: undefined }
  })
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('process.run', (_$, e) => {
    const [cmd, ...args] = e.argv
    if (cmd === 'hostname') return { value: { exitCode: 0, stdout: 'mbp\n', stderr: '' } }
    calls.push(args.join(' '))
    const r = answer(args) ?? {}
    return { value: { exitCode: 0, stdout: '', stderr: '', ...r } }
  })
  return { clock, calls, toasts }
}

const start = { cwd: '/', surface: 'terminal', isInteractive: true } as const
const GIT_DIR = '/home/me/.claude/memory-sync.git'

test('first run: imports local memories into an empty remote and pushes', async ($, on) => {
  const files = new Set<string>()
  const { clock, calls, toasts } = host(
    on,
    args => {
      if (args[0] === 'init') files.add(`${GIT_DIR}/HEAD`)
      if (args[0] === 'rev-parse') return { exitCode: args[3] === 'HEAD' && calls.some(c => c.startsWith('commit')) ? 0 : 1 }
      if (args.join(' ') === 'diff --cached --quiet') return { exitCode: 1 }
      if (args.join(' ') === 'diff --cached --name-only') return { stdout: '-p1/memory/MEMORY.md\n-p2/memory/a.md\n' }
      return undefined
    },
    files,
  )

  await $.session.start(start)
  await clock.advance(10)

  expect(calls).toContain('init -q -b main')
  expect(calls).toContain('remote add origin https://github.com/kokko-ng/claude-memory.git')
  expect(calls).toContain('commit -q -m chore(memory): update -p1, -p2 (mbp)')
  expect(calls).toContain('push -q -u origin main')
  expect(calls.some(c => c.startsWith('reset'))).toBe(false)
  expect(files.has(`${GIT_DIR}/info/exclude`)).toBe(true)
  expect(files.has(`${GIT_DIR}/info/attributes`)).toBe(true)
  expect(toasts).toEqual(['memory-sync: syncing memories with kokko-ng/claude-memory'])
})

test('in sync: no commit, rebase or push', async ($, on) => {
  const files = new Set([`${GIT_DIR}/HEAD`])
  const { clock, calls, toasts } = host(
    on,
    args => {
      if (args[0] === 'rev-list') return { stdout: '0\n' }
      return undefined
    },
    files,
  )

  await $.session.start(start)
  await clock.advance(10)

  expect(calls).toContain('fetch -q origin')
  expect(calls.some(c => /^(commit|rebase|push)/.test(c))).toBe(false)
  expect(toasts).toEqual([])
})

test('behind the remote: rebases onto it', async ($, on) => {
  const files = new Set([`${GIT_DIR}/HEAD`])
  const { clock, calls } = host(
    on,
    args => {
      if (args.join(' ') === 'rev-list --count HEAD..origin/main') return { stdout: '2\n' }
      if (args[0] === 'rev-list') return { stdout: '0\n' }
      return undefined
    },
    files,
  )

  await $.session.start(start)
  await clock.advance(10)

  expect(calls).toContain('rebase -q origin/main')
  expect(calls.some(c => c.startsWith('push'))).toBe(false)
})

test('a conflict aborts the rebase and says how to resolve it', async ($, on) => {
  const files = new Set([`${GIT_DIR}/HEAD`])
  const { clock, calls, toasts } = host(
    on,
    args => {
      if (args.join(' ') === 'rev-list --count HEAD..origin/main') return { stdout: '1\n' }
      if (args.join(' ') === 'rebase -q origin/main') return { exitCode: 1, stderr: 'CONFLICT' }
      return undefined
    },
    files,
  )

  await $.session.start(start)
  await clock.advance(10)

  expect(calls).toContain('rebase --abort')
  expect(calls.some(c => c.startsWith('push'))).toBe(false)
  expect(toasts.length).toBe(1)
  expect(toasts[0]).toContain('memories conflict with kokko-ng/claude-memory')
})

test('another session holding the git lock is not reported', async ($, on) => {
  const files = new Set([`${GIT_DIR}/HEAD`])
  const { clock, toasts } = host(
    on,
    args => {
      if (args[0] === 'add') return { exitCode: 128, stderr: "fatal: Unable to create '/x/index.lock': File exists." }
      return undefined
    },
    files,
  )

  await $.session.start(start)
  await clock.advance(10)

  expect(toasts).toEqual([])
})

test('an idle session pulls every ten minutes', async ($, on) => {
  const files = new Set([`${GIT_DIR}/HEAD`])
  const { clock, calls } = host(on, args => (args[0] === 'rev-list' ? { stdout: '0\n' } : undefined), files)

  await $.session.start(start)
  await clock.advance(10)
  const fetches = () => calls.filter(c => c === 'fetch -q origin').length
  expect(fetches()).toBe(1)

  await clock.advance(10 * 60 * 1000)
  expect(fetches()).toBe(2)
})

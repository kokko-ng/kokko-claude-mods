import type { EngineInterface, Register } from 'claude-code'

// The repo memories go to: `owner/name` on GitHub, or any git URL or path.
// CLAUDE_MEMORY_REPO overrides it.
const DEFAULT_REPO = 'kokko-ng/claude-memory'

// How often an idle session pulls what other machines pushed.
const PULL_EVERY_MS = 10 * 60 * 1000

// How long session start waits for the first sync, so a new session loads the
// memories other machines pushed; past it the sync carries on in the background.
const START_WAIT_MS = 15_000

// The git work tree is <config dir>/projects itself; only each project's
// memory/ folder is tracked, never transcripts. Memories stay ordinary files
// where Claude Code reads and writes them.
const EXCLUDE = `# memory-sync: track only <project>/memory/ under projects/
/*
!/*/
/*/*
!/*/memory/
/*/memory/.claude/
.DS_Store
`

// Two machines editing the index (MEMORY.md) merge by keeping both sides'
// lines. Any other memory both changed goes through MERGE_DRIVER: a clean
// three-way merge when there is one, else the version already pushed stays and
// this machine's is kept beside it as <name>.from-<host>.md. Nothing is lost,
// no file is interleaved, and a sync never stalls on it.
const ATTRIBUTES = `*.md merge=memory-sync
MEMORY.md merge=union
`

// git runs it from the top of the work tree as: sh <script> %O %A %B %P <host>.
// During the rebase a sync does, %A is what other machines pushed and %B is
// this machine's change being replayed.
const MERGE_DRIVER = `#!/bin/sh
base=$1 ours=$2 theirs=$3 path=$4 host=$5
if git merge-file -p -q "$ours" "$base" "$theirs" >"$ours.merged" 2>/dev/null; then
    mv "$ours.merged" "$ours"
    exit 0
fi
rm -f "$ours.merged"
side="\${path%.md}.from-$host.md"
n=2
while [ -e "$side" ]; do
    side="\${path%.md}.from-$host-$n.md"
    n=$((n + 1))
done
cp "$theirs" "$side"
exit 0
`

type Config = { dir: string; gitDir: string; repo: string; url: string; host: string }

// Per load: one sync at a time; a request while busy runs once afterwards.
let config: Config | undefined
let isBusy = false
let isPending = false
let lastError = ''

const isLockError = (text: string) => /index\.lock|\.lock'?: File exists|Another git process/.test(text)

async function git($: EngineInterface, cfg: Config, args: string[]) {
  return $.process.run(['git', ...args], {
    cwd: cfg.dir,
    env: { GIT_DIR: cfg.gitDir, GIT_WORK_TREE: `${cfg.dir}/projects` },
    timeoutMs: 60_000,
  })
}

async function gitOk($: EngineInterface, cfg: Config, args: string[]) {
  const r = await git($, cfg, args)
  if (r.exitCode !== 0) {
    const why = (r.stderr || r.stdout).trim().split('\n').pop() ?? ''
    throw new Error(`git ${args[0]} failed: ${why}`)
  }
  return r.stdout
}

async function hasRef($: EngineInterface, cfg: Config, ref: string) {
  return (await git($, cfg, ['rev-parse', '-q', '--verify', ref])).exitCode === 0
}

async function commitChanges($: EngineInterface, cfg: Config) {
  await gitOk($, cfg, ['add', '-A'])
  if ((await git($, cfg, ['diff', '--cached', '--quiet'])).exitCode === 0) return
  const files = (await gitOk($, cfg, ['diff', '--cached', '--name-only'])).split('\n').filter(Boolean)
  const projects = [...new Set(files.map(f => f.split('/')[0]))]
  const what = projects.length > 3 ? `${projects.length} projects` : projects.join(', ')
  await gitOk($, cfg, ['commit', '-q', '-m', `chore(memory): update ${what} (${cfg.host})`])
}

async function writeRules($: EngineInterface, cfg: Config) {
  await $.fs.write(`${cfg.gitDir}/info/exclude`, EXCLUDE)
  await $.fs.write(`${cfg.gitDir}/info/attributes`, ATTRIBUTES)
  await $.fs.write(`${cfg.gitDir}/memory-merge.sh`, MERGE_DRIVER)
  const driver = `sh "${cfg.gitDir}/memory-merge.sh" %O %A %B %P ${cfg.host}`
  if ((await git($, cfg, ['config', 'merge.memory-sync.driver'])).stdout.trim() !== driver) {
    await gitOk($, cfg, ['config', 'merge.memory-sync.name', 'memory-sync: merge, else keep both'])
    await gitOk($, cfg, ['config', 'merge.memory-sync.driver', driver])
  }
}

async function setUp($: EngineInterface, cfg: Config) {
  await gitOk($, cfg, ['init', '-q', '-b', 'main'])
  await writeRules($, cfg)
  await gitOk($, cfg, ['remote', 'add', 'origin', cfg.url])
  await gitOk($, cfg, ['fetch', '-q', 'origin'])
  if (await hasRef($, cfg, 'refs/remotes/origin/main')) {
    // Start from what other machines pushed: restore memories missing here,
    // then commit what this machine has on top.
    await gitOk($, cfg, ['reset', '-q', 'origin/main'])
    const missing = (await gitOk($, cfg, ['ls-files', '--deleted', '-z'])).split('\0').filter(Boolean)
    if (missing.length > 0) await gitOk($, cfg, ['checkout', '--', ...missing])
  }
  await commitChanges($, cfg)
  $.ui.toast(`memory-sync: syncing memories with ${cfg.repo}`)
}

async function syncOnce($: EngineInterface, cfg: Config) {
  if (!(await $.fs.exists(`${cfg.gitDir}/HEAD`))) await setUp($, cfg)
  await writeRules($, cfg)
  if ((await $.fs.exists(`${cfg.gitDir}/rebase-merge`)) || (await $.fs.exists(`${cfg.gitDir}/rebase-apply`))) {
    throw new Error(`a rebase is in progress in ${cfg.gitDir}; finish or abort it`)
  }
  await commitChanges($, cfg)
  await gitOk($, cfg, ['fetch', '-q', 'origin'])
  const hasRemote = await hasRef($, cfg, 'refs/remotes/origin/main')
  const hasLocal = await hasRef($, cfg, 'HEAD')
  if (hasRemote && hasLocal && (await gitOk($, cfg, ['rev-list', '--count', 'HEAD..origin/main'])).trim() !== '0') {
    const rebased = await git($, cfg, ['rebase', '-q', 'origin/main'])
    if (rebased.exitCode !== 0) {
      await git($, cfg, ['rebase', '--abort'])
      throw new Error(
        `memories conflict with ${cfg.repo}; resolve with ` +
          `GIT_DIR=${cfg.gitDir} GIT_WORK_TREE=${cfg.dir}/projects git rebase origin/main`,
      )
    }
    // A conflicting memory kept as <name>.from-<host>.md goes up with this sync.
    await commitChanges($, cfg)
  }
  const isAhead =
    hasLocal && (!hasRemote || (await gitOk($, cfg, ['rev-list', '--count', 'origin/main..HEAD'])).trim() !== '0')
  if (isAhead) await gitOk($, cfg, ['push', '-q', '-u', 'origin', 'main'])
}

function requestSync($: EngineInterface): Promise<void> {
  const cfg = config
  if (!cfg) return Promise.resolve()
  if (isBusy) {
    isPending = true
    return Promise.resolve()
  }
  isBusy = true
  return syncOnce($, cfg)
    .then(() => {
      lastError = ''
    })
    .catch((err: unknown) => {
      const text = err instanceof Error ? err.message : String(err)
      if (!isLockError(text) && text !== lastError) $.ui.toast(`memory-sync: ${text}`)
      lastError = text
    })
    .finally(() => {
      isBusy = false
      if (isPending) {
        isPending = false
        void requestSync($)
      }
    })
}

async function hasChanges($: EngineInterface, cfg: Config) {
  const status = await git($, cfg, ['status', '--porcelain'])
  return status.exitCode === 0 && status.stdout.trim() !== ''
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)

    const dir = (await $.env.get('CLAUDE_CONFIG_DIR')) ?? `${await $.env.get('HOME')}/.claude`
    const repo = (await $.env.get('CLAUDE_MEMORY_REPO')) ?? DEFAULT_REPO
    const host = (await $.process.run(['hostname', '-s'])).stdout.trim().replace(/[^A-Za-z0-9-]/g, '-') || 'mac'
    config = {
      dir,
      gitDir: `${dir}/memory-sync.git`,
      repo,
      url: /^[\w.-]+\/[\w.-]+$/.test(repo) ? `https://github.com/${repo}.git` : repo,
      host,
    }

    await Promise.race([requestSync($), $.clock.sleep(START_WAIT_MS)])
    $.clock.every(PULL_EVERY_MS, () => void requestSync($))

    return result
  })

  // After each turn, sync only when a memory changed (a status is cheap), and
  // finish before the turn does so a session that exits next loses nothing.
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (config && !isBusy && (await hasChanges($, config))) await requestSync($)
    return result
  })
}

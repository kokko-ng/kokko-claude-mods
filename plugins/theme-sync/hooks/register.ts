import type { Register } from 'claude-code'

// How often to look at settings.json. A stat is cheap; the file is only read
// and parsed when its modification time moves.
const POLL_MS = 1000

// Claude Code reloads settings.json when it changes but does not re-apply
// `theme` to a running session; this applies it through the /config row.
export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)

    const dir =
      (await $.env.get('CLAUDE_CONFIG_DIR')) ?? `${await $.env.get('HOME')}/.claude`
    const path = `${dir}/settings.json`
    let seenMtime = -1
    let isBusy = false
    let lastError = ''

    const readTheme = async (): Promise<unknown> => {
      try {
        return (JSON.parse(await $.fs.read(path)) as { theme?: unknown }).theme
      } catch {
        return undefined // missing or half-written: the next change retries
      }
    }

    const sync = async () => {
      const { mtimeMs } = await $.fs.stat(path)
      if (mtimeMs === seenMtime) return
      seenMtime = mtimeMs

      const theme = await readTheme()
      if (typeof theme !== 'string') return

      const row = (await $.config.list()).find(r => r.key === 'theme')
      if (!row || row.isLocked || row.value === theme) return

      const { deny } = await $.config.set({ key: 'theme', value: theme })
      $.ui.toast(deny ? `theme-sync: ${deny}` : `Theme: ${theme}`)
    }

    const tick = () => {
      if (isBusy) return
      isBusy = true
      sync()
        .then(() => {
          lastError = ''
        })
        .catch((err: unknown) => {
          const text = err instanceof Error ? err.message : String(err)
          if (text !== lastError) $.ui.toast(`theme-sync: ${text}`)
          lastError = text
        })
        .finally(() => {
          isBusy = false
        })
    }

    tick()
    $.clock.every(POLL_MS, tick)

    return result
  })
}

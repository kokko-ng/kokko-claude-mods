import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ContextSnapshot } from '../types'

const snapshot = atom({ plugin: 'context-bar', key: 'snapshot' } as const, null)
const isLight = atom({ plugin: 'context-bar', key: 'isLight' } as const, false)
// The thinking effort of the main conversation's latest request (low ...
// max, or a token budget), or the settings' effortLevel before the first one.
const effort = atom({ plugin: 'context-bar', key: 'effort' } as const, null)

// Gruvbox Material, medium contrast (sainnhe/gruvbox-material), as hex so the
// bar can use the palette's orange, which the 16 ANSI colours lack. The light
// palette follows a light-* Claude Code theme. Each category keeps its colour
// across sessions, so the legend reads the same every time.
export type Palette = {
  red: string
  orange: string
  yellow: string
  green: string
  aqua: string
  blue: string
  purple: string
  grey: string // labels
  track: string // empty part of the bar
}

export const PALETTES: Record<'dark' | 'light', Palette> = {
  dark: {
    red: '#ea6962',
    orange: '#e78a4e',
    yellow: '#d8a657',
    green: '#a9b665',
    aqua: '#89b482',
    blue: '#7daea3',
    purple: '#d3869b',
    grey: '#a89984',
    track: '#504945',
  },
  light: {
    red: '#c14a4a',
    orange: '#c35e0a',
    yellow: '#b47109',
    green: '#6c782e',
    aqua: '#4c7a5d',
    blue: '#45707a',
    purple: '#945e80',
    grey: '#7c6f64',
    track: '#ddccab',
  },
}

// A Claude Code theme value (`light-ansi`, `dark`, ...) is light by its name;
// `auto` and custom themes count as dark.
export const isLightTheme = (theme: unknown): boolean =>
  typeof theme === 'string' && theme.startsWith('light')

const CATEGORY: Record<string, keyof Palette> = {
  system: 'blue',
  tools: 'aqua',
  mcp: 'purple',
  agents: 'red',
  memory: 'yellow',
  skills: 'green',
  messages: 'orange',
}

const BAR_MAX = 48 // the bar never grows past this, however wide the terminal
const BAR_MIN = 8 // below this the bar is dropped and only the percentage shows
const LEGEND_MIN_COLUMNS = 40 // narrower than this, no legend line

const LABELS: Record<string, string> = {
  'System prompt': 'system',
  'System tools': 'tools',
  'MCP tools': 'mcp',
  'Custom agents': 'agents',
  'Memory files': 'memory',
  'Skills': 'skills',
  'Messages': 'messages',
}

// Lower three-quarter block: solid enough to read at a glance, with a gap
// above it so the band does not merge into the prompt. Free space is the
// same glyph in the track colour, so the bar keeps one shape end to end.
const CELL = '▆'

export type Segment = { text: string; color?: string; bold?: boolean }
export type Layout = { bar: Segment[]; legend: Segment[] }

export const formatTokens = (n: number): string =>
  n >= 1000 ? `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1).replace(/\.0$/, '')}k` : `${n}`

export const label = (name: string): string => LABELS[name] ?? name.toLowerCase()

const colorOf = (p: Palette, name: string): string => p[CATEGORY[label(name)] ?? 'grey']

const widthOf = (segments: Segment[]): number =>
  segments.reduce((n, s) => n + s.text.length, 0)

// Cells per category by largest remainder: the used part of the bar is
// proportional to the window's fill, split by each category's share of it.
export const cellsPerRow = (s: ContextSnapshot, width: number): number[] => {
  const total = s.rows.reduce((n, r) => n + r.tokens, 0)
  const used = Math.min(width, Math.round((total / s.max) * width))
  if (total === 0 || used === 0) return s.rows.map(() => 0)
  const exact = s.rows.map(r => (r.tokens / total) * used)
  const cells = exact.map(Math.floor)
  let left = used - cells.reduce((a, b) => a + b, 0)
  const order = exact.map((x, i) => [x - Math.floor(x), i] as const).sort((a, b) => b[0] - a[0])
  for (const [, i] of order) {
    if (left <= 0) break
    cells[i] = (cells[i] ?? 0) + 1
    left -= 1
  }
  return cells
}

const percentSegment = (p: Palette, percent: number): Segment => ({
  text: `${percent}%`,
  bold: true,
  color: percent >= 80 ? p.red : percent >= 50 ? p.yellow : p.green,
})

// Everything the band draws, sized so no line is wider than `columns`.
export const layout = (
  s: ContextSnapshot,
  columns: number,
  p: Palette = PALETTES.dark,
  thinking: string | null = null,
): Layout => {
  const pct = percentSegment(p, s.percent)
  const tokens: Segment = { text: `  ${formatTokens(s.used)} / ${formatTokens(s.max)}`, color: p.grey }
  const effortLabel: Segment = { text: '  effort ', color: p.grey }
  const effortValue: Segment = { text: thinking ?? '', color: p.aqua, bold: true }

  // Widest suffix that still leaves room for a bar, else the percentage alone.
  // The effort goes first as the band narrows, then the token count.
  const suffixes: Segment[][] = [
    ...(thinking ? [[{ text: ' ' }, pct, tokens, effortLabel, effortValue]] : []),
    [{ text: ' ' }, pct, tokens],
    [{ text: ' ' }, pct],
  ]
  const suffix = suffixes.find(sfx => columns - widthOf(sfx) >= BAR_MIN)
  if (!suffix) return { bar: columns >= pct.text.length ? [pct] : [], legend: [] }

  const width = Math.min(BAR_MAX, columns - widthOf(suffix))
  const cells = cellsPerRow(s, width)
  const bar: Segment[] = s.rows
    .map((r, i) => ({ text: CELL.repeat(cells[i] ?? 0), color: colorOf(p, r.name) }))
    .filter(seg => seg.text.length > 0)
  const free = width - widthOf(bar)
  if (free > 0) bar.push({ text: CELL.repeat(free), color: p.track })
  bar.push(...suffix)

  if (columns < LEGEND_MIN_COLUMNS) return { bar, legend: [] }

  // Largest categories first until the line is full, then shown in bar order
  // so the colours read left to right like the bar.
  const items = s.rows.map((r, i) => ({
    i,
    tokens: r.tokens,
    text: `● ${label(r.name)} ${formatTokens(r.tokens)}`,
  }))
  const chosen = new Set<number>()
  let used = 0
  for (const item of [...items].sort((a, b) => b.tokens - a.tokens)) {
    const cost = item.text.length + (chosen.size > 0 ? 2 : 0)
    if (used + cost > columns) continue
    chosen.add(item.i)
    used += cost
  }
  const legend: Segment[] = []
  for (const item of items) {
    if (!chosen.has(item.i)) continue
    if (legend.length > 0) legend.push({ text: '  ' })
    const name = s.rows[item.i]?.name ?? ''
    legend.push({ text: '●', color: colorOf(p, name) })
    legend.push({ text: ` ${label(name)}`, color: p.grey })
    legend.push({ text: ` ${formatTokens(item.tokens)}` })
  }
  return { bar, legend }
}

async function refresh($: EngineInterface): Promise<void> {
  const usage = await $.session.usage({ breakdown: 'summary' })
  const b = usage.context.breakdown
  if (!b) return
  const next: ContextSnapshot = {
    percent: b.percentage,
    used: b.totalTokens,
    max: b.rawMaxTokens,
    rows: b.categories
      .filter(c => c.kind === 'used' && c.tokens > 0)
      .map(c => ({ name: c.name, tokens: c.tokens })),
  }
  await update($, snapshot, () => next)
}

// Before the first request, the effort the settings ask for.
async function readEffort($: EngineInterface): Promise<void> {
  const settings = await $.settings.read().catch(() => ({}))
  const level = (settings as { effortLevel?: unknown }).effortLevel
  if (typeof level === 'string' && level) await update($, effort, () => level)
}

async function readTheme($: EngineInterface): Promise<void> {
  const row = (await $.config.list()).find(r => r.key === 'theme')
  await update($, isLight, () => isLightTheme(row?.value))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await readTheme($)
    await readEffort($)
    await refresh($)
    return result
  })

  // The effort each request of the main conversation is actually sent with
  // (the session's setting, /effort, or the model's default). Subagents'
  // requests (e.agentId) run at their own effort and are left out.
  on('turn.step', async function* ($, e, next) {
    if (e.agentId === undefined && e.effort !== undefined) {
      const sent = String(e.effort)
      await update($, effort, () => sent)
    }
    return yield* next(e)
  })

  // A theme change from /config or another plugin (theme-sync) redraws the
  // band in the matching palette.
  on('config.set', { key: 'theme' }, async ($, e, next) => {
    const result = await next(e)
    if (result.deny === undefined) await update($, isLight, () => isLightTheme(result.value))
    return result
  })

  on('session.measure', async ($, e, next) => {
    const result = await next(e)
    if (e.changed.includes('context')) await refresh($)
    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const s = await read($, snapshot)
    if (s === null || e.props.hasSurvey) return next(e)

    const palette = (await read($, isLight)) ? PALETTES.light : PALETTES.dark
    const { bar, legend } = layout(s, e.props.bodyColumns, palette, await read($, effort))
    if (bar.length === 0) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    const line = (key: string, segments: Segment[]) => (
      <Box key={key}>
        {segments.map((seg, i) => (
          <Text
            key={`${key}-${i}`}
            color={seg.color}
            bold={seg.bold}
            wrap="truncate-end"
          >
            {seg.text}
          </Text>
        ))}
      </Box>
    )

    return (
      <Box flexDirection="column">
        {line('bar', bar)}
        {legend.length > 0 ? line('legend', legend) : null}
      </Box>
    )
  })
}

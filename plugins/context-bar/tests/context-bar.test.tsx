import { expect, test } from 'claude-code/testing'

import { cellsPerRow, formatTokens, isLightTheme, label, layout, PALETTES } from '../hooks/register'
import type { Segment } from '../hooks/register'
import type { ContextSnapshot } from '../types'

const SNAPSHOT: ContextSnapshot = {
  percent: 42,
  used: 84_000,
  max: 200_000,
  rows: [
    { name: 'System prompt', tokens: 4_000 },
    { name: 'System tools', tokens: 20_000 },
    { name: 'Memory files', tokens: 200 },
    { name: 'Messages', tokens: 59_800 },
  ],
}

const band = (bodyColumns: number) =>
  ({
    component: 'AbovePrompt',
    props: {
      hasSurvey: false,
      isWorking: false,
      maxRows: 10,
      bodyColumns,
      scroll: { offset: 0, bodyRows: 10 },
      view: {},
    },
  }) as const

const USAGE = {
  startedAt: 0,
  rateLimits: [],
  context: {
    tokens: SNAPSHOT.used,
    window: SNAPSHOT.max,
    percent: SNAPSHOT.percent,
    breakdown: {
      categories: [
        ...SNAPSHOT.rows.map(r => ({ ...r, color: 'text', isDeferred: false, kind: 'used' as const })),
        { name: 'Free space', tokens: 116_000, color: 'inactive', isDeferred: false, kind: 'free' as const },
      ],
      totalTokens: SNAPSHOT.used,
      maxTokens: SNAPSHOT.max,
      rawMaxTokens: SNAPSHOT.max,
      autocompactSource: 'model-default' as const,
      percentage: SNAPSHOT.percent,
      gridRows: [],
      model: 'Opus 5.5',
      memoryFiles: [],
      mcpTools: [],
      agents: [],
      isAutoCompactEnabled: true,
      apiUsage: null,
    },
  },
}

const text = (segments: Segment[]): string => segments.map(s => s.text).join('')

test('formatting', async () => {
  expect(formatTokens(950)).toBe('950')
  expect(formatTokens(4_200)).toBe('4.2k')
  expect(formatTokens(20_000)).toBe('20k')
  expect(formatTokens(200_000)).toBe('200k')
  expect(label('System prompt')).toBe('system')
  expect(label('Something new')).toBe('something new')
})

test('bar cells are proportional and never exceed the width', async () => {
  const cells = cellsPerRow(SNAPSHOT, 48)
  // 84k of 200k on 48 cells is 20 used cells
  expect(cells.reduce((a, b) => a + b, 0)).toBe(20)
  expect(cells[3]).toBeGreaterThan(cells[1] ?? 0)
  const over = { ...SNAPSHOT, max: 50_000 }
  expect(cellsPerRow(over, 10).reduce((a, b) => a + b, 0)).toBe(10)
})

test('no line is ever wider than the band, at any width', async () => {
  for (const snap of [SNAPSHOT, { ...SNAPSHOT, percent: 97, max: 86_000 }]) {
    for (let columns = 1; columns <= 200; columns++) {
      const { bar, legend } = layout(snap, columns)
      expect(text(bar).length).toBeLessThanOrEqual(columns)
      expect(text(legend).length).toBeLessThanOrEqual(columns)
    }
  }
})

test('degrades step by step as the terminal narrows', async () => {
  const wide = layout(SNAPSHOT, 120)
  expect(text(wide.bar)).toContain('42%  84k / 200k')
  expect(text(wide.bar).length).toBe(48 + ' 42%  84k / 200k'.length) // bar capped
  expect(text(wide.legend)).toContain('messages 59.8k')
  expect(text(wide.legend)).toContain('memory 200')

  const mid = layout(SNAPSHOT, 45)
  expect(text(mid.legend)).toContain('messages 59.8k') // biggest kept
  expect(text(mid.legend)).not.toContain('memory') // smallest dropped

  const narrow = layout(SNAPSHOT, 30)
  expect(narrow.legend).toEqual([])
  expect(text(narrow.bar)).toContain('84k / 200k')

  const tight = layout(SNAPSHOT, 14)
  expect(text(tight.bar)).toMatch(/▆.* 42%$/) // bar plus percentage only

  expect(text(layout(SNAPSHOT, 5).bar)).toBe('42%')
  expect(layout(SNAPSHOT, 2).bar).toEqual([])
})

test('gruvbox colours: fixed per category, track for free space', async () => {
  const { bar, legend } = layout(SNAPSHOT, 120)
  const colorOfText = (segs: Segment[], needle: string) => segs.find(s => s.text.includes(needle))?.color
  expect(bar[bar.length - 4]?.color).toBe('#504945') // free space track, before ' ', pct, tokens
  expect(bar.find(s => s.text.startsWith('▆'))?.color).toBe('#7daea3') // system first, blue
  expect(bar.find(s => s.text.endsWith('%'))?.color).toBe('#a9b665') // 42% is green
  expect(layout({ ...SNAPSHOT, percent: 85 }, 120).bar.find(s => s.text.endsWith('%'))?.color).toBe('#ea6962')
  const dots = legend.filter(s => s.text === '●').map(s => s.color)
  expect(dots).toEqual(['#7daea3', '#89b482', '#d8a657', '#e78a4e']) // system, tools, memory, messages
  expect(colorOfText(legend, 'messages')).toBe('#a89984')
})

test('band draws within its width on every surface', async ($, on) => {
  on('ui.render', () => <></>)
  on('session.usage', () => ({ value: USAGE }))
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  await $.session.measure({
    context: { tokens: SNAPSHOT.used, window: SNAPSHOT.max, percent: SNAPSHOT.percent },
    rateLimits: [],
    changed: ['context'],
  })
  for (const surface of ['terminal', 'desktop'] as const) {
    for (const columns of [120, 60, 45, 30, 14]) {
      const ui = await $.ui.mount({ plugin: 'context-bar', surface, ...band(columns) })
      const bar = await ui.find({ key: 'bar' })
      expect(bar?.text).toContain('42%')
      expect(bar?.text.length ?? 0).toBeLessThanOrEqual(columns)
      const legend = await ui.find({ key: 'legend' })
      if (columns >= 40) expect(legend?.text.length ?? 0).toBeLessThanOrEqual(columns)
      else expect(legend).toBeUndefined()
      expect(await ui.find({ type: 'Text', text: /Free space|free/ })).toBeUndefined()
      await ui.unmount()
    }
  }
})

test('light palette: Gruvbox Material light for light-* themes', async () => {
  expect(isLightTheme('light-ansi')).toBe(true)
  expect(isLightTheme('light')).toBe(true)
  expect(isLightTheme('dark-ansi')).toBe(false)
  expect(isLightTheme('auto')).toBe(false)
  expect(isLightTheme(undefined)).toBe(false)

  const { bar, legend } = layout(SNAPSHOT, 120, PALETTES.light)
  expect(bar[bar.length - 4]?.color).toBe('#ddccab') // track
  expect(bar.find(s => s.text.endsWith('%'))?.color).toBe('#6c782e') // 42% green
  const dots = legend.filter(s => s.text === '●').map(s => s.color)
  expect(dots).toEqual(['#45707a', '#4c7a5d', '#b47109', '#c35e0a'])
})

test('follows the theme: at session start and on every theme change', async ($, on) => {
  let theme = 'light-ansi'
  on('ui.render', () => <></>)
  on('session.usage', () => ({ value: USAGE }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('config.list', () => ({
    value: [
      {
        key: 'theme',
        label: 'Theme',
        kind: 'choice',
        value: theme,
        provider: { plugin: 'engine', tier: 'core' },
        isLocked: false,
      },
    ] as never,
  }))
  on('config.set', (_$, e) => {
    theme = String(e.value)
    return { value: e.value }
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const percentColor = async () => {
    const ui = await $.ui.mount({ plugin: 'context-bar', surface: 'terminal', ...band(120) })
    const pct = await ui.find({ type: 'Text', text: '42%' })
    await ui.unmount()
    return pct?.props.color
  }

  expect(await percentColor()).toBe(PALETTES.light.green)
  await $.config.set({ key: 'theme', value: 'dark-ansi' })
  expect(await percentColor()).toBe(PALETTES.dark.green)
  await $.config.set({ key: 'theme', value: 'light-ansi' })
  expect(await percentColor()).toBe(PALETTES.light.green)
})

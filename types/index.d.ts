export type ContextRow = { name: string; tokens: number }

export type ContextSnapshot = {
  percent: number
  used: number
  max: number
  rows: ContextRow[]
}

declare module 'claude-code' {
  interface PluginState {
    'context-bar': { snapshot: ContextSnapshot | null }
  }
}

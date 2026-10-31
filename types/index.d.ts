export type Question = {
  id: string
  question: string
  options: string[]
  context: string
  source: string
  kind: 'ask' | 'permission'
  revision: number
  createdAt: number
}

export type View = { online: boolean; queue: Question[] }

declare module 'claude-code' {
  interface PluginState {
    offload: { view: View }
  }
}

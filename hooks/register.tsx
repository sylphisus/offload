import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Question, View } from '../types'

// The offload daemon (server/server.js) holds the queue every agent feeds;
// this pane long-polls it and posts answers back.
const BASE = 'http://localhost:7777'
const PANE = 'offload'
const START_RETRY_MS = 30000

const view = atom({ plugin: 'offload', key: 'view' } as const, { online: false, queue: [] } as View)

let poller: { cancel: () => void } | undefined
let isPolling = false
let version = -1
let lastStartAt = 0

// Starts the daemon from this plugin's own copy; start.js exits once it's up.
async function startServer($: EngineInterface) {
  const now = await $.clock.now()
  if (now - lastStartAt < START_RETRY_MS) return
  lastStartAt = now
  await $.process.run(['node', `${$.plugin.root}/server/start.js`], { timeoutMs: 10000 }).catch(() => undefined)
}

async function poll($: EngineInterface) {
  if (isPolling) return
  isPolling = true
  try {
    const res = await $.http.fetch(`${BASE}/queue?v=${version}`)
    if (!res.ok) throw new Error(`status ${res.status}`)
    const body = JSON.parse(res.text) as { version: number; queue: Question[] }
    version = body.version
    await update($, view, () => ({ online: true, queue: body.queue }))
  } catch {
    // Offline (or a state write lost): show offline, then retry slowly.
    version = -1
    await update($, view, v => (v.online || v.queue.length ? { online: false, queue: [] } : v)).catch(() => undefined)
    await startServer($).catch(() => undefined)
    await $.clock.sleep(2000).catch(() => undefined)
  } finally {
    isPolling = false
  }
}

// A permission prompt as one line, plus the dim hint under it.
function summarize(tool: string, input: Record<string, unknown>, cwd: string): [string, string] {
  const rel = (p: unknown) => (typeof p === 'string' && p.startsWith(`${cwd}/`) ? p.slice(cwd.length + 1) : String(p ?? ''))
  switch (tool) {
    case 'Bash': return [`$ ${String(input.command ?? '')}`, String(input.description ?? tool)]
    case 'Edit': case 'MultiEdit': return [`edit ${rel(input.file_path)}`, tool]
    case 'Write': return [`write ${rel(input.file_path)}`, tool]
    case 'Read': return [`read ${rel(input.file_path)}`, tool]
    case 'NotebookEdit': return [`edit ${rel(input.notebook_path)}`, tool]
    case 'WebFetch': return [`fetch ${String(input.url ?? '')}`, tool]
    case 'WebSearch': return [`search "${String(input.query ?? '')}"`, tool]
    default: return [`${tool} ${JSON.stringify(input)}`, tool]
  }
}

const DENIED = 'The user denied this in the offload console.'
const DECISIONS = [
  { behavior: 'allow' },
  { behavior: 'deny', message: DENIED },
  { behavior: 'deny', message: 'The user rejected this approach in the offload console. Do not retry it as is: take a different approach, or ask the user with the offload ask tool.' },
] as const

// Polls only while the pane is open: the daemon counts a polling pane as an
// open console, and routes permission prompts to it.
function startPolling($: EngineInterface) {
  poller ??= $.clock.every(200, () => void poll($))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'offload', description: 'Open the offload decision pane' })
    void $.ui.open({ id: PANE, title: 'offload' }).then(opened => {
      if (opened.isPlaced) startPolling($)
    })

    return next(e)
  })

  on('command.run', { command: 'offload' }, async $ => {
    await $.ui.open({ id: PANE, title: 'offload' })
    startPolling($)

    return { text: 'offload pane opened. Click it, then answer with Z X C or , . /' }
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) {
      poller?.cancel()
      poller = undefined
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  // While the pane is open, permission prompts go to it as allow / deny / rethink.
  // Anything else (pane closed, server down) falls through to the usual dialog.
  on('classic.PermissionRequest', async ($, e, next) => {
    if (!poller) return next(e)
    const input = (e.tool_input ?? {}) as Record<string, unknown>
    const [question, context] = summarize(e.tool_name, input, e.cwd)
    const res = await $.http.fetch(`${BASE}/ask`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        question, context, options: ['allow', 'deny'], kind: 'permission', requireClient: true,
        source: e.cwd.split('/').filter(Boolean).pop() ?? '',
      }),
    })
    if (!res.ok) return next(e)
    const { index } = JSON.parse(res.text) as { index: number }

    return { decision: DECISIONS[index] ?? { behavior: 'deny', message: DENIED } }
  }).catch(($, e, next) => next(e))

  on('ui.message', async ($, e, next) => {
    const data = e.data as { type?: string; id?: string; index?: number } | null
    if (e.element !== 'console' || data?.type !== 'answer') return next(e)
    await $.http
      .fetch(`${BASE}/answer`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: data.id, index: data.index }),
      })
      .catch(() => undefined)

    return {}
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    startPolling($)
    const current = await read($, view)
    if (e.surface === 'terminal' || e.surface === 'desktop') {
      const { Client } = $.ui.resolve(e)

      return <Client key="console" module="./console.tsx" props={current} flexGrow={1} />
    }
    const { Text } = $.ui.resolve(e)

    return <Text dimColor>offload needs the desktop app or the terminal.</Text>
  })
}

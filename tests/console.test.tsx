import { expect, test } from 'claude-code/testing'

import type { Question, View } from '../types'

const PANE = {
  plugin: 'offload',
  component: 'Pane',
  requestId: 'offload',
  props: {
    title: 'offload',
    isFocused: true,
    bodyColumns: 48,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

const question = (id: string, text: string, options: string[], kind: Question['kind'] = 'ask'): Question => ({
  id, question: text, options, context: '', source: 'proj', kind, revision: 0, createdAt: 0,
})

const VIEW: View = {
  online: true,
  queue: [
    question('a', 'Use sqlite?', ['sqlite', 'postgres']),
    question('b', '$ npm ci', ['allow', 'deny'], 'permission'),
    question('c', 'Open a draft PR?', ['draft', 'ready']),
  ],
}

declare const setTimeout: (fn: (value?: unknown) => void, ms: number) => unknown

// The client locks a new card for 250 ms of wall time.
const glance = () => new Promise(resolve => setTimeout(resolve, 300))

test('Z X C and , . / answer the head question, shifted keys do not', async ($, on) => {
  let answers: unknown[] = []
  on('state.get', () => ({ value: { value: VIEW, version: 1 } }))
  on('clock.every', () => ({ value: undefined })) // no polling in tests
  on('http.fetch', (_, e) => {
    if (e.init?.method === 'POST') answers.push(JSON.parse(e.init.body ?? '{}'))
    return { value: { status: 200, ok: true, headers: {}, text: '{}' } }
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    answers = []
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: 'Use sqlite?', in: 'console' }))?.text).toBe('Use sqlite?')

    await glance()
    await ui.key({ key: '<', shift: true, in: 'console' }) // shifted: ignored
    await ui.key({ key: ',', in: 'console' })
    await ui.key({ key: 'x', in: 'console' }) // the next card isn't drawn yet: ignored
    expect(answers).toEqual([{ id: 'a', index: 0 }])

    // The permission prompt is next; its third choice reads "rethink".
    expect(await ui.find({ type: 'Text', text: '$ npm ci', in: 'console' })).toBeDefined()
    expect(await ui.find({ type: 'Button', key: 'option-2', in: 'console' })).toBeDefined()
    await glance()
    await ui.key({ key: '/', in: 'console' })
    await glance()
    await ui.key({ key: 'x', in: 'console' })
    expect(answers).toEqual([{ id: 'a', index: 0 }, { id: 'b', index: 2 }, { id: 'c', index: 1 }])

    expect(await ui.find({ type: 'Text', text: 'Nothing to decide', in: 'console' })).toBeDefined()
    await ui.unmount()
  }
})

test('a pressed button answers like its key', async ($, on) => {
  const answers: unknown[] = []
  on('state.get', () => ({ value: { value: VIEW, version: 1 } }))
  on('clock.every', () => ({ value: undefined })) // no polling in tests
  on('http.fetch', (_, e) => {
    if (e.init?.method === 'POST') answers.push(JSON.parse(e.init.body ?? '{}'))
    return { value: { status: 200, ok: true, headers: {}, text: '{}' } }
  })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await glance()
  await ui.press({ key: 'option-1' })
  expect(answers).toEqual([{ id: 'a', index: 1 }])
  await ui.unmount()
})

test('with the pane open, a permission prompt is answered from the console', async ($, on) => {
  const asked: { question?: string; kind?: string }[] = []
  on('state.get', () => ({ value: { value: VIEW, version: 1 } }))
  on('clock.every', () => ({ value: undefined })) // no polling in tests
  on('http.fetch', (_, e) => {
    if (e.url.endsWith('/ask')) {
      asked.push(JSON.parse(e.init?.body ?? '{}'))
      return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ answer: null, index: 2, rejected: true }) } }
    }
    return { value: { status: 200, ok: true, headers: {}, text: '{}' } }
  })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' }) // drawing the pane starts polling
  const result = await $.classic.PermissionRequest({
    tool_name: 'Bash', tool_input: { command: 'rm -rf dist', description: 'Clean' }, cwd: '/home/me/proj',
  })
  expect(asked).toEqual([expect.objectContaining({ question: '$ rm -rf dist', kind: 'permission', source: 'proj' })])
  expect(result?.decision).toEqual(expect.objectContaining({ behavior: 'deny' }))
  await ui.unmount()
})

import type { ClientModule } from 'claude-code'

import type { Question, View } from '../types'

type Answered = { label: string; index: number; question: string }
type Local = {
  answered: string[] // ids answered here, hidden until the next poll drops them
  combo: number
  lastMs?: number
  history: Answered[]
  now: number
}

// Left hand Z X C, right hand , . / (unshifted only).
const KEYS: Record<string, number> = { z: 0, x: 1, c: 2, ',': 0, '.': 1, '/': 2 }
const KEYCAPS = ['Z', 'X', 'C']
const COLORS = ['#ff4f9a', '#3fc6ff', '#c6c6d8']
const INPUT_LOCK_MS = 250 // a new card can't be answered until you've had a glance at it
const COMBO_BREAK_MS = 10000

// Per instance: the newest props (for key handlers) and when each question was
// first drawn there (for reaction times and the input lock).
const instances = new WeakMap<object, { latest: View; seenAt: Map<string, number> }>()

const labelFor = (q: Question, i: number) =>
  i < 2 ? (q.options[i] ?? '') : q.kind === 'permission' ? 'rethink' : 'neither'

const fmtMs = (ms: number) => (ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`)

const fmtAge = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
}

const Console: ClientModule<View, Local> = (props, surface) => {
  const { Box, Text, Button } = surface.elements
  const instance = instances.get(surface) ?? { latest: props, seenAt: new Map<string, number>() }
  instances.set(surface, instance)
  instance.latest = props
  const { seenAt } = instance

  const visible = (s: Local) => instance.latest.queue.filter(q => !s.answered.includes(q.id))

  function answer(index: number) {
    const s = surface.state
    if (!s) return
    const head = visible(s)[0]
    const shown = head && seenAt.get(head.id)
    if (!head || shown === undefined) return // not drawn yet
    const ms = Date.now() - shown
    if (ms < INPUT_LOCK_MS) return
    surface.post({ type: 'answer', id: head.id, index })
    surface.setState({
      ...s,
      answered: [...s.answered.filter(id => instance.latest.queue.some(q => q.id === id)), head.id],
      combo: ms < COMBO_BREAK_MS ? s.combo + 1 : 0,
      lastMs: ms,
      history: [{ label: labelFor(head, index), index, question: head.question }, ...s.history].slice(0, 4),
    })
  }

  if (!surface.state) {
    surface.onKey(e => {
      if (e.ctrl || e.meta || e.shift) return
      const index = KEYS[e.key.toLowerCase()]
      if (index !== undefined) answer(index)
    })
    surface.every(1000, () => {
      if (surface.state) surface.setState({ ...surface.state, now: Date.now() })
    })
    surface.setState({ answered: [], combo: 0, history: [], now: Date.now() })
  }
  const s = surface.state ?? { answered: [], combo: 0, history: [], now: Date.now() }

  const queue = visible(s)
  const head = queue[0]
  const now = Date.now()
  if (head && !seenAt.has(head.id)) seenAt.set(head.id, now)

  const status = props.online ? `${queue.length} waiting` : 'offline'
  const score = [s.combo ? `×${s.combo}` : '', s.lastMs !== undefined ? fmtMs(s.lastMs) : '']
    .filter(Boolean)
    .join(' · ')

  return (
    <Box flexDirection="column" gap="md" padding="sm" flexGrow={1}>
      <Box justifyContent="space-between">
        <Text size="footnote" dimColor>{status}</Text>
        <Text size="footnote" mono dimColor>{score}</Text>
      </Box>

      {head ? (
        <Box flexDirection="column" gap="sm">
          <Text size="caption" dimColor>
            {[
              head.source,
              head.kind === 'permission' ? 'permission' : '',
              head.revision ? `take ${head.revision + 1}` : '',
              fmtAge(now - head.createdAt),
            ].filter(Boolean).join(' · ')}
          </Text>
          <Text weight="semibold" mono={head.kind === 'permission'}>{head.question}</Text>
          {head.context ? <Text size="footnote" dimColor>{head.context}</Text> : null}
          <Box flexDirection="column" gap="xs">
            {[0, 1, 2].map(i => (
              <Button key={`option-${i}`} onPress={() => answer(i)} dimColor={i === 2}>
                <Text mono color={COLORS[i]}>{KEYCAPS[i]}</Text> {labelFor(head, i)}
              </Button>
            ))}
          </Box>
        </Box>
      ) : (
        <Box flexDirection="column" gap="xs">
          <Text weight="semibold">Nothing to decide</Text>
          <Text size="footnote" dimColor>
            {props.online
              ? 'Questions from your agents show up here.'
              : 'Starting the offload server…'}
          </Text>
        </Box>
      )}

      {queue.length > 1 ? (
        <Box flexDirection="column">
          {queue.slice(1, 4).map(q => (
            <Text size="caption" dimColor>{q.source ? `${q.source} · ` : ''}{q.question}</Text>
          ))}
          {queue.length > 4 ? <Text size="caption" dimColor>+{queue.length - 4} more</Text> : null}
        </Box>
      ) : null}

      {s.history.length ? (
        <Box flexDirection="column">
          {s.history.map(item => (
            <Text size="caption" dimColor>
              <Text color={COLORS[item.index]}>●</Text> {item.label} · {item.question}
            </Text>
          ))}
        </Box>
      ) : null}

      <Text size="caption" dimColor>Click here, then Z X C or , . /</Text>
    </Box>
  )
}

export default Console

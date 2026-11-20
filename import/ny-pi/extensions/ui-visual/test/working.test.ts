// node --experimental-strip-types --test ~/.pi/agent/extensions/ui-visual/test/working.test.ts
import assert from 'node:assert/strict'
import { afterEach, mock, test } from 'node:test'
import working, { formatElapsed, frames, phaseText, toolTarget, truncate } from '../working.ts'

afterEach(() => mock.timers.reset())

test('formatElapsed: limites', () => {
  assert.equal(formatElapsed(-5), '0s')
  assert.equal(formatElapsed(4000), '4s')
  assert.equal(formatElapsed(59999), '59s')
  assert.equal(formatElapsed(60000), '1m 00s')
  assert.equal(formatElapsed(65000), '1m 05s')
  assert.equal(formatElapsed(3599000), '59m 59s')
  assert.equal(formatElapsed(3720000), '1h 02m')
})

test('truncate e toolTarget', () => {
  assert.equal(truncate('abc', 5), 'abc')
  assert.equal(truncate('a'.repeat(50)).length, 40)
  assert.ok(truncate('a'.repeat(50)).endsWith('…'))
  assert.equal(toolTarget({ path: '/a/b.ts' }), '/a/b.ts')
  assert.equal(toolTarget({ command: 'ls -la\nrm x' }), 'ls -la')
  assert.equal(toolTarget({ pattern: 'foo' }), 'foo')
  assert.equal(toolTarget({ path: '' , pattern: 'x' }), 'x')
  assert.equal(toolTarget(undefined), '')
  assert.equal(toolTarget({ n: 1 }), '')
})

test('phaseText: 0, 1 e 2 ferramentas', () => {
  assert.equal(phaseText({ phase: 'pensando', tools: [], elapsedMs: 4000 }), 'pensando · 4s')
  assert.equal(phaseText({ phase: 'escrevendo', tools: [], elapsedMs: 65000 }), 'escrevendo · 1m 05s')
  assert.equal(phaseText({ phase: 'pensando', tools: [{ name: 'read', target: 'a.ts' }], elapsedMs: 1000 }), 'read · a.ts · 1s')
  assert.equal(phaseText({ phase: 'pensando', tools: [{ name: 'bash', target: '' }], elapsedMs: 1000 }), 'bash · 1s')
  const two = [{ name: 'read', target: 'a' }, { name: 'ls', target: 'b' }]
  assert.equal(phaseText({ phase: 'pensando', tools: two, elapsedMs: 2000 }), '2 ferramentas · 2s')
})

test('frames: 8 com gradiente; sem movimento 1 quadro', () => {
  const theme = { fg: (k: string, s: string) => `<${k}>${s}` }
  const f = frames(theme, true)
  assert.equal(f.length, 8)
  assert.deepEqual(f.slice(0, 4).map((x) => x.slice(1, x.indexOf('>'))), ['mdHeading', 'syntaxType', 'accent', 'syntaxType'])
  assert.deepEqual(frames(theme, false), ['<accent>●'])
})

function setup(hasUI = true) {
  const handlers: Record<string, (e: any, c: any) => void> = {}
  const calls: unknown[][] = []
  const ctx = {
    hasUI,
    ui: {
      theme: { fg: (k: string, s: string) => `<${k}>${s}` },
      setWorkingIndicator: (o: unknown) => calls.push(['indicator', o]),
      setHiddenThinkingLabel: (t: string) => calls.push(['label', t]),
      setWorkingMessage: (t?: string) => calls.push(['message', t]),
    },
  }
  working({ on: (n: string, h: any) => { handlers[n] = h } } as any)
  return { handlers, calls, ctx }
}

function withEnv(env: Record<string, string>, fn: () => void) {
  const keys = ['PI_REDUCED_MOTION', 'NO_PROGRESS', 'PI_CODE_SUBAGENT']
  const saved = keys.map((k) => process.env[k])
  keys.forEach((k) => delete process.env[k])
  Object.assign(process.env, env)
  try {
    fn()
  } finally {
    keys.forEach((k, i) => (saved[i] === undefined ? delete process.env[k] : (process.env[k] = saved[i])))
  }
}

test('session_start: indicador animado e rótulo de raciocínio', () => {
  withEnv({}, () => {
    const { handlers, calls, ctx } = setup()
    handlers.session_start({}, ctx)
    const ind = calls[0][1] as { frames: string[]; intervalMs: number }
    assert.equal(ind.frames.length, 8)
    assert.equal(ind.intervalMs, 80)
    assert.match(String(calls[1][1]), /raciocinando…$/)
  })
})

test('session_start: PI_REDUCED_MOTION deixa 1 quadro', () => {
  withEnv({ PI_REDUCED_MOTION: '1' }, () => {
    const { handlers, calls, ctx } = setup()
    handlers.session_start({}, ctx)
    assert.equal((calls[0][1] as { frames: string[] }).frames.length, 1)
  })
})

test('sem UI ou em subagente não faz nada', () => {
  withEnv({}, () => {
    const { handlers, calls, ctx } = setup(false)
    for (const n of ['session_start', 'agent_start', 'message_update', 'tool_execution_start', 'tool_execution_end', 'agent_settled']) handlers[n]({}, ctx)
    assert.deepEqual(calls, [])
  })
  withEnv({ PI_CODE_SUBAGENT: '1' }, () => {
    const { handlers, calls, ctx } = setup()
    handlers.session_start({}, ctx)
    handlers.agent_start({}, ctx)
    assert.deepEqual(calls, [])
  })
})

test('turno: fases, timer de 1s e restauração', () => {
  withEnv({}, () => {
    mock.timers.enable({ apis: ['setInterval', 'Date'] })
    const { handlers, calls, ctx } = setup()
    const msgs = () => calls.filter((c) => c[0] === 'message').map((c) => c[1])
    handlers.tool_execution_start({ toolCallId: 'x', toolName: 'read', args: {} }, ctx) // sem turno: ignora
    assert.deepEqual(msgs(), [])
    handlers.agent_start({}, ctx)
    assert.deepEqual(msgs(), ['pensando · 0s'])
    mock.timers.tick(3000)
    assert.equal(msgs().at(-1), 'pensando · 3s')
    handlers.message_update({}, ctx)
    handlers.message_update({}, ctx)
    assert.equal(msgs().at(-1), 'escrevendo · 3s')
    handlers.tool_execution_start({ toolCallId: 'a', toolName: 'read', args: { path: 'a.ts' } }, ctx)
    assert.equal(msgs().at(-1), 'read · a.ts · 3s')
    handlers.tool_execution_start({ toolCallId: 'b', toolName: 'bash', args: { command: 'ls' } }, ctx)
    assert.equal(msgs().at(-1), '2 ferramentas · 3s')
    handlers.tool_execution_end({ toolCallId: 'a' }, ctx)
    assert.equal(msgs().at(-1), 'bash · ls · 3s')
    handlers.tool_execution_end({ toolCallId: 'b' }, ctx)
    assert.equal(msgs().at(-1), 'pensando · 3s')
    handlers.agent_settled({}, ctx)
    assert.equal(msgs().at(-1), undefined)
    const n = calls.length
    mock.timers.tick(5000) // timer limpo: nada novo
    assert.equal(calls.length, n)
  })
})

test('session_shutdown limpa o timer; agent_start repetido não vaza', () => {
  withEnv({}, () => {
    mock.timers.enable({ apis: ['setInterval', 'Date'] })
    const { handlers, calls, ctx } = setup()
    handlers.agent_start({}, ctx)
    handlers.agent_start({}, ctx)
    handlers.session_shutdown({}, ctx)
    const n = calls.length
    mock.timers.tick(3000)
    assert.equal(calls.length, n)
  })
})

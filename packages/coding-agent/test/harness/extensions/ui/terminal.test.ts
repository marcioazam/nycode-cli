// node --experimental-strip-types --test ~/.pi/agent/extensions/ui/test/terminal.test.ts
import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import terminal, { baseTitle, lastFocus, parseFocus, titleFor } from '../terminal.ts'

delete process.env.PI_CODE_SUBAGENT // o próprio teste pode rodar dentro de um subagente

test('baseTitle segue o formato nativo, com e sem nome', () => {
  assert.equal(baseTitle('feat', '/a/b/proj'), 'pi - feat - proj')
  assert.equal(baseTitle(undefined, '/a/b/proj'), 'pi - proj')
})

test('titleFor por estado', () => {
  assert.equal(titleFor('pi - x', 'idle', '⠋'), 'pi - x')
  assert.equal(titleFor('pi - x', 'working', '⠋'), '⠋ pi - x')
  assert.equal(titleFor('pi - x', 'done', '⠋'), '✓ pi - x')
})

test('parseFocus: exato; outra entrada ou sequência misturada → undefined', () => {
  assert.equal(parseFocus('\x1b[I'), true)
  assert.equal(parseFocus('\x1b[O'), false)
  assert.equal(parseFocus('a'), undefined)
  assert.equal(parseFocus('\x1b[Ia'), undefined)
})

test('lastFocus: último relato num bloco misturado', () => {
  assert.equal(lastFocus('a\x1b[Ib'), true)
  assert.equal(lastFocus('\x1b[I\x1b[O'), false)
  assert.equal(lastFocus('\x1b[O x \x1b[I'), true)
  assert.equal(lastFocus('abc'), undefined)
})

const focusIn = (s: string | Buffer) => process.stdin.emit('data', s)
after(() => process.stdin.pause()) // o listener de 'data' põe o stdin em modo fluindo

function setup(opts: { tuiMode?: string; hasUI?: boolean; name?: string } = {}) {
  const handlers: Record<string, any> = {}
  const titles: string[] = []
  const events: unknown[] = []
  let input: any
  let unsubbed = 0
  const pi = {
    on: (n: string, h: unknown) => { handlers[n] = h },
    getSettings: () => ({ tuiMode: opts.tuiMode }),
    getSessionName: () => opts.name,
    events: { emit: (_c: string, d: unknown) => events.push(d) },
  }
  const ctx = {
    hasUI: opts.hasUI ?? true,
    cwd: '/x/proj',
    ui: {
      setTitle: (t: string) => titles.push(t),
      onTerminalInput: (h: unknown) => { input = h; return () => { unsubbed++ } },
    },
  }
  terminal(pi as any)
  return { handlers, titles, events, ctx, input: () => input, unsubbed: () => unsubbed }
}

async function withStdout<T>(fn: () => T | Promise<T>): Promise<{ out: string[]; value: T }> {
  const out: string[] = []
  const orig = process.stdout.write
  process.stdout.write = ((s: string) => (out.push(String(s)), true)) as typeof process.stdout.write
  try {
    return { out, value: await fn() }
  } finally {
    process.stdout.write = orig
  }
}

test('trabalha com spinner, termina fora de foco com ✓ e volta ao focar (regular)', async () => {
  const s = setup({ tuiMode: 'regular' })
  const { out } = await withStdout(() => s.handlers.session_start({}, s.ctx))
  assert.deepEqual(out, ['\x1b[?1004h'])
  s.handlers.agent_start({}, s.ctx)
  assert.equal(s.titles.at(-1), '⠋ pi - proj')
  await new Promise((r) => setTimeout(r, 200))
  assert.notEqual(s.titles.at(-1), '⠋ pi - proj')
  assert.deepEqual(s.input()('\x1b[O'), { consume: true })
  focusIn('\x1b[O')
  focusIn('\x1b[O') // repetido: sem novo evento
  s.handlers.agent_settled({}, s.ctx)
  assert.equal(s.titles.at(-1), '✓ pi - proj')
  assert.deepEqual(s.input()('\x1b[I'), { consume: true })
  focusIn(Buffer.from('x\x1b[I'))
  assert.equal(s.titles.at(-1), 'pi - proj')
  assert.deepEqual(s.events, [{ focused: false }, { focused: true }])
  assert.equal(s.input()('x'), undefined)
  const { out: off } = await withStdout(() => s.handlers.session_shutdown({}, s.ctx))
  assert.deepEqual(off, ['\x1b[?1004l'])
  assert.equal(s.unsubbed(), 1)
})

test('fullscreen não consome o foco; settle em foco mantém título normal', async () => {
  const s = setup({ name: 'n' })
  const { out } = await withStdout(() => s.handlers.session_start({}, s.ctx))
  assert.deepEqual(out, [])
  assert.equal(s.input()('\x1b[O'), undefined)
  focusIn('\x1b[O')
  assert.deepEqual(s.events, [{ focused: false }]) // fullscreen: o foco vem do stdin cru
  focusIn('\x1b[I')
  s.handlers.agent_start({}, s.ctx)
  s.handlers.agent_settled({}, s.ctx)
  assert.equal(s.titles.at(-1), 'pi - n - proj')
  s.handlers.session_info_changed({}, s.ctx)
  assert.equal(s.titles.at(-1), 'pi - n - proj')
  await withStdout(() => s.handlers.session_shutdown({}, s.ctx))
  focusIn('\x1b[O') // listener removido no shutdown
  assert.equal(s.events.length, 2)
})

test('PI_REDUCED_MOTION: prefixo estático, sem timer', async () => {
  process.env.PI_REDUCED_MOTION = '1'
  try {
    const s = setup()
    await withStdout(() => s.handlers.session_start({}, s.ctx))
    s.handlers.agent_start({}, s.ctx)
    const n = s.titles.length
    await new Promise((r) => setTimeout(r, 150))
    assert.equal(s.titles.length, n)
    assert.equal(s.titles.at(-1), '● pi - proj')
    s.handlers.agent_settled({}, s.ctx)
  } finally {
    delete process.env.PI_REDUCED_MOTION
  }
})

test('sem UI, subagente ou sessão não iniciada: nada acontece', async () => {
  const a = setup({ hasUI: false })
  a.handlers.session_start({}, a.ctx)
  a.handlers.agent_start({}, a.ctx)
  a.handlers.agent_settled({}, a.ctx)
  assert.deepEqual(a.titles, [])
  process.env.PI_CODE_SUBAGENT = '1'
  try {
    const b = setup()
    b.handlers.session_start({}, b.ctx)
    assert.equal(b.input(), undefined)
    b.handlers.session_shutdown({}, b.ctx)
  } finally {
    delete process.env.PI_CODE_SUBAGENT
  }
})

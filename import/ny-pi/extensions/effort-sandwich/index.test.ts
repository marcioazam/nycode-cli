// node --experimental-strip-types --test ~/.pi/agent/extensions/effort-sandwich/index.test.ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import ext, { DEFAULT_TURNS, levelFor, turnsFromEnv } from './index.ts'

test('turnsFromEnv: padrão 1; inteiro positivo passa; resto cai no padrão', () => {
  assert.equal(DEFAULT_TURNS, 1)
  assert.equal(turnsFromEnv(undefined), 1)
  assert.equal(turnsFromEnv('5'), 5)
  for (const v of ['0', '-1', 'x', '1.5', '']) assert.equal(turnsFromEnv(v), 1)
})

test('levelFor: high nos N primeiros turnos, nível inicial depois', () => {
  assert.equal(levelFor(0, 'low', 2), 'high')
  assert.equal(levelFor(1, 'low', 2), 'high')
  assert.equal(levelFor(2, 'low', 2), 'low')
  assert.equal(levelFor(9, 'off', 2), 'off')
})

test('levelFor: inicial >= high não muda nada', () => {
  for (const l of ['high', 'xhigh', 'max']) {
    assert.equal(levelFor(0, l, 2), l)
    assert.equal(levelFor(5, l, 2), l)
  }
})

function setup(env: Record<string, string | undefined>, hasUI: boolean, initial: string, depth?: string) {
  const saved = { ...process.env }
  Object.assign(process.env, env)
  if (depth === undefined) delete process.env.PI_CODE_SUBAGENT_DEPTH
  else process.env.PI_CODE_SUBAGENT_DEPTH = depth
  for (const k of Object.keys(env)) if (env[k] === undefined) delete process.env[k]
  let level = initial
  const sets: string[] = []
  const handlers: Record<string, (e: unknown, c: unknown) => unknown> = {}
  ext({
    on: (n: string, h: never) => {
      handlers[n] = h
    },
    getThinkingLevel: () => level,
    setThinkingLevel: (l: string) => {
      level = l
      sets.push(l)
    },
  } as never)
  const turn = (i: number) => handlers.turn_start?.({ turnIndex: i }, { hasUI })
  const restore = () => {
    process.env = saved
  }
  return { turn, sets, restore, handlers }
}

test('sem a env ou com PI_EFFORT_SANDWICH=0: nenhum handler registrado', () => {
  for (const v of [undefined, '0']) {
    const s = setup({ PI_EFFORT_SANDWICH: v }, false, 'low')
    assert.deepEqual(Object.keys(s.handlers), [])
    s.restore()
  }
})

test('ligado com TURNS padrão, headless de topo: high só no turno 0, volta a medium no turno 1', () => {
  const s = setup({ PI_EFFORT_SANDWICH: '1', PI_EFFORT_SANDWICH_TURNS: undefined }, false, 'medium')
  for (let i = 0; i < 4; i++) s.turn(i)
  assert.deepEqual(s.sets, ['high', 'medium'])
  s.restore()
})

test('TURNS=2: high nos turnos 0-1, volta a low no turno 2', () => {
  const s = setup({ PI_EFFORT_SANDWICH: '1', PI_EFFORT_SANDWICH_TURNS: '2' }, false, 'low')
  for (let i = 0; i < 5; i++) s.turn(i)
  assert.deepEqual(s.sets, ['high', 'low'])
  s.restore()
})

test('PI_EFFORT_SANDWICH_TURNS=3 segura high por 3 turnos', () => {
  const s = setup({ PI_EFFORT_SANDWICH: '1', PI_EFFORT_SANDWICH_TURNS: '3' }, false, 'medium')
  s.turn(0)
  s.turn(2)
  assert.deepEqual(s.sets, ['high'])
  s.turn(3)
  assert.deepEqual(s.sets, ['high', 'medium'])
  s.restore()
})

test('inicial já high: nunca chama setThinkingLevel', () => {
  const s = setup({ PI_EFFORT_SANDWICH: '1' }, false, 'xhigh')
  for (let i = 0; i < 4; i++) s.turn(i)
  assert.deepEqual(s.sets, [])
  s.restore()
})

test('com UI ou subagente: não faz nada', () => {
  const ui = setup({ PI_EFFORT_SANDWICH: '1' }, true, 'low')
  ui.turn(0)
  assert.deepEqual(ui.sets, [])
  ui.restore()
  const sub = setup({ PI_EFFORT_SANDWICH: '1' }, false, 'low', '1')
  sub.turn(0)
  assert.deepEqual(sub.sets, [])
  sub.restore()
})

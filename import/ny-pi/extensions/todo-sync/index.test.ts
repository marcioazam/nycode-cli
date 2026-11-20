// node --experimental-strip-types --test extensions/todo-sync/index.test.ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import ext, { EVERY, FOLLOW, reminder } from './index.ts'

type Result = { content: Array<{ type: string; text: string }> } | undefined

function load(hasUI?: boolean) {
  let onResult: (e: unknown) => Result = () => undefined
  let onTodos: (d: unknown) => void = () => {}
  ext({
    on: (name: string, h: never) => {
      if (name === 'tool_result') onResult = h
    },
    events: {
      on: (name: string, h: never) => {
        if (name === 'pi-code:todos') onTodos = h
      },
    },
  } as never)
  const ctx = hasUI === undefined ? undefined : { hasUI }
  const call = (toolName = 'bash', input?: unknown) =>
    (onResult as (e: unknown, c: unknown) => Result)({ toolName, input, content: [{ type: 'text', text: 'out' }] }, ctx)
  return { call, onTodos }
}

const open = [
  { id: 1, text: 'feito', status: 'completed' },
  { id: 2, text: 'Rodando o gate', status: 'in_progress' },
  { id: 3, text: 'depois', status: 'pending' },
]

test('sem item aberto não há lembrete', () => {
  assert.equal(reminder([], EVERY), undefined)
  assert.equal(reminder([open[0]], EVERY), undefined)
})

test('lembrete cita o item em andamento e a contagem de abertos', () => {
  const text = reminder(open, EVERY) as string
  assert.match(text, /2 open item\(s\)/)
  assert.match(text, /#2 "Rodando o gate"/)
  assert.match(reminder([open[2]], EVERY) as string, /none in progress/)
})

test('lembra na chamada EVERY, preserva a saída e rearma', () => {
  const { call, onTodos } = load()
  onTodos(open)
  for (let i = 1; i < EVERY; i++) assert.equal(call(), undefined)
  const out = call() as NonNullable<Result>
  assert.equal(out.content[0].text, 'out')
  assert.match(out.content[1].text, /^<system-reminder>/)
  for (let i = 1; i < EVERY; i++) assert.equal(call(), undefined)
  assert.ok(call())
})

test('chamar a ferramenta todo zera a contagem', () => {
  const { call, onTodos } = load()
  onTodos(open)
  for (let i = 1; i < EVERY; i++) call()
  assert.equal(call('todo'), undefined)
  for (let i = 1; i < EVERY; i++) assert.equal(call(), undefined)
  assert.ok(call())
})

test('lista vazia ou toda concluída: silêncio', () => {
  const { call, onTodos } = load()
  for (let i = 0; i < EVERY * 2; i++) assert.equal(call(), undefined)
  onTodos([open[0]])
  for (let i = 0; i < EVERY * 2; i++) assert.equal(call(), undefined)
})

const OLD =
  '<system-reminder>The todo list has 2 open item(s) (in progress: #2 "Rodando o gate") and the last 10 tool calls did not update it. If an item is finished, complete it now; if the work moved to another item, start that one; add what is missing. If the list is accurate, carry on and do not mention this reminder.</system-reminder>'

test('sem UI: texto e ritmo idênticos ao antigo', () => {
  for (const hasUI of [undefined, false]) {
    const { call, onTodos } = load(hasUI)
    onTodos(open)
    for (let i = 1; i < EVERY; i++) assert.equal(call(), undefined)
    assert.equal((call() as NonNullable<Result>).content[1].text, OLD)
    assert.equal(call('todo', { action: 'list' }), undefined)
    for (let i = 1; i < EVERY; i++) assert.equal(call(), undefined)
    assert.ok(call())
  }
})

test('com UI: 10ª, 13ª e 16ª sem mudança; list não zera', () => {
  const { call, onTodos } = load(true)
  onTodos(open)
  const hits: number[] = []
  for (let i = 1; i <= 16; i++)
    if (call(i === 5 ? 'todo' : 'bash', i === 5 ? { action: 'list' } : undefined)) hits.push(i)
  assert.deepEqual(hits, [EVERY, EVERY + FOLLOW, EVERY + 2 * FOLLOW])
})

test('com UI: add/start/complete/delete/sem input zeram', () => {
  for (const input of [
    { action: 'add' },
    { action: 'start' },
    { action: 'complete' },
    { action: 'delete' },
    undefined,
  ]) {
    const { call, onTodos } = load(true)
    onTodos(open)
    for (let i = 1; i < EVERY; i++) call()
    assert.equal(call('todo', input), undefined)
    for (let i = 1; i < EVERY; i++) assert.equal(call(), undefined)
    assert.ok(call())
  }
})

test('com UI: texto estrito lista itens, sem frase de saída', () => {
  const { call, onTodos } = load(true)
  onTodos([...open, { id: 4, text: 'x'.repeat(80), status: 'pending' }])
  for (let i = 1; i < EVERY; i++) call()
  const t = (call() as NonNullable<Result>).content[1].text
  assert.match(t, /#2 \[in_progress\] Rodando o gate/)
  assert.match(t, new RegExp(`#4 \\[pending\\] ${'x'.repeat(60)}(?!x)`))
  assert.match(t, /one todo call that changes it/)
  assert.doesNotMatch(t, /carry on|do not mention/)
})

test('com UI: corta em 12 itens com +N more', () => {
  const { call, onTodos } = load(true)
  onTodos(Array.from({ length: 15 }, (_, i) => ({ id: i + 1, text: `t${i + 1}`, status: 'pending' })))
  for (let i = 1; i < EVERY; i++) call()
  const t = (call() as NonNullable<Result>).content[1].text
  assert.match(t, /#12 /)
  assert.doesNotMatch(t, /#13 /)
  assert.match(t, /\+3 more/)
})

test('sem item aberto nada é escrito em nenhum modo', () => {
  for (const hasUI of [false, true]) {
    const { call, onTodos } = load(hasUI)
    onTodos([open[0]])
    for (let i = 0; i < EVERY * 3; i++) assert.equal(call(), undefined)
  }
})

test('PI_TODO_SYNC=0 não registra nada', () => {
  process.env.PI_TODO_SYNC = '0'
  try {
    ext({ on: () => assert.fail('registrou'), events: { on: () => assert.fail('registrou') } } as never)
  } finally {
    delete process.env.PI_TODO_SYNC
  }
})

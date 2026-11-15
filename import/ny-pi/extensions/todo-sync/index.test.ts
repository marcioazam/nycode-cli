// node --experimental-strip-types --test extensions/todo-sync/index.test.ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import ext, { EVERY, reminder } from './index.ts'

type Result = { content: Array<{ type: string; text: string }> } | undefined

function load() {
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
  const call = (toolName = 'bash') => onResult({ toolName, content: [{ type: 'text', text: 'out' }] })
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

test('PI_TODO_SYNC=0 não registra nada', () => {
  process.env.PI_TODO_SYNC = '0'
  try {
    ext({ on: () => assert.fail('registrou'), events: { on: () => assert.fail('registrou') } } as never)
  } finally {
    delete process.env.PI_TODO_SYNC
  }
})

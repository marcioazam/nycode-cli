// Testes do zzzzzz-todo-active.patch: node --experimental-strip-types --test ~/.pi/agent/claude-home/patches/pi-code/zzzzzz-todo-active/todo-active.test.ts (PI_CODE_EXTENSIONS: pasta extensions já com o patch, antes de instalá-lo)
import assert from 'node:assert/strict'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

const tmp = mkdtempSync(join(tmpdir(), 'todo-active-test-'))
after(() => rmSync(tmp, { recursive: true }))
// O Node não tira tipos de .ts dentro de node_modules: testa uma cópia do pacote, com o pi ao lado.
cpSync(
  process.env.PI_CODE_EXTENSIONS ?? `${homedir()}/.pi/agent/npm/node_modules/pi-code/extensions`,
  join(tmp, 'extensions'),
  { recursive: true },
)
const rel = `${homedir()}/.pi/agent/install/releases/${readFileSync(`${homedir()}/.pi/agent/install/current-version`, 'utf8').trim()}/node_modules`
mkdirSync(join(tmp, 'node_modules'))
for (const m of ['@earendil-works', 'typebox']) symlinkSync(join(rel, m), join(tmp, 'node_modules', m))
const { activeStep, PlanTimes }: any = await import(join(tmp, 'extensions', 'plan-mode', 'table.ts'))

// Mesmo mapeamento de index.ts para os todos do evento pi-code:todos.
const asItems = (todos: Array<{ id: number; status: string }>) =>
  todos.map((t) => ({
    step: t.id,
    text: `t${t.id}`,
    completed: t.status === 'completed',
    doing: t.status === 'in_progress',
  }))

test('index.ts mapeia id e in_progress dos todos', () => {
  const src = readFileSync(join(tmp, 'extensions', 'plan-mode', 'index.ts'), 'utf8')
  assert.match(src, /step: t\.id,[^\n]*doing: t\.status === 'in_progress'/)
})

test('(a) activeStep é o todo em andamento, não o primeiro aberto', () => {
  const items = asItems([
    { id: 3, status: 'pending' },
    { id: 5, status: 'in_progress' },
    { id: 9, status: 'pending' },
  ])
  assert.deepEqual(
    items.map((i) => i.step),
    [3, 5, 9],
  )
  assert.equal(activeStep(items), 5)
})

test('(b) nenhum em andamento: activeStep indefinido', () => {
  assert.equal(
    activeStep(
      asItems([
        { id: 3, status: 'pending' },
        { id: 5, status: 'completed' },
      ]),
    ),
    undefined,
  )
})

test('(c) relógio do todo em andamento começa agora, mesmo após um concluído', () => {
  const t = new PlanTimes()
  t.observe(
    asItems([
      { id: 2, status: 'completed' },
      { id: 3, status: 'pending' },
      { id: 5, status: 'in_progress' },
    ]),
    1000,
  )
  assert.equal(t.window(5, 1500).from, 1000)
  assert.equal(t.window(3, 1500), undefined)
})

test('(d) volta a pending: relógio descartado', () => {
  const t = new PlanTimes()
  t.observe(asItems([{ id: 5, status: 'in_progress' }]), 1000)
  t.observe(asItems([{ id: 5, status: 'pending' }]), 2000)
  assert.equal(t.window(5, 3000), undefined)
})

test('(e) modo plano (sem doing) inalterado', () => {
  const items = [
    { step: 1, text: 'a', completed: true },
    { step: 2, text: 'b', completed: false },
    { step: 3, text: 'c', completed: false },
  ]
  assert.equal(activeStep(items), 2)
  const t = new PlanTimes()
  t.observe(
    items.map((i) => ({ ...i, completed: false })),
    1000,
  )
  t.observe(items, 2000)
  assert.equal(t.window(2, 2500).from, 2000)
  assert.equal(t.window(3, 2500), undefined)
})

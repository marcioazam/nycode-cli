// Testes do todo-collapse.patch: node --experimental-strip-types --test ~/.pi/agent/claude-home/patches/pi-code/todo-collapse.test.ts
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

const HOME = homedir()
const PATCHES = `${HOME}/.pi/agent/claude-home/patches/pi-code`
const EXT = `${HOME}/.pi/agent/npm/node_modules/pi-code/extensions`
// O Node não tira tipos de .ts dentro de node_modules: testa uma cópia do pacote, com o pi ao lado.
const tmp = mkdtempSync(join(tmpdir(), 'todo-collapse-test-'))
const ext = join(tmp, 'extensions')
cpSync(EXT, ext, { recursive: true })
mkdirSync(join(tmp, 'node_modules'))
const modules = `${HOME}/.pi/agent/install/releases/${readFileSync(`${HOME}/.pi/agent/install/current-version`, 'utf8').trim()}/node_modules`
symlinkSync(`${modules}/@earendil-works`, join(tmp, 'node_modules', '@earendil-works'))
symlinkSync(`${modules}/typebox`, join(tmp, 'node_modules', 'typebox'))
const mod = await import(`${ext}/todo.ts`)

const theme: any = { fg: (c: string, t: string) => `<${c}>${t}</${c}>` }
const todo = (id: number, status: string, text: string, activeForm?: string) => ({ id, status, text, activeForm })

test('collapsedLine: contagem completed/total e o in_progress com activeForm', () => {
  const line = mod.collapsedLine([todo(1, 'completed', 'a'), todo(2, 'in_progress', 'write', 'Writing'), todo(3, 'pending', 'c')], theme)
  assert.equal(line, '<accent>Todos 1/3</accent> · <accent>◐</accent> Writing')
})

test('collapsedLine: sem activeForm usa o texto; sem in_progress só a contagem', () => {
  assert.ok(mod.collapsedLine([todo(1, 'in_progress', 'write')], theme).endsWith('◐</accent> write'))
  assert.equal(mod.collapsedLine([todo(1, 'completed', 'a'), todo(2, 'pending', 'b')], theme), '<accent>Todos 1/2</accent>')
})

/** Starts the extension with a todo list replayed from a custom entry. */
function start(todos: object[]) {
  const handlers = new Map<string, (...a: any[]) => any>()
  const shortcuts = new Map<string, any>()
  const pi: any = new Proxy({ on: (n: string, h: any) => handlers.set(n, h), registerShortcut: (k: string, o: any) => shortcuts.set(k, o) }, { get: (t: any, k) => t[k] ?? (() => {}) })
  mod.default(pi)
  const widgets: any[] = []
  let renders = 0
  const ui = { setWidget: (key: string, factory: any) => widgets.push({ key, factory }) }
  const entries = todos.length ? [{ type: 'custom', customType: 'pi-code:todo', data: { todos, nextId: 9 } }] : []
  const ctx: any = { hasUI: true, ui, sessionManager: { getBranch: () => entries } }
  handlers.get('session_start')!({}, ctx)
  const tui = { requestRender: () => renders++ }
  const component = widgets.at(-1)?.factory(tui, theme)
  return { shortcuts, widgets, component, renders: () => renders }
}

test('registra ctrl+shift+t', () => {
  assert.ok(start([todo(1, 'pending', 'a')]).shortcuts.has('ctrl+shift+t'))
})

test('ctrl+shift+t alterna entre a lista completa e uma linha, e pede re-render', () => {
  const s = start([todo(1, 'completed', 'a'), todo(2, 'in_progress', 'b', 'Doing b')])
  const full = s.component.render(80)
  assert.ok(full.length > 3)
  s.shortcuts.get('ctrl+shift+t').handler()
  assert.equal(s.renders(), 1)
  assert.deepEqual(s.component.render(80), ['<accent>Todos 1/2</accent> · <accent>◐</accent> Doing b', ''])
  s.shortcuts.get('ctrl+shift+t').handler()
  assert.equal(s.renders(), 2)
  assert.deepEqual(s.component.render(80), full)
})

test('ctrl+shift+t sem todos não faz nada', () => {
  const s = start([])
  assert.doesNotThrow(() => s.shortcuts.get('ctrl+shift+t').handler())
  assert.equal(s.widgets.length, 0)
  assert.equal(s.renders(), 0)
})

test('a linha recolhida respeita a largura', () => {
  const s = start([todo(1, 'in_progress', 'x'.repeat(100))])
  s.shortcuts.get('ctrl+shift+t').handler()
  assert.ok(s.component.render(20)[0].length < 60)
})

// ---- cobertura do comportamento completo de todo.ts ----
const theme2: any = { fg: (c: string, t: string) => `<${c}>${t}</${c}>`, bold: (t: string) => `*${t}*` }
const dump = (c: any, w = 200) => c.render(w).map((l: string) => l.trimEnd()).join('\n')

function boot(entries: any[] = [], ctxOver: any = {}) {
  const handlers = new Map<string, (...a: any[]) => any>()
  const commands = new Map<string, any>()
  const appended: any[] = []
  let tool: any
  const pi: any = {
    on: (n: string, h: any) => handlers.set(n, h),
    registerShortcut: () => {},
    registerCommand: (n: string, c: any) => commands.set(n, c),
    registerTool: (t: any) => { tool = t },
    appendEntry: (type: string, data: any) => appended.push({ type, data }),
  }
  mod.default(pi)
  const widgets: any[] = []
  const notes: any[] = []
  const ui = { setWidget: (key: string, f: any, o: any) => widgets.push({ key, f, o }), notify: (m: string, l: string) => notes.push([m, l]), custom: async (f: any) => f({}, theme2, {}, () => {}) }
  const ctx: any = { hasUI: true, mode: 'tui', ui, sessionManager: { getBranch: () => entries }, ...ctxOver }
  return { handlers, commands, appended, tool, widgets, notes, ctx, ui, run: (p: any) => tool.execute('id', p, undefined, undefined, ctx), text: async (p: any) => (await tool.execute('id', p)).content[0].text }
}
const snap = (todos: object[], nextId = 5) => ({ type: 'custom', customType: 'pi-code:todo', data: { todos, nextId } })

test('execute: add exige texto, atribui ids crescentes e persiste snapshot', async () => {
  const b = boot()
  const bad = await b.run({ action: 'add' })
  assert.equal(bad.content[0].text, 'Error: text required for add')
  assert.equal(bad.details.error, 'text required for add')
  assert.equal(b.appended.length, 0)
  assert.equal(await b.text({ action: 'add', text: 'one', activeForm: 'Doing one' }), 'Added todo #1: one')
  assert.equal(await b.text({ action: 'add', text: 'two' }), 'Added todo #2: two')
  assert.equal(b.appended.length, 2)
  assert.deepEqual(b.appended[1], { type: 'pi-code:todo', data: { todos: [todo(1, 'pending', 'one', 'Doing one'), todo(2, 'pending', 'two', undefined)], nextId: 3 } })
})

test('execute: start/complete/delete validam id e existência', async () => {
  const b = boot()
  await b.run({ action: 'add', text: 'a' })
  for (const action of ['start', 'complete', 'delete']) {
    assert.equal(await b.text({ action }), `Error: id required for ${action}`)
    assert.equal(await b.text({ action, id: 99 }), 'Error: #99 not found')
  }
  assert.equal(b.appended.length, 1) // falhas não persistem
})

test('execute: start rebaixa o in_progress anterior e grava activeForm', async () => {
  const b = boot()
  for (const t of ['a', 'b', 'c']) await b.run({ action: 'add', text: t })
  assert.equal(await b.text({ action: 'start', id: 1 }), 'Started #1: a')
  assert.equal(await b.text({ action: 'start', id: 2, activeForm: 'Doing b' }), 'Started #2: b (moved #1 back to pending)')
  const listed = (await b.run({ action: 'list' })).details.todos
  assert.deepEqual(listed.map((t: any) => t.status), ['pending', 'in_progress', 'pending'])
  assert.equal(listed[1].activeForm, 'Doing b')
  // reiniciar o mesmo todo não o rebaixa
  assert.equal(await b.text({ action: 'start', id: 2 }), 'Started #2: b')
})

test('execute: complete, delete, list e clear (reinicia nextId)', async () => {
  const b = boot()
  for (const t of ['a', 'b']) await b.run({ action: 'add', text: t })
  assert.equal(await b.text({ action: 'complete', id: 1 }), 'Completed #1: a')
  assert.equal(await b.text({ action: 'list' }), '[x] #1: a\n[ ] #2: b')
  const n = b.appended.length
  assert.equal(await b.text({ action: 'delete', id: 2 }), 'Deleted #2: b')
  await b.run({ action: 'start', id: 1 })
  assert.equal(await b.text({ action: 'list' }), '[>] #1: a')
  assert.equal(b.appended.length, n + 2) // list não persiste
  assert.equal(await b.text({ action: 'clear' }), 'Cleared 1 todos')
  assert.equal(await b.text({ action: 'list' }), 'No todos')
  assert.equal(await b.text({ action: 'add', text: 'z' }), 'Added todo #1: z')
})

test('execute: ação desconhecida vira erro', async () => {
  const r = await boot().run({ action: 'explode' })
  assert.equal(r.content[0].text, 'Error: unknown action: explode')
})

test('o resultado carrega cópias: mutações posteriores não alteram detalhes antigos', async () => {
  const b = boot()
  const added = await b.run({ action: 'add', text: 'a' })
  await b.run({ action: 'complete', id: 1 })
  assert.equal(added.details.todos[0].status, 'pending')
})

test('renderCall mostra ação, id, texto e activeForm', () => {
  const b = boot()
  assert.equal(dump(b.tool.renderCall({ action: 'start', id: 3, text: 'x', activeForm: 'Xing' }, theme2, {})), '<toolTitle>*todo *</toolTitle><muted>start</muted> <accent>#3</accent> <dim>"x"</dim> <dim>(Xing)</dim>')
  assert.equal(dump(b.tool.renderCall({ action: 'list' }, theme2, {})), '<toolTitle>*todo *</toolTitle><muted>list</muted>')
})

test('renderResult: sem details, erro, mutação, start e list (curto/expandido/vazio)', () => {
  const b = boot()
  const r = (details: any, text = 'msg', expanded = false) => dump(b.tool.renderResult({ content: [{ type: 'text', text }], details }, { expanded }, theme2, {}))
  assert.equal(r(undefined, 'plain'), 'plain')
  assert.equal(dump(b.tool.renderResult({ content: [], details: undefined }, { expanded: false }, theme2, {})), '')
  assert.equal(r({ action: 'add', todos: [], nextId: 1, error: 'bad' }), '<error>Error: bad</error>')
  assert.equal(r({ action: 'add', todos: [], nextId: 1 }), '<success>✓ </success><muted>msg</muted>')
  assert.equal(r({ action: 'start', todos: [], nextId: 1 }), '<accent>◐ </accent><muted>msg</muted>')
  assert.equal(r({ action: 'list', todos: [], nextId: 1 }), '<dim>No todos</dim>')
  const many = Array.from({ length: 7 }, (_, i) => todo(i + 1, i === 0 ? 'completed' : 'pending', `t${i + 1}`))
  const short = r({ action: 'list', todos: many, nextId: 8 }).split('\n')
  assert.equal(short[0], '<muted>7 todo(s):</muted>')
  assert.equal(short.length, 1 + 5 + 1)
  assert.equal(short[1], '<success>✓</success> <accent>#1</accent> <dim>t1</dim>')
  assert.equal(short.at(-1), '<dim>... 2 more</dim>')
  const full = r({ action: 'list', todos: many, nextId: 8 }, 'm', true).split('\n')
  assert.equal(full.length, 8)
  assert.ok(!full.join().includes('more'))
})

test('replay: snapshot do provedor, legado (done) e details vazios de chamada falha', () => {
  const legacyResult = (details: any) => ({ type: 'message', message: { role: 'toolResult', toolName: 'todo', details } })
  const b = boot([
    legacyResult({ todos: [{ id: 1, text: 'old', done: true }, { id: 2, text: 'new' }], nextId: 3 }),
    legacyResult({}), // falha persistida como details: {}
    { type: 'message', message: { role: 'user' } },
    { type: 'message', message: { role: 'toolResult', toolName: 'other', details: { todos: [], nextId: 1 } } },
  ])
  b.handlers.get('session_start')!({}, b.ctx)
  return b.run({ action: 'list' }).then((r) => {
    assert.deepEqual(r.details.todos, [{ id: 1, status: 'completed', text: 'old' }, { id: 2, status: 'pending', text: 'new' }])
    assert.equal(r.details.nextId, 3)
  })
})

test('replay: snapshot do provedor supera resultados legados posteriores', async () => {
  const legacy = { type: 'message', message: { role: 'toolResult', toolName: 'todo', details: { todos: [{ id: 7, text: 'legacy', status: 'pending' }], nextId: 8 } } }
  const b = boot([snap([todo(1, 'in_progress', 'real', 'Real')], 2), legacy])
  b.handlers.get('session_start')!({}, b.ctx)
  assert.equal(await b.text({ action: 'list' }), '[>] #1: real')
  assert.equal(await b.text({ action: 'add', text: 'n' }), 'Added todo #2: n')
})

test('session_tree/session_compact refazem o replay; ctx obsoleto mantém o estado; outro erro propaga', async () => {
  let entries: any[] = [snap([todo(1, 'pending', 'a')])]
  const b = boot(entries)
  b.ctx.sessionManager.getBranch = () => entries
  b.handlers.get('session_start')!({}, b.ctx)
  entries = [snap([todo(4, 'pending', 'tree')], 5)]
  b.handlers.get('session_tree')!({}, b.ctx)
  assert.equal(await b.text({ action: 'list' }), '[ ] #4: tree')
  entries = [snap([todo(6, 'pending', 'compact')], 7)]
  b.handlers.get('session_compact')!({}, b.ctx)
  assert.equal(await b.text({ action: 'list' }), '[ ] #6: compact')
  const stale = { ...b.ctx, sessionManager: { getBranch: () => { throw new Error('ctx is stale after session replacement') } } }
  assert.doesNotThrow(() => b.handlers.get('session_tree')!({}, stale))
  assert.equal(await b.text({ action: 'list' }), '[ ] #6: compact')
  const broken = { ...b.ctx, sessionManager: { getBranch: () => { throw new Error('disk on fire') } } }
  assert.throws(() => b.handlers.get('session_compact')!({}, broken), /disk on fire/)
})

test('widget: registra uma vez, re-renderiza, esconde com lista vazia e no shutdown', async () => {
  const b = boot([snap([todo(1, 'pending', 'a')])])
  b.handlers.get('session_start')!({}, b.ctx)
  assert.equal(b.widgets.length, 1)
  assert.deepEqual([b.widgets[0].key, b.widgets[0].o], ['todos', { placement: 'aboveEditor' }])
  let renders = 0
  const comp = b.widgets[0].f({ requestRender: () => renders++ }, theme2)
  b.handlers.get('tool_execution_end')!({ toolName: 'todo', isError: false })
  assert.equal(renders, 1)
  b.handlers.get('tool_execution_end')!({ toolName: 'bash', isError: false })
  b.handlers.get('tool_execution_end')!({ toolName: 'todo', isError: true })
  assert.equal(renders, 1)
  b.handlers.get('session_start')!({}, b.ctx) // mesmo ui: idempotente
  assert.equal(b.widgets.length, 1)
  await b.run({ action: 'clear' })
  b.handlers.get('tool_execution_end')!({ toolName: 'todo', isError: false })
  assert.equal(b.widgets.at(-1).f, undefined) // setWidget(key, undefined)
  assert.deepEqual(comp.render(80), [])
  await b.run({ action: 'add', text: 'again' })
  b.handlers.get('tool_execution_end')!({ toolName: 'todo', isError: false })
  assert.equal(typeof b.widgets.at(-1).f, 'function')
  const n = b.widgets.length
  b.handlers.get('session_shutdown')!({})
  assert.equal(b.widgets.length, n + 1)
  assert.equal(b.widgets.at(-1).f, undefined)
  b.handlers.get('session_shutdown')!({}) // já escondido: nada
  assert.equal(b.widgets.length, n + 1)
})

test('widget: invalidate força novo registro; novo ui (/reload) re-registra; sem UI não registra', () => {
  const b = boot([snap([todo(1, 'pending', 'a')])])
  b.handlers.get('session_start')!({}, b.ctx)
  const comp = b.widgets[0].f({ requestRender() {} }, theme2)
  comp.invalidate()
  b.handlers.get('tool_execution_end')!({ toolName: 'todo', isError: false })
  assert.equal(b.widgets.length, 2)
  b.handlers.get('session_start')!({}, { ...b.ctx, ui: { ...b.ui, setWidget: (k: string, f: any) => b.widgets.push({ k, f }) } })
  assert.equal(b.widgets.length, 3)
  const nb = boot([snap([todo(1, 'pending', 'a')])])
  nb.handlers.get('session_start')!({}, { ...nb.ctx, hasUI: false })
  assert.equal(nb.widgets.length, 0)
})

test('widget: render normal com glifos, └─ no último e cabeçalho dim quando tudo concluído', () => {
  const b = boot([snap([todo(1, 'completed', 'done'), todo(2, 'in_progress', 'b', 'Doing b'), todo(3, 'pending', 'c')])])
  b.handlers.get('session_start')!({}, b.ctx)
  const lines = b.widgets[0].f({ requestRender() {} }, theme2).render(80)
  assert.deepEqual(lines, [
    '<accent>● Todos (1/3)</accent>',
    '<dim>├─</dim> <success>✓</success> <dim>done</dim>',
    '<dim>├─</dim> <accent>◐</accent> <text>Doing b</text>',
    '<dim>└─</dim> <dim>○</dim> <muted>c</muted>',
    '',
  ])
  // Tudo concluído: recolhe sozinho numa linha (pedido do usuário 2026-11-13), em vez do cabeçalho dim.
  const all = boot([snap([todo(1, 'completed', 'x')])])
  all.handlers.get('session_start')!({}, all.ctx)
  assert.deepEqual(all.widgets[0].f({ requestRender() {} }, theme2).render(80), ['<success>✓</success> <dim>Todos 1/1</dim>', ''])
})

test('widget concluído: clique expande, novo clique recolhe', () => {
  const b = boot([snap([todo(1, 'completed', 'x'), todo(2, 'completed', 'y')])])
  b.handlers.get('session_start')!({}, b.ctx)
  const w = b.widgets[0].f({ requestRender() {} }, theme2)
  assert.equal(w.render(80).length, 2) // recolhido
  w.handleMouse({ type: 'click' })
  const open = b.widgets.at(-1).f({ requestRender() {} }, theme2).render(80)
  assert.ok(open.length > 2 && open[0].includes('Todos (2/2)'))
  b.widgets.at(-1).f({ requestRender() {} }, theme2).handleMouse({ type: 'click' })
  assert.equal(b.widgets.at(-1).f({ requestRender() {} }, theme2).render(80).length, 2)
})

test('widget: roda do mouse rola a lista longa e mostra ↑↓', () => {
  const many = Array.from({ length: 20 }, (_, i) => todo(i + 1, 'pending', `p${i + 1}`))
  const b = boot([snap(many)])
  b.handlers.get('session_start')!({}, b.ctx)
  const w = b.widgets[0].f({ requestRender() {} }, theme2)
  assert.deepEqual(w.handleMouse({ type: 'wheel', wheelDelta: -1 }), undefined) // já no topo
  assert.deepEqual(w.handleMouse({ type: 'wheel', wheelDelta: 1 }), { render: true })
  const lines = b.widgets.at(-1).f({ requestRender() {} }, theme2).render(80)
  assert.match(lines.at(-2), /↑1 ↓9/)
  assert.ok(lines.some((l: string) => l.includes('p2')) && !lines.some((l: string) => l.includes('p1<')))
})

test('scrollWindow: cabe, satura no fim e conta acima/abaixo', () => {
  const items = [1, 2, 3, 4, 5]
  assert.deepEqual(mod.scrollWindow(items, 5, 3), { visible: items, above: 0, below: 0, offset: 0 })
  assert.deepEqual(mod.scrollWindow(items, 3, 1), { visible: [2, 3], above: 1, below: 2, offset: 1 })
  assert.deepEqual(mod.scrollWindow(items, 3, 99), { visible: [4, 5], above: 3, below: 0, offset: 3 })
})

test('allDone e retomada: item novo volta a expandir', () => {
  assert.equal(mod.allDone([]), false)
  assert.equal(mod.allDone([todo(1, 'completed', 'x')]), true)
  assert.equal(mod.allDone([todo(1, 'completed', 'x'), todo(2, 'pending', 'y')]), false)
  const list = [todo(1, 'completed', 'x')]
  const b = boot([snap(list)])
  b.handlers.get('session_start')!({}, b.ctx)
  assert.equal(b.widgets[0].f({ requestRender() {} }, theme2).render(80).length, 2)
  list.push(todo(2, 'pending', 'y'))
  b.handlers.get('session_start')!({}, b.ctx)
  assert.ok(b.widgets.at(-1).f({ requestRender() {} }, theme2).render(80)[0].includes('Todos (1/2)'))
})

test('widget: estouro mostra "+N more" e trunca à largura', () => {
  const many = [...Array.from({ length: 6 }, (_, i) => todo(i + 1, 'completed', `c${i + 1}`)), ...Array.from({ length: 12 }, (_, i) => todo(i + 7, 'pending', `p${i + 1}`))]
  const b = boot([snap(many)])
  b.handlers.get('session_start')!({}, b.ctx)
  const lines = b.widgets[0].f({ requestRender() {} }, theme2).render(80)
  assert.equal(lines.length, 12 + 1) // heading + 10 linhas + resumo + espaçador
  assert.equal(lines.at(-2), '<dim>└─ +8 more (6 completed, 2 pending)</dim>')
  assert.ok(lines.slice(1, -2).every((l: string) => l.includes('○')))
  assert.ok(b.widgets[0].f({ requestRender() {} }, theme2).render(12).every((l: string) => l.length < 60))
})

test('layoutOverlay: cabe, descarta concluídos primeiro e trunca a cauda', () => {
  const t = (id: number, status: string) => todo(id, status, `t${id}`)
  const fit = [t(1, 'completed'), t(2, 'pending')]
  assert.deepEqual(mod.layoutOverlay(fit, 2), { visible: fit, hiddenCompleted: 0, truncatedTail: 0 })
  const mixed = [t(1, 'completed'), t(2, 'completed'), t(3, 'pending'), t(4, 'in_progress')]
  const keep = mod.layoutOverlay(mixed, 3) // innerBudget 2: só os não concluídos
  assert.deepEqual([keep.visible.map((x: any) => x.id), keep.hiddenCompleted, keep.truncatedTail], [[3, 4], 2, 0])
  const six = [t(1, 'completed'), t(2, 'completed'), t(3, 'completed'), t(4, 'pending'), t(5, 'pending'), t(6, 'pending')]
  const part = mod.layoutOverlay(six, 5) // innerBudget 4: um concluído sobra
  assert.deepEqual([part.visible.map((x: any) => x.id), part.hiddenCompleted, part.truncatedTail], [[1, 4, 5, 6], 2, 0])
  const tail = mod.layoutOverlay([t(1, 'completed'), t(2, 'pending'), t(3, 'pending'), t(4, 'pending')], 3)
  assert.deepEqual([tail.visible.map((x: any) => x.id), tail.hiddenCompleted, tail.truncatedTail], [[2, 3], 1, 1])
})

test('normalizeTodo: status explícito, done legado e padrão pending', () => {
  assert.deepEqual(mod.normalizeTodo({ id: 1, text: 'a', status: 'in_progress', activeForm: 'A' }), todo(1, 'in_progress', 'a', 'A'))
  assert.deepEqual(mod.normalizeTodo({ id: 2, text: 'b', done: true }), { id: 2, text: 'b', status: 'completed' })
  assert.deepEqual(mod.normalizeTodo({ id: 3, text: 'c' }), { id: 3, text: 'c', status: 'pending' })
})

test('/todos: sem UI avisa erro; sem tui notifica a lista simples', async () => {
  const b = boot([snap([todo(1, 'completed', 'a'), todo(2, 'pending', 'b')])])
  b.handlers.get('session_start')!({}, b.ctx)
  const h = b.commands.get('todos').handler
  await h('', { ...b.ctx, hasUI: false })
  assert.deepEqual(b.notes, [['/todos requires interactive mode', 'error']])
  b.notes.length = 0
  await h('', { ...b.ctx, mode: 'rpc' })
  assert.deepEqual(b.notes, [['[x] #1: a\n[ ] #2: b', 'info']])
})

test('/todos em tui: componente lista, mostra vazio, cacheia por largura e fecha com Esc/Ctrl+C', async () => {
  const b = boot([snap([todo(1, 'completed', 'a'), todo(2, 'in_progress', 'b', 'Doing b')])])
  b.handlers.get('session_start')!({}, b.ctx)
  let comp: any
  let closed = 0
  b.ctx.ui.custom = async (f: any) => { comp = f({}, theme2, {}, () => closed++) }
  await b.commands.get('todos').handler('', b.ctx)
  const lines = comp.render(80)
  assert.ok(lines.includes('  <muted>1/2 completed</muted>'))
  assert.ok(lines.includes('  <dim>○</dim>'.replace('<dim>○</dim>', '<success>✓</success> <accent>#1</accent> <dim>a</dim>')))
  assert.ok(lines.includes('  <accent>◐</accent> <accent>#2</accent> <text>b</text> <dim>(Doing b)</dim>'))
  assert.ok(lines.includes('  <dim>Press Escape to close</dim>'))
  assert.equal(comp.render(80), lines) // cache
  assert.notEqual(comp.render(40), lines)
  comp.invalidate()
  assert.notEqual(comp.render(80), lines)
  comp.handleInput('x')
  assert.equal(closed, 0)
  comp.handleInput('\x1b')
  comp.handleInput('\x03')
  assert.equal(closed, 2)

  const empty = boot()
  let ec: any
  empty.ctx.ui.custom = async (f: any) => { ec = f({}, theme2, {}, () => {}) }
  await empty.commands.get('todos').handler('', empty.ctx)
  assert.ok(ec.render(80).includes('  <dim>No todos yet. Ask the agent to add some!</dim>'))
})

test('patch aplica ao original e reverte no instalado', () => {
  const d = mkdtempSync(join(tmpdir(), 'todo-orig-'))
  copyFileSync(`${PATCHES}/orig/todo.ts`, join(d, 'todo.ts'))
  execFileSync('patch', ['-d', d, '-p1', '-N', '--dry-run', '-i', `${PATCHES}/todo-collapse.patch`])
  execFileSync('patch', ['-d', EXT, '-p1', '-R', '--dry-run', '-i', `${PATCHES}/todo-collapse.patch`])
})

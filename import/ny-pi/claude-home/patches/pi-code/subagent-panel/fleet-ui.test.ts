// Testes do painel/viewer da frota (subagent/fleet-ui): node --experimental-strip-types --test ~/.pi/agent/claude-home/patches/pi-code/subagent-panel/fleet-ui.test.ts
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { mock, test } from 'node:test'
import { fleetTestEnv } from './setup.ts'

const { tmp, ext } = fleetTestEnv('fleet-ui-test-')
const vm = await import(`${ext}/subagent/fleet-ui/view-model.ts`)
const panel = await import(`${ext}/subagent/fleet-ui/panel.ts`)
const viewer = await import(`${ext}/subagent/fleet-ui/viewer.ts`)
const fleetUi = await import(`${ext}/subagent/fleet-ui/index.ts`)
const palette = await import(`${ext}/subagent/fleet-ui/palette.ts`)
await palette.ready
const { visibleWidth } = await import(`${ext}/../node_modules/@earendil-works/pi-tui/dist/index.js`)

const NOW = 1_000_000
const theme = { fg: (_c: string, s: string) => s, bold: (s: string) => s }
// Tema que marca a cor, para checar estilo por grau.
const tagTheme = { fg: (c: string, s: string) => `<${c}>${s}</${c}>`, bold: (s: string) => `*${s}*` }

function rec(id: string, parentId: string | null, depth: number, over: Record<string, unknown> = {}) {
  return {
    v: 1, id, parentId, depth, agent: `a-${id}`, task: 't', background: false, state: 'running',
    startedAt: NOW - 60_000, updatedAt: NOW, turns: 1, toolCalls: 1,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, context: 114_400 }, cost: 1.234, ownerPid: 1,
    activity: 'Reading files', ...over,
  } as any
}

function fakeSource(records: any[], transcripts: Record<string, any[]> = {}) {
  const listeners: Array<() => void> = []
  const calls = { stop: [] as string[], send: [] as Array<[string, string]>, detach: 0 }
  const s = {
    records, transcripts, calls, listeners,
    foreground: false, stopOutcome: 'stopping', sendOutcome: 'queued',
    list: () => s.records,
    readTranscript: (id: string, from: number) => ({ items: (s.transcripts[id] ?? []).slice(from), next: (s.transcripts[id] ?? []).length }),
    stop: (id: string) => { calls.stop.push(id); return s.stopOutcome },
    send: (id: string, text: string) => { calls.send.push([id, text]); return s.sendOutcome },
    hasForeground: () => s.foreground,
    detachForeground: () => { calls.detach++; return 2 },
    onChange: (l: () => void) => { listeners.push(l); return () => { listeners.splice(listeners.indexOf(l), 1) } },
  }
  return s as any
}

const rowsOf = (records: any[], over: Record<string, unknown> = {}) => vm.buildRows(records, { now: NOW, panel: true, ...over })
const ids = (rows: any[]) => rows.map((r) => r.id)

// ---- view model ----

test('visibilidade: running, done some, failed/cancelled 30 s, dispensado', () => {
  const records = [
    rec('r', null, 1),
    rec('d', null, 1, { state: 'done', endedAt: NOW - 1 }),
    rec('f', null, 1, { state: 'failed', endedAt: NOW - 29_000, error: 'boom', startedAt: NOW - 59_000 }),
    rec('fold', null, 1, { state: 'failed', endedAt: NOW - 30_001 }),
    rec('c', null, 1, { state: 'cancelled', endedAt: NOW - 10, startedAt: NOW - 58_000 }),
  ]
  // Siblings by startedAt ascending (ties fall back to the id).
  assert.deepEqual(ids(rowsOf(records)), ['r', 'f', 'c'])
  assert.deepEqual(ids(rowsOf(records, { dismissed: new Set(['f']) })), ['r', 'c'])
  assert.equal(rowsOf(records, { panel: false }).length, 5, '/tasks não esconde nada')
})

test('visibilidade: netos terminados só com o pai rodando; ancestrais ocultos escondem filhos', () => {
  const records = [
    rec('p', null, 1),
    rec('k-done', 'p', 2, { state: 'done', endedAt: NOW - 5 }),
    rec('k-run', 'p', 2),
    rec('q', null, 1, { state: 'failed', endedAt: NOW - 100 }),
    rec('qk', 'q', 2, { state: 'done', endedAt: NOW - 100 }),
    rec('h', null, 1, { state: 'done', endedAt: NOW - 100 }),
    rec('hk', 'h', 2),
  ]
  assert.deepEqual(ids(rowsOf(records)), ['p', 'k-done', 'k-run', 'q'])
})

test('pai ausente pendura em main; irmãos por startedAt; ciclo não quebra', () => {
  const records = [
    rec('late', null, 1, { startedAt: NOW - 10 }),
    rec('orphan', 'ghost', 2, { startedAt: NOW - 50 }),
    rec('self', 'self', 1, { startedAt: NOW - 70 }),
  ]
  const rows = rowsOf(records)
  assert.deepEqual(ids(rows), ['self', 'orphan', 'late'])
  assert.equal(rows[1].depth, 1)
  assert.equal(rows[1].parentId, null)
  assert.equal(vm.finishedCount([rec('o', 'ghost', 2, { state: 'done', endedAt: NOW - 5 })], NOW), 1)
})

const tree3 = () => [
  rec('a', null, 1, { startedAt: 1 }),
  rec('a1', 'a', 2, { startedAt: 2 }),
  rec('a1x', 'a1', 3, { startedAt: 3 }),
  rec('a1y', 'a1', 3, { startedAt: 4 }),
  rec('a2', 'a', 2, { startedAt: 5 }),
  rec('a2x', 'a2', 3, { startedAt: 6 }),
  rec('b', null, 1, { startedAt: 7 }),
]

test('guias de uma árvore de 3 níveis com irmãos', () => {
  const rows = rowsOf(tree3())
  assert.deepEqual(rows.map((r: any) => [r.id, r.guides]), [
    ['a', ''], ['a1', '├─ '], ['a1x', '│  ├─ '], ['a1y', '│  └─ '], ['a2', '└─ '], ['a2x', '   └─ '], ['b', ''],
  ])
})

test('colapso mostra (+N) e esconde descendentes; N conta visíveis', () => {
  const rows = rowsOf(tree3(), { collapsed: new Set(['a']) })
  assert.deepEqual(ids(rows), ['a', 'b'])
  assert.equal(rows[0].hiddenDescendants, 5)
  assert.equal(rows[0].collapsed, true)
  assert.match(panel.renderRow(rows[0], false, theme, 80), /a-a \(\+5\)/)
  const inner = rowsOf(tree3(), { collapsed: new Set(['a1']) })
  assert.equal(inner.find((r: any) => r.id === 'a1').hiddenDescendants, 2)
  assert.equal(inner.find((r: any) => r.id === 'a').hiddenDescendants, 0)
  // colapsar um nó sem filhos visíveis não marca nada
  assert.equal(rowsOf(tree3(), { collapsed: new Set(['b']) }).at(-1).collapsed, false)
})

test('dica de terminados: só depth 1 done nos últimos 30 s', () => {
  const records = [
    rec('d1', null, 1, { state: 'done', endedAt: NOW - 1000 }),
    rec('d2', null, 1, { state: 'done', endedAt: NOW - 29_999 }),
    rec('old', null, 1, { state: 'done', endedAt: NOW - 30_000 }),
    rec('f', null, 1, { state: 'failed', endedAt: NOW - 1 }),
    rec('deep', 'f', 2, { state: 'done', endedAt: NOW - 1 }),
  ]
  assert.equal(vm.finishedCount(records, NOW), 2)
  const view = { rows: [], focused: false, selectedId: null, hint: '', hintColor: 'muted', running: 0, finished: 2 }
  assert.deepEqual(panel.renderPanel(view, theme, 80), ['✓ 2 finished · /tasks', ''])
  assert.deepEqual(panel.renderPanel({ ...view, finished: 0 }, theme, 80), [])
})

test('newestRootFirst, elapsed e chainOf/neighbours', () => {
  const rows = rowsOf(tree3(), { panel: false, newestRootFirst: true })
  assert.equal(rows[0].id, 'b')
  assert.equal(rows.find((r: any) => r.id === 'a').elapsedMs, NOW - 1)
  const done = rowsOf([rec('z', null, 1, { state: 'failed', endedAt: NOW - 20_000 })])
  assert.equal(done[0].elapsedMs, 40_000)
  assert.deepEqual(vm.chainOf(tree3(), 'a1x').map((r: any) => r.id), ['a', 'a1', 'a1x'])
  const n = vm.neighbours(tree3(), 'a1')
  assert.deepEqual([n.siblings.map((r: any) => r.id), n.children.map((r: any) => r.id), n.parent.id], [['a1', 'a2'], ['a1x', 'a1y'], 'a'])
  assert.deepEqual(vm.neighbours(tree3(), 'nope'), { siblings: [], children: [] })
  assert.equal(vm.runningCount(rows), 7)
})

// ---- render ----

test('largura: nenhuma linha excede o width (20, 40, 80, 160)', () => {
  const records = [
    rec('a', null, 1, { activity: 'x'.repeat(120) }),
    rec('b', 'a', 2, { activity: 'Reading connect_target.rs tests and more', agent: 'gateway-engineer' }),
    rec('c', 'b', 3, { agent: 'a-very-long-agent-name-here', cost: 0.001, tokens: { context: 2_500_000 } }),
    rec('d', null, 1, { state: 'failed', endedAt: NOW - 1, error: 'e'.repeat(200) }),
    rec('e', null, 1, { state: 'cancelled', endedAt: NOW - 1 }),
    rec('g', null, 1, { activity: undefined }),
  ]
  const rows = rowsOf(records, { collapsed: new Set(['d']) })
  for (const width of [20, 40, 80, 160]) {
    for (const selected of [false, true]) {
      for (const row of rows) assert.ok(visibleWidth(panel.renderRow(row, selected, tagTheme, width)) <= width, `${row.id}@${width}`)
    }
    const lines = panel.renderPanel({ rows, focused: true, selectedId: 'b', hint: 'x'.repeat(100), hintColor: 'dim', running: 3, finished: 1 }, tagTheme, width)
    for (const l of lines) assert.ok(visibleWidth(l) <= width, `panel@${width}: ${l}`)
  }
})

test('largura curta descarta custo, depois tokens, depois atividade', () => {
  const row = rowsOf([rec('a', null, 1, { agent: 'agent', activity: 'Reading files' })])[0]
  const full = panel.renderRow(row, false, theme, 80)
  assert.match(full, /Reading files/)
  assert.match(full, /1m 0s \| 114\.4k tok \| {3}\$1\.23$/)
  assert.match(panel.renderRow(row, false, theme, 48), /1m 0s \| 114\.4k tok$/)
  assert.doesNotMatch(panel.renderRow(row, false, theme, 48), /\$/)
  const small = panel.renderRow(row, false, theme, 24)
  assert.match(small, /1m 0s$/)
  assert.doesNotMatch(small, /tok|Reading/)
  assert.equal(panel.formatCost(0.004), '<$0.01')
  assert.equal(panel.formatCost(12), '$12.00')
})

test('estilo por grau: glifo, selo, cores, estado sobrescreve atividade', () => {
  const records = [rec('a', null, 1), rec('b', 'a', 2), rec('c', 'b', 3), rec('d', 'c', 4)]
  const [r1, r2, r3, r4] = rowsOf(records)
  const l1 = panel.renderRow(r1, false, tagTheme, 200)
  const l2 = panel.renderRow(r2, false, tagTheme, 200)
  const l3 = panel.renderRow(r3, false, tagTheme, 200)
  const l4 = panel.renderRow(r4, false, tagTheme, 200)
  assert.ok(l1.includes('<text>○</text>'))
  assert.ok(l1.includes('*<text>a-a</text>*') && l1.includes('<muted>Reading files'))
  assert.ok(l2.includes('<muted>◦</muted>') && l2.includes('<muted>a-b</muted><dim>²</dim>') && l2.includes('<dim>Reading files'))
  assert.ok(l3.includes('<dim>·</dim>') && l3.includes('<dim>a-c</dim><dim>³</dim>'))
  assert.ok(l4.includes('⁴'))
  const sel = panel.renderRow(r1, true, tagTheme, 200)
  assert.ok(sel.startsWith('<accent>❯</accent> ') && sel.includes('<accent>a-a</accent>'), 'column 0: the selection glyph replaces the state glyph, no gutter')
  const fin = (state: string, extra = {}) => panel.renderRow(rowsOf([rec('x', null, 1, { state, endedAt: NOW - 1, ...extra })], { panel: false })[0], false, tagTheme, 200)
  assert.ok(fin('done').includes('<success>✓ done</success>'))
  assert.ok(fin('failed', { error: 'oops' }).includes('<error>✗ oops</error>'))
  assert.ok(fin('failed').includes('<error>✗ failed</error>'))
  assert.ok(fin('cancelled').includes('<warning>■ stopped</warning>'))
  assert.ok(fin('done').includes('<dim>a-x</dim>'))
  assert.equal(panel.superscript(12), '¹²')
})

test('painel: main focado/desfocado, janela de 10 linhas com … N more', () => {
  const records = Array.from({ length: 14 }, (_, i) => rec(`r${i}`, null, 1, { startedAt: i }))
  const rows = rowsOf(records)
  const base = { rows, focused: false, selectedId: null, hint: '14 running · ↓ to manage', hintColor: 'muted', running: 14, finished: 0 }
  const idle = panel.renderPanel(base, theme, 100)
  assert.equal(idle.length, 1 + 10 + 1 + 1)
  assert.match(idle[0], /^● main +14 running · ↓ to manage$/)
  assert.equal(idle.at(-2), '… 4 more')
  assert.equal(idle.at(-1), '')
  const sel = panel.renderPanel({ ...base, focused: true, selectedId: 'r13' }, theme, 100)
  assert.ok(sel.some((l) => l.startsWith('❯ a-r13')))
  assert.ok(!sel.some((l) => l.includes('a-r0 ')))
  assert.match(sel[0], /^○ main/)
  assert.ok(panel.renderPanel({ ...base, focused: true, selectedId: null }, theme, 100)[0].startsWith('❯ main'))
  assert.ok(idle.every((l) => !l.startsWith(' ')), 'panel starts at column 0, aligned with the status line')
  assert.ok(panel.renderPanel(base, theme, 8).every((l) => visibleWidth(l) <= 8))
})

// ---- controller ----

const K = { down: '\x1b[B', up: '\x1b[A', right: '\x1b[C', left: '\x1b[D', enter: '\r', esc: '\x1b', ctrlB: '\x02', tab: '\t', shiftTab: '\x1b[Z', pgUp: '\x1b[5~', pgDn: '\x1b[6~', home: '\x1b[H', end: '\x1b[F', bs: '\x7f' }
const OK = { editorText: '', editorFocused: true, overlayOpen: false }

function controllerOf(records: any[]) {
  const src = fakeSource(records)
  const clock = { now: NOW }
  const c = new panel.PanelController({ getSource: () => src, now: () => clock.now })
  return { c, src, clock }
}

test('controller: ativa só com editor vazio, editor focado e linhas; release ignorado', () => {
  const { c } = controllerOf([rec('a', null, 1), rec('b', 'a', 2)])
  assert.deepEqual(c.handleKey(K.down, { ...OK, editorText: 'hi' }), { consume: false })
  assert.equal(c.focused, false)
  assert.deepEqual(c.handleKey('\x1b[1;1:3B', OK), { consume: false }, 'release')
  assert.equal(c.focused, false)
  assert.deepEqual(c.handleKey('a', OK), { consume: false })
  assert.deepEqual(c.handleKey(K.down, { ...OK, editorFocused: false }), { consume: false })
  assert.equal(c.focused, false)
  assert.deepEqual(c.handleKey(K.down, OK), { consume: true })
  assert.equal(c.focused, true)
  assert.equal(c.selectedId, 'a')
  const empty = controllerOf([])
  assert.deepEqual(empty.c.handleKey(K.down, OK), { consume: false })
  const noSource = new panel.PanelController({ getSource: () => undefined, now: () => NOW })
  assert.deepEqual(noSource.rows(), [])
  assert.equal(noSource.view().finished, 0)
  assert.deepEqual(noSource.handleKey(K.ctrlB, OK), { consume: false })
})

test('controller: overlay e foco alheio desfocam sem consumir', () => {
  const { c } = controllerOf([rec('a', null, 1)])
  c.handleKey(K.down, OK)
  assert.equal(c.focused, true)
  assert.deepEqual(c.handleKey(K.down, { ...OK, overlayOpen: true }), { consume: false })
  assert.equal(c.focused, false)
  c.handleKey(K.down, OK)
  assert.deepEqual(c.handleKey(K.down, { ...OK, editorFocused: false }), { consume: false })
  assert.equal(c.focused, false)
})

test('controller: navegação, enter, esc, ↑ no main', () => {
  const { c } = controllerOf([rec('a', null, 1), rec('b', 'a', 2), rec('z', null, 1, { startedAt: NOW })])
  c.handleKey(K.down, OK)
  c.handleKey(K.down, OK)
  assert.equal(c.selectedId, 'b')
  assert.deepEqual(c.handleKey(K.enter, OK), { consume: true, action: { type: 'open', id: 'b' } })
  c.handleKey(K.down, OK)
  c.handleKey(K.down, OK)
  assert.equal(c.selectedId, 'z', 'down limitado ao fim')
  c.handleKey(K.up, OK)
  c.handleKey(K.up, OK)
  c.handleKey(K.up, OK)
  assert.equal(c.selectedId, null)
  assert.deepEqual(c.handleKey(K.enter, OK), { consume: true })
  assert.equal(c.focused, false, 'enter no main volta ao prompt')
  c.handleKey(K.down, OK)
  c.handleKey(K.up, OK)
  assert.equal(c.selectedId, null)
  assert.deepEqual(c.handleKey(K.up, OK), { consume: true })
  assert.equal(c.focused, false, '↑ acima do topo')
  c.handleKey(K.down, OK)
  assert.deepEqual(c.handleKey(K.esc, OK), { consume: true })
  assert.equal(c.focused, false)
})

test('controller: → e ← expandem, recolhem e sobem ao pai', () => {
  const { c } = controllerOf(tree3())
  c.handleKey(K.down, OK) // a
  c.handleKey(K.left, OK) // recolhe
  assert.ok(c.collapsed.has('a'))
  assert.deepEqual(ids(c.rows()), ['a', 'b'])
  c.handleKey(K.right, OK) // expande
  assert.ok(!c.collapsed.has('a'))
  c.handleKey(K.right, OK) // já expandido: vai ao primeiro filho
  assert.equal(c.selectedId, 'a1')
  c.handleKey(K.right, OK)
  assert.equal(c.selectedId, 'a1x')
  c.handleKey(K.right, OK) // sem filhos: fica
  assert.equal(c.selectedId, 'a1x')
  c.handleKey(K.left, OK)
  assert.equal(c.selectedId, 'a1')
  c.handleKey(K.left, OK) // recolhe a1
  c.handleKey(K.left, OK) // a1 recolhido: sobe
  assert.equal(c.selectedId, 'a')
  c.handleKey(K.left, OK)
  c.handleKey(K.left, OK)
  assert.equal(c.selectedId, null, 'depth 1 sem filhos visíveis sobe ao main')
})

test('controller: x x para (arma por 2 s), expira, e dispensa terminado', () => {
  const { c, clock } = controllerOf([rec('a', null, 1), rec('f', null, 1, { state: 'failed', endedAt: NOW - 1, startedAt: NOW - 5 })])
  c.handleKey(K.down, OK)
  assert.deepEqual(c.handleKey('x', OK), { consume: true })
  assert.match(c.view().hint, /^press x again to stop a-a$/)
  clock.now += 1999
  assert.deepEqual(c.handleKey('x', OK), { consume: true, action: { type: 'stop', id: 'a' } })
  assert.match(c.view().hint, /↑↓ select/, 'desarma depois do stop')
  // expiração
  c.handleKey('x', OK)
  clock.now += 2500
  assert.doesNotMatch(c.view().hint, /press x again/)
  assert.deepEqual(c.handleKey('x', OK), { consume: true }, 'rearma, não para')
  // mover a seleção desarma
  c.handleKey(K.down, OK)
  assert.equal(c.selectedId, 'f')
  assert.deepEqual(c.handleKey('x', OK), { consume: true, action: { type: 'dismiss', id: 'f' } })
  assert.ok(c.dismissed.has('f'))
  assert.equal(c.selectedId, 'a', 'seleção reparada para a linha restante')
  // x no main cai em "outra tecla"
  c.handleKey(K.up, OK)
  assert.deepEqual(c.handleKey('x', OK), { consume: false })
  assert.equal(c.focused, false)
})

test('controller: ctrl+b com e sem chamada em primeiro plano, em qualquer foco', () => {
  const { c, src } = controllerOf([rec('a', null, 1)])
  assert.deepEqual(c.handleKey(K.ctrlB, OK), { consume: false })
  src.foreground = true
  assert.deepEqual(c.handleKey(K.ctrlB, OK), { consume: true, action: { type: 'detach' } })
  c.handleKey(K.down, OK)
  assert.deepEqual(c.handleKey(K.ctrlB, OK), { consume: true, action: { type: 'detach' } })
})

test('controller: tecla imprimível desfoca sem consumir; linha que some é reparada', () => {
  const { c, src } = controllerOf([rec('a', null, 1), rec('b', null, 1, { startedAt: NOW - 1 }), rec('c', null, 1, { startedAt: NOW })])
  c.handleKey(K.down, OK)
  assert.deepEqual(c.handleKey('h', OK), { consume: false })
  assert.equal(c.focused, false)
  c.handleKey(K.down, OK)
  c.handleKey(K.down, OK)
  assert.equal(c.selectedId, 'b')
  src.records = [src.records[0], src.records[2]] // b some
  assert.deepEqual(c.handleKey(K.down, OK), { consume: true })
  assert.equal(c.selectedId, 'c')
  src.records = []
  c.view()
  assert.equal(c.focused, false, 'sem linhas: desfoca')
  assert.equal(c.view().rows.length, 0)
})

test('executeAction: abrir, detach, stop com cada desfecho', () => {
  const src = fakeSource([rec('a', null, 1)])
  const notes: Array<[string, string?]> = []
  const opened: string[] = []
  const env = { source: src, notify: (m: string, t?: string) => notes.push([m, t]), open: (id: string) => opened.push(id) }
  panel.executeAction({ type: 'open', id: 'a' }, env)
  panel.executeAction({ type: 'detach' }, env)
  panel.executeAction({ type: 'stop', id: 'a' }, env)
  src.stopOutcome = 'not-running'
  panel.executeAction({ type: 'stop', id: 'a' }, env)
  src.stopOutcome = 'refused'
  panel.executeAction({ type: 'stop', id: 'a' }, env)
  src.stopOutcome = 'unknown'
  panel.executeAction({ type: 'stop', id: 'gone' }, env)
  panel.executeAction({ type: 'dismiss', id: 'a' }, env)
  src.detachForeground = () => 0
  panel.executeAction({ type: 'detach' }, env)
  assert.deepEqual(opened, ['a'])
  assert.equal(notes[0][0], 'Moved 2 subagent call(s) to the background')
  assert.equal(notes[1][0], 'Stopping a-a…')
  assert.match(notes[2][0], /not running/)
  assert.match(notes[3][0], /Could not stop/)
  assert.match(notes[4][0], /gone: run not found/)
  assert.equal(notes.length, 5)
})

// ---- viewer ----

test('formatadores do viewer: itens do transcript', () => {
  const f = (item: any, w = 40) => viewer.formatItem({ t: 0, ...item }, tagTheme, w)
  assert.deepEqual(f({ kind: 'user', text: 'oi' }), ['<accent>› oi</accent>'])
  assert.deepEqual(f({ kind: 'tool_call', text: 'bash   ls\n-la' }), ['<muted>⏺ bash ls -la</muted>'])
  assert.deepEqual(f({ kind: 'note', text: 'n' }), ['<dim>n</dim>'])
  assert.deepEqual(f({ kind: 'assistant', text: '' }), ['<text></text>'])
  const wrapped = f({ kind: 'assistant', text: 'word '.repeat(20) })
  assert.ok(wrapped.length > 1 && wrapped.every((l: string) => visibleWidth(l) <= 40))
  assert.deepEqual(f({ kind: 'tool_result', text: 'a\nb\nc\nd\ne' }), ['<dim>  ⎿ a</dim>', '<dim>    b</dim>', '<dim>    c</dim>', '<dim>  … 2 more lines</dim>'])
  assert.deepEqual(f({ kind: 'tool_result', text: 'bad', isError: true }), ['<error>  ⎿ bad</error>'])
  assert.ok(f({ kind: 'tool_result', text: 'x'.repeat(200) }, 20).every((l: string) => visibleWidth(l) <= 20))
})

test('formatadores do viewer: desfechos de envio, estado, breadcrumb e navegação', () => {
  assert.equal(viewer.sendOutcomeText('queued'), '↪ sent; the agent reads it after its current tool step')
  assert.equal(viewer.sendOutcomeText('resumed'), '↪ resumed with your message')
  assert.equal(viewer.sendOutcomeText('not-running'), 'run finished; message not sent')
  assert.equal(viewer.sendOutcomeText('unknown'), 'run not found')
  assert.deepEqual(['running', 'done', 'failed', 'cancelled'].map(viewer.stateLabel), ['● running', '✓ done', '✗ failed', '■ stopped'])
  assert.equal(viewer.breadcrumb(tree3(), 'a1x'), 'main › a-a › a-a1² › a-a1x³')
  assert.equal(viewer.breadcrumb(tree3(), 'a'), 'main › a-a')
  assert.equal(viewer.navBar(tree3(), 'a1'), 'siblings: [a-a1] a-a2   children: a-a1x a-a1y')
  assert.equal(viewer.navBar(tree3(), 'a1x'), 'siblings: [a-a1x] a-a1y   children: -')
})

function viewerOf(records: any[], transcripts: Record<string, any[]> = {}, rows = 20) {
  const src = fakeSource(records, transcripts)
  const clock = { now: NOW }
  const state = { closed: 0, renders: 0 }
  const v = new viewer.ViewerComponent({ source: src, theme, id: records[0].id, done: () => state.closed++, requestRender: () => state.renders++, rows: () => rows, now: () => clock.now, poll: false })
  return { v, src, clock, state }
}
const item = (kind: string, text: string, extra = {}) => ({ t: 0, kind, text, ...extra })

test('viewer: render com cabeçalho, nav, corpo, input e rodapé; largura respeitada', () => {
  const { v, src } = viewerOf(tree3(), { a: [item('user', 'faça'), item('assistant', 'ok'), item('tool_call', 'bash ls'), item('tool_result', '1\n2')] })
  const lines = v.render(60)
  assert.equal(lines[0], '─'.repeat(60), 'régua no topo do overlay')
  assert.equal(lines[1], 'main › a-a')
  assert.match(lines[2], /^● running · 16m 40s · 114\.4k tok · \$1\.23$/)
  assert.match(lines[3], /^siblings: \[a-a\] a-b {3}children: a-a1 a-a2$/)
  assert.ok(lines.includes('› faça') && lines.includes('⏺ bash ls') && lines.includes('  ⎿ 1'))
  assert.ok(lines.at(-1).startsWith('↑↓ scroll'))
  assert.ok(lines.every((l: string) => visibleWidth(l) <= 60))
  assert.equal(lines.at(-2), '> ')
  src.records = []
  assert.match(v.render(60)[1], /run not found/)
})

test('viewer: leitura incremental, teto de 2000 itens e auto-follow / rolagem', () => {
  const many = Array.from({ length: 2100 }, (_, i) => item('note', `n${i}`))
  const { v, src } = viewerOf([rec('a', null, 1)], { a: many })
  assert.equal(v.items.length, 2000)
  assert.equal(v.items[0].text, 'n100')
  const bottom = v.render(80)
  assert.ok(bottom.includes('n2099') && !bottom.includes('n100'))
  v.handleInput(K.up)
  v.handleInput(K.up)
  assert.ok(!v.render(80).includes('n2099'), 'rolou para cima: não segue')
  src.transcripts.a.push(item('note', 'novo'))
  v.refresh()
  assert.ok(!v.render(80).includes('novo'), 'sem auto-follow enquanto rolado')
  v.handleInput(K.end)
  assert.ok(v.render(80).includes('novo'))
  v.handleInput(K.pgUp)
  v.handleInput(K.home)
  assert.ok(v.render(80).includes('n101'))
  v.handleInput(K.pgDn)
  v.handleInput(K.down)
  v.invalidate()
  assert.ok(v.render(40).length > 0)
})

test('viewer: ←/→ irmãos, tab filho, ⇧tab pai (depth 1 fecha), esc', () => {
  const { v, state } = viewerOf(tree3())
  v.handleInput(K.right)
  assert.equal(v.id, 'b')
  v.handleInput(K.right)
  assert.equal(v.id, 'b', 'último irmão')
  v.handleInput(K.left)
  assert.equal(v.id, 'a')
  v.handleInput(K.tab)
  assert.equal(v.id, 'a1')
  v.handleInput(K.tab)
  assert.equal(v.id, 'a1x')
  v.handleInput(K.tab)
  assert.equal(v.id, 'a1x', 'sem filhos')
  v.handleInput(K.shiftTab)
  assert.equal(v.id, 'a1')
  v.handleInput(K.shiftTab)
  v.handleInput(K.shiftTab)
  assert.equal(state.closed, 1, 'depth 1 fecha')
  v.handleInput(K.esc)
  assert.equal(state.closed, 2)
})

test('viewer: input, backspace, esc limpa antes de fechar, enter envia e mostra o desfecho', () => {
  const { v, src, state } = viewerOf([rec('a', null, 1)])
  for (const ch of 'olá') v.handleInput(ch)
  v.handleInput(K.bs)
  assert.equal(v.input, 'ol')
  v.handleInput(K.left) // com texto, ←/→ não trocam de irmão
  v.handleInput('x') // com texto, x é caractere
  assert.equal(v.input, 'olx')
  v.handleInput(K.esc)
  assert.equal(v.input, '')
  assert.equal(state.closed, 0)
  v.handleInput('\x1b[120;1:3u') // release
  v.handleInput('\x01') // controle não vira texto
  assert.equal(v.input, '')
  v.handleInput('   ')
  v.handleInput(K.enter)
  assert.deepEqual(src.calls.send, [], 'só espaços não envia')
  v.handleInput('pare')
  v.handleInput(K.enter)
  assert.deepEqual(src.calls.send, [['a', 'pare']])
  assert.equal(v.input, '')
  assert.match(v.render(100).at(-3), /^↪ sent; the agent reads it/)
  for (const [out, text] of [['resumed', '↪ resumed with your message'], ['not-running', 'run finished; message not sent'], ['unknown', 'run not found']]) {
    src.sendOutcome = out
    v.handleInput('m')
    v.handleInput(K.enter)
    assert.equal(v.render(100).at(-3), text)
  }
})

test('viewer: x x para em 2 s; expira; terminado é somente leitura', () => {
  const { v, src, clock } = viewerOf([rec('a', null, 1)])
  v.handleInput('x')
  assert.match(v.outcome, /press x again to stop a-a/)
  clock.now += 2001
  v.handleInput('x')
  assert.deepEqual(src.calls.stop, [])
  clock.now += 100
  v.handleInput('x')
  assert.deepEqual(src.calls.stop, ['a'])
  assert.equal(v.outcome, 'Stopping a-a…')
  const done = viewerOf([rec('d', null, 1, { state: 'done', endedAt: NOW })])
  assert.equal(done.v.render(100).at(-3), 'read-only: run finished')
  done.v.handleInput('x')
  assert.match(done.v.outcome, /nothing to stop/)
  const bg = viewerOf([rec('bg', null, 1, { state: 'done', endedAt: NOW, background: true })])
  assert.equal(bg.v.render(100).at(-3), '')
  const gone = viewerOf([rec('g', null, 1)])
  gone.src.records = []
  gone.v.handleInput('x')
  assert.equal(gone.v.outcome, 'run not found')
})

test('viewer: com poll liga timer e onChange, dispose solta', () => {
  const src = fakeSource([rec('a', null, 1)], { a: [item('note', 'um')] })
  const v = new viewer.ViewerComponent({ source: src, theme, id: 'a', done() {}, requestRender() {}, rows: () => 20, now: () => NOW })
  assert.equal(src.listeners.length, 1)
  src.transcripts.a.push(item('note', 'dois'))
  src.listeners[0]()
  assert.equal(v.items.length, 2)
  v.dispose()
  assert.equal(src.listeners.length, 0)
  v.dispose()
})

// ---- /tasks ----

function fakeCtx(results: any[]) {
  const calls: any[] = []
  const notes: Array<[string, string?]> = []
  const comps: any[] = []
  const ctx = {
    hasUI: true,
    ui: {
      notify: (m: string, t?: string) => notes.push([m, t]),
      custom: async (factory: any, options: any) => {
        calls.push(options)
        const tui = { requestRender() {}, terminal: { rows: 30 } }
        let finish: (v: any) => void = () => {}
        const p = new Promise((r) => (finish = r))
        const comp = factory(tui, theme, {}, finish)
        comps.push(comp)
        comp.render(80)
        const next = results.shift()
        if (next) next(comp)
        const out = await p
        comp.dispose?.()
        return out
      },
    },
  }
  return { ctx: ctx as any, calls, notes, comps }
}

test('/tasks: sem runs avisa; lista todos (sem esconder), enter abre o viewer e volta à lista', async () => {
  const empty = fakeCtx([])
  await viewer.openTasksBrowser(empty.ctx, fakeSource([]))
  assert.deepEqual(empty.notes, [['No subagent runs in this session.', 'info']])

  const records = [rec('a', null, 1, { startedAt: 1 }), rec('d', null, 1, { state: 'done', endedAt: NOW, startedAt: 2 })]
  const src = fakeSource(records)
  const { ctx, calls, comps } = fakeCtx([
    (c: any) => { // lista: desce e abre
      const lines = c.render(80)
      assert.equal(lines[0].replace(/\x1b\[[0-9;]*m/g, ''), '─'.repeat(80), 'régua no topo do overlay (HUD-colored)')
      assert.match(lines[1], /Subagent runs \(2\)/)
      assert.match(lines[2], /a-d/, 'raiz mais nova primeiro')
      c.handleInput('\x1b[1;1:3B')
      c.handleInput(K.down)
      c.handleInput(K.down)
      c.handleInput(K.up)
      c.handleInput(K.enter)
    },
    (c: any) => c.handleInput(K.esc), // viewer fecha
    (c: any) => c.handleInput(K.esc), // lista fecha
  ])
  await viewer.openTasksBrowser(ctx, src)
  assert.equal(comps.length, 3)
  assert.equal(comps[1].id, 'd')
  assert.deepEqual(calls[0], { overlay: true, overlayOptions: { anchor: 'bottom-center', width: '100%', maxHeight: '85%', margin: 0 } })
  assert.equal(viewer.overlays.open, 0)
})

test('TasksComponent: seleção limitada e timers soltos no dispose', () => {
  const src = fakeSource([rec('a', null, 1), rec('b', null, 1, { startedAt: NOW })])
  let picked: any = 'unset'
  const t = new viewer.TasksComponent({ source: src, theme, done: (id: any) => (picked = id), requestRender() {}, rows: () => 20, now: () => NOW })
  assert.equal(src.listeners.length, 1)
  t.handleInput(K.up)
  t.handleInput(K.enter)
  assert.equal(picked, 'b')
  t.handleInput(K.down)
  t.handleInput(K.down)
  t.handleInput(K.enter)
  assert.equal(picked, 'a')
  t.handleInput(K.esc)
  assert.equal(picked, undefined)
  t.invalidate()
  t.dispose()
  assert.equal(src.listeners.length, 0)
  const big = new viewer.TasksComponent({ source: fakeSource(Array.from({ length: 40 }, (_, i) => rec(`r${i}`, null, 1))), theme, done() {}, requestRender() {}, rows: () => 20, now: () => NOW, selectedId: 'r5', poll: false })
  assert.ok(big.render(60).every((l: string) => visibleWidth(l) <= 60))
})

// ---- index ----

function fakePi() {
  const handlers: Record<string, Function> = {}
  return { handlers, pi: { on: (e: string, h: Function) => { handlers[e] = h } } as any }
}

function fakeUi(over: Record<string, unknown> = {}) {
  const rec2: any = { widgets: [] as any[], inputs: [] as any[], notes: [] as any[], editorText: '' }
  const tui = { requestRender: () => { rec2.renders = (rec2.renders ?? 0) + 1 }, focusedComponent: undefined as any, terminal: { rows: 30 } }
  const ctx = {
    hasUI: true,
    ui: {
      setWidget: (key: string, content: any, options: any) => rec2.widgets.push({ key, content, options }),
      onTerminalInput: (h: any) => { rec2.inputs.push(h); return () => rec2.inputs.splice(rec2.inputs.indexOf(h), 1) },
      getEditorText: () => rec2.editorText,
      notify: (m: string, t: string) => rec2.notes.push([m, t]),
      custom: async () => undefined,
    },
    ...over,
  }
  return { ctx: ctx as any, rec: rec2, tui }
}

test('registerFleetUi: widget abaixo do editor, teclas, sem UI/filho não registra, shutdown limpa', async () => {
  const src = fakeSource([rec('a', null, 1)])
  const { pi, handlers } = fakePi()
  let source: any = undefined
  const api = fleetUi.registerFleetUi(pi, () => source)
  const { ctx, rec: r, tui } = fakeUi()

  // sem UI e em processo filho: nada
  await handlers.session_start({}, { ...ctx, hasUI: false })
  process.env.PI_CODE_SUBAGENT = '1'
  await handlers.session_start({}, ctx)
  delete process.env.PI_CODE_SUBAGENT
  assert.equal(r.widgets.length, 0)

  await handlers.session_start({}, ctx)
  assert.equal(r.widgets[0].key, 'pi-code-fleet')
  assert.deepEqual(r.widgets[0].options, { placement: 'belowEditor' })
  const comp = r.widgets[0].content(tui, theme)
  assert.deepEqual(comp.render(80), [], 'sem source: nada')
  comp.invalidate()

  source = src // aparece depois
  assert.equal(comp.render(80).length, 3, 'main + row + blank gap')
  assert.equal(r.inputs.length, 1)
  assert.equal(r.inputs[0]('a'), undefined)
  assert.deepEqual(r.inputs[0](K.down), { consume: true })
  assert.ok(r.renders > 0)
  tui.focusedComponent = { render() {} } // diálogo: não é o editor
  assert.equal(r.inputs[0](K.down), undefined)
  tui.focusedComponent = { getText() {}, setText() {} }
  r.inputs[0](K.down) // refoca
  src.foreground = true
  r.inputs[0](K.ctrlB)
  assert.deepEqual(r.notes.at(-1), ['Moved 2 subagent call(s) to the background', 'info'])
  r.editorText = ''
  r.inputs[0](K.enter) // open → ctx.ui.custom
  await new Promise((res) => setTimeout(res, 0)) // o overlay (flag) fecha
  r.inputs[0](K.esc)
  src.records.push(rec('f', null, 1, { startedAt: NOW + 1 }))
  r.inputs[0](K.down)
  r.inputs[0](K.down)
  r.inputs[0]('x')
  r.inputs[0]('x')
  assert.deepEqual(src.calls.stop, ['f'])

  await handlers.session_shutdown()
  assert.equal(r.inputs.length, 0)
  assert.deepEqual(r.widgets.at(-1), { key: 'pi-code-fleet', content: undefined, options: undefined })
  await handlers.session_shutdown() // idempotente

  const { ctx: c2, rec: r2 } = fakeUi()
  await api.openTasks({ ...c2, hasUI: false })
  assert.deepEqual(r2.notes, [])
  await api.openTasks(c2)
  assert.deepEqual(r2.notes, [])
  source = undefined
  await api.openTasks(c2)
  assert.deepEqual(r2.notes, [['No subagent runs in this session.', 'info']])
})

test('registerFleetUi: o tick de 1 s assina um source que só aparece depois do session_start e repinta quando há linhas', async () => {
  mock.timers.enable({ apis: ['setInterval'] })
  const { pi, handlers } = fakePi()
  const src = fakeSource([])
  let source: any = undefined
  fleetUi.registerFleetUi(pi, () => source)
  const { ctx, rec: r, tui } = fakeUi()
  try {
    await handlers.session_start({}, ctx)
    r.widgets[0].content(tui, theme) // guarda o tui que o render usa
    source = src
    assert.equal(src.listeners.length, 0, 'ainda não assinou')
    mock.timers.tick(1000)
    assert.equal(src.listeners.length, 1, 'o tick assinou o source tardio')
    assert.equal(r.renders ?? 0, 0, 'sem linhas o tick não repinta')
    src.listeners[0]()
    assert.equal(r.renders, 1, 'a mudança do source repinta pela assinatura do tick')
    src.records.push(rec('a', null, 1))
    mock.timers.tick(1000)
    assert.equal(r.renders, 2, 'com linhas o tick repinta')
    assert.equal(src.listeners.length, 1, 'o mesmo source não é assinado de novo')
  } finally {
    await handlers.session_shutdown()
    mock.timers.reset()
  }
  assert.equal(src.listeners.length, 0)
})

test('registerFleetUi: o main desenha estado, tempo, contexto e custo da sessão (só visual)', async () => {
  const { pi, handlers } = fakePi()
  const src = fakeSource([rec('a', null, 1)])
  fleetUi.registerFleetUi(pi, () => src)
  const branch = [
    { type: 'message', message: { role: 'user' } },
    { type: 'message', message: { role: 'assistant', usage: { cost: { total: 1.5 } } } },
    { type: 'message', message: { role: 'assistant', usage: { cost: { total: 0.25 } } } },
  ]
  const { ctx, rec: r, tui } = fakeUi({ sessionManager: { getBranch: () => branch }, getContextUsage: () => ({ tokens: 163_000 }) })
  const lines = (): string => r.widgets[0].content(tui, theme).render(120)[0].replace(/\x1b\[[0-9;]*m/g, '')
  await handlers.session_start({}, ctx)
  assert.match(lines(), /main idle/)
  assert.match(lines(), /163\.0k tok \| +\$1\.75$/)
  assert.doesNotMatch(lines(), /\dm \d+s \|/, 'ocioso: sem tempo de execução')
  handlers.agent_start()
  assert.match(lines(), /thinking…/)
  assert.match(lines(), /\d+s \| +163\.0k tok/)
  handlers.tool_execution_start()
  assert.match(lines(), /working/)
  handlers.turn_start()
  assert.match(lines(), /thinking…/, 'novo turno volta a pensar')
  branch.push({ type: 'message', message: { role: 'assistant', usage: { cost: { total: 0.5 } } } })
  await handlers.turn_end({}, ctx)
  assert.match(lines(), /\$2\.25$/)
  await handlers.agent_settled({}, ctx)
  assert.match(lines(), /main idle/)
  const { ctx: bare } = fakeUi()
  await handlers.session_start({}, bare)
  assert.doesNotMatch(r.widgets[0].content(tui, theme).render(120)[0].replace(/\x1b\[[0-9;]*m/g, ''), /tok/, 'sem fonte de contexto/custo a coluna some em branco')
})

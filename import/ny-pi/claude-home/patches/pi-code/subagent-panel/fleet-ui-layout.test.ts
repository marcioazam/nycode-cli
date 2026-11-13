// Testes de layout, paleta e larguras do painel da frota: node --experimental-strip-types --test ~/.pi/agent/claude-home/patches/pi-code/subagent-panel/fleet-ui-layout.test.ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fleetTestEnv } from './setup.ts'

const { ext } = fleetTestEnv('fleet-ui-layout-test-')

const vm = await import(`${ext}/subagent/fleet-ui/view-model.ts`)
const panel = await import(`${ext}/subagent/fleet-ui/panel.ts`)
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

function controllerOf(records: any[]) {
  const src = fakeSource(records)
  const clock = { now: NOW }
  const c = new panel.PanelController({ getSource: () => src, now: () => clock.now })
  return { c, src, clock }
}

// ---- agent panel SOTA (record 2026-11-13) ----

const NOCOLOR_ENV = ['NO_COLOR', 'PI_REDUCED_MOTION'] as const
function withEnv<T>(env: Record<string, string | undefined>, fn: () => T): T {
  const saved = Object.fromEntries(NOCOLOR_ENV.map((k) => [k, process.env[k]]))
  for (const k of NOCOLOR_ENV) delete process.env[k]
  for (const [k, v] of Object.entries(env)) if (v !== undefined) process.env[k] = v
  try {
    return fn()
  } finally {
    for (const k of NOCOLOR_ENV) saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k])
  }
}
const viewOf = (rows: any[], over: Record<string, unknown> = {}) => ({ rows, focused: false, selectedId: null, hint: '2 running · ↓ to manage', hintColor: 'muted', running: 2, finished: 0, ...over })

test('gap: one blank line closes a non-empty panel, none when empty', () => {
  const rows = rowsOf([rec('a', null, 1), rec('b', null, 1, { startedAt: NOW - 1 })])
  const lines = panel.renderPanel(viewOf(rows), theme, 80)
  assert.equal(lines.at(-1), '')
  assert.notEqual(lines.at(-2), '')
  assert.deepEqual(panel.renderPanel(viewOf([], { finished: 0 }), theme, 80), [])
})

test('task label: first line, collapsed, truncated; #n for repeated types in start order', () => {
  const rows = rowsOf([
    rec('a', null, 1, { agent: 'general-purpose', task: 'Fix the\n  parser   bug', startedAt: 10 }),
    rec('b', null, 1, { agent: 'general-purpose', task: 'Write docs', startedAt: 5 }),
    rec('c', null, 1, { agent: 'Explore', task: 'x'.repeat(300), startedAt: 7 }),
  ])
  const byId = Object.fromEntries(rows.map((r: any) => [r.id, r]))
  assert.deepEqual([byId.b.nth, byId.a.nth, byId.c.nth], [1, 2, 0])
  const la = panel.renderRow(byId.a, false, tagTheme, 300)
  assert.ok(la.includes('<text>general-purpose</text>') && la.includes('<dim>#2</dim>'), la)
  assert.ok(la.includes('<task>Fix the</task>'), la)
  assert.ok(la.indexOf('<task>') < la.indexOf('<muted>Reading files'), 'task before activity')
  assert.ok(panel.renderRow(byId.b, false, tagTheme, 300).includes('#1'))
  assert.ok(!panel.renderRow(byId.c, false, tagTheme, 300).includes('#'))
  const narrow = panel.renderRow(byId.c, false, theme, 60)
  assert.ok(narrow.includes('…') && visibleWidth(narrow) <= 60)
  assert.equal(vm.buildRows([rec('s', null, 1, { agent: 'one' })], { now: NOW, panel: true })[0].nth, 0)
})

test('stats columns have fixed widths so values do not shift', () => {
  const rows = rowsOf([
    rec('a', null, 1, { startedAt: NOW - 5_000, tokens: { context: 900 }, cost: 0.004 }),
    rec('b', null, 1, { startedAt: NOW - 3_725_000, tokens: { context: 2_500_000 }, cost: 123.4 }),
  ])
  const re = /(.{7}) \| (.{10}) \| (.{7})$/
  const cols = rows.map((r: any) => re.exec(panel.renderRow(r, false, theme, 100)))
  assert.ok(cols.every(Boolean))
  assert.ok(cols.every((m: any) => m[0].length === cols[0][0].length))
  for (const r of rows) assert.equal(visibleWidth(panel.renderRow(r, false, theme, 100)), 100)
})

test('spinner: time-driven frame for running rows, static under NO_COLOR or reduced motion', () => {
  const [row] = rowsOf([rec('a', null, 1)])
  const spin = (f: number) => panel.renderRow(row, false, tagTheme, 300, f)
  assert.ok(spin(0).includes(palette.SPINNER[0]) && spin(3).includes(palette.SPINNER[3]))
  assert.ok(panel.renderRow(row, false, tagTheme, 300).includes('<text>○</text>'), 'no frame: static glyph')
  const done = rowsOf([rec('d', null, 1, { state: 'failed', endedAt: NOW - 1 })], { panel: false })[0]
  assert.ok(!panel.renderRow(done, false, tagTheme, 300, 2).includes(palette.SPINNER[2]), 'finished rows never spin')
  assert.equal(palette.spinnerAt(0), 0)
  assert.notEqual(palette.spinnerAt(0), palette.spinnerAt(palette.SPINNER_MS))
  const view = () => controllerOf([rec('a', null, 1)]).c.view().frame
  assert.equal(typeof withEnv({}, view), 'number')
  assert.equal(withEnv({ PI_REDUCED_MOTION: '1' }, view), undefined)
  assert.equal(withEnv({ NO_COLOR: '1' }, view), undefined)
})

test('hint: stays on the main row when it fits, else gets its own dim line under main', () => {
  const rows = rowsOf([rec('a', null, 1)])
  const idle = panel.renderPanel(viewOf(rows, { running: 1 }), theme, 80)
  assert.match(idle[0], /main +2 running/)
  // Spec 2026-11-13 (main como raiz): a dica curta fica na linha do main também com foco; antes o foco sempre a descia.
  const hint = '↑↓ select · enter open'
  const fit = panel.renderPanel(viewOf(rows, { focused: true, selectedId: 'a', hint, hintColor: 'dim' }), tagTheme, 80)
  assert.ok(fit[0].includes(hint) && fit[1].includes('a-a'))
  const long = '↑↓ select · enter open · →← fold · x stop · esc back · ' + 'z'.repeat(40)
  const f = panel.renderPanel(viewOf(rows, { focused: true, selectedId: 'a', hint: long, hintColor: 'dim' }), tagTheme, 80)
  assert.ok(!f[0].includes('select') && f[0].includes('main'))
  assert.ok(f[1].includes('<dim>') && f[1].includes('↑↓ select'))
  assert.ok(f[2].includes('a-a'))
})

// ---- main como raiz da árvore (2026-11-13) ----
const MAIN = { state: 'thinking', elapsedMs: 102_000, contextTokens: 163_000, cost: 8.79 }
const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '')
const treeRecords = () => [
  rec('a', null, 1, { startedAt: 1 }),
  rec('a1', 'a', 2, { startedAt: 2 }),
  rec('b', null, 1, { startedAt: 3 }),
]

test('main root: depth-1 rows hang from main with ├─/└─, deeper levels carry │ or blanks', () => {
  const rows = rowsOf(treeRecords(), { mainRoot: true })
  assert.deepEqual(rows.map((r: any) => [r.id, r.guides]), [['a', '├─ '], ['a1', '│  └─ '], ['b', '└─ ']])
  assert.deepEqual(rowsOf(treeRecords()).map((r: any) => r.guides), ['', '└─ ', ''], 'sem mainRoot (/tasks) nada muda')
  const solo = rowsOf([rec('a', null, 1), rec('a1', 'a', 2)], { mainRoot: true })
  assert.deepEqual(solo.map((r: any) => r.guides), ['└─ ', '   └─ '])
  const folded = rowsOf(treeRecords(), { mainRoot: true, collapsed: new Set(['a']) })
  assert.deepEqual(folded.map((r: any) => [r.id, r.guides, r.hiddenDescendants]), [['a', '├─ ', 1], ['b', '└─ ', 0]])
})

test('main row: state left, stats columns line up with the agent rows at widths 60, 100, 160', () => {
  const rows = rowsOf(treeRecords(), { mainRoot: true })
  for (const width of [60, 100, 160]) {
    const lines = panel.renderPanel(viewOf(rows, { main: MAIN }), theme, width)
    for (const l of lines) assert.ok(visibleWidth(l) <= width, `@${width}: ${l}`)
    assert.ok(lines[0].includes('● main') && lines[0].includes('thinking…'), lines[0])
    assert.match(lines[0], /1m 42s \| 163.0k tok \| +\$8\.79$/)
    // as barras separadoras caem nas mesmas colunas do main e de cada agente
    const bars = (l: string) => [...l].flatMap((c, i) => (c === '|' ? [i] : []))
    if (width < 100) continue // estreito: as linhas dos agentes derrubam o custo (e o main nunca derruba stats), então só a largura vale
    const agentLines = lines.slice(1).filter((l) => l.includes('|'))
    assert.equal(agentLines.length, 3)
    for (const l of agentLines) assert.deepEqual(bars(l), bars(lines[0]), l)
  }
})

test('main row: hint is dropped to its own line before the stats are, unavailable values blank their column', () => {
  const rows = rowsOf(treeRecords(), { mainRoot: true })
  const wide = panel.renderPanel(viewOf(rows, { main: MAIN }), theme, 160)
  assert.match(wide[0], /thinking… · 2 running · ↓ to manage +1m 42s/)
  const narrow = panel.renderPanel(viewOf(rows, { main: MAIN }), theme, 60)
  assert.ok(!narrow[0].includes('manage') && narrow[1].trim() === '2 running · ↓ to manage' && narrow[0].endsWith('$8.79'))
  const idle = panel.renderPanel(viewOf(rows, { main: { state: 'idle', contextTokens: 5_000 } }), theme, 100)
  assert.match(idle[0], /idle · 2 running/)
  assert.match(idle[0], /5\.0k tok/)
  assert.ok(!idle[0].includes('$'), 'sem custo conhecido não mostra número')
})

test('main row: renders the sample tree at width 120', () => {
  const rows = rowsOf([...treeRecords(), rec('b1', 'b', 2, { startedAt: 4 })].slice(0, 3), { mainRoot: true })
  const out = panel.renderPanel(viewOf(rows, { main: MAIN }), theme, 120).map(strip)
  console.log(out.join('\n'))
  assert.match(out[1], /^├─ ○ a-a/)
  assert.match(out[2], /^│ {2}└─ ◦ a-a1²/)
  assert.match(out[3], /^└─ ○ a-b/)
})

test('palette: HUD colors from config, truecolor roles, fallback and NO_COLOR', () => {
  const colors = palette.parseColors(JSON.stringify({ colors: { model: '#7dcfff', project: '#7aa2f7', label: 'nope', custom: '#ff9e64' } }))
  assert.deepEqual(Object.keys(colors).sort(), ['custom', 'model', 'project'])
  assert.deepEqual(palette.parseColors('{bad'), {})
  assert.deepEqual(palette.parseColors('{"colors":3}'), {})
  const t = withEnv({}, () => palette.hudTheme(tagTheme, colors))
  withEnv({}, () => {
    assert.equal(t.fg('text', 'x'), '\x1b[38;2;125;207;255mx\x1b[39m')
    assert.equal(t.fg('task', 'x'), '\x1b[38;2;122;162;247mx\x1b[39m')
    assert.equal(t.fg('cost', 'x'), '\x1b[38;2;255;158;100mx\x1b[39m')
    assert.equal(t.fg('dim', 'x'), '<dim>x</dim>', 'invalid field falls back to the pi theme')
    assert.equal(t.fg('borderMuted', 'x'), '<borderMuted>x</borderMuted>')
    const none = palette.hudTheme(tagTheme, {})
    assert.equal(none.fg('task', 'x'), '<accent>x</accent>', 'new roles map to a pi token without a palette')
    assert.equal(none.fg('cost', 'x'), '<dim>x</dim>')
  })
  withEnv({ NO_COLOR: '1' }, () => {
    assert.equal(t.fg('text', 'x'), 'x')
    assert.equal(t.bold('x'), 'x')
  })
  assert.equal(typeof palette.hudColors(), 'object')
  assert.equal(palette.hudColors(), palette.hudColors(), 'read once')
})

test('widths 40, 80 and 160: no line wider than width with HUD palette and spinner', () => {
  const records = [
    rec('a', null, 1, { agent: 'general-purpose', task: 'Investigate the very long failing integration scenario ' + 'y'.repeat(100), startedAt: 1 }),
    rec('b', 'a', 2, { agent: 'general-purpose', task: 'child', startedAt: 2, activity: 'Reading connect_target.rs tests and more' }),
    rec('c', null, 1, { agent: 'general-purpose', task: 'Third', startedAt: 3, cost: 123.4, tokens: { context: 2_500_000 } }),
    rec('d', null, 1, { state: 'failed', endedAt: NOW - 1, error: 'e'.repeat(200), startedAt: 4 }),
  ]
  const rows = rowsOf(records)
  const hud = palette.hudTheme(tagTheme, palette.parseColors(JSON.stringify({ colors: { model: '#7dcfff' } })))
  for (const width of [40, 80, 160]) {
    for (const th of [theme, tagTheme, hud]) {
      for (const sel of [false, true]) for (const r of rows) assert.ok(visibleWidth(panel.renderRow(r, sel, th, width, 4)) <= width, `${r.id}@${width}`)
      for (const focused of [false, true]) {
        const lines = panel.renderPanel(viewOf(rows, { focused, selectedId: 'a', hint: 'x'.repeat(200), frame: 4, finished: 1 }), th, width)
        for (const l of lines) assert.ok(visibleWidth(l) <= width, `panel@${width}: ${l}`)
      }
    }
  }
})

// Testes do zzzzzzzzzzzzzzzzzzzzzzzz-plan-modal.patch: node --experimental-strip-types --test ~/.pi/agent/claude-home/patches/pi-code/zzzzzzzzzzzzzzzzzzzzzzzz-plan-modal/plan-modal.test.ts
// Pedido do dono (2026-11-14): botão `o abrir plano` no rodapé do Plan abre o plano numa modal com título e descrição por passo;
// a descrição vem dos bullets do próprio plano (custo zero) e o lint exige ao menos um por tarefa. Registro: docs/pi-plan-modal-2026-11-14.md.
import assert from 'node:assert/strict'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

const tmp = mkdtempSync(join(tmpdir(), 'plan-modal-test-'))
after(() => rmSync(tmp, { recursive: true }))
cpSync(`${homedir()}/.pi/agent/npm/node_modules/pi-code/extensions`, join(tmp, 'extensions'), { recursive: true })
const rel = `${homedir()}/.pi/agent/install/releases/${readFileSync(`${homedir()}/.pi/agent/install/current-version`, 'utf8').trim()}/node_modules`
mkdirSync(join(tmp, 'node_modules'))
for (const m of ['@earendil-works', 'typebox']) symlinkSync(join(rel, m), join(tmp, 'node_modules', m))
const ext = join(tmp, 'extensions')
const { planToTodos, lintPlan, restoredPlanState } = await import(join(ext, 'plan-mode', 'utils.ts'))
const { planModalLines, planTitle, PlanModal } = await import(join(ext, 'plan-mode', 'modal.ts'))
const { validKeys, drawerLines } = await import(join(ext, 'plan-mode', 'manage.ts'))
const { PlanSection } = await import(join(ext, 'plan-mode', 'section.ts'))
const planMode = (await import(join(ext, 'plan-mode', 'index.ts'))).default
const { visibleWidth } = await import(join(tmp, 'node_modules', '@earendil-works', 'pi-tui', 'dist', 'index.js'))
await (await import(join(ext, 'subagent', 'fleet-ui', 'palette.ts'))).ready

const strip = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, '')
const theme = { fg: (_c: string, s: string) => s, bg: (_c: string, s: string) => s, bold: (s: string) => s }
const DOWN = '\x1b[B', ESC = '\x1b'

const PLAN = [
  'Tier: T1 (teste)',
  '# Modal do plano',
  'AC1: WHEN o plano abre THE SYSTEM SHALL mostrar a descrição.',
  '## Tarefas',
  '1. Guardar a descrição',
  '   - arquivos: `utils.ts`',
  '   - **pronto**: bullets viram descrição',
  '     que continua na linha de baixo',
  '',
  '   - check: node --test (AC1)',
  '2. Desenhar a modal',
  '* ação: modal.ts',
  '## Riscos',
  '- nenhum',
].join('\n')

test('planToTodos guarda os bullets como descrição e para na próxima tarefa ou título', () => {
  const todos = planToTodos(PLAN)
  assert.deepEqual(todos.map((t: any) => t.text), ['Guardar a descrição', 'Desenhar a modal'])
  assert.equal(todos[0].description, 'arquivos: utils.ts\npronto: bullets viram descrição que continua na linha de baixo\ncheck: node --test (AC1)')
  assert.equal(todos[1].description, 'ação: modal.ts') // `- nenhum` fica depois do título ## Riscos
})

test('sem bullets não há campo; prosa sem recuo e linha numerada rejeitada encerram a descrição', () => {
  const todos = planToTodos('1. Primeira tarefa\nTexto solto.\n- bullet órfão\n2. Segunda tarefa\n3. `x`\n- bullet da linha rejeitada\n4. Terceira tarefa\n  continuação recuada')
  assert.deepEqual(todos.map((t: any) => t.text), ['Primeira tarefa', 'Segunda tarefa', 'Terceira tarefa'])
  assert.equal('description' in todos[0], false)
  assert.equal('description' in todos[1], false)
  assert.equal(todos[2].description, 'continuação recuada')
})

test('descrição limitada a 1200 caracteres', () => {
  const todos = planToTodos(`1. Tarefa comprida\n${Array.from({ length: 40 }, (_, i) => `- bullet ${i} ${'x'.repeat(60)}`).join('\n')}`)
  assert.equal(todos[0].description.length, 1200)
  assert.ok(todos[0].description.endsWith('…'))
})

test('lintPlan: tarefa sem bullet é rejeitada; com bullet passa; as outras regras seguem', () => {
  assert.deepEqual(lintPlan(PLAN), [])
  assert.deepEqual(lintPlan(PLAN.replace('* ação: modal.ts\n', '')), ["task 2 has no description (add '-' bullets under it: action, done criterion)"])
  // continuação recuada sem bullet não conta como descrição no lint
  assert.deepEqual(lintPlan('Tier: T0 (x)\n1. Trocar o texto\n   sem bullet'), ["task 1 has no description (add '-' bullets under it: action, done criterion)"])
  assert.deepEqual(lintPlan('Tier: T0 (x)\n1. Trocar o texto\n- ação: editar'), [])
  const bad = lintPlan('1. Trocar o texto\n- ação: editar\n- A1 sem número')
  assert.ok(bad.includes('missing "Tier: Tn (signals)" line'))
  assert.ok(bad.includes('assumption A1 has no confidence %'))
  assert.ok(lintPlan('Tier: T1 (x)\n1. Trocar o texto\n- ação: editar').includes('no EARS acceptance criterion (AC1: WHEN … THE SYSTEM SHALL …)'))
  assert.deepEqual(lintPlan('Tier: T0 (x)\nsem tarefas'), ['no numbered tasks'])
})

test('restoredPlanState guarda descrição string, aceita entrada antiga e rejeita descrição não string', () => {
  const ok = [{ step: 1, text: 'a', completed: false, description: 'd' }, { step: 2, text: 'b', completed: true }]
  assert.deepEqual(restoredPlanState({ todos: ok }).todos, ok)
  assert.equal(restoredPlanState({ todos: [{ step: 1, text: 'a', completed: false, description: 7 }] }).todos, undefined)
})

const items = [
  { step: 1, text: 'Guardar a descrição', completed: true, description: 'arquivos: utils.ts\npronto: bullets viram descrição que continua na linha de baixo e é longa o bastante para quebrar em qualquer largura testada aqui' },
  { step: 2, text: 'Desenhar a modal', completed: false, description: 'ação: modal.ts' },
  { step: 3, text: 'Passo sem descrição', completed: false },
  { step: 4, text: 'Passo pulado', completed: false, status: 'skipped', note: 'fora do escopo' },
]

test('planModalLines: título, feito/total, cada passo com descrição quebrada dentro da largura', () => {
  for (const width of [40, 80, 120]) {
    const lines = planModalLines(items, { title: 'Modal do plano', file: '/tmp/p.md' }, theme, width)
    for (const l of lines) assert.ok(visibleWidth(l) <= width, `largura ${width}: ${visibleWidth(l)} em "${strip(l)}"`)
    const text = lines.map(strip)
    assert.match(text[0], /^┌ PLAN 1\/4 · Modal do plano ─+┐$/)
    for (const want of ['✓ 01  Guardar a descrição', '▸ 02  Desenhar a modal', '○ 03  Passo sem descrição', '⊘ 04  Passo pulado', 'ação: modal.ts', 'nota: fora do escopo', 'plano: /tmp/p.md', width < 44 ? '↑↓ rolar · e abrir arquivo' : '↑↓ rolar · e abrir arquivo · esc fechar']) { // 39 colunas de teclas: cortadas só na moldura mais estreita
      assert.ok(text.some((l: string) => l.includes(want)), `largura ${width}: falta "${want}"`)
    }
    // a descrição inteira aparece, quebrada em linhas recuadas sob o título
    const joined = text.map((l: string) => l.replace(/^│\s*|\s*│$/g, '')).join(' ')
    assert.ok(joined.includes('pronto: bullets viram descrição que continua na linha de baixo e é longa o bastante para quebrar em qualquer largura testada aqui'))
    // passo sem descrição: só o título, seguido da linha em branco entre passos (nenhum bloco vazio)
    const at = text.findIndex((l: string) => l.includes('03  Passo sem descrição'))
    assert.match(text[at + 1], /^│\s+│$/)
    assert.ok(text[at + 2].includes('04  Passo pulado'))
  }
})

test('planTitle: primeiro título markdown, senão Plan', () => {
  assert.equal(planTitle('Tier: T1\n\n## Modal do plano\n# outro'), 'Modal do plano')
  assert.equal(planTitle('sem título'), 'Plan')
})

test('modal: ↓ rola, esc e q fecham, e abre o arquivo e mantém a modal', () => {
  let done = 0
  let open = 0
  const modal = new PlanModal(items, { title: 'T' }, theme, { done: () => done++, open: () => open++, rows: () => 8 })
  const first = modal.render(60)
  assert.equal(first.length, 8) // moldura + 5 linhas de corpo + teclas + base
  modal.handleInput(DOWN)
  assert.equal(modal.offset, 1)
  const second = modal.render(60)
  assert.equal(strip(second[1]), strip(first[2]))
  assert.equal(second[0], first[0])
  assert.equal(second.at(-2), first.at(-2)) // cabeçalho e teclas não rolam
  modal.handleInput('\x1b[F') // end
  modal.render(60)
  const last = modal.offset
  modal.handleInput(DOWN)
  assert.equal(modal.offset, last) // não passa do fim
  modal.handleInput('\x1b[H') // home
  assert.equal(modal.offset, 0)
  modal.handleInput('e')
  assert.deepEqual([open, done], [1, 0])
  modal.handleInput(ESC)
  modal.handleInput('q')
  assert.deepEqual([open, done], [1, 2])
})

test('validKeys segue listando o abrir plano; a gaveta mostra a descrição', () => {
  assert.deepEqual(validKeys(items[1], false)[1], ['o', 'abrir plano'])
  const drawer = drawerLines(items[1], { state: 'fazendo' }, theme, 80).map(strip)
  assert.deepEqual(drawer.slice(1, 4), [' │ fazendo', ' │ ação: modal.ts', ' │ tarefa: Desenhar a modal'])
  assert.deepEqual(drawerLines(items[2], { state: 'a fazer' }, theme, 80).map(strip).slice(1, 3), [' │ a fazer', ' │ tarefa: Passo sem descrição'])
  const long = drawerLines({ ...items[1], description: Array.from({ length: 9 }, (_, i) => `b${i}`).join('\n') }, { state: 'a fazer' }, theme, 80).map(strip)
  assert.deepEqual(long.slice(7, 9), [' │ b5', ' │ …'])
})

function section(show = true) {
  const tui: any = { terminal: { rows: 40 }, requestRender() {}, setFocus(c: any) { tui.focusedComponent = c; if (c) c.focused = true } }
  let widget: any
  const ctx: any = { hasUI: true, ui: { theme, setWidget: (_k: string, content: any) => { widget = content?.(tui, theme) } }, sessionManager: { getBranch: () => [] } }
  const sec = new PlanSection()
  const calls = { show: 0, open: 0 }
  sec.host = { notify() {}, abort() {}, open: async () => void calls.open++, ...(show ? { show: () => void calls.show++ } : {}) }
  sec.update(ctx, items, 'plan')
  after(() => sec.shutdown(ctx))
  return { sec, tui, calls, lines: (w = 100) => widget.render(w).map(strip) as string[] }
}

test('rodapé do Plan mostra o abrir plano sem foco e com foco, mesmo estreito; o e o clique abrem a modal', () => {
  const { sec, tui, calls, lines } = section()
  for (const w of [30, 60, 100]) assert.ok(lines(w).at(-1)!.includes('o abrir plano'), `sem foco, largura ${w}: ${lines(w).at(-1)}`)
  const rows = lines()
  assert.deepEqual(sec.handleMouse({ type: 'click', x: 3, y: rows.length - 1 }), { handled: true, render: true })
  assert.equal(calls.show, 1)
  assert.notEqual(tui.focusedComponent, sec) // o clique no botão não toma o foco
  assert.deepEqual(sec.handleMouse({ type: 'click', x: 3, y: rows.length - 2 }), { focus: true, render: true }) // corpo: foco, como antes
  tui.setFocus(sec)
  for (const w of [30, 60, 100]) assert.ok(lines(w).at(-1)!.includes('o abrir plano'), `com foco, largura ${w}: ${lines(w).at(-1)}`)
  assert.match(lines(100).at(-1)!, /↵ detalhes · o abrir plano · .*esc back$/)
  sec.handleInput('o')
  assert.deepEqual(calls, { show: 2, open: 0 })
})

test('host sem show: o abre o arquivo, como antes', async () => {
  const { sec, tui, calls } = section(false)
  tui.setFocus(sec)
  sec.handleInput('o')
  await new Promise((r) => setTimeout(r, 10))
  assert.deepEqual(calls, { show: 0, open: 1 })
})

test('plan-mode: host.show abre overlay no terminal; sem terminal não abre nem falha; texto do modo plano cita a regra', async () => {
  const on: Record<string, any> = {}
  const cmds: Record<string, any> = {}
  const tools: Record<string, any> = {}
  let active = ['read', 'bash', 'edit', 'plan_mode_complete']
  const pi: any = {
    on: (e: string, f: any) => (on[e] = f), registerCommand: (n: string, c: any) => (cmds[n] = c), registerTool: (t: any) => (tools[t.name] = t),
    registerShortcut() {}, registerFlag() {}, registerMarkdownTransformer() {}, getFlag: () => undefined,
    getActiveTools: () => active, setActiveTools: (t: string[]) => (active = t), getAllTools: () => active.map((name) => ({ name })),
    events: { emit() {}, on() {} }, appendEntry() {}, sendMessage() {}, sendUserMessage() {},
  }
  planMode(pi)
  const tui: any = { terminal: { rows: 40 }, requestRender() {}, setFocus() {} }
  let section: any
  const overlays: any[] = []
  const ui: any = { notify() {}, setStatus() {}, select: async () => 'Execute the plan (track progress)', editor: async () => '', theme, setWidget: (_k: string, content: any) => { if (content) section = content(tui, theme) } }
  const ctx: any = { hasUI: true, ui, isIdle: () => true, sessionManager: { getEntries: () => [], getBranch: () => [] } }
  await cmds.plan.handler('', ctx)
  const injected = await on.before_agent_start({}, ctx)
  assert.ok(JSON.stringify(injected).includes("every task has ≥1 '-' bullet under it (shown as its description);"))
  const rejected = await tools.plan_mode_complete.execute('id', { plan: 'Tier: T0 (teste)\n1. contar a.txt' })
  assert.match(rejected.content[0].text, /task 1 has no description/)
  await tools.plan_mode_complete.execute('id', { plan: 'Tier: T0 (teste)\n# Contagem\n1. contar a.txt\n- ação: wc -l a.txt' })
  await on.agent_end({ messages: [] }, ctx)
  assert.ok(section, 'a seção do Plan foi registrada')
  // sem ui.custom (print/RPC): nada abre, nada lança
  section.handleInput('o')
  ui.custom = (factory: any, options: any) => { overlays.push({ c: factory(tui, theme, {}, () => {}), options }); return Promise.resolve() }
  ctx.hasUI = false
  section.handleInput('o')
  assert.equal(overlays.length, 0)
  ctx.hasUI = true
  section.handleInput('o')
  assert.equal(overlays.length, 1)
  assert.deepEqual(overlays[0].options, { overlay: true, overlayOptions: { anchor: 'center', width: '80%', maxHeight: '80%' } })
  const text = overlays[0].c.render(80).map(strip)
  assert.match(text[0], /^┌ PLAN 0\/1 · Contagem /)
  assert.ok(text.some((l: string) => l.includes('ação: wc -l a.txt')))
})

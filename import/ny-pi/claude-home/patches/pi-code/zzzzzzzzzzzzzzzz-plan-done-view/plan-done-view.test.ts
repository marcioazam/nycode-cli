// Testes do zzzzzzzzzzzzzzzz-plan-done-view.patch: node --experimental-strip-types --test ~/.pi/agent/claude-home/patches/pi-code/zzzzzzzzzzzzzzzz-plan-done-view/plan-done-view.test.ts
// Pedido do dono (2026-11-14): [DONE:6] cru no chat é vago; mostrar "etapa 6/8 · título" só na exibição. Sem ícone de estado desde 2026-11-15: "etapa 6 de 8 concluída · título", o estado só por nome e cor. O formato atual (bloco, barra, "a seguir") vem do zzzzzzzzzzzzzzzzzzz-plan-done-block.patch, testado aqui.
import assert from 'node:assert/strict'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

const tmp = mkdtempSync(join(tmpdir(), 'plan-done-view-test-'))
after(() => rmSync(tmp, { recursive: true }))
cpSync(`${homedir()}/.pi/agent/npm/node_modules/pi-code/extensions`, join(tmp, 'extensions'), { recursive: true })
const rel = `${homedir()}/.pi/agent/install/releases/${readFileSync(`${homedir()}/.pi/agent/install/current-version`, 'utf8').trim()}/node_modules`
mkdirSync(join(tmp, 'node_modules'))
for (const m of ['@earendil-works', 'typebox']) symlinkSync(join(rel, m), join(tmp, 'node_modules', m))
const { renderDoneTags } = await import(join(tmp, 'extensions', 'plan-mode', 'done-view.ts'))
const planMode = (await import(join(tmp, 'extensions', 'plan-mode', 'index.ts'))).default

const steps = [
  { step: 6, text: 'Gate único (gate-runner)' },
  { step: 7, text: 'Revisão' },
  { step: 8, text: 'Entrega' },
]
const paint = { ok: (s: string) => `<ok>${s}</>`, muted: (s: string) => `<m>${s}</>`, text: (s: string) => `<t>${s}</>` }

test('linha só de tags vira uma linha por etapa, com cores', () => {
  assert.equal(
    renderDoneTags('[DONE:6] [DONE:7]', steps, paint),
    '<m>etapa 6 de 8</> <ok>concluída</> <m>·</> <t>Gate único (gate-runner)</>\n<m>etapa 7 de 8</> <ok>concluída</> <m>·</> <t>Revisão</>  <ok>━━━━━━━</><m>╌</>\n<m>→ a seguir: etapa 8 · Entrega</>',
  )
})

test('tag no meio da frase vira etapa n concluída', () => {
  assert.equal(renderDoneTags('feito [DONE:6] ok', steps), 'feito etapa 6 concluída ok')
})

test('sem plano ou etapa desconhecida: etapa n concluída, sem erro', () => {
  assert.equal(renderDoneTags('[DONE:6]', undefined), 'etapa 6 concluída')
  assert.equal(renderDoneTags('[DONE:6]', []), 'etapa 6 concluída')
  assert.equal(renderDoneTags('[DONE:99]', steps), 'etapa 99 concluída')
})

test('código fica literal: bloco cercado e inline', () => {
  const t = 'a `[DONE:1]` b\n```\n[DONE:2]\n```\n[DONE:3]'
  assert.equal(renderDoneTags(t, undefined), 'a `[DONE:1]` b\n```\n[DONE:2]\n```\netapa 3 concluída')
})

test('streaming: prefixo incompleto some até a tag fechar', () => {
  assert.equal(renderDoneTags('pronto\n[DONE:', steps, undefined, true), 'pronto\n')
  assert.equal(renderDoneTags('pronto [DON', steps, undefined, true), 'pronto ')
  assert.equal(renderDoneTags('pronto\n[DONE:6]', steps, undefined, true), 'pronto\netapa 6 de 8 concluída · Gate único (gate-runner)  ━━━━━━╌╌\n→ a seguir: etapa 7 · Revisão')
  assert.equal(renderDoneTags('pronto [DONE:', steps), 'pronto [DONE:') // fora do streaming nada é escondido
})

test('plan-mode registra o transformador e guarda os títulos após a última etapa', async () => {
  const on: Record<string, any> = {}
  const cmds: Record<string, any> = {}
  const tools: Record<string, any> = {}
  let transformer: any
  let opts: any
  let active = ['read', 'bash', 'edit', 'plan_mode_complete']
  const pi: any = {
    on: (e: string, f: any) => (on[e] = f),
    registerCommand: (n: string, c: any) => (cmds[n] = c),
    registerTool: (t: any) => (tools[t.name] = t),
    registerShortcut() {},
    registerFlag() {},
    registerMarkdownTransformer: (f: any, o: any) => ((transformer = f), (opts = o)),
    getFlag: () => undefined,
    getActiveTools: () => active,
    setActiveTools: (t: string[]) => (active = t),
    getAllTools: () => active.map((name) => ({ name })),
    events: { emit() {}, on() {} },
    appendEntry() {},
    sendMessage() {},
    sendUserMessage() {},
  }
  planMode(pi)
  assert.deepEqual(opts.messageTypes, ['assistant'])
  const ui = { notify() {}, setStatus() {}, setWidget() {}, select: async () => 'Execute the plan (track progress)', editor: async () => '', theme: { fg: (_c: string, s: string) => s, bg: (_c: string, s: string) => s, bold: (s: string) => s } }
  const ctx: any = { hasUI: true, ui, isIdle: () => true, sessionManager: { getEntries: () => [], getBranch: () => [] } }
  const render = (t: string) => transformer(t, { messageType: 'assistant', isStreaming: false, availableWidth: 80 })
  assert.equal(render('[DONE:1]'), 'etapa 1 concluída') // sem plano
  await cmds.plan.handler('', ctx)
  await tools.plan_mode_complete.execute('id', { plan: 'Tier: T0 (teste)\n1. contar a.txt\n- wc -l a.txt\n2. contar b.txt\n- wc -l b.txt' })
  await on.agent_end({ messages: [] }, ctx)
  assert.equal(render('[DONE:1]'), 'etapa 1 de 2 concluída · Contar a.txt  ━╌\n→ a seguir: etapa 2 · Contar b.txt')
  const done = { role: 'assistant', content: [{ type: 'text', text: '[DONE:1] [DONE:2]' }], stopReason: 'stop' }
  await on.turn_end({ message: done }, ctx)
  await on.agent_end({ messages: [done] }, ctx) // plano acaba: todoItems zera
  assert.equal(render('[DONE:2]'), 'etapa 2 de 2 concluída · Contar b.txt  ━━ plano concluído')
})

// Pedido do dono (2026-11-14): "etapa 6 concluída" é abstrato. Com o plano conhecido: número de total, título, barra de progresso e o
// que vem a seguir; etapas seguidas viram um bloco só. Sem plano conhecido: uma linha só, sem repetir.
test('bloco: linhas seguidas só de tags viram um bloco com barra e fecho', () => {
  assert.equal(
    renderDoneTags('texto\n[DONE:6]\n[DONE:7]\n[DONE:8]\nfim', steps),
    'texto\netapa 6 de 8 concluída · Gate único (gate-runner)\netapa 7 de 8 concluída · Revisão\netapa 8 de 8 concluída · Entrega  ━━━━━━━━ plano concluído\nfim',
  )
  assert.equal(renderDoneTags('[DONE:6]\n[DONE:7]\n[DONE:8]', undefined), 'etapas 6, 7 e 8 concluídas')
  assert.equal(renderDoneTags('[DONE:6] [DONE:7]', []), 'etapas 6 e 7 concluídas')
  const muitos = Array.from({ length: 30 }, (_, i) => ({ step: i + 1, text: `t${i + 1}` }))
  assert.equal(renderDoneTags('[DONE:15]', muitos).split('\n')[0], 'etapa 15 de 30 concluída · t15  ━━━━━━╌╌╌╌╌╌') // barra com no máximo 12 colunas
})

test('após /reload os títulos voltam do último plano gravado na sessão', async () => {
  const on: Record<string, any[]> = {}
  let transformer: any
  const pi: any = {
    on: (e: string, f: any) => (on[e] ??= []).push(f),
    registerCommand() {}, registerTool() {}, registerShortcut() {}, registerFlag() {},
    registerMarkdownTransformer: (f: any) => (transformer = f),
    getFlag: () => undefined, getActiveTools: () => ['read'], setActiveTools() {}, getAllTools: () => [{ name: 'read' }],
    events: { emit() {}, on() {} }, appendEntry() {}, sendMessage() {}, sendUserMessage() {},
  }
  planMode(pi)
  const todos = [{ step: 1, text: 'Contar a.txt', completed: true }, { step: 2, text: 'Contar b.txt', completed: true }]
  const branch = [
    { type: 'custom', customType: 'plan-mode', data: { enabled: false, todos, executing: true } },
    { type: 'custom', customType: 'plan-mode', data: { enabled: false, todos: [], executing: false } }, // fim do plano: lista zerada
  ]
  const ui = { notify() {}, setStatus() {}, setWidget() {}, theme: { fg: (_c: string, s: string) => s, bg: (_c: string, s: string) => s, bold: (s: string) => s } }
  for (const f of on.session_start ?? []) await f({}, { hasUI: true, ui, isIdle: () => true, sessionManager: { getEntries: () => branch, getBranch: () => branch } })
  assert.equal(transformer('[DONE:2]', { messageType: 'assistant', isStreaming: false, availableWidth: 80 }), 'etapa 2 de 2 concluída · Contar b.txt  ━━ plano concluído')
})

// Pedido do dono (2026-11-14): "PLAN WAITING: …" cru vira bloco. Primeiro a variante B de /tmp/plano-espera.png; depois a
// variante A de /tmp/plano-espera2.png (esta): caixa de fundo neutro, relógio ◷ no lugar da bolinha (removido em 2026-11-15: o estado vai por nome e cor), título em negrito com a
// etapa e a barra à direita, motivo e o que fazer embaixo. Só exibição (zzzzzzzzzzzzzzzzzzzzz-plan-espera.patch): o plan-gate
// segue lendo o texto literal da sessão.
test('espera/bloqueado/cancelado (padrão SOTA 2026-11-18): ícone + plano em todos os estados, etapa+barra+% junto ao título, roxo wait, ▲ precisa de você e data no canto', () => {
  const env = { TERM: 'xterm' }
  const p2 = {
    ...paint,
    run: (s: string) => `<run>${s}</>`,
    wait: (s: string) => `<wait>${s}</>`,
    warn: (s: string) => `<w>${s}</>`,
    accent: (s: string) => `<a>${s}</>`,
    bold: (s: string) => `*${s}*`,
  }
  const andamento = [{ step: 1, text: 'a', completed: true }, { step: 2, text: 'b', completed: false }, { step: 3, text: 'c', completed: false }]
  assert.equal(
    renderDoneTags('feito.\n\nPLAN WAITING: entrega do platform (bg-fa2bfef6)', andamento, p2, false, 0, true, '', env),
    'feito.\n\n  <wait>◈</> <t>*plano*</> <m>·</> <wait>*em espera*</> <m>·</> <m>etapa 2 de 3</>  <ok>━</><m>╌╌</>  <m>33%</>\n<m>│</> <m>atual:</> <t>b</> <m>·</> <m>1 concluída, faltam 2</>\n<m>│</> <t>entrega do platform</>\n<m>│</> <wait>segundo plano</><m> · bg-fa2bfef6 · retoma sozinho, nada a fazer</>',
  )
  assert.equal(
    renderDoneTags('PLANO BLOQUEADO: falta autorização para o merge', andamento, p2, false, 0, true, '', env),
    '  <w>◈</> <t>*plano*</> <m>·</> <w>*bloqueado*</> <m>·</> <m>etapa 2 de 3</>  <ok>━</><m>╌╌</>  <m>33%</>\n<m>│</> <m>atual:</> <t>b</> <m>·</> <m>1 concluída, faltam 2</>\n<m>│</> <t>falta autorização para o merge</>\n<m>│</> <w>▲</> <w>*precisa de você*</> <m>· responda para continuar</>',
  )
  // Pedido do dono (2026-11-18): todos os status de plano seguem o MESMO layout padronizado (sem sumir ícone nem palavra "plano").
  assert.equal(
    renderDoneTags('PLAN WAITING: gate rodando', undefined, p2, false, 0, true, '', env),
    '  <wait>◈</> <t>*plano*</> <m>·</> <wait>*em espera*</>\n<m>│</> <t>gate rodando</>\n<m>│</> <wait>segundo plano</><m> · retoma sozinho, nada a fazer</>',
  )
  assert.equal(
    renderDoneTags('PLAN BLOCKED: falta o ok', [], p2, false, 0, true, '', env),
    '  <w>◈</> <t>*plano*</> <m>·</> <w>*bloqueado*</>\n<m>│</> <t>falta o ok</>\n<m>│</> <w>▲</> <w>*precisa de você*</> <m>· responda para continuar</>',
  )
  assert.equal(renderDoneTags('PLAN CANCELLED', undefined, p2, false, 0, true, '', env), '  <a>◈</> <t>*plano*</> <m>·</> <m>*cancelado*</>')
  assert.equal(renderDoneTags('PLAN CANCELLED', andamento, p2, false, 0, true, '', env), '  <a>◈</> <t>*plano*</> <m>·</> <m>*cancelado*</>')
  // no meio da frase, em código ou sem cores extras: literal / sem erro
  assert.equal(renderDoneTags('termine com PLAN WAITING: x quando esperar', andamento, p2, false, 0, true, '', env), 'termine com PLAN WAITING: x quando esperar')
  assert.equal(renderDoneTags('```\nPLAN WAITING: x\n```', andamento, p2, false, 0, true, '', env), '```\nPLAN WAITING: x\n```')
  assert.ok(renderDoneTags('PLAN WAITING: x', andamento, undefined, false, 0, true, '', env).includes('plano · em espera'))
})

test('espera: com largura, fundo e data de envio, etapa+barra+% colam ao título, data fica no canto direito e caixa ocupa largura inteira', () => {
  const env = { TERM: 'xterm' }
  const ansi = {
    ok: (s: string) => `\x1b[32m${s}\x1b[39m`,
    muted: (s: string) => `\x1b[2m${s}\x1b[22m`,
    text: (s: string) => s,
    bold: (s: string) => `\x1b[1m${s}\x1b[22m`,
    box: (s: string) => `\x1b[47m${s}\x1b[49m`,
    pill: (s: string) => `[${s}]`,
  }
  const andamento = [{ step: 1, text: 'a', completed: true }, { step: 2, text: 'b', completed: false }]
  const out = renderDoneTags('antes\n\nPLAN WAITING: rodando `gate` do **platform**\n\ndepois', andamento, ansi, false, 78, true, '18/11 02:45', env).split('\n')
  const caixa = out.slice(2, 8)
  assert.deepEqual([out[0], out[1], out[8], out[9]], ['antes', '', '', 'depois'])
  const vis = (l: string) => l.replace(/\x1b\[[0-9;]*m/g, '')
  for (const l of caixa) {
    assert.ok(l.startsWith('\x1b[47m') && l.endsWith('\x1b[49m'), JSON.stringify(l))
  }
  for (const i of [0, 1, 4, 5]) assert.equal([...vis(caixa[i]!)].length, 78, vis(caixa[i]!))
  assert.equal(vis(caixa[0]!).trim(), '')
  assert.match(vis(caixa[1]!), /^ {3}◈ plano · em espera · etapa 2 de 2 {2}━╌ {2}50% {2,}\[18\/11 02:45\] {3}$/)
  assert.equal(vis(caixa[2]!).replace(/`/g, '').trimEnd(), '     │ atual: b · 1 concluída, falta 1')
  assert.equal(vis(caixa[3]!).trimEnd(), '     │ ``rodando `gate` do **platform**``')
  assert.equal(vis(caixa[4]!).trimEnd(), '     │ segundo plano · retoma sozinho, nada a fazer')
  // estreito demais: não estoura
  for (const l of renderDoneTags('PLAN WAITING: x', andamento, ansi, false, 24, true, '18/11 02:45', env).split('\n')) assert.equal([...vis(l).replace(/`/g, '')].length, 24, vis(l))
})

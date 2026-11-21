// Testes do zzzzzzzzzzzzzzzzzzzzzzzzz-question-nav.patch: node --experimental-strip-types --test ~/.pi/agent/claude-home/patches/pi-code/zzzzzzzzzzzzzzzzzzzzzzzzz-question-nav/question-nav.test.ts
// Pedido do dono (2026-11-15): navegação entre perguntas do lote, abas, revisão, esc com respostas, comandos na lista.
// Contrato: descartar, esc ou pular vai ao modelo com texto próprio (ele decide se pergunta de novo).
import assert from 'node:assert/strict'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
process.env.PI_ASCII_ICONS = '1'

const tmp = mkdtempSync(join(tmpdir(), 'question-nav-test-'))
after(() => rmSync(tmp, { recursive: true }))
cpSync(`${homedir()}/.pi/agent/npm/node_modules/pi-code/extensions`, join(tmp, 'extensions'), { recursive: true })
const rel = `${homedir()}/.pi/agent/install/releases/${readFileSync(`${homedir()}/.pi/agent/install/current-version`, 'utf8').trim()}/node_modules`
mkdirSync(join(tmp, 'node_modules'))
for (const m of ['@earendil-works', 'typebox']) symlinkSync(join(rel, m), join(tmp, 'node_modules', m))
const mod = await import(join(tmp, 'extensions', 'question.ts'))
const nav = await import(join(tmp, 'extensions', 'internal', 'question-nav.ts'))

const ansi = { fg: (_c: string, x: string) => `\x1b[2m${x}\x1b[22m`, bold: (x: string) => `\x1b[1m${x}\x1b[22m` }
const limpo = (l: string[]) => l.map((x) => x.replace(/\x1b\[[0-9;]*m/g, '').trimEnd())
const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '')
const theme = ansi
const editor = { render: () => ['[editor]'] }
const opts = [{ label: 'alpha', description: 'primeira opção.' }, { label: 'beta', description: 'segunda opção.' }]
const rec = [{ label: 'alpha (Recomendado)' }, { label: 'beta' }]
const other = { label: 'Type something.', isOther: true }
const K = { up: '\x1b[A', down: '\x1b[B', right: '\x1b[C', left: '\x1b[D', shiftTab: '\x1b[Z', tab: '\t', esc: '\x1b', enter: '\r', home: '\x1b[H', end: '\x1b[F' }

/** Teclas para as telas que abrirem, em ordem: cada tela consome até fechar; a fila vazia com a tela aberta falha o teste. */
function harness(keys: string[]) {
  const q = [...keys]
  const trace: string[] = []
  const ctx = {
    hasUI: true,
    mode: 'tui',
    sessionManager: { getSessionId: () => 's' },
    ui: {
      custom: (f: any) =>
        new Promise((resolve) => {
          let closed = false
          const c = f({ requestRender() {}, terminal: { rows: 24, columns: 80 } }, theme, null, (v: any) => { closed = true; resolve(v) })
          trace.push(strip(c.render(80).join('\n')))
          setTimeout(() => {
            while (!closed && q.length) {
              c.handleInput(q.shift()!)
              if (!closed) trace.push(strip(c.render(80).join('\n')))
            }
            if (!closed) resolve({ stalled: true })
          }, 0)
        }),
    },
  }
  return { ctx, trace, q }
}
async function ask(keys: string[], params: any) {
  let tool: any
  mod.default({ registerTool: (t: any) => (tool = t), on() {}, events: undefined })
  const h = harness(keys)
  const res = await tool.execute('id', params, undefined, undefined, h.ctx)
  assert.deepEqual(h.q, [], 'sobraram teclas')
  return { res, trace: h.trace, text: res.content[0].text as string, d: res.details }
}
async function drive(options: any[], multiSelect: boolean, keys: string[], batch?: any) {
  const h = harness(keys)
  const p = mod.askViaOverlay({ question: 'Qual?', options: opts, multiSelect }, h.ctx, options, multiSelect, undefined, undefined, batch)
  return p
}
const S = (o: any[] = [...opts, other], multi = false) => ({ question: 'Qual?', options: o.filter((x) => !x.isOther), multiSelect: multi })

const AGAIN = 'Decide whether to ask again or proceed on your own judgment.'

// ---------------------------------------------------------------------------------------------------- lista (pergunta única)

test('s pula: details.skipped e texto que devolve a decisão ao modelo', async () => {
  const r = await ask(['s'], S())
  assert.equal(r.text, `User skipped this question. ${AGAIN}`)
  assert.equal(r.d.skipped, true)
  assert.equal(r.d.answer, '')
})

test('esc sozinho: texto de dispensa (não é cancelamento mudo), answer null', async () => {
  const r = await ask([K.esc], S())
  assert.equal(r.text, `User dismissed the question without answering (Esc). ${AGAIN}`)
  assert.equal(r.d.answer, null)
  assert.ok(!r.trace.some((t) => t.includes('Sair das perguntas')))
})

test('r escolhe a recomendada; sem recomendada é ignorada', async () => {
  assert.deepEqual(await drive([...rec, other], false, ['r']), { answer: 'alpha (Recomendado)', wasCustom: false, index: 1 })
  assert.equal(await drive([...opts, other], false, ['r', K.esc]), null)
  assert.deepEqual(await drive(rec, true, ['r', K.enter]), { answer: 'alpha (Recomendado)', wasCustom: false })
})

test('d: decide você, com e sem motivo', async () => {
  const a = await ask(['d', 'p', 'r', 'a', K.enter], S())
  assert.equal(a.text, 'User asked you to decide: pra.')
  assert.equal(a.d.delegated, true)
  assert.equal(a.d.note, 'pra')
  const b = await ask(['d', K.enter], S())
  assert.equal(b.text, 'User asked you to decide.')
  assert.equal(b.d.delegated, true)
  assert.ok(b.trace.some((t) => t.includes('Motivo (opcional):')))
})

test('n: opção em foco + nota; sem nota vira escolha normal; na opção de texto livre é ignorada', async () => {
  const a = await ask([K.down, 'n', 'x', K.enter], S())
  assert.equal(a.text, 'User selected: 2. beta — note: x')
  assert.equal(a.d.note, 'x')
  assert.equal((await ask(['n', K.enter], S())).text, 'User selected: 1. alpha')
  assert.deepEqual(await drive([...opts, other], false, ['G', 'n', K.esc]), null) // ignorada: o esc dispensa
  assert.deepEqual(await drive(opts, true, [K.down, 'n', 'k', K.enter]), { answer: 'beta', wasCustom: false, note: 'k' })
})

test('o e 0 abrem o texto livre; em multi são ignoradas', async () => {
  assert.deepEqual(await drive([...opts, other], false, ['o', 'o', 'k', K.enter]), { answer: 'ok', wasCustom: true })
  assert.deepEqual(await drive([...opts, other], false, ['0', 'x', K.enter]), { answer: 'x', wasCustom: true })
  assert.deepEqual(await drive(opts, true, ['o', '0', K.enter]), { answer: '', wasCustom: false })
})

test('g/G, Home/End e ↑↓ dão a volta', async () => {
  const three = [{ label: 'a' }, { label: 'b' }, { label: 'c' }]
  const idx = async (keys: string[]) => (await drive(three, false, [...keys, K.enter]))!.index
  assert.equal(await idx(['G']), 3)
  assert.equal(await idx(['G', 'g']), 1)
  assert.equal(await idx([K.end]), 3)
  assert.equal(await idx([K.end, K.home]), 1)
  assert.equal(await idx([K.up]), 3)
  assert.equal(await idx([K.end, K.down]), 1)
})

test('multi: a marca/desmarca todas, i inverte', async () => {
  const three = [{ label: 'a' }, { label: 'b' }, { label: 'c' }]
  assert.equal((await drive(three, true, ['a', K.enter]))!.answer, 'a, b, c')
  assert.equal((await drive(three, true, ['a', 'a', K.enter]))!.answer, '')
  assert.equal((await drive(three, true, [' ', 'i', K.enter]))!.answer, 'b, c')
})

test('esc no editor volta à lista sem apagar o rascunho; outro uso do editor começa limpo', async () => {
  assert.deepEqual(await drive([...opts, other], false, ['o', 'h', 'i', K.esc, 'o', K.enter]), { answer: 'hi', wasCustom: true })
  const r = await ask(['o', 'h', 'i', K.esc, 'g', 'n', K.enter], S()) // a nota não herda o texto livre
  assert.equal(r.text, 'User selected: 1. alpha')
})

test('e expande a descrição de todas as opções (toggle); ? abre a ajuda e qualquer tecla fecha', async () => {
  const lines = (expanded: boolean) => limpo(mod.buildQuestionLines({ width: 80, question: 'Qual?', options: [...opts, other], optionIndex: 0, editMode: false, multiSelect: false, checked: [], editor, theme: ansi, expanded })).join('\n')
  assert.ok(lines(false).includes(' ─── alpha'))
  const on = lines(true)
  assert.ok(!on.includes(' ─── alpha'))
  assert.ok(on.includes(' primeira opção.') && on.includes(' segunda opção.'))
  const h = harness(['e', 'e', '?', 'x', '2'])
  const p = mod.askViaOverlay({ question: 'Qual?', options: opts }, h.ctx, [...opts, other], false)
  assert.deepEqual(await p, { answer: 'beta', wasCustom: false, index: 2 })
  const helpScreen = h.trace.find((t) => t.includes('Atalhos'))!
  for (const frag of ['escolhe (multi: marca)', 'pergunta anterior/próxima', 'pula (o agente decide e segue)', 'escolhe a ★ recomendada', '"decide você" + motivo opcional', 'qualquer tecla fecha']) assert.ok(helpScreen.includes(frag), frag)
  assert.ok(h.trace.some((t) => t.includes('Atalhos')) && !h.trace.at(-1)!.includes('Atalhos'))
})

// ---------------------------------------------------------------------------------------------------- rodapé

test('rodapé curto: omite ←→ sem lote e r sem recomendada; cabe na largura sem "..."', () => {
  const foot = (over: Record<string, unknown>) => limpo(mod.buildQuestionLines({ width: 80, question: 'Qual?', options: [...opts, other], optionIndex: 0, editMode: false, multiSelect: false, checked: [], editor, theme: ansi, ...over })).at(-2)
  assert.equal(foot({}), ' 1-3 escolhe · ↑↓ move · s pula · ? ajuda · esc sai')
  assert.equal(foot({ options: [...rec, other] }), ' 1-3 escolhe · ↑↓ move · s pula · r recomendada · ? ajuda · esc sai')
  assert.equal(foot({ options: opts, multiSelect: true }), ' 1-2 marca · ↑↓ move · espaço marca · ⏎ confirma · s pula · ? ajuda · esc sai')
  const tabs = [{ label: 'A', status: 'pending' }, { label: 'B', status: 'pending' }]
  assert.equal(foot({ options: [...rec, other], batch: { tabs, current: 0 }, width: 100 }), ' 1-3 escolhe · ↑↓ move · ←→ pergunta · s pula · r recomendada · ? ajuda · esc sai')
  assert.equal(foot({ options: [...rec, other], batch: { tabs, current: 0 } }), ' 1-3 escolhe · ↑↓ move · ←→ pergunta · s pula · ? ajuda · esc sai') // 80 colunas: r recomendada sai primeiro
  // largura curta: sai o menos útil primeiro, ? e esc ficam
  const curto = limpo(mod.buildQuestionLines({ width: 50, question: 'Qual?', options: [...rec, other], optionIndex: 0, editMode: false, multiSelect: false, checked: [], editor, theme: ansi, batch: { tabs, current: 0 } })).at(-2)!
  assert.ok([...curto].length <= 50 && curto.endsWith('? ajuda · esc sai') && !curto.includes('...') && !curto.includes('recomendada'), curto)
})

// ---------------------------------------------------------------------------------------------------- lote

const Q = [
  { question: 'Plano?', header: 'Plano', options: [{ label: 'T1' }, { label: 'T2' }] },
  { question: 'Cadastro?', header: 'Cadastro', options: [{ label: 'Manter (Recomendado)', description: 'a.' }, { label: 'Auto', description: 'b.' }] },
  { question: 'Auth?', options: [{ label: 'P' }, { label: 'O' }] },
]
const batch = (keys: string[]) => ask(keys, { questions: Q })

test('←/→ preservam a resposta e restauram o foco ao revisitar; s pula; envio mostra pendente como "not answered"', async () => {
  const r = await batch(['2', K.left, K.right, K.right, K.tab, K.left, 's', K.enter])
  // Q1 revisitada: foco de volta na opção 2
  assert.ok(r.trace.some((t) => t.includes('Plano') && t.includes('❯ 2  T2')))
  assert.equal(r.text, 'Plano?\nUser selected: 2. T2\n\nCadastro?\nnot answered\n\nAuth?\nUser skipped this question. ' + AGAIN)
  assert.equal(r.d.questions[0].answer, 'T2')
  assert.equal(r.d.questions[1].pending, true)
  assert.equal(r.d.questions[2].skipped, true)
})

test('abas: header (fallback Q3), ✓ ● ○ ↷, n/N; Shift+Tab volta; r escolhe a recomendada', async () => {
  const r = await batch([K.tab, K.shiftTab, '1', 'r', '2', K.enter])
  assert.ok(r.trace[0]!.includes('[Plano ●]') && r.trace[0]!.includes('Cadastro ○') && r.trace[0]!.includes('Q3 ○') && r.trace[0]!.includes('1/3'))
  assert.ok(r.trace.some((t) => t.includes('Plano ✓') && t.includes('[Cadastro ●]') && t.includes('2/3')))
  assert.ok(r.trace.some((t) => t.includes('[Revisar]') && t.includes('Manter') && !t.includes('(Recomendado)')))
  assert.equal(r.text, 'Plano?\nUser selected: 1. T1\n\nCadastro?\nUser selected: 1. Manter (Recomendado)\n\nAuth?\nUser selected: 2. O')
  const skipTab = await batch(['s', 's', 's', K.esc]) // tudo pulado: esc na revisão sai direto
  assert.ok(skipTab.trace.some((t) => t.includes('Plano ↷') && t.includes('Cadastro ↷')))
  assert.ok(skipTab.text.endsWith('User dismissed the question without answering (Esc). ' + AGAIN))
})

test('revisão: lista, ⏎ envia, número edita e volta à revisão, ← volta, esc abre a tela D', async () => {
  const r = await batch(['1', '1', '1', '2', '2', K.enter])
  const rev = r.trace.find((t) => t.includes('[Revisar]'))!
  assert.ok(rev.includes('1 Plano') && rev.includes('T1') && rev.includes('⏎ envia · 1-3 edita · ← volta · esc sai'))
  assert.equal(r.text, 'Plano?\nUser selected: 1. T1\n\nCadastro?\nUser selected: 2. Auto\n\nAuth?\nUser selected: 1. P')
  const back = await batch(['1', '1', '1', K.left, '2', K.enter])
  assert.ok(back.text.endsWith('Auth?\nUser selected: 2. O'))
  const nota = await batch(['n', 'o', 'k', K.enter, 'd', K.enter, 's', K.enter])
  assert.ok(nota.trace.some((t) => t.includes('nota: ok') && t.includes('decide você') && t.includes('↷ pulada: o agente decide')))
  assert.equal(nota.d.questions[0].note, 'ok')
  assert.equal(nota.d.questions[1].delegated, true)
})

test('esc com respostas abre a tela D: enviar as respondidas / descartar tudo / continuar', async () => {
  const send = await batch(['1', K.esc, K.enter])
  const d = send.trace.find((t) => t.includes('Sair das perguntas?'))!
  assert.ok(d.includes('1 de 3 respondidas') && d.includes('Enviar as 1 respondidas') && d.includes('Descartar tudo') && d.includes('Continuar respondendo') && d.includes('esc continua'))
  assert.equal(send.text, 'Plano?\nUser selected: 1. T1\n\nCadastro?\nnot answered\n\nAuth?\nnot answered')

  const discard = await batch(['1', K.esc, '2'])
  assert.equal(discard.text, `User discarded all answers (Esc). ${AGAIN}`)
  assert.ok(discard.d.questions.every((q: any) => q.answer === null))

  const keep = await batch(['1', K.esc, K.esc, '1', 's', K.enter]) // esc na tela D = continuar; a pergunta 2 segue aberta
  assert.equal(keep.text, 'Plano?\nUser selected: 1. T1\n\nCadastro?\nUser selected: 1. Manter (Recomendado)\n\nAuth?\nUser skipped this question. ' + AGAIN)
  const viaDown = await batch(['1', K.esc, K.down, K.enter]) // ↓⏎ = descartar
  assert.equal(viaDown.text, `User discarded all answers (Esc). ${AGAIN}`)
  const revEsc = await batch(['1', '1', '1', K.esc, '3', K.enter]) // esc na revisão também abre D; 3 continua
  assert.ok(revEsc.trace.some((t) => t.includes('3 de 3 respondidas')) && revEsc.text.endsWith('Auth?\nUser selected: 1. P'))
})

test('esc sem nenhuma resposta no lote sai direto, com o texto de dispensa', async () => {
  const r = await batch([K.esc])
  assert.equal(r.text, `User dismissed the question without answering (Esc). ${AGAIN}`)
  assert.ok(!r.trace.some((t) => t.includes('Sair das perguntas')))
  assert.ok(r.d.questions.every((q: any) => q.answer === null))
})

test('remoto: resposta remota ainda ganha da local num lote (claim/settle)', async () => {
  let tool: any
  let offer: any
  const handlers: any[] = []
  mod.default({ registerTool: (t: any) => (tool = t), on() {}, events: { on: (_c: string, h: any) => handlers.push(h), emit: (_c: string, o: any) => { offer = o; const settle = o.claim(); setTimeout(() => settle({ action: 'answer', indices: [2] }), 0) } } })
  const h = harness([K.enter]) // as duas perguntas são respondidas pelo remoto; ⏎ envia a revisão
  const res = await tool.execute('id', { questions: Q.slice(0, 1).concat(Q.slice(0, 1)) }, undefined, undefined, h.ctx)
  assert.ok(offer && res.content[0].text.includes('User selected: 2. T2'))
})

// ---------------------------------------------------------------------------------------------------- resultado no chat

test('renderResult: pulada, decide você, nota, não respondida; os existentes seguem', () => {
  let tool: any
  mod.default({ registerTool: (t: any) => (tool = t), on() {}, events: { on() {}, emit() {} } })
  const show = (details: any) => strip(tool.renderResult({ content: [{ type: 'text', text: 'x' }], details }, {}, theme).render(100).join('\n'))
  const base = { question: 'Q?', options: ['a', 'b'] }
  assert.ok(show({ ...base, answer: '', skipped: true }).includes('↷ pulada'))
  const dele = show({ ...base, answer: '', delegated: true, note: 'tanto faz' })
  assert.ok(dele.includes('decide você') && dele.includes('tanto faz'))
  assert.ok(show({ ...base, answer: 'a', note: 'porque sim' }).includes('nota: porque sim'))
  assert.ok(show({ ...base, answer: null, pending: true }).includes('não respondida'))
  assert.ok(show({ ...base, answer: null }).includes('cancelada'))
  assert.ok(show({ ...base, answer: 'a' }).includes('a'))
})

test('telas auxiliares: ajuda em uma coluna quando estreita; exit e review cabem na largura', () => {
  const wide = limpo(nav.helpLines(90, ansi))
  assert.ok(wide.some((l: string) => l.includes('escolhe (multi: marca)') && l.includes('pergunta anterior/próxima')))
  const narrow = limpo(nav.helpLines(50, ansi))
  assert.ok(narrow.every((l: string) => [...l].length <= 50) && narrow.some((l: string) => l.includes('escolhe (multi: marca)') && !l.includes('pergunta anterior')))
  assert.ok(limpo(nav.exitLines(60, ansi, 2, 4, 1)).every((l: string) => [...l].length <= 60))
})

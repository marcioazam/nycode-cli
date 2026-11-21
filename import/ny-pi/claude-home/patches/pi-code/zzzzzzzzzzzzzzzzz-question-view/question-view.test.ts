// Testes do zzzzzzzzzzzzzzzzz-question-view.patch: node --experimental-strip-types --test ~/.pi/agent/claude-home/patches/pi-code/zzzzzzzzzzzzzzzzz-question-view/question-view.test.ts
// Pedido do dono (2026-11-14): a tool question aparece como lista (● escolhida, ○ demais), desenhada uma vez só.
import assert from 'node:assert/strict'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
// Ícone fixo nos testes: sem Nerd Font a pergunta usa `?` (o ícone de balões depende do terminal; ver questionGlyph).
process.env.PI_ASCII_ICONS = '1'

// O Node não tira tipos de .ts dentro de node_modules: testa uma cópia do pacote, com o pi ao lado.
const tmp = mkdtempSync(join(tmpdir(), 'question-view-test-'))
after(() => rmSync(tmp, { recursive: true }))
cpSync(`${homedir()}/.pi/agent/npm/node_modules/pi-code/extensions`, join(tmp, 'extensions'), { recursive: true })
const rel = `${homedir()}/.pi/agent/install/releases/${readFileSync(`${homedir()}/.pi/agent/install/current-version`, 'utf8').trim()}/node_modules`
mkdirSync(join(tmp, 'node_modules'))
for (const m of ['@earendil-works', 'typebox']) symlinkSync(join(rel, m), join(tmp, 'node_modules', m))
const question = (await import(join(tmp, 'extensions', 'question.ts'))).default

let tool: any
question({ registerTool: (t: any) => (tool = t), events: { emit() {}, on() {} } } as any)

const theme: any = { fg: (c: string, s: string) => `<${c}:${s}>`, bold: (s: string) => `*${s}*` }
const draw = (c: any) => c.render(200).map((l: string) => l.trimEnd())
const call = (args: any, isPartial = true) => draw(tool.renderCall(args, theme, { isPartial }))
const result = (details: any) => draw(tool.renderResult({ content: [{ type: 'text', text: 'x' }], details }, { expanded: false, isPartial: false }, theme))

const args = { question: 'Como resolvo?', header: 'Tipos', options: [{ label: 'Tipos continuam ciano (Recomendado · ~80%)', description: 'oculta' }, { label: 'Tipos na cor do texto' }] }
const details = { question: 'Como resolvo?', header: 'Tipos', options: ['Tipos continuam ciano (Recomendado · ~80%)', 'Tipos na cor do texto'] }

// Pedido do dono (2026-11-14): enquanto o diálogo está aberto a pergunta não aparece também no chat (ficava duplicada);
// o bloco só entra no chat depois da resposta, desenhado pelo resultado.
test('renderCall não desenha nada, nem pendente nem depois: a pergunta entra no chat só com a resposta', () => {
  assert.deepEqual(call(args).join('').trim(), '')
  assert.deepEqual(call(args, false).join('').trim(), '')
})

// Variante A (dono, 2026-11-14; prévia /tmp/pergunta-bloco.png): estado + ícone + título + RESPOSTA no cabeçalho, a pergunta
// embaixo com │; as opções só aparecem ao abrir (ctrl+o). Antes: pergunta na linha do título e a lista inteira sempre visível.
const open = (details: any) => draw(tool.renderResult({ content: [{ type: 'text', text: 'x' }], details }, { expanded: true, isPartial: false }, theme))
const ASK = '<dim:│> <muted:Como resolvo?>'

// Pedido do dono (2026-11-14): o título é sempre "pergunta"; a etiqueta do modelo (header, ex. "Forma") vem depois, apagada.
test('sem header o rótulo é só "pergunta"', () => {
  assert.deepEqual(result({ question: 'Qual?', options: ['a', 'b'], answer: 'a' }), ['  <accent:?> <toolTitle:*pergunta*>  <success:a>', '<dim:│> <muted:Qual?><dim: · ctrl+o abre>'])
})

test('respondida: resposta no cabeçalho (sem a etiqueta), pergunta embaixo; aberta lista ● escolhida e ○ demais', () => {
  const d = { ...details, answer: 'Tipos continuam ciano (Recomendado · ~80%)' }
  assert.deepEqual(result(d), ['  <accent:?> <toolTitle:*pergunta*> <dim:· Tipos>  <success:Tipos continuam ciano>', `${ASK}<dim: · ctrl+o abre>`])
  assert.deepEqual(open(d), [
    '  <accent:?> <toolTitle:*pergunta*> <dim:· Tipos>  <success:Tipos continuam ciano>',
    `${ASK}<dim: · ctrl+o fecha>`,
    '<dim:│> <success:●> <text:Tipos continuam ciano>  <dim:recomendada · ~80%>',
    '<dim:│> <dim:○> <dim:Tipos na cor do texto>',
  ])
})

test('texto livre: o texto digitado é a resposta; aberta mostra-o como linha escolhida, sem "Outra resposta"', () => {
  const d = { ...details, answer: 'meu jeito', wasCustom: true }
  assert.equal(result(d)[0], '  <accent:?> <toolTitle:*pergunta*> <dim:· Tipos>  <success:meu jeito>')
  const lines = open(d)
  assert.equal(lines.at(-1), '<dim:│> <success:●> <text:meu jeito>')
  assert.equal(lines.some((l: string) => l.includes('Outra resposta')), false)
})

test('multiSelect marca várias', () => {
  const d = { question: 'Q?', options: ['a', 'b', 'c'], multiSelect: true, answer: 'a, c' }
  assert.equal(result(d)[0], '  <accent:?> <toolTitle:*pergunta*>  <success:a, c>')
  assert.deepEqual(open(d).slice(2), ['<dim:│> <success:●> <text:a>', '<dim:│> <dim:○> <dim:b>', '<dim:│> <success:●> <text:c>'])
})

test('cancelada e tempo esgotado: sem ícone de estado, o motivo em amarelo no lugar da resposta; aberta lista tudo ○ dim', () => {
  assert.deepEqual(result({ ...details, answer: null }), ['  <accent:?> <toolTitle:*pergunta*> <dim:· Tipos>  <warning:cancelada> <dim:· sem resposta>', `${ASK}<dim: · ctrl+o abre>`])
  assert.deepEqual(open({ ...details, answer: null }).slice(2), ['<dim:│> <dim:○> <dim:Tipos continuam ciano>  <dim:recomendada · ~80%>', '<dim:│> <dim:○> <dim:Tipos na cor do texto>'])
  assert.equal(result({ ...details, answer: '', timedOut: true })[0], '  <accent:?> <toolTitle:*pergunta*> <dim:· Tipos>  <warning:tempo esgotado> <dim:· seguiu sem resposta>')
})

test('lote: um bloco por pergunta, separados por linha em branco', () => {
  const a = { question: 'A?', options: ['x'], answer: 'x' }
  const b = { question: 'B?', options: ['y'], answer: 'y' }
  const lines = result({ ...a, questions: [a, b] })
  assert.equal(lines.filter((l: string) => l.includes('<accent:?>')).length, 2)
  assert.deepEqual(lines.map((l: string) => l === ''), [false, false, true, false, false])
})

test('sem details o resultado segue sendo o texto devolvido', () => {
  assert.deepEqual(draw(tool.renderResult({ content: [{ type: 'text', text: 'erro' }] }, {}, theme)), ['erro'])
})

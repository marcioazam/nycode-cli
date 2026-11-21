// Testes do zzzzzzzzzzzzzzzzzzzz-question-dialog.patch: node --experimental-strip-types --test ~/.pi/agent/claude-home/patches/pi-code/zzzzzzzzzzzzzzzzzzzz-question-dialog/question-dialog.test.ts
// Pedido do dono (2026-11-14): a pergunta aparecia duas vezes (no chat e no diálogo) e o diálogo cortava textos com "...".
import assert from 'node:assert/strict'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
// Ícone fixo nos testes: sem Nerd Font a pergunta usa `?` (o ícone de balões depende do terminal; ver questionGlyph).
process.env.PI_ASCII_ICONS = '1'

const tmp = mkdtempSync(join(tmpdir(), 'question-dialog-test-'))
after(() => rmSync(tmp, { recursive: true }))
cpSync(`${homedir()}/.pi/agent/npm/node_modules/pi-code/extensions`, join(tmp, 'extensions'), { recursive: true })
const rel = `${homedir()}/.pi/agent/install/releases/${readFileSync(`${homedir()}/.pi/agent/install/current-version`, 'utf8').trim()}/node_modules`
mkdirSync(join(tmp, 'node_modules'))
for (const m of ['@earendil-works', 'typebox']) symlinkSync(join(rel, m), join(tmp, 'node_modules', m))
const mod = await import(join(tmp, 'extensions', 'question.ts'))

const theme = { fg: (c: string, s: string) => `<${c}>${s}</${c}>`, bold: (s: string) => `<b>${s}</b>` }
const editor = { render: () => ['[editor]'] }
const strip = (l: string[]) => l.join('\n').replace(/<\/?[a-z]+>/g, '')
const opts = [{ label: 'alpha', description: 'primeira' }, { label: 'beta' }]
const other = { label: 'Type something.', isOther: true }
const lines = (over: Record<string, unknown>) => mod.buildQuestionLines({ width: 80, question: 'Qual?', header: 'Abordagem', options: [...opts, other], optionIndex: 1, editMode: false, multiSelect: false, checked: [], editor, theme, ...over })

// Variante B (dono, 2026-11-14; prévia /tmp/pergunta-B.png): lista numerada curta (rótulo + resumo de uma linha), recomendada
// marcada com ★, painel com a descrição inteira só da opção em foco, tecla 1-9 escolhe direto.
const ansi = { fg: (_c: string, x: string) => `\x1b[2m${x}\x1b[22m`, bold: (x: string) => `\x1b[1m${x}\x1b[22m` }
const limpo = (l: string[]) => l.map((x) => x.replace(/\x1b\[[0-9;]*m/g, '').trimEnd())

test('cabeçalho: ? título à esquerda, tipo à direita; rodapé com 1-N', () => {
  assert.match(limpo(lines({ theme: ansi }))[1]!, /^ \? pergunta · Abordagem +escolha uma$/)
  assert.match(limpo(lines({ theme: ansi, options: opts, multiSelect: true, checked: [true, false] }))[1]!, /^ \? pergunta · Abordagem +escolha um ou mais$/)
  assert.match(limpo(lines({ theme: ansi, header: undefined }))[1]!, /^ \? pergunta +escolha uma$/)
  assert.equal(limpo(lines({ theme: ansi })).at(-2), ' 1-3 escolhe · ↑↓ move · s pula · ? ajuda · esc sai')
  assert.equal(limpo(lines({ theme: ansi, options: opts, multiSelect: true, checked: [] })).at(-2), ' 1-2 marca · ↑↓ move · espaço marca · ⏎ confirma · s pula · ? ajuda · esc sai')
  assert.ok(lines({}).some((l: string) => l.includes('<accent><b>❯ 2</b></accent>  <accent><b>beta')))
})

// Dono, 2026-11-15: a lista mostra só o título (o resumo de uma linha saiu); a descrição fica no painel da opção em foco.
test('variante B: uma linha por opção com número e só o título; ★ recomendada; painel só da opção em foco, com altura estável', () => {
  const longa = 'Mesma conta do baseline já gravado. Então a comparação continua limpa e eu tento de novo a cada 30 minutos, sem trocar de conta nem de modelo no meio.'
  const o = [{ label: 'Esperar (Recomendado · ~80%)', description: longa }, { label: 'Reduzir', description: 'Corta o lote pela metade.' }, { label: 'Type something.', isOther: true }]
  const ver = (optionIndex: number) => limpo(mod.buildQuestionLines({ width: 90, question: 'A conta está no limite de uso desde 14:12 e as duas retomadas falharam, então o lote parou. Como seguir?', header: 'Conta', options: o, optionIndex, editMode: false, multiSelect: false, checked: [], editor, theme: ansi }))
  const t = ver(0)
  assert.ok(t.join(' ').replace(/\s+/g, ' ').includes('então o lote parou. Como seguir?')) // pergunta inteira, quebrada
  assert.ok(t.every((x) => [...x].length <= 90) && !t.some((x) => x.includes('...')))
  const i = t.findIndex((x) => x.startsWith(' ❯ 1  Esperar'))
  assert.match(t[i]!, /^ ❯ 1  Esperar +★ recomendada · ~80%$/)
  assert.equal(t[i + 1], '   2  Reduzir')
  assert.equal(t[i + 2], '   3  Outra resposta…')
  assert.equal(t[i + 3], '')
  assert.match(t[i + 4]!, /^ ─── Esperar ─+$/)
  const painel = t.slice(i + 5, -3)
  assert.ok(painel.length >= 2 && painel.join(' ').replace(/\s+/g, ' ').includes('nem de modelo no meio.')) // descrição inteira
  // foco em outra opção: o painel troca e a altura do diálogo não muda
  const t2 = ver(1)
  assert.ok(t2.some((x) => /^ ─── Reduzir ─+$/.test(x)) && t2.includes(' Corta o lote pela metade.'))
  assert.equal(t2.length, t.length)
  assert.equal(ver(2).length, t.length)
  // sem descrições: sem resumo e sem painel
  const curto = limpo(lines({ theme: ansi, options: [{ label: 'sim' }, { label: 'não' }], optionIndex: 0 }))
  assert.deepEqual(curto.slice(3, -3), ['', ' ❯ 1  sim', '   2  não'])
})

async function drive(options: any[], multiSelect: boolean, keys: string[]) {
  let handler: any
  const ctx = { ui: { custom: (f: any) => new Promise((resolve) => { handler = f({ requestRender() {}, terminal: { rows: 24, columns: 80 } }, theme, null, resolve) }) } }
  const p = mod.askViaOverlay({ question: 'Qual?', options: opts, multiSelect }, ctx, options, multiSelect)
  for (const k of keys) handler.handleInput(k)
  return p
}

test('tecla numérica: escolhe e confirma; em múltipla marca; em "Outra resposta" abre o texto; fora da faixa é ignorada', async () => {
  assert.deepEqual(await drive([...opts, other], false, ['2']), { answer: 'beta', wasCustom: false, index: 2 })
  assert.deepEqual(await drive([...opts, other], false, ['9', '1']), { answer: 'alpha', wasCustom: false, index: 1 })
  assert.deepEqual(await drive([...opts, other], false, ['3', 'o', 'i', '\r']), { answer: 'oi', wasCustom: true })
  assert.deepEqual(await drive(opts, true, ['2', '1', '\r']), { answer: 'alpha, beta', wasCustom: false })
  assert.deepEqual(await drive([...opts, other], false, ['\x1b[B', '\r']), { answer: 'beta', wasCustom: false, index: 2 }) // setas seguem valendo
})

test('chat: a chamada não desenha nada; a pergunta entra só com a resposta', () => {
  let tool: any
  mod.default({ registerTool: (t: any) => (tool = t), on() {}, events: { on() {}, emit() {} } })
  const args = { question: 'Como?', options: [{ label: 'a' }, { label: 'b' }] }
  for (const isPartial of [true, false]) assert.equal(tool.renderCall(args, theme, { isPartial }).render(80).join('').trim(), '')
  const res = tool.renderResult({ content: [{ type: 'text', text: 'x' }], details: { question: 'Como?', options: ['a', 'b'], answer: 'a' } }, {}, theme).render(80)
  // variante A do bloco (dono, 2026-11-14): resposta no cabeçalho, pergunta embaixo (antes: lista com ● a)
  assert.match(strip(res).replace(/\s+/g, ' '), /\? .*pergunta.* a │ Como\? · ctrl\+o abre/)
})

// Pedido do dono (2026-11-14): ícone da pergunta = dois balões (cod-comment_discussion, U+EAC7), de uma cor só, no bloco do
// chat e no cabeçalho do diálogo. Só onde há Nerd Font (mesma regra de extensions/ui-visual/icons.ts); senão `?`.
test('ícone: balões com Nerd Font, ? sem', () => {
  assert.equal(mod.questionGlyph({ TERM: 'xterm-kitty' }), '\ueac7')
  assert.equal(mod.questionGlyph({ KITTY_WINDOW_ID: '1' }), '\ueac7')
  assert.equal(mod.questionGlyph({ PI_NERD_FONT: '1' }), '\ueac7')
  assert.equal(mod.questionGlyph({ TERM: 'xterm-kitty', PI_ASCII_ICONS: '1' }), '?')
  assert.equal(mod.questionGlyph({ TERM: 'xterm-256color' }), '?')
  delete process.env.PI_ASCII_ICONS
  process.env.PI_NERD_FONT = '1'
  try {
    assert.ok(limpo(lines({ theme: ansi }))[1]!.startsWith(' \ueac7 pergunta · Abordagem'))
  } finally {
    delete process.env.PI_NERD_FONT
    process.env.PI_ASCII_ICONS = '1'
  }
})

// Pedido do dono (2026-11-14, variante A de /tmp/rec.png): a linha da opção recomendada leva o fundo verde suave das tools
// com sucesso, de ponta a ponta, com ou sem o foco nela. As demais linhas seguem sem fundo.
// Dono, 2026-11-15: a recomendada usa o ciano da paleta do sistema (token syntaxType = vars.cyan) sobre toolPendingBg, não mais o verde.
test('recomendada: ★ em ciano (syntaxType) e fundo toolPendingBg na linha inteira, com e sem foco; as outras sem fundo', () => {
  const cor = { fg: (_c: string, x: string) => `\x1b[2m${x}\x1b[22m`, bold: (x: string) => `\x1b[1m${x}\x1b[22m`, bg: (c: string, x: string) => `\x1b[48;5;${c === 'toolPendingBg' ? 22 : 99}m${x}\x1b[49m` }
  const o = [{ label: 'Esperar (Recomendado)', description: 'Mesma conta.' }, { label: 'Reduzir', description: 'Corta o lote.' }, { label: 'Type something.', isOther: true }]
  for (const optionIndex of [0, 1]) {
    const l = mod.buildQuestionLines({ width: 70, question: 'Qual?', options: o, optionIndex, editMode: false, multiSelect: false, checked: [], editor, theme: cor }) as string[]
    const rec = l.filter((x) => x.includes('Esperar') && x.includes('★'))
    assert.equal(rec.length, 1)
    assert.ok(rec[0]!.startsWith('\x1b[48;5;22m') && rec[0]!.endsWith('\x1b[49m'))
    assert.equal([...rec[0]!.replace(/\x1b\[[0-9;]*m/g, '')].length, 70) // largura inteira
    assert.match(rec[0]!.replace(/\x1b\[[0-9;]*m/g, ''), /★ recomendada $/)
    assert.equal(l.filter((x) => x.includes('\x1b[48;')).length, 1)
  }
  // width 140: o tema de etiquetas `<tag>` conta como largura visível; com 70 o truncamento cortava o </syntaxType>.
  const tags = (mod.buildQuestionLines({ width: 140, question: 'Qual?', options: o, optionIndex: 1, editMode: false, multiSelect: false, checked: [], editor, theme }) as string[]).join('\n')
  assert.ok(tags.includes('<syntaxType>★ recomendada</syntaxType>'))
  // tema sem fundo (ou sem recomendada): nada muda
  assert.ok(!lines({ theme: ansi }).some((x: string) => x.includes('\x1b[48;')))
})

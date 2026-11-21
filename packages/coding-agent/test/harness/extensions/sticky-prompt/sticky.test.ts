import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
const agent = process.env.PI_AGENT_DIR ?? path.join(homedir(), '.pi/agent')
const tui = `${agent}/install/releases/${readFileSync(`${agent}/install/current-version`, 'utf8').trim()}/node_modules/@earendil-works/pi-tui/dist`
const { stripTerminalSequences, truncateToWidth, visibleWidth } = await import(`${tui}/utils.js`)
import { findSticky, selecting, stickyLine, stickyStyle, userMatcher } from './sticky.ts'

const BG = '\x1b[48;5;236m'
const A = '\x1b]133;A\x07'
const BC = '\x1b]133;B\x07\x1b]133;C\x07'
const lines = [
  `${A}${BG}   \x1b[49m`, `${BG} primeiro pedido \x1b[49m`, `${BC}${BG}   \x1b[49m`,
  `${A}resposta do assistente`, `${BC}fim`,
  `${A}${BG}   \x1b[49m`, `${BG} segundo \x1b[1mpedido\x1b[22m \x1b[49m`, `${BG} linha 2 \x1b[49m`, `${BC}${BG}   \x1b[49m`,
  'saída', 'mais saída',
]
const strip = stripTerminalSequences
const isUser = userMatcher(['Primeiro   pedido', 'segundo **pedido**\nlinha 2', '???'])

test('matcher ignora pontuação, markdown e textos vazios', () => {
  assert.equal(isUser('primeiro pedido'), true)
  assert.equal(isUser('resposta do assistente fim'), false)
  assert.equal(userMatcher(['!!'])('qualquer'), false)
})

test('acha o prompt do usuário mais recente acima da janela, ignorando o assistente', () => {
  assert.deepEqual(findSticky(lines, 10, isUser, strip), { row: 5, text: 'segundo pedido linha 2' })
  assert.deepEqual(findSticky(lines, 5, isUser, strip), { row: 0, text: 'primeiro pedido' })
  assert.deepEqual(findSticky(lines, 4, isUser, strip), { row: 0, text: 'primeiro pedido' })
})

test('nada quando nenhum prompt saiu da janela', () => {
  assert.equal(findSticky(lines, 0, isUser, strip), undefined)
  assert.equal(findSticky(['x', `${A}${BG}assistente`], 2, isUser, strip), undefined)
  assert.deepEqual(findSticky(lines, 999, isUser, strip)?.row, 5)
})

test('linha cabe na largura e trunca com reticências', () => {
  const id = (s: string) => s
  const short = stickyLine('oi', 20, truncateToWidth, visibleWidth, id)
  assert.equal(visibleWidth(short), 20)
  assert.ok(short.startsWith(' ❯ oi'))
  const long = stickyLine('x'.repeat(100), 30, truncateToWidth, visibleWidth, id)
  assert.equal(visibleWidth(long), 30)
  assert.ok(long.includes('…'))
  assert.ok(stickyLine('a', 1, truncateToWidth, visibleWidth, (s) => `[${s}]`).startsWith('['))
})

test('estilo usa selectedBg/text do tema e fecha as cores', () => {
  // tema colorido falso
  const theme = { getFgAnsi: () => '<fg>', getBgAnsi: () => '<bg>' }
  assert.equal(stickyStyle(theme)('x'), '<bg><fg>x\x1b[39m\x1b[49m')
})

test('tema mono (NO_COLOR) não emite SGR', () => {
  // cor vazia no pi = reset padrão: nenhuma sequência de escape
  const mono = { getFgAnsi: () => '\x1b[39m', getBgAnsi: () => '\x1b[49m' }
  assert.equal(stickyStyle(mono)('x'), 'x')
  assert.equal(stickyStyle({ getFgAnsi: () => '', getBgAnsi: () => '' })('x'), 'x')
})

test('estilo relê o tema a cada chamada', () => {
  // o tema muda em runtime
  let on = true
  const theme = { getFgAnsi: () => (on ? '<fg>' : '\x1b[39m'), getBgAnsi: () => (on ? '<bg>' : '\x1b[49m') }
  const style = stickyStyle(theme)
  assert.ok(style('a').includes('<bg>'))
  on = false
  assert.equal(style('a'), 'a')
})

test('seleção em andamento esconde o sticky: o pi-tui só ancora no transcript (e rola) sem overlay visível', () => {
  assert.equal(selecting({ selectionPressActive: true }), true)
  assert.equal(selecting({ selectionPressActive: false }), false)
  assert.equal(selecting({}), false)
})

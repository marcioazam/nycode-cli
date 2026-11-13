// Testes do statusline-multiline.patch: node --experimental-strip-types --test ~/.pi/agent/claude-home/patches/pi-code/statusline-multiline.test.ts
import assert from 'node:assert/strict'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

// O Node não tira tipos de .ts dentro de node_modules: testa uma cópia do pacote, com o pi ao lado.
const tmp = mkdtempSync(join(tmpdir(), 'statusline-test-'))
const ext = join(tmp, 'extensions')
cpSync(`${homedir()}/.pi/agent/npm/node_modules/pi-code/extensions`, ext, { recursive: true })
mkdirSync(join(tmp, 'node_modules'))
symlinkSync(`${homedir()}/.pi/agent/install/releases/${readFileSync(`${homedir()}/.pi/agent/install/current-version`, 'utf8').trim()}/node_modules/@earendil-works`, join(tmp, 'node_modules', '@earendil-works'))
const sl = await import(`${ext}/status-line.ts`)
const { visibleWidth } = await import(`${tmp}/node_modules/@earendil-works/pi-tui/dist/index.js`)

test('1 linha vai ao footer, com padding', () => {
  assert.deepEqual(sl.statusRows('  a b \n', 2), { footer: '  a b  ', rows: [] })
})

test('3 linhas viram rows do widget, sem footer, vazias descartadas', () => {
  assert.deepEqual(sl.statusRows('one\n\n two \nthree\n', 0), { footer: undefined, rows: ['one', 'two', 'three'] })
})

test('saída vazia limpa tudo', () => {
  assert.deepEqual(sl.statusRows('\n  \n', 1), { footer: undefined, rows: [] })
})

test('padding à esquerda nas rows do widget', () => {
  assert.deepEqual(sl.statusRows('a\nb', 2).rows, ['  a', '  b'])
})

test('renderStatusRows trunca por largura visível, ciente de ANSI', () => {
  const out = sl.renderStatusRows(['\x1b[31mabcdefghij\x1b[0m', 'ok'], 6)
  assert.equal(out.length, 2)
  assert.ok(out[0].includes('\x1b[31m'))
  assert.ok(visibleWidth(out[0]) <= 6)
  assert.equal(out[1], 'ok')
})

test('status de extensão absorvido vai ao fim da última row (a de tools), separado como o HUD', () => {
  const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '')
  const out = sl.renderStatusRows(['model', '✓ Bash ×12 | ✓ Read ×2'], 80, ['\x1b[36m📋 0/8\x1b[0m'])
  assert.equal(out[0], 'model')
  assert.equal(strip(out[1]), '✓ Bash ×12 | ✓ Read ×2 | 📋 0/8')
  assert.deepEqual(sl.renderStatusRows(['a', 'b'], 80, []), ['a', 'b'])
  assert.deepEqual(sl.renderStatusRows([], 80, ['📋 1/2']), [])
  assert.deepEqual(sl.renderStatusRows(['a', 'b'], 80, ['', undefined]), ['a', 'b'])
  assert.ok(visibleWidth(sl.renderStatusRows(['x'.repeat(20)], 22, ['📋 1/2'])[0]) <= 22)
})

test('ponte do footer: a extensão de footer publica o provedor; o HUD lê o status vivo e marca a chave como absorvida', () => {
  const statuses = new Map([['plan-mode', '📋 3/8'], ['bypass', 'BYPASS']])
  const bridge = { footerData: { getExtensionStatuses: () => statuses }, absorbed: new Set<string>() }
  const hud = sl.hudFooterBridge()
  hud.attach(bridge)
  assert.deepEqual(hud.trailers(), ['📋 3/8'])
  hud.claim(true)
  assert.deepEqual([...bridge.absorbed], ['plan-mode'])
  statuses.set('plan-mode', '📋 4/8')
  assert.deepEqual(hud.trailers(), ['📋 4/8'], 'lido na hora do render, sem cópia')
  hud.claim(false)
  assert.equal(bridge.absorbed.size, 0, 'sem widget o footer volta a mostrar o status')
  assert.deepEqual(sl.hudFooterBridge().trailers(), [], 'sem footer publicado não há trailer')
  const bad = sl.hudFooterBridge()
  bad.attach({})
  bad.attach(null)
  assert.deepEqual(bad.trailers(), [], 'payload inválido é ignorado')
  bad.claim(true)
  const late = { footerData: { getExtensionStatuses: () => statuses }, absorbed: new Set<string>() }
  hud.claim(true)
  hud.attach(late)
  assert.deepEqual([...late.absorbed], ['plan-mode'], 'footer recriado depois do widget herda a marca')
})

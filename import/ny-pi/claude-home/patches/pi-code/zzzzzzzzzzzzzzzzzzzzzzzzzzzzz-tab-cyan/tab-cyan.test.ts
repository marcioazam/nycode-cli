// Testes do zzzzzzzzzzzzzzzzzzzzzzzzzzzzz-tab-cyan.patch: node --experimental-strip-types --test ~/.pi/agent/claude-home/patches/pi-code/zzzzzzzzzzzzzzzzzzzzzzzzzzzzz-tab-cyan/tab-cyan.test.ts
// Dono, 2026-11-15: o ciano do sistema (`syntaxType`) marca onde está o foco. Com o foco no composer, a tab aberta fica ciana
// (nome e `━`); com uma tab focada (↓ no editor vazio, ← →), o ciano vai para ela e a aberta mantém a cor do pi.
import assert from 'node:assert/strict'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

const tmp = mkdtempSync(join(tmpdir(), 'tab-cyan-test-'))
after(() => rmSync(tmp, { recursive: true }))
cpSync(`${homedir()}/.pi/agent/npm/node_modules/pi-code/extensions`, join(tmp, 'extensions'), { recursive: true })
const rel = `${homedir()}/.pi/agent/install/releases/${readFileSync(`${homedir()}/.pi/agent/install/current-version`, 'utf8').trim()}/node_modules`
mkdirSync(join(tmp, 'node_modules'))
for (const m of ['@earendil-works', 'typebox']) symlinkSync(join(rel, m), join(tmp, 'node_modules', m))
const { tabBar } = await import(join(tmp, 'extensions', 'subagent', 'fleet-ui', 'chrome.ts'))

const theme = { fg: (c: string, s: string) => `<${c}>${s}</${c}>`, bold: (s: string) => `<b>${s}</b>` }
// Largura folgada: as tags falsas do tema contam como texto visível.
const tab = (id: string, open: boolean, focus: boolean) => ({ id, label: id, open, focus })

test('foco no composer: a tab aberta fica ciana (nome e régua)', () => {
  const { lines } = tabBar([tab('status', true, false), tab('run', false, false)], '', theme, 200)
  assert.ok(lines[1].startsWith('<b><syntaxType>status</syntaxType></b>'), lines[1])
  assert.ok(lines[2].startsWith('<b><syntaxType>━━━━━━</syntaxType></b>'), lines[2])
  assert.ok(lines[1].includes('<dim>run</dim>'), lines[1])
})

test('tab focada: o ciano vai para ela; a aberta mantém a cor do pi', () => {
  const { lines } = tabBar([tab('status', true, false), tab('run', false, true)], '', theme, 200)
  assert.ok(lines[1].includes('<b><syntaxType>run</syntaxType></b>'), lines[1])
  assert.ok(lines[1].startsWith('<b><text>status</text></b>'), lines[1])
  assert.ok(lines[2].includes('<b><syntaxType>━━━</syntaxType></b>'), lines[2])
  assert.ok(lines[2].startsWith('<b><text>━━━━━━</text></b>'), lines[2])
})

test('tab aberta e focada: ciano', () => {
  const { lines } = tabBar([tab('status', true, true)], '', theme, 200)
  assert.ok(lines[1].startsWith('<b><syntaxType>status</syntaxType></b>'), lines[1])
})

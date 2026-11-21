// Testes do zzzzzzzzzzzzzzzzzzzzzzzz-rules-notice.patch: node --experimental-strip-types --test ~/.pi/agent/claude-home/patches/pi-code/zzzzzzzzzzzzzzzzzzzzzzzz-rules-notice/rules-notice.test.ts
// Pedido do dono (2026-11-15, variante A): "Rules loaded: global yes, project 0" vira caixa neutra
// `⚖ regras  2 globais · nenhuma do projeto · sempre ativas`, no desenho do aviso de memória.
import assert from 'node:assert/strict'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

// O Node não tira tipos de .ts dentro de node_modules: testa uma cópia do pacote, com o pi ao lado.
const tmp = mkdtempSync(join(tmpdir(), 'rules-notice-test-'))
after(() => rmSync(tmp, { recursive: true }))
cpSync(`${homedir()}/.pi/agent/npm/node_modules/pi-code/extensions`, join(tmp, 'extensions'), { recursive: true })
const rel = `${homedir()}/.pi/agent/install/releases/${readFileSync(`${homedir()}/.pi/agent/install/current-version`, 'utf8').trim()}/node_modules`
mkdirSync(join(tmp, 'node_modules'))
for (const m of ['@earendil-works', 'typebox']) symlinkSync(join(rel, m), join(tmp, 'node_modules', m))
const { rulesLoadedMessage } = await import(join(tmp, 'extensions', 'claude-rules.ts'))

const set = (inline: number, scoped: number) => ({ inline: Array(inline).fill({}), scoped: Array(scoped).fill({}) })
const fg = (c: string, s: string) => `<${c}>${s}</>`
const theme = { fg, bold: (s: string) => `*${s}*` }

test('cores do aviso de memória: ícone accent, título em negrito, contagens muted, modo dim', () => {
  assert.equal(
    rulesLoadedMessage(set(2, 0), set(0, 0), theme, {}),
    '<accent>§</> <text>*regras*</>  <muted>2 globais</> <dim>·</> <muted>nenhuma do projeto</> <dim>· sempre ativas</>',
  )
})

test('singular, só do projeto, por arquivo e misto', () => {
  assert.equal(rulesLoadedMessage(set(1, 0), set(0, 0), undefined, {}), '§ regras  1 global · nenhuma do projeto · sempre ativa')
  assert.equal(rulesLoadedMessage(set(0, 0), set(0, 3), undefined, {}), '§ regras  nenhuma global · 3 do projeto · por arquivo')
  assert.equal(rulesLoadedMessage(set(2, 1), set(1, 1), undefined, {}), '§ regras  3 globais · 2 do projeto · 3 sempre ativas · 2 por arquivo')
})

test('martelo com Nerd Font (kitty ou PI_NERD_FONT=1); pedido ASCII vence', () => {
  // kitty desenha o ícone por cima do espaço seguinte: dois espaços mantêm o vão (zzzzzzzzzzzzzzzzzzzzzzzzzz-icon-gap.patch).
  assert.ok(rulesLoadedMessage(set(1, 0), set(0, 0), undefined, { KITTY_WINDOW_ID: '1' })!.startsWith('\uf0e3  regras'))
  assert.ok(rulesLoadedMessage(set(1, 0), set(0, 0), undefined, { PI_NERD_FONT: '1' })!.startsWith('\uf0e3 regras'))
  assert.ok(rulesLoadedMessage(set(1, 0), set(0, 0), undefined, { PI_NERD_FONT: '1', PI_ASCII_ICONS: '1' })!.startsWith('§ regras'))
})

test('nenhuma regra: sem aviso', () => {
  assert.equal(rulesLoadedMessage(set(0, 0), set(0, 0), theme, {}), undefined)
})

// Teste do zzzzzzzzzzzzzzzzzzzzzzzzzzzzzz-todo-follow-active.patch:
//   NO_COLOR=1 node --experimental-strip-types --test ~/.pi/agent/claude-home/patches/pi-code/zzzzzzzzzzzzzzzzzzzzzzzzzzzzzz-todo-follow-active/todo-follow-active.test.ts
// Bug (2026-11-15): numa lista maior que a janela, a aba Todo ficava presa no topo e mostrava só linhas feitas
// ("Todo 8/13", 6 linhas "feito"); o item em andamento e os pendentes ficavam fora da tela.
import assert from 'node:assert/strict'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

process.env.NO_COLOR = '1'
const HOME = homedir()
const EXT = process.env.PI_CODE_EXT ?? `${HOME}/.pi/agent/npm/node_modules/pi-code/extensions`
// O Node não tira tipos de .ts dentro de node_modules: testa uma cópia do pacote, com o pi ao lado.
const tmp = mkdtempSync(join(tmpdir(), 'todo-follow-active-test-'))
const ext = join(tmp, 'extensions')
cpSync(EXT, ext, { recursive: true })
mkdirSync(join(tmp, 'node_modules'))
const modules = `${HOME}/.pi/agent/install/releases/${readFileSync(`${HOME}/.pi/agent/install/current-version`, 'utf8').trim()}/node_modules`
symlinkSync(`${modules}/@earendil-works`, join(tmp, 'node_modules', '@earendil-works'))
symlinkSync(`${modules}/typebox`, join(tmp, 'node_modules', 'typebox'))
const { PlanSection } = await import(`${ext}/plan-mode/section.ts`)

const theme = { fg: (_c: string, t: string) => t, bold: (t: string) => t }
const tui = { requestRender() {}, terminal: { rows: 40 } }
const ctx: any = {
  hasUI: true,
  ui: { setWidget: (_k: string, f?: (t: unknown, th: unknown) => unknown) => void f?.(tui, theme) },
}
const step = (n: number, completed = false) => ({ step: n, text: `passo ${n}`, completed })

const body = (s: any): string => s.render(200).join('\n').replace(/\x1b\[[0-9;]*m/g, '')

test('a janela acompanha o primeiro item não concluído', () => {
  const s = new PlanSection()
  s.update(ctx, Array.from({ length: 13 }, (_, i) => step(i + 1, i < 8)), 'todo')
  const out = body(s)
  assert.match(out, /passo 9\b/, 'o primeiro item aberto aparece')
  assert.doesNotMatch(out, /passo 1\b/, 'o topo já concluído sai da janela')
})

test('lista que cabe na janela não rola', () => {
  const s = new PlanSection()
  s.update(ctx, [step(1, true), step(2, true), step(3)], 'todo')
  assert.match(body(s), /passo 1\b[\s\S]*passo 3\b/)
})

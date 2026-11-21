// Testes do zzzzzzzzzzzzzz-onda5-goal.patch: node --experimental-strip-types --test ~/.pi/agent/claude-home/patches/pi-code/zzzzzzzzzzzzzz-onda5-goal.test.ts
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

const HOME = homedir()
const PATCH = new URL('../zzzzzzzzzzzzzz-onda5-goal.patch', import.meta.url).pathname
const EXT = `${HOME}/.pi/agent/npm/node_modules/pi-code/extensions`
// O Node não tira tipos de .ts dentro de node_modules: testa uma cópia do pacote (pilha atual) com o patch por cima.
const tmp = mkdtempSync(join(tmpdir(), 'onda5-goal-test-'))
const ext = join(tmp, 'extensions')
cpSync(EXT, ext, { recursive: true })
mkdirSync(join(tmp, 'node_modules'))
const version = readFileSync(`${HOME}/.pi/agent/install/current-version`, 'utf8').trim()
symlinkSync(`${HOME}/.pi/agent/install/releases/${version}/node_modules/@earendil-works`, join(tmp, 'node_modules', '@earendil-works'))
try {
  symlinkSync(`${HOME}/.pi/agent/install/releases/${version}/node_modules/typebox`, join(tmp, 'node_modules', 'typebox'))
} catch {}

const applied = (() => {
  try {
    execFileSync('patch', ['-d', ext, '-p1', '-R', '-s', '--dry-run', '-i', PATCH], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()
if (!applied) {
  execFileSync('patch', ['-d', ext, '-p1', '-N', '-s', '--dry-run', '-i', PATCH])
  execFileSync('patch', ['-d', ext, '-p1', '-N', '-s', '--no-backup-if-mismatch', '-i', PATCH])
}

test('patch aplica sobre a pilha atual (ou já está aplicado) e reverte', () => {
  execFileSync('patch', ['-d', ext, '-p1', '-R', '-s', '--dry-run', '-i', PATCH])
})

const ui = await import(`${ext}/internal/goal-ui.ts`)
const ev = await import(`${ext}/internal/goal-evaluator.ts`)
const id = (s: string) => s
const style = { accent: id, success: id, error: id, warning: id, dim: id }
const summary = { condition: 'c', durationMs: 460_000, iterations: 5, tokens: 21_000, lastReason: 'falta fuso', evaluator: 'anthropic/haiku' }
const lines = (d: any, expanded = false) => ui.goalMessageLines('CONTENT', d, expanded, style, 'H')

test('mensagens: definido, ainda não, atingido, não pôde', () => {
  assert.deepEqual(lines({ kind: 'set', condition: 'escrever testes' }), ['◎ Objetivo definido escrever testes'])
  assert.deepEqual(lines({ kind: 'not_met', condition: 'c', reason: 'r' }), ['○ Objetivo ainda não atingido · continuando H'])
  assert.deepEqual(lines({ kind: 'achieved', condition: 'c', summary }), ['✓ Objetivo atingido (7m 40s · 5 turnos · 21.0k tok) H'])
  assert.deepEqual(lines({ kind: 'failed', condition: 'c', reason: 'serviço fora do ar', summary }), ['✗ Objetivo não pôde ser atingido (7m 40s · 5 turnos · 21.0k tok)', '  serviço fora do ar'])
  assert.deepEqual(lines({ kind: 'cleared', condition: 'c' }), ['Objetivo encerrado: c'])
  assert.deepEqual(lines({ kind: 'achieved', condition: 'c', reason: 'ok', summary }, true).slice(1), ['  Objetivo: c', '  Motivo: ok', '  Avaliador: anthropic/haiku'])
})

test('painel: ativo, atingido e vazio', () => {
  const a = ui.goalPanelLines({ active: summary }, style)
  assert.deepEqual(a, ['◎ Objetivo ativo', 'há 7m 40s · 5 turnos · 21.0k tok', '', 'Objetivo: c', 'Última checagem: falta fuso', 'Avaliador: anthropic/haiku', '', '/goal clear encerra · esc fecha'])
  const d = ui.goalPanelLines({ achieved: summary }, style)
  assert.deepEqual([d[0], d[1], d.at(-1)], ['✓ Objetivo atingido', '7m 40s · 5 turnos · 21.0k tok', '/goal <condição> define outro · esc fecha'])
  assert.deepEqual(ui.goalPanelLines({}, style), ['Nenhum objetivo · /goal <condição> define um', '', 'esc fecha'])
})

test('indicador: 0 turnos, 1 turno, N turnos e menos de 1s', () => {
  assert.equal(ui.indicatorText(500), '◎ objetivo')
  assert.equal(ui.indicatorText(500, 2), '◎ objetivo · 2 turnos')
  assert.equal(ui.indicatorText(252_000), '◎ objetivo · 4m 12s')
  assert.equal(ui.indicatorText(252_000, 1), '◎ objetivo · 1 turno · 4m 12s')
  assert.equal(ui.indicatorText(252_000, 3), '◎ objetivo · 3 turnos · 4m 12s')
})

test('lógica e texto do modelo intactos: summaryText segue em inglês', () => {
  assert.equal(ev.summaryText(summary), '7m 40s · 5 turns · 21.0k tokens')
})

test('goal.ts: o status passa os turnos e a notificação de limite sai em português', async () => {
  const goalExt = (await import(`${ext}/goal.ts`)).default
  const status: (string | undefined)[] = []
  const notes: string[] = []
  let command: any
  const pi: any = { registerCommand: (_n: string, d: any) => (command = d), registerMessageRenderer: () => {}, on: () => {}, events: { on: () => {} }, sendMessage: () => {}, appendEntry: () => {} }
  goalExt(pi)
  const ctx: any = {
    cwd: tmp, hasUI: true, mode: 'tui', model: { provider: 'anthropic', id: 'm', contextWindow: 1000 }, isIdle: () => true, isProjectTrusted: () => true,
    modelRegistry: { getAvailable: () => [] }, sessionManager: { getBranch: () => [] },
    ui: { notify: (t: string) => notes.push(t), setStatus: (_k: string, t?: string) => status.push(t), theme: { fg: (_c: string, t: string) => t } },
  }
  await command.handler('x'.repeat(4001), ctx)
  assert.match(notes.at(-1)!, /^A condição do objetivo é limitada a 4000 caracteres \(recebi 4001\)/)
  await command.handler('fazer X', ctx)
  assert.equal(status.at(-1), '◎ objetivo')
  await command.handler('clear', ctx)
})

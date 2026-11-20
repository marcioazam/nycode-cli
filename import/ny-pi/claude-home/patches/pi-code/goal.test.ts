// Testes do patch do /goal: node --experimental-strip-types --test ~/.pi/agent/claude-home/patches/pi-code/goal.test.ts
import assert from 'node:assert/strict'
import { cpSync, readFileSync, mkdirSync, mkdtempSync, symlinkSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

// O Node não tira tipos de .ts dentro de node_modules: testa uma cópia, com o pacote do pi
// ao lado para resolver @earendil-works/*.
const tmp = mkdtempSync(join(tmpdir(), 'goal-test-'))
const base = join(tmp, 'internal')
cpSync(`${homedir()}/.pi/agent/npm/node_modules/pi-code/extensions/internal`, base, { recursive: true })
mkdirSync(join(tmp, 'node_modules'))
symlinkSync(`${homedir()}/.pi/agent/install/releases/${readFileSync(`${homedir()}/.pi/agent/install/current-version`, "utf8").trim()}/node_modules/@earendil-works`, join(tmp, 'node_modules', '@earendil-works'))
const ev = await import(`${base}/goal-evaluator.ts`)
const mc = await import(`${base}/model-complete.ts`)
const ui = await import(`${base}/goal-ui.ts`)

test('parseVerdict: JSON simples, fence, prosa ao redor', () => {
  assert.deepEqual(ev.parseVerdict('{"ok": true, "reason": "x"}'), { ok: true, reason: 'x', impossible: false })
  assert.deepEqual(ev.parseVerdict('```json\n{"ok": false, "reason": "falta y"}\n```'), { ok: false, reason: 'falta y', impossible: false })
  assert.equal(ev.parseVerdict('Aqui: {"ok": false, "impossible": true, "reason": "r"} fim').impossible, true)
})

test('parseVerdict: chaves dentro da reason e segundo objeto', () => {
  assert.equal(ev.parseVerdict('{"ok": false, "reason": "falta } e {"}').reason, 'falta } e {')
  assert.equal(ev.parseVerdict('{"note": 1} {"ok": true, "reason": "b"}').ok, true)
  assert.equal(ev.parseVerdict('{"ok": true, "reason": "a"}\n{"ok": false, "reason": "b"}').reason, 'a')
})

test('parseVerdict: ok como string, prosa yes/no, vazio e truncado', () => {
  assert.equal(ev.parseVerdict('{"ok": "true", "reason": "s"}').ok, true)
  assert.equal(ev.parseVerdict('No, tests still fail').ok, false)
  assert.equal(ev.parseVerdict(''), undefined)
  assert.equal(ev.parseVerdict('{"ok": false, "reason": "cort'), undefined)
  assert.equal(ev.parseVerdict('{"ok": 1}'), undefined)
  assert.equal(ev.parseVerdict('[{"ok": true}]').ok, true)
})

test('evaluatorPrompt traz turno e tempo medidos', () => {
  const p = ev.evaluatorPrompt('T', 'C', { turn: 3, elapsedMs: 125_000 })
  assert.match(p, /turn 3 since the goal was set, running for 2m 5s/)
  assert.match(p, /Condition: C$/)
  assert.doesNotMatch(ev.evaluatorPrompt('T', 'C'), /Goal progress/)
})

test('classifyTurnError: pausa x retry', () => {
  assert.deepEqual(ev.classifyTurnError('429 rate_limit_error: slow down'), { action: 'pause', cause: 'rate limit' })
  assert.deepEqual(ev.classifyTurnError("You've hit your usage limit, resets 5pm"), { action: 'pause', cause: 'usage limit' })
  assert.deepEqual(ev.classifyTurnError('529 overloaded_error'), { action: 'retry', cause: 'overloaded' })
  assert.deepEqual(ev.classifyTurnError('fetch failed: ECONNRESET'), { action: 'retry', cause: 'connection' })
  assert.deepEqual(ev.classifyTurnError('Request timed out'), { action: 'retry', cause: 'timeout' })
  assert.deepEqual(ev.classifyTurnError('webhook 503'), { action: 'retry', cause: 'server error' })
  assert.deepEqual(ev.classifyTurnError('???'), { action: 'retry', cause: 'error' })
  assert.deepEqual([1, 2, 3, 4].map(ev.turnRetryDelayMs), [15_000, 30_000, 60_000, 60_000])
})

test('erros irrecuperáveis continuam limpando o goal', () => {
  assert.equal(ev.classifyUnrecoverable('401 authentication_error'), 'authentication')
  assert.equal(ev.classifyUnrecoverable('529 overloaded_error'), undefined)
})

test('minimalReasoning: off quando possível, menor nível quando não', () => {
  assert.equal(mc.minimalReasoning({ reasoning: true, thinkingLevelMap: { off: null, minimal: null, low: 'low' } }), 'low')
  assert.equal(mc.minimalReasoning({ reasoning: true, thinkingLevelMap: { off: null, xhigh: 'xhigh' } }), 'minimal')
  assert.equal(mc.minimalReasoning({ reasoning: true, thinkingLevelMap: { minimal: null, low: 'low' } }), undefined)
  assert.equal(mc.minimalReasoning({ reasoning: true }), undefined)
  assert.equal(mc.minimalReasoning({ reasoning: false, thinkingLevelMap: { off: null } }), undefined)
})

test('completeText repassa reasoning mínimo e stopReason', async () => {
  let seen: any
  mc.setCompleteBackend(async (_m: unknown, _c: unknown, o: any) => {
    seen = o
    return { role: 'assistant', content: [{ type: 'text', text: '{"ok":true}' }], stopReason: 'length', usage: {} }
  })
  const r = await mc.completeText({ reasoning: true, thinkingLevelMap: { off: null, minimal: null, low: 'low' } }, 'p', { maxTokens: 10 })
  assert.equal(seen.reasoning, 'low')
  assert.equal(r.stopReason, 'length')
  await mc.completeText({ reasoning: true, thinkingLevelMap: { off: null } }, 'p', { reasoning: 'high' })
  assert.equal(seen.reasoning, 'high')
  mc.setCompleteBackend(null)
})

test('kickoff pede evidência visível', () => {
  assert.match(ev.kickoffPrompt('C'), /reads only this conversation/)
})

test('canForceTool só com Anthropic e thinking desligável', () => {
  assert.equal(mc.canForceTool({ api: 'anthropic-messages', reasoning: true, thinkingLevelMap: { minimal: null } }), true)
  assert.equal(mc.canForceTool({ api: 'anthropic-messages', reasoning: true, thinkingLevelMap: { off: null, low: 'low' } }), false)
  assert.equal(mc.canForceTool({ api: 'openai-responses', reasoning: false }), false)
  assert.deepEqual(ev.verdictFromArgs({ ok: false, impossible: true, reason: 'r' }), { ok: false, reason: 'r', impossible: true })
  assert.equal(ev.verdictFromArgs(undefined), undefined)
})

const id = (s) => s
const style = { accent: id, success: id, error: id, warning: id, dim: id }
const summary = { condition: 'tests pass', durationMs: 303_000, iterations: 3, tokens: 12_300, lastReason: 'all green', evaluator: 'anthropic/haiku' }

test('goalMessageLines: achieved recolhido e expandido', () => {
  const d = { kind: 'achieved', condition: 'tests pass', reason: 'all green', summary }
  const c = ui.goalMessageLines('body', d, false, style, 'HINT')
  assert.equal(c.length, 1)
  assert.match(c[0], /^✓ Goal achieved \(5m 3s · 3 turns · 12\.3k tokens\) HINT$/)
  assert.deepEqual(ui.goalMessageLines('body', d, true, style, 'HINT').slice(1), ['  Goal: tests pass', '  Reason: all green', '  Evaluator: anthropic/haiku'])
})

test('goalMessageLines: failed mostra a reason mesmo recolhido', () => {
  const d = { kind: 'failed', condition: 'x', reason: 'impossible', summary }
  const c = ui.goalMessageLines('body', d, false, style, 'HINT')
  assert.match(c[0], /^✗ Goal could not be achieved \(/)
  assert.equal(c[1], '  impossible')
})

test('goalMessageLines: not_met, set, cleared e sem details', () => {
  assert.deepEqual(ui.goalMessageLines('b', { kind: 'not_met', condition: 'c', reason: 'r' }, false, style, 'H'), ['○ Goal not yet met… continuing H'])
  assert.deepEqual(ui.goalMessageLines('b', { kind: 'not_met', condition: 'c', reason: 'r' }, true, style, 'H'), ['○ Goal not yet met… continuing', '  Goal: c', '  Reason: r'])
  assert.deepEqual(ui.goalMessageLines('DIRECTIVE', { kind: 'set', condition: 'c' }, false, style, 'H'), ['◎ Goal set: c'])
  assert.deepEqual(ui.goalMessageLines('DIRECTIVE', { kind: 'set', condition: 'c' }, true, style, 'H'), ['◎ Goal set: c', 'DIRECTIVE'])
  assert.deepEqual(ui.goalMessageLines('x', { kind: 'cleared', condition: 'c' }, false, style, 'H'), ['Goal cleared: c'])
  assert.deepEqual(ui.goalMessageLines('l1\nl2', undefined, false, style, 'H'), ['l1 H'])
  assert.deepEqual(ui.goalMessageLines('l1\nl2', undefined, true, style, 'H'), ['l1\nl2'])
})

test('indicatorText omite o tempo no primeiro segundo', () => {
  assert.equal(ui.indicatorText(500), '◎ /goal active')
  assert.equal(ui.indicatorText(300_000), '◎ /goal active (5m 0s)')
})

test('goalPanelLines: ativo, concluído e vazio', () => {
  const a = ui.goalPanelLines({ active: summary }, style)
  assert.equal(a[0], '◎ Goal active')
  assert.equal(a[1], 'running 5m 3s · 3 turns · 12.3k tokens')
  assert.ok(a.includes('Goal: tests pass') && a.includes('Last check: all green') && a.includes('Evaluator: anthropic/haiku'))
  assert.equal(a.at(-1), '/goal clear to stop early · esc to dismiss')
  assert.equal(ui.goalPanelLines({ active: { ...summary, iterations: 0 } }, style)[1], 'running 5m 3s · 12.3k tokens')
  const d = ui.goalPanelLines({ achieved: summary }, style)
  assert.equal(d[0], '✓ Goal achieved')
  assert.equal(d.at(-1), '/goal <condition> to set another · esc to dismiss')
  assert.deepEqual(ui.goalPanelLines({}, style), ['Goal', '', 'No goal set /goal <condition> to set one', '', 'esc to dismiss'])
})

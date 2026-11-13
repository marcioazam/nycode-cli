// Testes de ~/.pi/agent/extensions/plan-gate.ts (porta do ~/.claude/hooks/plan/plan_gate.py).
// Rodar: node --experimental-strip-types --test ~/.pi/agent/claude-home/bin/tests/plan-gate.test.ts
import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { decidePlanGate } from '../../../extensions/plan-gate.ts'

type Entry = Record<string, unknown>
let n = 0
const id = () => `e${++n}`
const approve = (): Entry => ({ type: 'custom_message', id: id(), customType: 'plan-mode-execute', content: 'Execute the plan.' })
const say = (text: string): Entry => ({ type: 'message', id: id(), message: { role: 'assistant', content: [{ type: 'text', text }] } })
const call = (name: string, args: Record<string, unknown>, callId = `c${n + 1}`): Entry => ({
  type: 'message', id: id(), message: { role: 'assistant', content: [{ type: 'toolCall', id: callId, name, arguments: args }] },
})
const result = (callId: string, toolName: string, text: string): Entry => ({
  type: 'message', id: id(), message: { role: 'toolResult', toolCallId: callId, toolName, content: [{ type: 'text', text }] },
})
const review = (verdict: string, callId: string): Entry[] => [
  call('subagent', { agent: 'plan-reviewer', task: 'review' }, callId),
  result(callId, 'subagent', `- gap one\nPLAN_REVIEW: ${verdict}`),
]
const record = (data: Record<string, unknown>): Entry => ({ type: 'custom', id: id(), customType: 'plan-gate', data })

test('sem plano aprovado: nada a fazer', () => {
  assert.equal(decidePlanGate([say('oi')]).action, 'none')
})

test('plano aprovado sem revisão: bloqueia pedindo plan-reviewer', () => {
  const d = decidePlanGate([approve(), call('edit', { path: 'a' }), say('pronto')])
  assert.equal(d.action, 'block')
  assert.equal(d.why, 'no_review')
  assert.match(d.message ?? '', /plan-reviewer/)
})

test('revisão complete depois da última edição: libera e encerra', () => {
  const d = decidePlanGate([approve(), call('edit', { path: 'a' }), ...review('complete', 'r1'), say('feito')])
  assert.equal(d.action, 'allow')
  assert.equal(d.why, 'review_complete')
  assert.equal(d.record?.state, 'completed')
})

test('edição depois da revisão complete: bloqueia', () => {
  const d = decidePlanGate([approve(), ...review('complete', 'r1'), call('write', { path: 'b' }), say('feito')])
  assert.equal(d.why, 'edit_after_review')
})

test('revisão incomplete: bloqueia com os gaps', () => {
  const d = decidePlanGate([approve(), ...review('incomplete', 'r1'), say('feito')])
  assert.equal(d.why, 'review_incomplete')
  assert.match(d.message ?? '', /gap one/)
})

test('revisão de outro agente não conta', () => {
  const d = decidePlanGate([approve(), call('subagent', { agent: 'code-reviewer', task: 'x' }, 'x1'), result('x1', 'subagent', 'PLAN_REVIEW: complete'), say('ok')])
  assert.equal(d.why, 'no_review')
})

test('revisão em chamada paralela (tasks) conta', () => {
  const d = decidePlanGate([approve(), call('subagent', { tasks: [{ agent: 'plan-reviewer', task: 'r' }] }, 'p1'), result('p1', 'subagent', 'PLAN_REVIEW: complete'), say('ok')])
  assert.equal(d.why, 'review_complete')
})

test('marcadores: CANCELLED encerra, BLOCKED e WAITING liberam', () => {
  assert.equal(decidePlanGate([approve(), say('PLAN CANCELLED')]).record?.state, 'cancelled')
  assert.equal(decidePlanGate([approve(), say('PLAN BLOCKED: preciso da sua decisão')]).why, 'marker_blocked')
  assert.equal(decidePlanGate([approve(), say('PLANO AGUARDANDO: lanes rodando')]).why, 'marker_waiting')
})

test('plan mode ligado de novo: libera', () => {
  const d = decidePlanGate([approve(), { type: 'custom', id: id(), customType: 'plan-mode', data: { enabled: true } }, say('planejando')])
  assert.equal(d.why, 'plan_mode')
})

test('estado encerrado não reativa até nova aprovação', () => {
  const base = [approve(), ...review('complete', 'r1'), say('ok'), record({ state: 'completed' })]
  assert.equal(decidePlanGate([...base, say('outra coisa')]).action, 'none')
  assert.equal(decidePlanGate([...base, approve(), say('novo plano')]).why, 'no_review')
})

test('3 paradas sem progresso: desiste com aviso', () => {
  const entries: Entry[] = [approve(), say('a')]
  let d = decidePlanGate(entries)
  for (let i = 0; i < 3; i++) {
    entries.push(record(d.record ?? {}), say('sem progresso'))
    d = decidePlanGate(entries)
  }
  assert.equal(d.action, 'give_up')
  assert.equal(d.record?.state, 'gave_up')
  assert.match(d.message ?? '', /PLAN_REVIEW: complete/)
})

test('progresso (edição nova) zera o contador', () => {
  const entries: Entry[] = [approve(), say('a')]
  let d = decidePlanGate(entries)
  entries.push(record(d.record ?? {}), say('b'))
  d = decidePlanGate(entries)
  entries.push(record(d.record ?? {}), call('edit', { path: 'x' }), say('c'))
  d = decidePlanGate(entries)
  assert.equal(d.action, 'block')
  assert.equal(d.record?.noProgress, 0)
})

test('PI_PLAN_GATE=0 desliga', () => {
  assert.equal(decidePlanGate([approve(), say('x')], { PI_PLAN_GATE: '0' }).action, 'none')
})

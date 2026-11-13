// Testes de ~/.pi/agent/extensions/completion-gate.ts.
// Rodar: node --experimental-strip-types --test ~/.pi/agent/claude-home/bin/tests/gates/completion-gate.test.ts
import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { decideCompletionGate, isCheckCommand } from '../../../../extensions/completion-gate.ts'

type Entry = Record<string, unknown>
let n = 0
const id = () => `e${++n}`
const user = (text = 'faça'): Entry => ({ type: 'message', id: id(), message: { role: 'user', content: text } })
const say = (text: string): Entry => ({ type: 'message', id: id(), message: { role: 'assistant', content: [{ type: 'text', text }] } })
const call = (name: string, args: Record<string, unknown>, callId = `c${n + 1}`): Entry => ({
  type: 'message', id: id(), message: { role: 'assistant', content: [{ type: 'toolCall', id: callId, name, arguments: args }] },
})
const result = (callId: string, toolName: string, isError = false): Entry => ({
  type: 'message', id: id(), message: { role: 'toolResult', toolCallId: callId, toolName, isError, content: [{ type: 'text', text: 'ok' }] },
})
const edit = (path: string): Entry => call('edit', { path, edits: [] })
const bash = (command: string, callId: string, isError = false): Entry[] => [call('bash', { command }, callId), result(callId, 'bash', isError)]
const env = {}

test('sem edição: nada a fazer', () => {
  assert.equal(decideCompletionGate([user(), say('oi')], env).action, 'none')
})

test('código editado sem checagem: bloqueia citando o arquivo', () => {
  const d = decideCompletionGate([user(), edit('src/a.py'), say('pronto')], env)
  assert.equal(d.action, 'block')
  assert.deepEqual(d.files, ['src/a.py'])
  assert.match(d.message ?? '', /src\/a\.py/)
  assert.match(d.message ?? '', /once per turn/)
})

test('checagem aprovada depois da edição: libera', () => {
  const d = decideCompletionGate([user(), edit('a.go'), ...bash('cd x && go test ./...', 'b1'), say('ok')], env)
  assert.equal(d.action, 'none')
})

test('checagem que falhou não conta', () => {
  const d = decideCompletionGate([user(), edit('a.ts'), ...bash('npm run typecheck', 'b1', true), say('ok')], env)
  assert.equal(d.action, 'block')
})

test('checagem antes da última edição não conta', () => {
  const d = decideCompletionGate([user(), edit('a.rs'), ...bash('cargo test', 'b1'), edit('b.rs'), say('ok')], env)
  assert.equal(d.action, 'block')
  assert.deepEqual(d.files, ['a.rs', 'b.rs'])
})

test('bash que não é checagem não conta', () => {
  const d = decideCompletionGate([user(), edit('a.py'), ...bash('ls -la && cat a.py', 'b1'), say('ok')], env)
  assert.equal(d.action, 'block')
})

test('só docs e config: nada a fazer', () => {
  const d = decideCompletionGate([user(), edit('README.md'), call('write', { path: 'c.json', content: '{}' }), say('ok')], env)
  assert.equal(d.action, 'none')
})

test('gate-runner depois da edição libera (single e tasks)', () => {
  const single = decideCompletionGate([user(), edit('a.py'), call('subagent', { agent: 'gate-runner', task: 'x' }, 's1'), result('s1', 'subagent'), say('ok')], env)
  assert.equal(single.action, 'none')
  const many = decideCompletionGate([user(), edit('a.py'), call('subagent', { tasks: [{ agent: 'gate-runner', task: 'x' }] }, 's2'), result('s2', 'subagent'), say('ok')], env)
  assert.equal(many.action, 'none')
})

test('bloqueia uma vez por turno e rearma no turno seguinte', () => {
  const blocked: Entry = { type: 'custom', id: id(), customType: 'completion-gate', data: {} }
  const turn = [user(), edit('a.py'), say('ok'), blocked, say('adiado: verifico antes do commit')]
  assert.equal(decideCompletionGate(turn, env).action, 'none')
  assert.equal(decideCompletionGate([...turn, user('mais'), edit('b.py'), say('ok')], env).action, 'block')
})

test('edição de turno anterior não bloqueia o turno atual', () => {
  assert.equal(decideCompletionGate([user(), edit('a.py'), say('ok'), user('pergunta'), say('resposta')], env).action, 'none')
})

test('isCheckCommand: checagens reais em qualquer segmento, atrás de wrappers', () => {
  for (const c of [
    'pytest -q', 'cd x && go test ./...', 'python3 -m unittest test_a.py', 'uv run --with hcl2 pytest', 'npm run typecheck',
    'node --experimental-strip-types --test a.test.ts', 'FOO=1 timeout 60 cargo test', './gradlew test',
    'python3 ~/.pi/agent/claude-home/bin/checks/check-instructions.py', 'npx tsc --noEmit', 'make check 2>&1',
    'ls; ruff check .', 'bash -n x.sh',
  ]) assert.equal(isCheckCommand(c), true, c)
})

test('isCheckCommand: menção de ferramenta não é checagem', () => {
  for (const c of ['rg pytest .', 'cat eslint.config.js', 'grep -n tsc package.json', 'python3 x.py', 'echo go test', 'ls tests/'])
    assert.equal(isCheckCommand(c), false, c)
})

test('plan mode e PI_COMPLETION_GATE=0 desligam', () => {
  const planOn: Entry = { type: 'custom', id: id(), customType: 'plan-mode', data: { enabled: true } }
  assert.equal(decideCompletionGate([planOn, user(), edit('a.py'), say('ok')], env).action, 'none')
  assert.equal(decideCompletionGate([user(), edit('a.py'), say('ok')], { PI_COMPLETION_GATE: '0' }).action, 'none')
})

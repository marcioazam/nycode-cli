// node --experimental-strip-types --test ~/.pi/agent/extensions/bash-timeout/index.test.ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import ext, { DEFAULT_S, MAX_S, decide } from './index.ts'

test('sem timeout, inválido ou não-número vira o padrão', () => {
  for (const v of [undefined, 0, -5, Number.NaN, Number.POSITIVE_INFINITY, '30', null]) {
    assert.deepEqual(decide(v), { timeout: DEFAULT_S })
  }
})

test('timeout dentro do teto passa intacto', () => {
  assert.deepEqual(decide(5), { timeout: 5 })
  assert.deepEqual(decide(MAX_S), { timeout: MAX_S })
})

test('acima do teto recusa e sugere segundo plano', () => {
  const d = decide(MAX_S + 1) as { deny: string }
  assert.match(d.deny, /acima do teto de 1800s/)
  assert.match(d.deny, /nohup/)
})

function run(toolName: string, input: Record<string, unknown>) {
  let handler: any
  ext({ on: (name: string, h: unknown) => { if (name === 'tool_call') handler = h } } as never)
  const out = handler({ toolName, input })
  return { out, input }
}

test('só mexe no bash', () => {
  const { out, input } = run('read', { path: 'x' })
  assert.equal(out, undefined)
  assert.deepEqual(input, { path: 'x' })
})

test('bash sem timeout recebe o padrão', () => {
  const { out, input } = run('bash', { command: 'ls' })
  assert.equal(out, undefined)
  assert.equal(input.timeout, DEFAULT_S)
})

test('bash acima do teto é bloqueado e o input não muda', () => {
  const { out, input } = run('bash', { command: 'sleep 9000', timeout: 9000 })
  assert.equal((out as { block: boolean }).block, true)
  assert.equal(input.timeout, 9000)
})

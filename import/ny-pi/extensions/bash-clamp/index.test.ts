// Testes de ~/.pi/agent/extensions/bash-clamp/index.ts.
// Rodar: node --experimental-strip-types --test ~/.pi/agent/extensions/bash-clamp/index.test.ts
import { strict as assert } from 'node:assert'
import { mkdtempSync, readFileSync, existsSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { clamp } from './index.ts'

const dir = mkdtempSync(join(tmpdir(), 'bash-clamp-test-'))
let n = 0
const spill = () => join(dir, 'spill', `${n++}.log`)
const mk = (count: number, f = (i: number) => `line ${i}`) => Array.from({ length: count }, (_, i) => f(i + 1)).join('\n')

test('saída pequena passa intacta', () => {
  assert.equal(clamp('a\nb\nc', false, spill), undefined)
  assert.equal(clamp('a\nb\n\nCommand exited with code 1', true, spill), undefined)
})

test('sucesso longo: cabeça 50 + cauda 50 e log completo no rodapé', () => {
  const raw = mk(500)
  const out = clamp(raw, false, spill)!
  assert.match(out, /line 50\n/)
  assert.match(out, /\[\.\.\. 400 lines omitted \(lines 51-450\) \.\.\.\]/)
  assert.ok(!out.includes('line 51\n'))
  assert.match(out, /line 500\n\n\[Output clamped: showing 100 of 500 lines\./)
  const path = /Full output: (\S+) —/.exec(out)![1]
  assert.equal(readFileSync(path, 'utf8'), raw)
  assert.match(out, /offset: 51, limit: 250/)
  assert.equal((statSync(path).mode & 0o777), 0o600)
})

test('erro: mantém a linha de diagnóstico do meio e o status por último', () => {
  const raw = mk(300, (i) => (i === 150 ? 'AssertionError: boom' : `line ${i}`))
  const out = clamp(`${raw}\n\nCommand exited with code 1`, true, spill)!
  assert.match(out, /line 10\n/)
  assert.match(out, /AssertionError: boom/)
  assert.match(out, /line 300\n/)
  assert.ok(out.endsWith('\n\nCommand exited with code 1'))
  assert.match(out, /showing 100 of 300 lines/)
})

test('erro sem diagnóstico no meio: cauda de 90', () => {
  const out = clamp(mk(300), true, spill)!
  assert.match(out, /line 211\n/)
  assert.ok(!out.includes('line 210\n'))
})

test('linha longa é cortada', () => {
  const out = clamp(`short\n${'x'.repeat(1000)}\nend`, false, spill)!
  assert.match(out, /x{240} … \[line truncated: 760 chars omitted\]/)
  assert.ok(!out.includes('x'.repeat(241)))
})

test('rodapé do pi: reusa o arquivo dele e não grava outro', () => {
  const full = join(dir, 'pi-full.log')
  writeFileSync(full, mk(5000))
  const tailOnly = mk(2000, (i) => `line ${i + 3000}`)
  const count = () => (existsSync(join(dir, 'spill')) ? readdirSync(join(dir, 'spill')).length : 0)
  const before = count()
  const out = clamp(`${tailOnly}\n\n[Showing lines 3001-5000 of 5000. Full output: ${full}]\n\nCommand exited with code 2`, false, spill)!
  assert.match(out, new RegExp(`Full output: ${full} —`))
  assert.match(out, /showing 100 of 5000 lines/)
  assert.match(out, /line 50\n/)
  assert.match(out, /line 5000\n/)
  assert.ok(out.endsWith('Command exited with code 2'))
  assert.equal(count(), before)
})

test('limite de bytes respeitado e fs quebrado não lança', () => {
  const raw = mk(200, (i) => `${i} ${'y'.repeat(280)}`)
  const out = clamp(raw, false, spill)!
  assert.ok(Buffer.byteLength(out) <= 20 * 1024)
  assert.match(out, /Full output:/)
  assert.equal(clamp(mk(500), false, () => join(dir, 'pi-full.log', 'sub', 'x.log')), undefined)
})

test('newline final não conta como linha (seq 1 500 com \\n no fim)', () => {
  const text = Array.from({ length: 500 }, (_, i) => String(i + 1)).join('\n') + '\n'
  const out = clamp(text, false, () => join(mkdtempSync(join(tmpdir(), 'bc-nl-')), 'x.log'))!
  assert.match(out, /showing 100 of 500 lines/)
  assert.match(out, /\n500\n\n\[Output clamped/)
})

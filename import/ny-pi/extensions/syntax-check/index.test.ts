// Testes de ~/.pi/agent/extensions/syntax-check/index.ts.
// Rodar: node --experimental-strip-types --test ~/.pi/agent/extensions/syntax-check/index.test.ts
import { strict as assert } from 'node:assert'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import syntaxCheck, { firstError, langOf } from './index.ts'

test('python: quebrado reporta linha/coluna; correto não', async () => {
  const e = await firstError('def f(:\n  pass\n', 'python')
  assert.ok(e)
  assert.equal(e.line, 1)
  assert.ok(e.column >= 1 && e.text.length > 0)
  assert.equal(await firstError('def f():\n  pass\n', 'python'), null)
})

test('typescript: quebrado reporta, correto não', async () => {
  const e = await firstError('const x: number = (1 +\nfunction g() {}\n', 'typescript')
  assert.ok(e)
  assert.ok(e.line >= 1 && e.line <= 2)
  assert.equal(await firstError('const x: number = 1\n', 'typescript'), null)
})

test('langOf: extensões suportadas e ignoradas', () => {
  assert.equal(langOf('a/b.PY'), 'python')
  assert.equal(langOf('x.tsx'), 'tsx')
  assert.equal(langOf('README.md'), undefined)
})

function harness() {
  const h: Record<string, (e: any, c: any) => any> = {}
  syntaxCheck({ on: (n: string, f: any) => (h[n] = f) } as any)
  return h
}
const ctx = (cwd: string) => ({ cwd })
const run = async (h: ReturnType<typeof harness>, cwd: string, name: string, path: string, edit: () => void, id = 'c1') => {
  await h.tool_call({ toolName: name, toolCallId: id, input: { path } }, ctx(cwd))
  edit()
  return h.tool_result({ toolName: name, toolCallId: id, input: { path }, isError: false, content: [{ type: 'text', text: 'ok' }] }, ctx(cwd))
}

test('handler: arquivo limpo que quebra reporta; erro preexistente não; arquivo novo com erro reporta', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'syntax-check-test-'))
  const h = harness()
  writeFileSync(join(cwd, 'a.py'), 'x = 1\n')
  const r = await run(h, cwd, 'edit', 'a.py', () => writeFileSync(join(cwd, 'a.py'), 'x = (1 +\n'))
  assert.match(r.content[1].text, /parse error at \d+:\d+ — .*parsed cleanly before/)
  const r2 = await run(h, cwd, 'edit', 'a.py', () => writeFileSync(join(cwd, 'a.py'), 'x = (2 +\n'), 'c2')
  assert.equal(r2, undefined) // já estava quebrado
  const r3 = await run(h, cwd, 'write', 'n.py', () => writeFileSync(join(cwd, 'n.py'), 'def (:\n'), 'c3')
  assert.match(r3.content[1].text, /in the new file\.$/)
})

test('handler: extensão sem gramática e isError não produzem nada', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'syntax-check-test-'))
  const h = harness()
  assert.equal(await run(h, cwd, 'write', 'n.md', () => writeFileSync(join(cwd, 'n.md'), '((')), undefined)
  await h.tool_call({ toolName: 'write', toolCallId: 'e', input: { path: 'b.py' } }, ctx(cwd))
  writeFileSync(join(cwd, 'b.py'), 'def (:\n')
  const r = await h.tool_result({ toolName: 'write', toolCallId: 'e', input: { path: 'b.py' }, isError: true, content: [] }, ctx(cwd))
  assert.equal(r, undefined)
})

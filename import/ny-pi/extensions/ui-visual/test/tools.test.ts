// node --experimental-strip-types --test ~/.pi/agent/extensions/ui-visual/test/tools.test.ts
import assert from 'node:assert/strict'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

// O Node não resolve @earendil-works a partir de extensions/: testa uma cópia com o pi ao lado.
const tmp = mkdtempSync(join(tmpdir(), 'ui-visual-test-'))
mkdirSync(join(tmp, 'node_modules'))
symlinkSync(`${homedir()}/.pi/agent/install/releases/${readFileSync(`${homedir()}/.pi/agent/install/current-version`, 'utf8').trim()}/node_modules/@earendil-works`, join(tmp, 'node_modules', '@earendil-works'))
for (const f of ['tools.ts', 'icons.ts']) cpSync(join(import.meta.dirname, '..', f), join(tmp, f))
const mod = await import(join(tmp, 'tools.ts'))
const { icon } = await import(join(tmp, 'icons.ts'))
const visibleWidth = (s: string) => [...s].length // sem largura dupla nos casos testados

const theme = { fg: (c: string, t: string) => `<${c}>${t}</c>`, bold: (t: string) => `\u0001${t}\u0002` }
// truncateToWidth fecha com \x1b[0m; não ocupa coluna, então sai antes da medida.
const plain = (s: string) => s.replace(/<\/?[a-zA-Z]*>/g, '').replace(/[\u0001\u0002]/g, '').replace(/\x1b\[[0-9;]*m/g, '')
const ctx = (o: Record<string, unknown> = {}) => ({ cwd: '/work/proj', argsComplete: true, isError: false, isPartial: false, durationMs: undefined, args: {}, ...o })
const NATIVE = { tag: 'native' }
const nativeComponent = (label: string) => ({ render: () => [label], invalidate() {} })
const base = () => ({
  keep: 'x',
  renderCall: () => nativeComponent('native-call'),
  renderResult: () => nativeComponent('native-result'),
})
const resolverOf = (env: Record<string, string> = {}) => {
  const old = process.env.PI_CODE_SUBAGENT
  if ('PI_CODE_SUBAGENT' in env) process.env.PI_CODE_SUBAGENT = env.PI_CODE_SUBAGENT
  else delete process.env.PI_CODE_SUBAGENT
  const calls: string[] = []
  let resolver: any
  mod.default({
    registerToolRenderer: (r: unknown) => { calls.push('registerToolRenderer'); resolver = r },
    registerTool: () => calls.push('registerTool'),
  })
  if (old === undefined) delete process.env.PI_CODE_SUBAGENT
  else process.env.PI_CODE_SUBAGENT = old
  return { calls, resolver }
}
const wrapped = (name: string, b: any = base()) => resolverOf().resolver(name, () => b)
const header = (name: string, args: Record<string, unknown>, c: Record<string, unknown> = {}, w = 200) =>
  plain(wrapped(name).renderCall(args, theme, ctx({ args, ...c })).render(w)[0])
const result = (text: string, details?: unknown) => ({ content: [{ type: 'text', text }], details })
const body = (name: string, r: unknown, c: Record<string, unknown> = {}, o: Record<string, unknown> = {}, w = 200) =>
  wrapped(name).renderResult(r, { expanded: false, isPartial: false, ...o }, theme, ctx(c)).render(w).map(plain)

test('resolver: só registerToolRenderer, next() para desconhecidas, undefined sem base', () => {
  const { calls, resolver } = resolverOf()
  assert.deepEqual(calls, ['registerToolRenderer'])
  assert.equal(resolver('mcp__x', () => NATIVE), NATIVE)
  assert.equal(resolver('mcp__x', () => undefined), undefined)
  assert.equal(resolver('bash', () => undefined), undefined)
  const out = resolver('read', base)
  assert.equal(out.keep, 'x')
  assert.notEqual(out.renderCall, base().renderCall)
})

test('subagente não registra nada', () => {
  assert.deepEqual(resolverOf({ PI_CODE_SUBAGENT: '1' }).calls, [])
})

test('formatDuration: fronteiras', () => {
  const f = mod.formatDuration
  assert.equal(f(0), '0.0s')
  assert.equal(f(400), '0.4s')
  assert.equal(f(999), '0.9s')
  assert.equal(f(1234), '1.2s')
  assert.equal(f(9999), '9.9s')
  assert.equal(f(10_000), '10s')
  assert.equal(f(59_999), '59s')
  assert.equal(f(60_000), '1m 00s')
  assert.equal(f(65_000), '1m 05s')
  assert.equal(f(-5), '0.0s')
  assert.equal(f(Number.NaN), '0.0s')
})

test('cabeçalho por ferramenta', () => {
  assert.equal(header('read', { path: '/work/proj/src/a.ts' }), `${icon('ok')} ${icon('read')} read src/a.ts`)
  assert.ok(header('write', { path: '/outro/b.ts' }).includes('/outro/b.ts'))
  assert.ok(header('edit', { file_path: '/work/proj/x/y.ts' }).endsWith('edit x/y.ts'))
  assert.ok(header('ls', {}).endsWith('ls .'))
  assert.ok(header('ls', { path: '/work/proj' }).endsWith('ls .'))
  assert.ok(header('grep', { pattern: 'foo', path: '/work/proj/src' }).endsWith('grep foo in src'))
  assert.ok(header('find', { pattern: 'x.ts' }).endsWith('find x.ts'))
  assert.ok(header('bash', { command: 'ls -la' }).endsWith('bash ls -la'))
  assert.ok(header('bash', { command: 'echo a\necho b' }).endsWith('bash echo a…'))
  assert.ok(header('bash', { command: 'sleep 9', timeout: 30 }).endsWith('(timeout 30s)'))
})

test('read: offset e limit', () => {
  assert.ok(header('read', { path: 'a', offset: 10, limit: 20 }).includes('a :10-30'))
  assert.ok(header('read', { path: 'a', limit: 5 }).includes('a :1-6'))
  assert.ok(header('read', { path: 'a', offset: 7 }).includes('a :7'))
})

test('status: pendente, ok, erro; duração à direita', () => {
  const c = wrapped('bash')
  const args = { command: 'x' }
  const raw = (o: Record<string, unknown>) => c.renderCall(args, theme, ctx({ args, ...o })).render(200)[0]
  assert.ok(raw({ isPartial: true }).startsWith(`<dim>${icon('pending')}</c>`))
  assert.ok(raw({ isPartial: false }).startsWith(`<success>${icon('ok')}</c>`))
  assert.ok(raw({ isPartial: false, isError: true }).startsWith(`<error>${icon('err')}</c>`))
  assert.ok(plain(raw({ durationMs: 1234 })).endsWith(' 1.2s'))
  assert.ok(!/\d+\.\ds$/.test(plain(raw({ isPartial: true }))))
})

test('args incompletos ou ausentes mostram …', () => {
  assert.ok(header('read', { path: '/a' }, { argsComplete: false }).endsWith('read …'))
  assert.ok(header('read', {}).endsWith('read …'))
  assert.ok(header('bash', {}).endsWith('bash …'))
  assert.ok(header('grep', {}).endsWith('grep …'))
})

test('largura: nenhuma linha passa de w', () => {
  const long = '/work/proj/' + 'dir/'.repeat(40) + 'arquivo.ts'
  const cmd = 'echo ' + 'x'.repeat(300)
  for (const w of [40, 60, 100, 200]) {
    for (const [name, args] of [['read', { path: long, offset: 1, limit: 9 }], ['bash', { command: cmd, timeout: 5 }], ['grep', { pattern: cmd, path: long }], ['edit', { path: long }]] as const) {
      const row = wrapped(name).renderCall(args, theme, ctx({ args, durationMs: 65_000 })).render(w)
      assert.equal(row.length, 1)
      assert.ok(visibleWidth(plain(row[0])) <= w, `${name} w=${w}`)
      assert.ok(plain(row[0]).endsWith(' 1m 05s'))
    }
    const out = body('bash', result((cmd + '\n').repeat(8)), {}, {}, w)
    assert.ok(out.every((l: string) => visibleWidth(l) <= w))
    const err = body('bash', result(cmd + '\n\nCommand exited with code 1'), { isError: true }, {}, w)
    assert.ok(err.every((l: string) => visibleWidth(l) <= w))
  }
})

test('expandido e bash parcial delegam ao nativo; demais parciais ficam vazios', () => {
  assert.deepEqual(body('read', result('a'), {}, { expanded: true }), ['native-result'])
  assert.deepEqual(body('bash', result('a'), {}, { isPartial: true }), ['native-result'])
  assert.deepEqual(body('grep', result('a'), {}, { isPartial: true }), [])
  assert.deepEqual(body('edit', result('a', { diff: '+1 a' })), ['native-result'])
})

test('erro: primeira linha em error; bash com manchete e saída dim', () => {
  assert.deepEqual(body('read', result('\nENOENT: no such file\nmais'), { isError: true }), ['  ENOENT: no such file'])
  assert.deepEqual(body('write', result(''), { isError: true }), ['  erro'])
  const raw = wrapped('read').renderResult(result('falhou'), { expanded: false }, theme, ctx({ isError: true })).render(80)
  assert.equal(raw[0], '<error>  falhou</c>')
  const out = Array.from({ length: 8 }, (_, i) => `l${i}`).join('\n')
  const lines = body('bash', result(`${out}\n\nCommand exited with code 2`), { isError: true })
  assert.equal(lines[0], '  Command exited with code 2')
  assert.deepEqual(lines.slice(1), ['  l3', '  l4', '  l5', '  l6', '  l7'])
  assert.deepEqual(body('bash', result('só isso'), { isError: true }), ['  só isso'])
  // E2E 2026-11-13: `bash false` mostrava "(no output)" sob a manchete; o marcador nativo não é saída.
  assert.deepEqual(body('bash', result('(no output)\n\nCommand exited with code 1'), { isError: true }), ['  Command exited with code 1'])
  assert.deepEqual(body('bash', result('(no output)')), [])
})

test('resumos', () => {
  assert.deepEqual(body('read', result('a\nb\nc\n')), ['  3 linhas'])
  assert.deepEqual(body('read', result('a')), ['  1 linha'])
  assert.deepEqual(body('read', { content: [{ type: 'image' }] }), ['  imagem'])
  assert.deepEqual(body('read', result('a\nb', { truncation: { truncated: true } })), ['  2 linhas · truncado'])
  assert.deepEqual(body('write', result('ok'), { args: { content: 'x\ny\n' } }), ['  2 linhas'])
  assert.deepEqual(body('write', result('ok'), { args: {} }), ['  0 linhas'])
  assert.deepEqual(body('grep', result('a:1:x\nb:2:y\n\n[100 matches limit reached]')), ['  2 resultados'])
  assert.deepEqual(body('find', result('a.ts')), ['  1 resultado'])
  assert.deepEqual(body('grep', result('No matches found')), ['  nenhum resultado'])
  assert.deepEqual(body('ls', result('(empty directory)')), ['  nenhum resultado'])
  const bash = body('bash', result(Array.from({ length: 7 }, (_, i) => `o${i}`).join('\n') + '\n\nCommand exited with code 0'))
  assert.deepEqual(bash, ['  o2', '  o3', '  o4', '  o5', '  o6'])
  assert.deepEqual(body('bash', result('')), [])
})

test('edit sem renderResult nativo: +A −R do diff', () => {
  const r = resolverOf().resolver('edit', () => ({ renderCall: base().renderCall }))
  const out = r.renderResult(result('ok', { diff: ' 1 a\n-2 b\n+2 c\n+3 d' }), { expanded: false }, theme, ctx()).render(80).map(plain)
  assert.deepEqual(out, ['  +2 −1'])
})

test('exceção cai no nativo', () => {
  const boom = { get content(): never { throw new Error('x') } }
  assert.deepEqual(wrapped('read').renderResult(boom, { expanded: false }, theme, ctx()).render(80), ['native-result'])
  const badCtx = { get args(): never { throw new Error('x') } }
  assert.deepEqual(wrapped('read').renderCall({}, theme, badCtx).render(80), ['native-call'])
  const noBase = resolverOf().resolver('read', () => ({}))
  assert.deepEqual(noBase.renderResult(boom, { expanded: false }, theme, ctx()).render(80), [])
  assert.deepEqual(noBase.renderCall({}, theme, badCtx).render(80), [])
})

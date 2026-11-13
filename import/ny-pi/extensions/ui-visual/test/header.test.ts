// node --experimental-strip-types --test ~/.pi/agent/extensions/ui-visual/test/header.test.ts
import assert from 'node:assert/strict'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

// O Node não resolve @earendil-works a partir de extensions/: testa uma cópia com o pi ao lado (como ui/test/diff.test.ts).
const tmp = mkdtempSync(join(tmpdir(), 'ui-visual-header-'))
mkdirSync(join(tmp, 'node_modules'))
mkdirSync(join(tmp, 'ui-visual'))
mkdirSync(join(tmp, 'ui'))
symlinkSync(`${homedir()}/.pi/agent/install/releases/${readFileSync(`${homedir()}/.pi/agent/install/current-version`, 'utf8').trim()}/node_modules/@earendil-works`, join(tmp, 'node_modules', '@earendil-works'))
for (const f of ['header.ts', 'icons.ts']) cpSync(join(import.meta.dirname, '..', f), join(tmp, 'ui-visual', f))
cpSync(join(import.meta.dirname, '..', '..', 'ui', 'a11y.ts'), join(tmp, 'ui', 'a11y.ts'))
const { visibleWidth } = await import(join(tmp, 'node_modules', '@earendil-works', 'pi-tui', 'dist', 'index.js'))
const { default: header, HINTS, buildHeaderLines, gitBranch, formatTokens, tildePath } = await import(join(tmp, 'ui-visual', 'header.ts'))

const theme = { fg: (_k: string, s: string) => s, bold: (s: string) => s }
const parts = { version: 'v1.5.2', model: 'claude-opus-4-7', cwd: join(homedir(), 'proj'), branch: 'main', thinking: 'high', context: '200k' }

test('buildHeaderLines: identidade e lugar na primeira linha, atalhos na segunda', () => {
  const lines = buildHeaderLines(parts, theme, 200)
  assert.equal(lines.length, 2)
  const [one, three] = lines
  const two = one
  assert.ok(one.includes('pi v1.5.2'))
  assert.ok(one.includes('claude-opus-4-7'))
  assert.ok(one.includes('high'))
  assert.ok(one.includes('200k ctx'))
  assert.ok(two.includes('~/proj'))
  assert.ok(two.includes('main'))
  for (const [k, label] of HINTS) assert.ok(three.includes(`${k} ${label}`))
})

test('buildHeaderLines: campos opcionais ausentes somem', () => {
  const [one] = buildHeaderLines({ ...parts, model: '', branch: '', thinking: '', context: '' }, theme, 200)
  assert.equal(one.includes('main'), false)
  assert.equal(one.includes('claude'), false)
  assert.equal(one.includes('ctx'), false)
  assert.ok(one.includes('~/proj'))
})

test('buildHeaderLines: estilos passam pelo tema', () => {
  const tagged = { fg: (k: string, s: string) => `<${k}>${s}</>`, bold: (s: string) => `*${s}*` }
  const [one, three] = buildHeaderLines(parts, tagged, 500)
  const two = one
  assert.ok(one.includes('<accent>*pi*</>'))
  assert.ok(one.includes('*<text>claude-opus-4-7</>*'))
  assert.ok(two.includes('<mdLink>main</>'))
  assert.ok(three.includes('<accent>esc</>'))
})

test('buildHeaderLines: estreito descarta os segmentos de menor prioridade inteiros', () => {
  const [one, three] = buildHeaderLines(parts, theme, 40)
  assert.ok(one.includes('claude-opus-4-7'))
  assert.equal(one.includes('ctx'), false)
  assert.equal(one.includes('~/proj'), false)
  assert.ok(three.includes('? atalhos'))
  assert.equal(three.includes('esc'), false)
})

test('formatTokens e tildePath', () => {
  assert.equal(formatTokens(200000), '200k')
  assert.equal(formatTokens(1000000), '1M')
  assert.equal(formatTokens(1048576), '1M')
  assert.equal(formatTokens(1500000), '1.5M')
  assert.equal(formatTokens(0), '')
  assert.equal(tildePath('/h/u', '/h/u'), '~')
  assert.equal(tildePath('/h/u/a', '/h/u'), '~/a')
  assert.equal(tildePath('/h/uu', '/h/u'), '/h/uu')
})

test('buildHeaderLines: largura nunca excede w', () => {
  for (const w of [0, 10, 40, 60, 100, 200]) {
    for (const line of buildHeaderLines(parts, theme, w)) assert.ok(visibleWidth(line) <= w, `w=${w}`)
  }
})

test('gitBranch: fora de repositório devolve vazio', () => {
  assert.equal(gitBranch('/nonexistent-dir-for-test'), '')
  assert.equal(typeof gitBranch(process.cwd()), 'string')
})

function setup(hasUI: boolean, env: Record<string, string>) {
  const keys = ['NO_COLOR', 'PI_CODE_SUBAGENT']
  const saved = keys.map((k) => process.env[k])
  keys.forEach((k) => delete process.env[k])
  Object.assign(process.env, env)
  let handler: any
  const calls: any[] = []
  header({ on: (_n: string, h: unknown) => { handler = h }, getThinkingLevel: () => 'medium' } as any)
  const ctx = { hasUI, cwd: '/tmp', model: { id: 'm1', reasoning: true, contextWindow: 200000 } as any, ui: { setHeader: (f: unknown) => calls.push(f) } }
  handler({}, ctx)
  keys.forEach((k, i) => (saved[i] === undefined ? delete process.env[k] : (process.env[k] = saved[i])))
  return { calls, ctx }
}

test('session_start: instala cabeçalho que lê o modelo na hora de desenhar', () => {
  const { calls, ctx } = setup(true, {})
  assert.equal(calls.length, 1)
  const comp = calls[0](undefined, theme)
  const first = comp.render(200)[0]
  assert.ok(first.includes('m1') && first.includes('medium') && first.includes('200k ctx'))
  ctx.model = { id: 'm2', reasoning: false, contextWindow: 0 }
  const next = comp.render(200)[0]
  assert.ok(next.includes('m2'))
  assert.equal(next.includes('medium'), false)
  comp.invalidate()
})

test('sem UI, em subagente ou com NO_COLOR não há cabeçalho', () => {
  assert.equal(setup(false, {}).calls.length, 0)
  assert.equal(setup(true, { PI_CODE_SUBAGENT: '1' }).calls.length, 0)
  assert.equal(setup(true, { NO_COLOR: '1' }).calls.length, 0)
})

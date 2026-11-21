// node --experimental-strip-types --test ~/.pi/agent/extensions/ui/test/history.test.ts
import assert from 'node:assert/strict'
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, truncateSync, utimesSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

// O Node não tira tipos de .ts dentro de node_modules: testa uma cópia do módulo, com o pi ao lado.
const tmp = mkdtempSync(join(tmpdir(), 'ui-history-test-'))
mkdirSync(join(tmp, 'node_modules'))
const version = readFileSync(`${homedir()}/.pi/agent/install/current-version`, 'utf8').trim()
symlinkSync(`${homedir()}/.pi/agent/install/releases/${version}/node_modules/@earendil-works`, join(tmp, 'node_modules', '@earendil-works'))
cpSync(new URL('../history.ts', import.meta.url), join(tmp, 'history.ts'))
const m = await import(join(tmp, 'history.ts'))

const line = (content: unknown, role = 'user') => JSON.stringify({ type: 'message', message: { role, content } })
const file = (dir: string, name: string, lines: string[], mtime?: number) => {
  mkdirSync(dir, { recursive: true })
  const p = join(dir, name)
  writeFileSync(p, lines.join('\n'))
  if (mtime) utimesSync(p, mtime, mtime)
  return p
}
const tick = () => new Promise((r) => setImmediate(r))

test('parseUserPrompts: string, blocos, outros papéis, linha corrompida e vazia', () => {
  const text = [
    line('um'),
    line([{ type: 'text', text: 'dois' }, { type: 'image' }, { type: 'text', text: 'três' }]),
    line('resposta', 'assistant'),
    '{"role":"user" corrompido',
    line('   '),
    line({ x: 1 }),
    JSON.stringify({ type: 'custom', message: { role: 'user', content: 'ignorado' } }),
  ].join('\n')
  assert.deepEqual(m.parseUserPrompts(text), ['um', 'dois três'])
  assert.deepEqual(m.parseUserPrompts(''), [])
})

test('dedupeNewestFirst, filterPrompts e oneLine', () => {
  assert.deepEqual(m.dedupeNewestFirst(['a', 'b', 'a', 'c']), ['c', 'a', 'b'])
  const ps = ['Corrigir o BUG de login', 'login ok', 'outra coisa']
  assert.deepEqual(m.filterPrompts(ps, ''), ps)
  assert.deepEqual(m.filterPrompts(ps, '  bug LOGIN '), [ps[0]])
  assert.deepEqual(m.filterPrompts(ps, 'bug xyz'), [])
  assert.equal(m.oneLine('a\nb\r\n  c '), 'a ⏎ b ⏎ c')
})

test('stashStep: guarda, devolve, troca e não faz nada quando ambos vazios', () => {
  assert.deepEqual(m.stashStep('abc', undefined), { text: '', stash: 'abc' })
  assert.deepEqual(m.stashStep('', 'abc'), { text: 'abc', stash: undefined })
  assert.deepEqual(m.stashStep('novo', 'abc'), { text: 'abc', stash: 'novo' })
  assert.deepEqual(m.stashStep('', undefined), { text: '', stash: undefined })
})

test('loadFromDirs: ordem por mtime, dedupe, diretório inexistente e arquivo ilegível contados', async () => {
  const d = join(tmp, 'proj')
  file(d, 'velho.jsonl', [line('a'), line('b')], 1000)
  file(d, 'novo.jsonl', [line('b'), line('c')], 2000)
  file(d, 'ruim.jsonl', [line('x')], 1500)
  chmodSync(join(d, 'ruim.jsonl'), 0o000)
  file(d, 'nota.txt', [line('ignorado')])
  const r = await m.loadFromDirs([d, join(tmp, 'nao-existe')], new Map())
  assert.deepEqual(r.prompts, ['c', 'b', 'a'])
  assert.equal(r.skipped, 2) // dir inexistente + arquivo ilegível
  chmodSync(join(d, 'ruim.jsonl'), 0o600)
})

test('limites: arquivo >128 MB pulado, ≤300 arquivos, ≤5000 prompts', async () => {
  const big = join(tmp, 'big')
  mkdirSync(big)
  const p = join(big, 'enorme.jsonl')
  writeFileSync(p, '')
  truncateSync(p, m.MAX_FILE_BYTES + 1) // esparso: não ocupa disco
  file(big, 'ok.jsonl', [line('ok')])
  const r = await m.loadFromDirs([big], new Map())
  assert.deepEqual(r.prompts, ['ok'])
  assert.equal(r.skipped, 1)

  const many = join(tmp, 'many')
  for (let i = 0; i < 305; i++) file(many, `s${i}.jsonl`, [line(`p${i}`)], 10000 + i)
  const l = await m.listSessionFiles([many])
  assert.equal(l.files.length, m.MAX_FILES)
  assert.ok(l.files[0].path.endsWith('s304.jsonl'))

  const lots = join(tmp, 'lots')
  file(lots, 'a.jsonl', Array.from({ length: 5100 }, (_, i) => line(`q${i}`)))
  assert.equal((await m.loadFromDirs([lots], new Map())).prompts.length, m.MAX_PROMPTS)
})

test('cache por caminho, mtime e tamanho', async () => {
  const d = join(tmp, 'cache')
  const p = file(d, 'a.jsonl', [line('aaa')], 3000)
  const cache = new Map()
  assert.deepEqual((await m.loadFromDirs([d], cache)).prompts, ['aaa'])
  writeFileSync(p, line('bbb')) // mesmo tamanho; mtime restaurado → cache serve o antigo
  utimesSync(p, 3000, 3000)
  assert.deepEqual((await m.loadFromDirs([d], cache)).prompts, ['aaa'])
  writeFileSync(p, line('cccc')) // tamanho mudou → relê
  assert.deepEqual((await m.loadFromDirs([d], cache)).prompts, ['cccc'])
})

test('loadScope: sessão, projeto e todas', async () => {
  const root = join(tmp, 'sessions')
  const dir = join(root, 'proj-a')
  file(dir, 'a.jsonl', [line('pa')], 1000)
  file(join(root, 'proj-b'), 'b.jsonl', [line('pb')], 2000)
  file(root, 'solto.jsonl', [line('ignorado')])
  const src = {
    branch: [{ type: 'message', message: { role: 'user', content: 'x' } }, { type: 'message', message: { role: 'assistant', content: 'r' } }, { type: 'label' }, { type: 'message', message: { role: 'user', content: 'x' } }, { type: 'message', message: { role: 'user', content: 'y' } }],
    sessionDir: dir,
  }
  assert.deepEqual((await m.loadScope('sessão', src, new Map())).prompts, ['y', 'x'])
  assert.deepEqual((await m.loadScope('projeto', src, new Map())).prompts, ['pa'])
  assert.deepEqual((await m.loadScope('todas', src, new Map())).prompts, ['pb', 'pa'])
  const gone = await m.loadScope('todas', { branch: [], sessionDir: join(tmp, 'nada', 'x') }, new Map())
  assert.deepEqual(gone, { prompts: [], skipped: 1 })
})

const theme = { fg: (_c: string, s: string) => s, bg: (_c: string, s: string) => `[${s}]` }
function overlay(load: (s: string) => Promise<{ prompts: string[]; skipped: number }>) {
  const result: { done: boolean; value?: string } = { done: false }
  let renders = 0
  const o = new m.PromptHistory(theme, load, (v: string | undefined) => { result.done = true; result.value = v }, () => { renders++ })
  return { o, result, renders: () => renders }
}
const items = ['um\ndois', 'tres', 'quatro']

test('overlay: Carregando…, lista com ⏎, filtro, setas e Enter', async () => {
  const { o, result } = overlay(async () => ({ prompts: items, skipped: 1 }))
  assert.ok(o.render(60).join('\n').includes('Carregando…'))
  await tick()
  const out = o.render(60)
  assert.ok(out[0].includes('Histórico de prompts') && out[0].includes('[sessão]'))
  assert.ok(out.some((l) => l.includes('um ⏎ dois')))
  assert.ok(out.some((l) => l.includes('1 arquivo(s) ignorado(s)')))
  assert.ok(out.some((l) => l.startsWith('[→ um')))
  o.handleInput('\x1b[B')
  assert.equal(o.index, 1)
  o.handleInput('\x1b[B')
  o.handleInput('\x1b[B') // limite inferior
  assert.equal(o.index, 2)
  o.handleInput('\x1b[A')
  o.handleInput('\x1b[A')
  o.handleInput('\x1b[A') // limite superior
  assert.equal(o.index, 0)
  for (const c of 'TR') o.handleInput(c)
  assert.deepEqual(o.visible(), ['tres', 'quatro']) // sem caixa: "TR" também casa "quaTRo"
  o.handleInput('\x7f')
  assert.equal(o.query, 'T')
  o.handleInput('\x1b[C') // sequência de escape não vira texto
  assert.equal(o.query, 'T')
  o.handleInput('R')
  o.handleInput('\r')
  assert.deepEqual(result, { done: true, value: 'tres' })
})

test('overlay: Esc fecha sem valor; Enter sem resultado não fecha; sem resultados', async () => {
  const a = overlay(async () => ({ prompts: items, skipped: 0 }))
  await tick()
  a.o.handleInput('\x1b')
  assert.deepEqual(a.result, { done: true, value: undefined })
  const b = overlay(async () => ({ prompts: [], skipped: 0 }))
  await tick()
  b.o.handleInput('\r')
  assert.equal(b.result.done, false)
  assert.ok(b.o.render(40).join('\n').includes('Nenhum prompt'))
})

test('overlay: Tab troca sessão → projeto → todas → sessão; leitura antiga é descartada; falha não lança', async () => {
  const seen: string[] = []
  let release: (() => void) | undefined
  const { o } = overlay((scope) => {
    seen.push(scope)
    if (scope === 'sessão') return new Promise((res) => { release = () => res({ prompts: ['velho'], skipped: 0 }) })
    if (scope === 'todas') return Promise.reject(new Error('falhou'))
    return Promise.resolve({ prompts: ['proj'], skipped: 0 })
  })
  o.handleInput('\t') // projeto, enquanto sessão ainda lê
  await tick()
  release?.()
  await tick()
  assert.deepEqual(o.items, ['proj'])
  o.handleInput('\t') // todas: rejeita
  await tick()
  assert.deepEqual(o.items, [])
  assert.equal(o.skipped, 1)
  o.handleInput('\t')
  assert.deepEqual(seen, ['sessão', 'projeto', 'todas', 'sessão'])
  assert.equal(o.scope, 'sessão')
  o.invalidate()
})

test('overlay: rolagem mantém o item selecionado visível', async () => {
  const many = Array.from({ length: 30 }, (_, i) => `item${i}`)
  const { o } = overlay(async () => ({ prompts: many, skipped: 0 }))
  await tick()
  for (let i = 0; i < 20; i++) o.handleInput('\x1b[B')
  const out = o.render(40)
  assert.ok(out.some((l) => l.includes('item20')))
  assert.ok(!out.some((l) => l.includes('item0')))
})

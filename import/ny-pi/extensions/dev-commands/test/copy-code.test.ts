// node --experimental-strip-types --test ~/.pi/agent/extensions/dev-commands/test/copy-code.test.ts
import assert from 'node:assert/strict'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

// O Node não tira tipos dentro de node_modules: testa uma cópia com o pi ao lado.
const tmp = mkdtempSync(join(tmpdir(), 'dev-test-'))
mkdirSync(join(tmp, 'node_modules'))
symlinkSync(`${homedir()}/.pi/agent/install/releases/${readFileSync(`${homedir()}/.pi/agent/install/current-version`, 'utf8').trim()}/node_modules/@earendil-works`, join(tmp, 'node_modules', '@earendil-works'))
const load = async (name: string) => {
  cpSync(join(import.meta.dirname, '..', name), join(tmp, name))
  return import(join(tmp, name))
}
const mod = await load('copy-code.ts')
await load('keybindings.ts')
const idx = await load('index.ts')

const msg = (text: string) => [{ type: 'message', message: { role: 'user', content: 'x' } }, { type: 'message', message: { role: 'assistant', content: [{ type: 'text', text }, { type: 'thinking' }] } }]

function setup(branch: any[], over: any = {}) {
  const notes: any[] = []
  const selects: string[][] = []
  const ctx = {
    hasUI: true,
    sessionManager: { getBranch: () => branch },
    ui: { notify: (m: string, l: string) => notes.push([m, l]), select: async (_t: string, o: string[]) => (selects.push(o), over.pick?.(o)) },
    ...over.ctx,
  }
  const copied: string[] = []
  const copy = over.copy ?? (async (t: string) => void copied.push(t))
  return { ctx, notes, copied, copy, selects }
}

test('extractCodeBlocks: ``` e ~~~, fecho maior, sem fecho, fence curta de outro tipo', () => {
  const b = mod.extractCodeBlocks('a\n```ts\nx\n```\n~~~\ny\n```\nz\n~~~~\n````\nq\n```\nr\n````\n```js\nabre')
  assert.equal(b.length, 4)
  assert.equal(b[0].code, 'x')
  assert.equal(b[1].code, 'y\n```\nz')
  assert.equal(b[2].code, 'q\n```\nr')
  assert.deepEqual(b[3], { lang: 'js', code: 'abre' })
})

test('lastAssistantText: ramo vazio, string, partes de texto', () => {
  assert.equal(mod.lastAssistantText([]), undefined)
  assert.equal(mod.lastAssistantText([{ type: 'message', message: { role: 'assistant', content: 'oi' } }]), 'oi')
  assert.equal(mod.lastAssistantText(msg('t')), 't')
  assert.equal(mod.lastAssistantText([{ type: 'message', message: { role: 'assistant', content: 5 } }]), '')
})

test('sem mensagem e sem blocos: aviso informativo', async () => {
  let s = setup([])
  await mod.copyCode('', s.ctx, s.copy)
  assert.equal(s.notes[0][1], 'info')
  s = setup(msg('sem código'))
  await mod.copyCode('', s.ctx, s.copy)
  assert.match(s.notes[0][0], /não tem blocos/)
  assert.equal(s.copied.length, 0)
})

test('bloco único é copiado', async () => {
  const s = setup(msg('```ts\na\nb\n```'))
  await mod.copyCode('', s.ctx, s.copy)
  assert.deepEqual(s.copied, ['a\nb'])
  assert.equal(s.notes[0][0], 'Bloco 1 copiado (2 linhas)')
})

test('N válido e inválido', async () => {
  const text = '```\na\n```\n```\nb\n```'
  let s = setup(msg(text))
  await mod.copyCode('2', s.ctx, s.copy)
  assert.deepEqual(s.copied, ['b'])
  for (const bad of ['3', '0', 'x', '1.5']) {
    s = setup(msg(text))
    await mod.copyCode(bad, s.ctx, s.copy)
    assert.equal(s.notes[0][1], 'warning')
    assert.match(s.notes[0][0], /1 a 2/)
    assert.equal(s.copied.length, 0)
  }
})

test('vários blocos: select copia o escolhido; cancelar não copia', async () => {
  const text = '```ts\nfirst\n```\n```\nsecond\n```'
  let s = setup(msg(text), { pick: (o: string[]) => o[1] })
  await mod.copyCode('', s.ctx, s.copy)
  assert.deepEqual(s.copied, ['second'])
  assert.match(s.selects[0][0], /^1 · ts · first… \(1 linha\)$/)
  s = setup(msg(text), { pick: () => undefined })
  await mod.copyCode('', s.ctx, s.copy)
  assert.equal(s.copied.length, 0)
})

test('sem UI e vários blocos: lista no aviso', async () => {
  const s = setup(msg('```\na\n```\n```\nb\n```'), { ctx: { hasUI: false } })
  await mod.copyCode('', s.ctx, s.copy)
  assert.match(s.notes[0][0], /2 · texto/)
  assert.equal(s.copied.length, 0)
})

test('erro do clipboard vira notify de erro (Error e não-Error)', async () => {
  for (const err of [new Error('boom'), 'str']) {
    const s = setup(msg('```\na\n```'), { copy: async () => { throw err } })
    await mod.copyCode('', s.ctx, s.copy)
    assert.equal(s.notes[0][1], 'error')
    assert.match(s.notes[0][0], /Falha ao copiar/)
  }
})

test('index registra os dois comandos e o handler delega', async () => {
  const cmds: Record<string, any> = {}
  idx.default({ registerCommand: (n: string, c: any) => (cmds[n] = c) })
  assert.deepEqual(Object.keys(cmds).sort(), ['copy-code', 'keybindings'])
  const s = setup([])
  await cmds['copy-code'].handler(undefined, s.ctx)
  assert.equal(s.notes.length, 1)
  const k = setup([], { ctx: { hasUI: false } })
  await cmds.keybindings.handler('', k.ctx)
  assert.match(k.notes[0][0], /keybindings\.json/)
})

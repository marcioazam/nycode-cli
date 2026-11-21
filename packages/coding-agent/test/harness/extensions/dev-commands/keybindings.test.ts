// node --experimental-strip-types --test ~/.pi/agent/extensions/dev-commands/test/keybindings.test.ts
import assert from 'node:assert/strict'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

// O Node não tira tipos dentro de node_modules: testa uma cópia com o pi ao lado.
const tmp = mkdtempSync(join(tmpdir(), 'dev-kb-test-'))
mkdirSync(join(tmp, 'node_modules'))
symlinkSync(`${homedir()}/.pi/agent/install/releases/${readFileSync(`${homedir()}/.pi/agent/install/current-version`, 'utf8').trim()}/node_modules/@earendil-works`, join(tmp, 'node_modules', '@earendil-works'))
cpSync(join(import.meta.dirname, '..', 'keybindings.ts'), join(tmp, 'keybindings.ts'))
const mod = await import(join(tmp, 'keybindings.ts'))

function setup(edited: string | undefined, hasUI = true) {
  const notes: any[] = []
  const calls: any[] = []
  const ctx = {
    hasUI,
    ui: {
      notify: (m: string, l: string) => notes.push([m, l]),
      editor: async (_t: string, prefill: string) => (calls.push(prefill), edited),
    },
    reload: async () => void calls.push('reload'),
  }
  return { ctx, notes, calls }
}
const file = () => join(mkdtempSync(join(tmpdir(), 'kb-')), 'keybindings.json')

test('validateKeybindings: válido, JSON inválido, não-objeto, valor inválido, id desconhecido', () => {
  assert.deepEqual(mod.validateKeybindings('{"app.exit":["ctrl+d"],"tui.editor.x":"a"}'), { errors: [], warnings: [] })
  assert.match(mod.validateKeybindings('{').errors[0], /JSON inválido/)
  for (const t of ['[]', 'null', '3']) assert.match(mod.validateKeybindings(t).errors[0], /objeto/)
  assert.match(mod.validateKeybindings('{"app.exit":3}').errors[0], /texto ou lista/)
  assert.equal(mod.validateKeybindings('{"app.exit":[1]}').errors.length, 1)
  assert.match(mod.validateKeybindings('{"foo":"a"}').warnings[0], /Id desconhecido: "foo"/)
})

test('sem UI: avisa o caminho', async () => {
  const s = setup(undefined, false)
  await mod.editKeybindings(s.ctx, '/x/k.json')
  assert.match(s.notes[0][0], /\/x\/k\.json/)
  assert.equal(s.calls.length, 0)
})

test('arquivo ausente: prefill {} , grava sem .bak e recarrega', async () => {
  const p = file()
  const s = setup('{"app.exit":"ctrl+q"}')
  await mod.editKeybindings(s.ctx, p)
  assert.equal(s.calls[0], '{\n}\n')
  assert.equal(readFileSync(p, 'utf8'), '{"app.exit":"ctrl+q"}')
  assert.equal(existsSync(`${p}.bak`), false)
  assert.deepEqual(s.calls.slice(1), ['reload'])
  assert.equal(s.notes[0][1], 'info')
})

test('arquivo existente: prefill atual, .bak com o antigo, aviso de id desconhecido', async () => {
  const p = file()
  writeFileSync(p, '{"app.exit":"a"}')
  const s = setup('{"zzz":"b"}')
  await mod.editKeybindings(s.ctx, p)
  assert.equal(s.calls[0], '{"app.exit":"a"}')
  assert.equal(readFileSync(`${p}.bak`, 'utf8'), '{"app.exit":"a"}')
  assert.equal(readFileSync(p, 'utf8'), '{"zzz":"b"}')
  assert.equal(s.notes[0][1], 'warning')
  assert.equal(s.calls.at(-1), 'reload')
})

test('cancelar não grava nem recarrega', async () => {
  const p = file()
  const s = setup(undefined)
  await mod.editKeybindings(s.ctx, p)
  assert.equal(existsSync(p), false)
  assert.equal(s.notes[0][1], 'info')
  assert.equal(s.calls.includes('reload'), false)
})

test('erro de validação: notify de erro, sem gravar nem recarregar', async () => {
  const p = file()
  const s = setup('{"app.exit":1}')
  await mod.editKeybindings(s.ctx, p)
  assert.equal(s.notes[0][1], 'error')
  assert.equal(existsSync(p), false)
  assert.equal(s.calls.includes('reload'), false)
})

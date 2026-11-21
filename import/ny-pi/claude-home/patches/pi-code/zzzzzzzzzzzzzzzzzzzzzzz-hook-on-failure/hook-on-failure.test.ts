import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { after, test } from 'node:test'

// ONFAILURE_PATCH=/dev/null roda o teste sem o patch (prova do vermelho).
const patchFile = process.env.ONFAILURE_PATCH ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'zzzzzzzzzzzzzzzzzzzzzzz-hook-on-failure.patch')
const tmp = mkdtempSync(join(tmpdir(), 'hook-on-failure-test-'))
after(() => rmSync(tmp, { recursive: true }))
const ext = join(tmp, 'extensions')
cpSync(`${homedir()}/.pi/agent/npm/node_modules/pi-code/extensions`, ext, { recursive: true })
const rel = `${homedir()}/.pi/agent/install/releases/${readFileSync(`${homedir()}/.pi/agent/install/current-version`, 'utf8').trim()}/node_modules`
mkdirSync(join(tmp, 'node_modules'))
for (const m of ['@earendil-works', 'typebox']) symlinkSync(join(rel, m), join(tmp, 'node_modules', m))

const patch = (...flags: string[]) => spawnSync('patch', ['-d', ext, '-p1', '-s', '-f', '--no-backup-if-mismatch', ...flags], { input: readFileSync(patchFile) }).status
const noPatch = patchFile === '/dev/null'
// A cópia pode já vir com o patch (árvore instalada = pilha aplicada): volta ao original primeiro.
if (!noPatch && patch('-R', '--dry-run') === 0) assert.equal(patch('-R'), 0)
const dryOk = noPatch ? 0 : patch('-N', '--dry-run')
const applied = noPatch ? 0 : patch('-N')
const reverseDry = noPatch ? 0 : patch('-R', '--dry-run')
const dec = await import(join(ext, 'hooks/decisions.ts'))
const cfg = await import(join(ext, 'hooks/config.ts'))

const hook = (extra: object = {}) => ({ type: 'command', command: 'guard.py', ...extra })
const config = (h: object) => ({ PreToolUse: [{ matcher: '*', hooks: [h] }], UserPromptSubmit: [{ hooks: [h] }] })
const result = (o: object) => ({ code: 0, stdout: '', stderr: '', timedOut: false, ...o })
const pre = (h: object, r: object) => dec.runPreToolUse(config(h), 'bash', { command: 'ls' }, async () => result(r))
const prompt = (h: object, r: object) => dec.runUserPromptSubmit(config(h), 'oi', async () => result(r))
const REASON = 'Hook failed (exit 1, onFailure: block): guard.py: ModuleNotFoundError: x'
const FAIL = { code: 1, stderr: 'ModuleNotFoundError: x\ntraceback' }

test('o patch aplica, e reverte limpo', () => {
  assert.equal(dryOk, 0)
  assert.equal(applied, 0)
  assert.equal(reverseDry, 0)
})

test('PreToolUse: onFailure block + exit 1 bloqueia com o motivo', async () => {
  const o = await pre(hook({ onFailure: 'block' }), FAIL)
  assert.equal(o.block, true)
  assert.equal(o.reason, REASON)
})

test('PreToolUse: exit 1 com JSON allow também bloqueia; sem stderr omite o sufixo', async () => {
  const o = await pre(hook({ onFailure: 'block' }), { code: 3, stdout: '{"hookSpecificOutput":{"permissionDecision":"allow"}}' })
  assert.equal(o.block, true)
  assert.equal(o.reason, 'Hook failed (exit 3, onFailure: block): guard.py')
})

test('PreToolUse: sem onFailure ou continue, exit 1 segue permitido (paridade)', async () => {
  assert.equal((await pre(hook(), FAIL)).block, false)
  assert.equal((await pre(hook({ onFailure: 'continue' }), FAIL)).block, false)
})

test('PreToolUse: exit 0 passa e exit 2 mantém o motivo do próprio hook, com block', async () => {
  assert.equal((await pre(hook({ onFailure: 'block' }), {})).block, false)
  const o = await pre(hook({ onFailure: 'block' }), { code: 2, stderr: 'nao' })
  assert.deepEqual([o.block, o.reason], [true, 'nao'])
})

test('PreToolUse: timeout e spawnFailed continuam bloqueando', async () => {
  assert.match((await pre(hook({ onFailure: 'block' }), { code: 1, timedOut: true })).reason, /timed out/)
  assert.match((await pre(hook({ onFailure: 'block' }), { spawnFailed: true, stderr: 'boom' })).reason, /failed to run/)
})

test('UserPromptSubmit: mesmo tratamento', async () => {
  const o = await prompt(hook({ onFailure: 'block' }), FAIL)
  assert.deepEqual([o.block, o.reason], [true, REASON])
  assert.equal((await prompt(hook(), FAIL)).block, false)
})

test('config: block/continue preservados; valor inválido vira continue com aviso', () => {
  const file = join(tmp, 'settings.json')
  writeFileSync(file, JSON.stringify({ hooks: { PreToolUse: [{ matcher: '*', hooks: [hook({ onFailure: 'block' }), hook({ command: 'b', onFailure: 'maybe' }), hook({ command: 'c', onFailure: 'continue' })] }] } }))
  const warns: string[] = []
  const orig = console.warn
  console.warn = (m: string) => warns.push(String(m))
  let loaded
  try {
    loaded = cfg.loadHooks([file])
  } finally {
    console.warn = orig
  }
  const hooks = loaded.PreToolUse[0].hooks
  assert.deepEqual(hooks.map((h: any) => h.onFailure), ['block', undefined, 'continue'])
  assert.equal(warns.filter((w) => w.includes('onFailure')).length, 1)
})

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cpSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { after, test } from 'node:test'

const patchFile = join(dirname(fileURLToPath(import.meta.url)), '..', 'zzzzzzzzzzzzzzzzzzzzzz-hook-diag.patch')
const tmp = mkdtempSync(join(tmpdir(), 'hook-diag-test-'))
after(() => rmSync(tmp, { recursive: true }))
const ext = join(tmp, 'extensions')
cpSync(`${homedir()}/.pi/agent/npm/node_modules/pi-code/extensions`, ext, { recursive: true })
const rel = `${homedir()}/.pi/agent/install/releases/${readFileSync(`${homedir()}/.pi/agent/install/current-version`, 'utf8').trim()}/node_modules`
mkdirSync(join(tmp, 'node_modules'))
for (const m of ['@earendil-works', 'typebox']) symlinkSync(join(rel, m), join(tmp, 'node_modules', m))

const patch = (...flags: string[]) => spawnSync('patch', ['-d', ext, '-p1', '-s', '-f', '--no-backup-if-mismatch', ...flags], { input: readFileSync(patchFile) }).status
// A cópia pode já vir com o patch (árvore instalada = pilha aplicada): volta ao original primeiro.
if (patch('-R', '--dry-run') === 0) assert.equal(patch('-R'), 0)
copyFileSync(join(ext, 'hooks/runners.ts'), join(ext, 'hooks/runners-orig.ts'))
const dryOk = patch('-N', '--dry-run')
const applied = patch('-N')
const reverseDry = patch('-R', '--dry-run')
const orig = await import(join(ext, 'hooks/runners-orig.ts'))
const mod = await import(join(ext, 'hooks/runners.ts'))

const KEY = Symbol.for('pi-harness:diag')
const g = globalThis as any
const run = (cmd: string, ms = 5000, payload: unknown = { hook_event_name: 'PreToolUse' }) => mod.runHookCommand(cmd, payload, ms)
const capture = async (cmd: string, ms?: number, payload?: unknown) => {
  const recs: any[] = []
  g[KEY] = (r: unknown) => recs.push(r)
  try {
    const result = await run(cmd, ms, payload)
    return { result, recs }
  } finally {
    delete g[KEY]
  }
}

test('o patch aplica (dry-run no original), aplica e reverte limpo', () => {
  assert.equal(dryOk, 0)
  assert.equal(applied, 0)
  assert.equal(reverseDry, 0)
})

test('sucesso: sev 9, quieto, durMs numérico', async () => {
  const { result, recs } = await capture('/bin/true')
  assert.equal(result.code, 0)
  assert.equal(recs.length, 1)
  const r = recs[0]
  assert.equal(r.sev, 9)
  assert.equal(r.quieto, true)
  assert.equal(r.fonte, 'hook')
  assert.equal(r.tipo, 'hook')
  assert.equal(typeof r.dados.durMs, 'number')
  assert.match(r.msg, /^PreToolUse · true · ok · \d+ ms$/)
  assert.equal(r.detalhe, undefined)
  assert.deepEqual([r.dados.evento, r.dados.comando, r.dados.code, r.dados.timedOut, r.dados.spawnFailed], ['PreToolUse', '/bin/true', 0, false, false])
})

test('saída 2 com stderr: sev 13, bloqueou, detalhe com o stderr', async () => {
  const { recs } = await capture('echo proibido >&2; exit 2')
  assert.equal(recs[0].sev, 13)
  assert.equal(recs[0].quieto, false)
  assert.match(recs[0].msg, /bloqueou \(2\)/)
  assert.match(recs[0].detalhe, /proibido/)
})

test('saída 1: sev 17', async () => {
  const { recs } = await capture('exit 1')
  assert.equal(recs[0].sev, 17)
  assert.equal(recs[0].quieto, false)
  assert.match(recs[0].msg, /saiu 1/)
})

test('timeout: sev 17 e timedOut', async () => {
  const { result, recs } = await capture('sleep 5', 100)
  assert.equal(result.timedOut, true)
  assert.equal(recs[0].sev, 17)
  assert.equal(recs[0].dados.timedOut, true)
  assert.match(recs[0].msg, /timeout/)
})

test('falha ao iniciar: sev 17 e spawnFailed', async () => {
  const recs: any[] = []
  g[KEY] = (r: unknown) => recs.push(r)
  try {
    const result = await mod.runHookCommand('/nao/existe/hook-diag', {}, 5000, { args: [] })
    assert.equal(result.spawnFailed, true)
  } finally {
    delete g[KEY]
  }
  assert.equal(recs[0].sev, 17)
  assert.equal(recs[0].dados.spawnFailed, true)
  assert.equal(recs[0].dados.evento, 'hook')
  assert.match(recs[0].msg, /não iniciou/)
})

test('comando longo é truncado a 200; stderr a 2048', async () => {
  const { recs } = await capture(`: ${'x'.repeat(400)}; head -c 5000 /dev/zero | tr '\\0' e >&2; exit 1`)
  assert.equal(recs[0].dados.comando.length, 200)
  assert.equal(recs[0].detalhe.length, 2048)
})

test('sink que lança não muda o resultado; sem sink o resultado é igual ao original', async () => {
  g[KEY] = () => {
    throw new Error('boom')
  }
  let thrown: unknown
  try {
    thrown = await run('echo oi; echo err >&2; exit 3')
  } finally {
    delete g[KEY]
  }
  const plain = await run('echo oi; echo err >&2; exit 3')
  const before = await orig.runHookCommand('echo oi; echo err >&2; exit 3', { hook_event_name: 'PreToolUse' }, 5000)
  assert.deepEqual(thrown, { code: 3, stdout: 'oi\n', stderr: 'err\n', timedOut: false })
  assert.deepEqual(plain, before)
})

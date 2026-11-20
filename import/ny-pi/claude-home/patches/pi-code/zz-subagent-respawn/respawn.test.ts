// Testes do zz-subagent-respawn.patch: node --experimental-strip-types --test ~/.pi/agent/claude-home/patches/pi-code/zz-subagent-respawn/respawn.test.ts
import assert from 'node:assert/strict'
import { cpSync, mkdtempSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

// O Node não tira tipos de .ts dentro de node_modules: testa uma cópia do módulo (respawn.ts só importa node:*).
const tmp = mkdtempSync(join(tmpdir(), 'respawn-test-'))
cpSync(`${homedir()}/.pi/agent/npm/node_modules/pi-code/extensions/subagent/respawn/index.ts`, join(tmp, 'respawn.ts'))
const r = await import(join(tmp, 'respawn.ts'))
after(() => rmSync(tmp, { recursive: true }))

const ok = { role: 'assistant', stopReason: 'stop' }
const err = (errorMessage = 'boom') => ({ role: 'assistant', stopReason: 'error', errorMessage })
const base = { wasAborted: false, attempts: 0, exitCode: 1, messages: [ok], env: {} }

test('respawna: exit != 0, morto por sinal, último turno em erro, sem mensagem do assistente', () => {
  assert.match(r.shouldRespawn(base), /^exit code 1/)
  assert.match(r.shouldRespawn({ ...base, exitCode: null }), /by signal/)
  assert.match(r.shouldRespawn({ ...base, exitCode: 0, messages: [err('503 unavailable')] }), /503 unavailable/)
  assert.match(r.shouldRespawn({ ...base, exitCode: 0, messages: [] }), /no assistant message/)
  assert.match(r.shouldRespawn({ ...base, attempts: 1 }), /exit code 1/)
})

test('não respawna: sucesso, aborto, stop do usuário, partial, env 0, 2 tentativas usadas', () => {
  assert.equal(r.shouldRespawn({ ...base, exitCode: 0 }), undefined)
  assert.equal(r.shouldRespawn({ ...base, wasAborted: true }), undefined)
  assert.equal(r.shouldRespawn({ ...base, stopBy: 'user' }), undefined)
  assert.equal(r.shouldRespawn({ ...base, partial: true }), undefined)
  assert.equal(r.shouldRespawn({ ...base, env: { PI_SUBAGENT_RESPAWN: '0' } }), undefined)
  assert.equal(r.shouldRespawn({ ...base, attempts: 2 }), undefined)
})

test('não respawna erro não retentável do provedor (mensagem ou stderr)', () => {
  for (const m of ['insufficient_quota', 'Billing hard limit', 'quota exceeded', 'out of budget', 'usage limit reached', 'authentication_error', 'invalid_api_key', 'permission_error', 'invalid_request_error'])
    assert.equal(r.shouldRespawn({ ...base, messages: [err(m)] }), undefined, m)
  assert.equal(r.shouldRespawn({ ...base, messages: [], stderr: 'Error: invalid_api_key' }), undefined)
})

test('orçamento do lane esgotado = sem respawn; só é chamado quando o resto já decidiu respawnar', () => {
  let calls = 0
  assert.equal(r.shouldRespawn({ ...base, claimBudget: () => (calls++, 'Subagent cost budget spent') }), undefined)
  assert.equal(r.shouldRespawn({ ...base, claimBudget: () => (calls++, undefined) }) !== undefined, true)
  assert.equal(r.shouldRespawn({ ...base, exitCode: 0, claimBudget: () => (calls++, undefined) }), undefined)
  assert.equal(calls, 2)
})

test('falha segura: exceção na decisão = sem respawn; motivo limitado a 200 caracteres', () => {
  assert.equal(r.shouldRespawn({ ...base, messages: null }), undefined)
  assert.equal(r.shouldRespawn({ ...base, claimBudget: () => { throw new Error('x') } }), undefined)
  assert.ok(r.shouldRespawn({ ...base, stderr: 'x'.repeat(1000) }).length <= 200)
})

test('espera: 20s e 60s; PI_SUBAGENT_RESPAWN_DELAY_MS substitui', () => {
  assert.equal(r.respawnDelayMs(0, {}), 20_000)
  assert.equal(r.respawnDelayMs(1, {}), 60_000)
  assert.equal(r.respawnDelayMs(1, { PI_SUBAGENT_RESPAWN_DELAY_MS: '5' }), 5)
})

test('args: --no-session vira sessão persistida; respawn só troca a tarefa', () => {
  const args = ['--mode', 'json', '-p', '--no-session', '--system-prompt', '/p.md', 'Task: x']
  r.useSessionArgs(args, '/tmp/d', 'pi-code-fg-abcd1234')
  assert.deepEqual(args, ['--mode', 'json', '-p', '--session-id', 'pi-code-fg-abcd1234', '--session-dir', '/tmp/d', '--system-prompt', '/p.md', 'Task: x'])
  const before = args.slice(0, -1)
  args[args.length - 1] = r.respawnTask('exit code 1: boom')
  assert.deepEqual(args.slice(0, -1), before)
  assert.match(args.at(-1), /^Your previous run of this task stopped unexpectedly \(exit code 1: boom\)\. Your full prior conversation is loaded\./)
  assert.ok(!args.includes('--no-session'))
})

test('sessão: diretório temporário criado; espera abortável', async () => {
  const d = r.makeSessionDir()
  assert.match(d, /pi-code-fg-session-/)
  rmSync(d, { recursive: true })
  assert.equal(await r.sleepAbortable(5), false)
  const ac = new AbortController()
  setTimeout(() => ac.abort(), 10)
  assert.equal(await r.sleepAbortable(60_000, ac.signal), true)
  assert.equal(await r.sleepAbortable(60_000, AbortSignal.abort()), true)
})

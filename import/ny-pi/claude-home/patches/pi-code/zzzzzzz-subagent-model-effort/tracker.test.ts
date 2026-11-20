// Modelo e esforço no registro da frota (docs/subagent-model-effort.md, AC3-AC6): node --experimental-strip-types --test ~/.pi/agent/claude-home/patches/pi-code/zzzzzzz-subagent-model-effort/tracker.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fleetTestEnv } from '../subagent-panel/setup.ts'

const { ext } = fleetTestEnv('fleet-model-effort-')
const store = await import(`${ext}/subagent/fleet/store.ts`)
const trackerMod = await import(`${ext}/subagent/fleet/tracker.ts`)
const childMod = await import(`${ext}/subagent/child.ts`)

const id = (n: number): string => `fg-${n.toString(16).padStart(8, '0')}`
const line = (ev: unknown): string => JSON.stringify(ev)
function mainFleet(): string {
  delete process.env.PI_CODE_SUBAGENT_DEPTH
  delete process.env.PI_CODE_SUBAGENT
  return store.ensureFleetDir()
}
const start = (opts: Record<string, unknown>, n: number) => {
  const dir = mainFleet()
  const tr = trackerMod.startTracking({ id: id(n), agent: 'swarm-worker', task: 't', background: false, ...opts })
  const read = () => {
    tr.flush(true)
    return JSON.parse(readFileSync(join(dir, `${id(n)}.json`), 'utf8'))
  }
  return { tr, read, dir }
}

test('configuredRuntime: lê o argv real (modelo com sufixo, --thinking, sem nada, sufixo que não é nível)', () => {
  const c = trackerMod.configuredRuntime
  assert.deepEqual(c(['--mode', 'json', '--model', 'anthropic/claude-sonnet-5-5:medium', '--tools', 'read']), { model: 'anthropic/claude-sonnet-5-5', effort: 'medium' })
  assert.deepEqual(c(['--model', 'm', '--thinking', 'off']), { model: 'm', effort: 'off' })
  assert.deepEqual(c(['--thinking', 'high']), { effort: 'high' })
  assert.deepEqual(c(['--model', 'm:off']), { model: 'm', effort: 'off' })
  assert.deepEqual(c(['--model', 'openrouter/x:free']), { model: 'openrouter/x:free' })
  assert.deepEqual(c(['--mode', 'json', '-p']), {})
  assert.deepEqual(c(['--model']), {})
})

test('configuredRuntime acompanha agentInvocationArgs: agent.model, alias e CLAUDE_CODE_SUBAGENT_MODEL', () => {
  const c = trackerMod.configuredRuntime
  const base = { name: 'w', description: 'd', systemPrompt: '', source: 'user' }
  assert.deepEqual(c(childMod.agentInvocationArgs({ ...base, model: 'a/b', effort: 'low' })), { model: 'a/b', effort: 'low' })
  assert.deepEqual(c(childMod.agentInvocationArgs({ ...base }, 'anthropic/alias-resolved')), { model: 'anthropic/alias-resolved' })
  const saved = process.env.CLAUDE_CODE_SUBAGENT_MODEL
  process.env.CLAUDE_CODE_SUBAGENT_MODEL = 'env/model'
  try {
    assert.deepEqual(c(childMod.agentInvocationArgs({ ...base })), { model: 'env/model' }, 'sem effort: desconhecido, não herdado')
  } finally {
    if (saved === undefined) delete process.env.CLAUDE_CODE_SUBAGENT_MODEL
    else process.env.CLAUDE_CODE_SUBAGENT_MODEL = saved
  }
})

test('tracker: configurado explícito fica no registro como não observado', () => {
  const { read } = start({ model: 'anthropic/claude-sonnet-5-5', effort: 'medium' }, 1)
  const rec = read()
  assert.equal(rec.model, 'anthropic/claude-sonnet-5-5')
  assert.equal(rec.effort, 'medium')
  assert.equal(rec.modelSeen, undefined)
  assert.equal(rec.effortSeen, undefined)
  store.removeFleetDir()
})

test('tracker: sem esforço configurado o registro não inventa um (nem medium)', () => {
  const { read } = start({}, 2)
  const rec = read()
  assert.equal('effort' in rec, false)
  assert.equal('model' in rec, false)
  assert.equal('provider' in rec, false)
  store.removeFleetDir()
})

test('tracker: esforço off configurado é preservado', () => {
  const { read } = start({ effort: 'off' }, 3)
  assert.equal(read().effort, 'off')
  store.removeFleetDir()
})

test('tracker: message_start do assistente já traz o modelo físico e o esforço observados', () => {
  const { tr, read } = start({ model: 'anthropic/configured', effort: 'low' }, 4)
  tr.onLine(line({ type: 'message_start', message: { role: 'assistant', provider: 'openai-codex', model: 'gpt-5.6-luna', thinkingLevel: 'high' } }))
  const rec = read()
  assert.equal(rec.provider, 'openai-codex')
  assert.equal(rec.model, 'gpt-5.6-luna')
  assert.equal(rec.effort, 'high')
  assert.equal(rec.modelSeen, true)
  assert.equal(rec.effortSeen, true)
  store.removeFleetDir()
})

test('tracker: message_end sobrescreve; sem thinkingLevel mantém o esforço anterior; user não conta', () => {
  const { tr, read } = start({ model: 'a/b', effort: 'low' }, 5)
  tr.onLine(line({ type: 'message_end', message: { role: 'user', provider: 'x', model: 'y', thinkingLevel: 'xhigh', content: 'oi' } }))
  assert.equal(read().model, 'a/b', 'mensagem de user não é runtime do modelo')
  tr.onLine(line({ type: 'message_end', message: { role: 'assistant', provider: 'anthropic', model: 'claude-sonnet-5-5', content: [], usage: { input: 1, output: 1, totalTokens: 2 } } }))
  const rec = read()
  assert.equal(rec.provider, 'anthropic')
  assert.equal(rec.model, 'claude-sonnet-5-5')
  assert.equal(rec.effort, 'low')
  assert.equal(rec.effortSeen, undefined, 'esforço ainda é o configurado')
  store.removeFleetDir()
})

test('tracker: thinking_level_changed troca o esforço e marca observado', () => {
  const { tr, read } = start({}, 6)
  tr.onLine(line({ type: 'thinking_level_changed', level: 'off' }))
  let rec = read()
  assert.equal(rec.effort, 'off')
  assert.equal(rec.effortSeen, true)
  tr.onLine(line({ type: 'thinking_level_changed', level: 'high' }))
  assert.equal(read().effort, 'high')
  tr.onLine(line({ type: 'thinking_level_changed', level: 'não é nível!' }))
  assert.equal(read().effort, 'high', 'valor inválido é ignorado')
  tr.onLine(line({ type: 'thinking_level_changed' }))
  rec = read()
  assert.equal(rec.effort, 'high')
  store.removeFleetDir()
})

test('tracker: metadados inválidos ou enormes são limpos/ignorados', () => {
  const { tr, read } = start({}, 7)
  tr.onLine(line({ type: 'message_start', message: { role: 'assistant', provider: 42, model: '', thinkingLevel: {} } }))
  assert.equal('model' in read(), false)
  tr.onLine(line({ type: 'message_start', message: { role: 'assistant', provider: 'p\u001b[31m', model: 'm'.repeat(500) } }))
  const rec = read()
  assert.equal(rec.provider, 'p', 'sequência ANSI removida')
  assert.equal(rec.model.length, 120)
  store.removeFleetDir()
})

test('tracker: resume recomeça do configurado do novo argv; contadores seguem', () => {
  const { tr, read } = start({ model: 'a/b', effort: 'low' }, 8)
  tr.onLine(line({ type: 'message_end', message: { role: 'assistant', provider: 'p', model: 'm', thinkingLevel: 'high', content: [], usage: { input: 3, output: 4, totalTokens: 7 } } }))
  tr.finish({ exitCode: 0 })
  assert.equal(read().state, 'done')
  const again = trackerMod.startTracking({ id: id(8), agent: 'swarm-worker', task: 't2', background: true, model: 'c/d' })
  const dir = store.currentFleetDir()
  const rec = JSON.parse(readFileSync(join(dir, `${id(8)}.json`), 'utf8'))
  assert.equal(rec.model, 'c/d')
  assert.equal('effort' in rec, false, 'o esforço antigo não vaza para a nova execução')
  assert.equal(rec.modelSeen, undefined)
  assert.equal(rec.turns, 1)
  again.finish({ exitCode: 0 })
  store.removeFleetDir()
})

test('wiring: run.ts e background.ts passam o argv resolvido ao startTracking', () => {
  for (const f of ['run.ts', 'background.ts']) {
    const src = readFileSync(`${ext}/subagent/${f}`, 'utf8')
    assert.match(src, /configuredRuntime\(/, f)
  }
})

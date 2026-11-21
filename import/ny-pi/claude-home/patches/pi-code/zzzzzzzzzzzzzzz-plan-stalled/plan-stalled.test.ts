// Testes do zzzzzzzzzzzzzzz-plan-stalled.patch: node --experimental-strip-types --test ~/.pi/agent/claude-home/patches/pi-code/zzzzzzzzzzzzzzz-plan-stalled/plan-stalled.test.ts
// Superado em parte em 2026-11-15 (zzzzzzzzzzzzzzzzzzzzzzzzzz-plan-no-interrupt): sem encerramento por runs paradas.
// Pedido do dono (2026-11-14): interromper um turno encerrava a execução do plano e a mensagem saía como [plan-complete].
import assert from 'node:assert/strict'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

// O Node não tira tipos de .ts dentro de node_modules: testa uma cópia do pacote, com o pi ao lado.
const tmp = mkdtempSync(join(tmpdir(), 'plan-stalled-test-'))
after(() => rmSync(tmp, { recursive: true }))
cpSync(`${homedir()}/.pi/agent/npm/node_modules/pi-code/extensions`, join(tmp, 'extensions'), { recursive: true })
const rel = `${homedir()}/.pi/agent/install/releases/${readFileSync(`${homedir()}/.pi/agent/install/current-version`, 'utf8').trim()}/node_modules`
mkdirSync(join(tmp, 'node_modules'))
for (const m of ['@earendil-works', 'typebox']) symlinkSync(join(rel, m), join(tmp, 'node_modules', m))
const planMode = (await import(join(tmp, 'extensions', 'plan-mode', 'index.ts'))).default

/** Sobe a extensão e entra em execução de um plano de 2 etapas. */
async function executing() {
  const on: Record<string, any> = {}
  const cmds: Record<string, any> = {}
  const tools: Record<string, any> = {}
  const sent: any[] = []
  let active = ['read', 'bash', 'edit', 'plan_mode_complete']
  const pi: any = {
    on: (e: string, f: any) => (on[e] = f),
    registerCommand: (n: string, c: any) => (cmds[n] = c),
    registerTool: (t: any) => (tools[t.name] = t),
    registerShortcut() {},
    registerFlag() {},
    getFlag: () => undefined,
    getActiveTools: () => active,
    setActiveTools: (t: string[]) => (active = t),
    getAllTools: () => active.map((name) => ({ name })),
    events: { emit() {}, on() {} },
    appendEntry() {},
    sendMessage: (m: any) => sent.push(m),
    sendUserMessage() {},
  }
  planMode(pi)
  const ui = { notify() {}, setStatus() {}, setWidget() {}, select: async () => 'Execute the plan (track progress)', editor: async () => '', theme: { fg: (_c: string, s: string) => s } }
  const ctx: any = { hasUI: true, ui, isIdle: () => true, sessionManager: { getEntries: () => [], getBranch: () => [] } }
  await cmds.plan.handler('', ctx)
  await tools.plan_mode_complete.execute('id', { plan: 'Tier: T0 (teste)\n1. contar a.txt\n- wc -l a.txt\n2. contar b.txt\n- wc -l b.txt' })
  await on.agent_end({ messages: [] }, ctx)
  const ended = () => sent.filter((m) => m.customType === 'plan-complete' || m.customType === 'plan-stalled')
  const assistant = (text: string, stopReason = 'stop') => ({ role: 'assistant', content: [{ type: 'text', text }], stopReason })
  return { on, ctx, ended, assistant }
}

test('turno interrompido pelo usuário não conta como turno sem progresso', async () => {
  const { on, ctx, ended, assistant } = await executing()
  for (let i = 0; i < 4; i++) await on.agent_end({ messages: [assistant('parcial', 'aborted')] }, ctx)
  assert.deepEqual(ended(), [])
})

// Contrato 2026-11-15 (revoga o limite de 2 runs): run sem progresso nunca encerra o plano.
test('execução parada sem progresso continua ativa: nem plan-stalled nem plan-complete', async () => {
  const { on, ctx, ended, assistant } = await executing()
  await on.agent_end({ messages: [assistant('nada')] }, ctx)
  await on.agent_end({ messages: [assistant('interrompido', 'aborted')] }, ctx)
  for (let i = 0; i < 5; i++) await on.agent_end({ messages: [assistant('nada')] }, ctx)
  assert.deepEqual(ended(), [])
})

test('plano concluído continua saindo como plan-complete', async () => {
  const { on, ctx, ended, assistant } = await executing()
  const done = assistant('feito [DONE:1] [DONE:2]')
  await on.turn_end({ message: done }, ctx)
  await on.agent_end({ messages: [done] }, ctx)
  assert.equal(ended().length, 1)
  assert.equal(ended()[0].customType, 'plan-complete')
  assert.match(ended()[0].content, /Plan Complete/)
})

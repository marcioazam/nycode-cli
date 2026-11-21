// Testes do zzzz-plan-done-rule.patch: node --experimental-strip-types --test ~/.pi/agent/claude-home/patches/pi-code/zzzz-plan-done-rule/plan-done-rule.test.ts
import assert from 'node:assert/strict'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

// O Node não tira tipos de .ts dentro de node_modules: testa uma cópia do pacote, com o pi ao lado.
const tmp = mkdtempSync(join(tmpdir(), 'plan-done-rule-test-'))
after(() => rmSync(tmp, { recursive: true }))
cpSync(process.env.PI_CODE_EXT ?? `${homedir()}/.pi/agent/npm/node_modules/pi-code/extensions`, join(tmp, 'extensions'), { recursive: true })
const rel = `${homedir()}/.pi/agent/install/releases/${readFileSync(`${homedir()}/.pi/agent/install/current-version`, 'utf8').trim()}/node_modules`
mkdirSync(join(tmp, 'node_modules'))
for (const m of ['@earendil-works', 'typebox']) symlinkSync(join(rel, m), join(tmp, 'node_modules', m))
const planMode = (await import(join(tmp, 'extensions', 'plan-mode', 'index.ts'))).default

test('execução do plano: a mensagem inicial e o contexto de cada turno exigem a tag literal [DONE:n]', async () => {
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
  const exec = sent.find((m) => m.customType === 'plan-mode-execute')
  assert.match(exec.content, /Start with: contar a\.txt\n.*literal tag \[DONE:n\]/i)
  const injected = JSON.stringify(await on.before_agent_start({}, ctx))
  assert.match(injected, /literal tag \[DONE:n\].*not prose or checkboxes/)
  // D5 (docs/sync-observabilidade.md): a regra também liga a caixa de `## Progresso` do registro à mesma resposta da tag.
  assert.match(exec.content, /tick box n under `## Progresso`/)
  assert.match(injected, /tick box n under `## Progresso`/)
  // D14 (docs/sync-observabilidade.md): a tag só conta na resposta final do turno (sem chamada de ferramenta).
  for (const t of [exec.content, injected]) assert.match(t, /final reply of the turn \(the message without a tool call\)/)
  assert.match(injected, /repeat the tag in the final reply/)
  const rule = /^When you finish step n.*$/m.exec(exec.content)![0]
  assert.ok(rule.split(/\s+/).length < 60, `DONE_RULE com ${rule.split(/\s+/).length} palavras`)
})

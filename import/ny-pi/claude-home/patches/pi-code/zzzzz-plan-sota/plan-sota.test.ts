// Testes do zzzzz-plan-sota.patch: node --experimental-strip-types --test ~/.pi/agent/claude-home/patches/pi-code/zzzzz-plan-sota/plan-sota.test.ts
import assert from 'node:assert/strict'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

const tmp = mkdtempSync(join(tmpdir(), 'plan-sota-test-'))
after(() => rmSync(tmp, { recursive: true }))
const plans = join(tmp, 'plans')
const outside = join(tmp, 'outside')
mkdirSync(plans)
mkdirSync(outside)
process.env.PI_PLANS_DIR = plans
// O Node não tira tipos de .ts dentro de node_modules: testa uma cópia do pacote, com o pi ao lado.
cpSync(`${homedir()}/.pi/agent/npm/node_modules/pi-code/extensions`, join(tmp, 'extensions'), { recursive: true })
const rel = `${homedir()}/.pi/agent/install/releases/${readFileSync(`${homedir()}/.pi/agent/install/current-version`, 'utf8').trim()}/node_modules`
mkdirSync(join(tmp, 'node_modules'))
for (const m of ['@earendil-works', 'typebox']) symlinkSync(join(rel, m), join(tmp, 'node_modules', m))
const planMode = (await import(join(tmp, 'extensions', 'plan-mode', 'index.ts'))).default
const utils: any = await import(join(tmp, 'extensions', 'plan-mode', 'utils.ts'))
const allowed = (tool: string, input: any = {}) => utils.isPlanModeToolAllowed(tool, input, plans)

function setup() {
  const on: Record<string, any> = {}
  const cmds: Record<string, any> = {}
  const tools: Record<string, any> = {}
  const sent: any[] = []
  let active = ['read', 'bash', 'edit', 'write', 'plan_mode_complete']
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
  const ctx: any = { hasUI: true, ui, isIdle: () => true, sessionManager: { getEntries: () => [], getBranch: () => [], getSessionId: () => 'abcdef12-3456' } }
  return { on, cmds, tools, sent, ctx }
}

test('AC1: ferramentas e MCP read-only passam', () => {
  for (const t of ['tool_search', 'web_fetch', 'mcp__keenable__search_web_pages', 'lsp_diagnostics', 'lsp_hover', 'lsp_definition', 'lsp_references', 'lsp_symbols', 'todo', 'read', 'question', 'plan_mode_complete']) assert.equal(allowed(t).ok, true, t)
  for (const s of ['keenable', 'perplexity', 'exa', 'brave_search', 'octen', 'parallel', 'youcom', 'context7', 'codegraph', 'paper_search', 'package_version_check', 'fetch', 'firecrawl', 'nimble']) assert.equal(allowed(`mcp__${s}__x`).ok, true, s)
})

test('AC2: MCP fora da lista é bloqueado', () => {
  for (const s of ['playwright', 'computer_use_linux', 'linear', 'desconhecido']) assert.equal(allowed(`mcp__${s}__x`).ok, false, s)
})

test('AC3: subagent só com agentes read-only', () => {
  const ro = ['Explore', 'code-mapper', 'Plan', 'perplexity-scout', 'web-scout', 'research-scout', 'scholar-scout', 'claim-verifier', 'code-reviewer', 'security-reviewer', 'test-reviewer', 'reliability-reviewer', 'contract-migration-reviewer', 'agent-systems-auditor']
  for (const a of ro) {
    assert.equal(allowed('subagent', { agent: a, task: 'x' }).ok, true, a)
    assert.equal(allowed('subagent', { tasks: [{ agent: a, task: 'x' }] }).ok, true, a)
    assert.equal(allowed('subagent', { chain: [{ agent: a, task: 'x' }] }).ok, true, a)
  }
  assert.equal(allowed('subagent', { agent: 'swarm-worker', task: 'x' }).ok, false)
  assert.equal(allowed('subagent', { tasks: [{ agent: 'swarm-worker', task: 'x' }] }).ok, false)
  assert.equal(allowed('subagent', { chain: [{ agent: 'Explore', task: 'x' }, { agent: 'swarm-worker', task: 'y' }] }).ok, false)
  assert.equal(allowed('subagent', { tasks: [{ agent: 'Explore', task: 'x' }, { agent: 'git-delivery', task: 'y' }] }).ok, false)
  assert.equal(allowed('subagent', { status: true }).ok, true)
  assert.equal(allowed('subagent', { cancel: 'bg_1' }).ok, true)
  assert.equal(allowed('subagent', { resume: 'bg_1', task: 'x' }).ok, false)
  // revisão: resume reabre qualquer run (até um writer); escopo de projeto deixa um agente local sombrear o nome
  assert.equal(allowed('subagent', { resume: 'bg_1', agent: 'Explore', task: 'x' }).ok, false)
  assert.equal(allowed('subagent', { agent: 'Explore', task: 'x', agentScope: 'project' }).ok, false)
  assert.equal(allowed('subagent', { agent: 'Explore', task: 'x', agentScope: 'both' }).ok, false)
  assert.equal(allowed('subagent', { agent: 'Explore', task: 'x', agentScope: 'user' }).ok, true)
})

test('AC3 pelo handler: subagent permitido roda com agentScope user', async () => {
  const { on, cmds, ctx } = setup()
  await cmds.plan.handler('', ctx)
  const input: any = { agent: 'Explore', task: 'x' }
  assert.equal(await on.tool_call({ toolName: 'subagent', input }, ctx), undefined)
  assert.equal(input.agentScope, 'user')
})

test('AC4: symlink pendurado no diretório de planos é recusado', () => {
  symlinkSync(join(outside, 'nao-existe.md'), join(plans, 'pendurado.md'))
  assert.equal(allowed('write', { path: join(plans, 'pendurado.md') }).ok, false)
})

test('AC4: write/edit só em .md dentro do diretório de planos', () => {
  writeFileSync(join(plans, 'ok.md'), '')
  symlinkSync(outside, join(plans, 'link'))
  writeFileSync(join(outside, 'x.md'), '')
  symlinkSync(join(outside, 'x.md'), join(plans, 'lnk.md'))
  for (const tool of ['write', 'edit']) {
    assert.equal(allowed(tool, { path: join(plans, 'ok.md') }).ok, true)
    assert.equal(allowed(tool, { path: join(plans, 'novo.md') }).ok, true)
    assert.equal(allowed(tool, { path: join(plans, '..', 'outside', 'x.md') }).ok, false)
    assert.equal(allowed(tool, { path: join(plans, 'sub', '..', '..', 'x.md') }).ok, false)
    assert.equal(allowed(tool, { path: join(plans, 'link', 'y.md') }).ok, false)
    assert.equal(allowed(tool, { path: join(plans, 'lnk.md') }).ok, false)
    assert.equal(allowed(tool, { path: join(plans, 'a.txt') }).ok, false)
    assert.equal(allowed(tool, { path: join(outside, 'z.md') }).ok, false)
    assert.equal(allowed(tool, { path: '/etc/x.md' }).ok, false)
    assert.equal(allowed(tool, {}).ok, false)
  }
})

test('AC4 pelo handler tool_call; AC5 contexto; AC6 execução', async () => {
  const { on, cmds, tools, sent, ctx } = setup()
  await cmds.plan.handler('', ctx)
  const date = new Date().toISOString().slice(0, 10)
  const file = join(plans, `${date}-abcdef12.md`)
  const blocked = await on.tool_call({ toolName: 'write', input: { path: '/tmp/fora.md', content: 'x' } }, ctx)
  assert.equal(blocked?.block, true)
  assert.equal(await on.tool_call({ toolName: 'write', input: { path: file, content: 'x' } }, ctx), undefined)
  assert.equal((await on.tool_call({ toolName: 'mcp__playwright__click', input: {} }, ctx))?.block, true)
  assert.equal(await on.tool_call({ toolName: 'tool_search', input: { query: 'x' } }, ctx), undefined)
  const text: string = (await on.before_agent_start({}, ctx)).message.content
  assert.match(text, /\[PLAN MODE ACTIVE\]/)
  assert.ok(text.includes('plan-workflow/SKILL.md'))
  assert.ok(text.includes(file))
  assert.ok(text.includes('Only tracked tasks are numbered'))
  assert.ok(text.length <= 1700, String(text.length))
  await tools.plan_mode_complete.execute('id', { plan: 'Tier: T0 (teste)\n1. contar a.txt\n2. contar b.txt' })
  await on.agent_end({ messages: [] }, ctx)
  const exec = sent.find((m) => m.customType === 'plan-mode-execute')
  assert.match(exec.content, /materialize the plan file/)
  assert.ok(exec.content.includes(file))
  assert.match(exec.content, /literal tag \[DONE:n\]/)
})

test('AC7: o modelo do plano gera exatamente 3 tarefas', () => {
  const tpl = `## Resumo
- Tier: T2
### Fase 1: Base
1. Criar tabela users
   - passo a
   - [ ] check
### Fase 2: API
2. Endpoint POST /users
3. Gate e revisão
## Checklist
- [ ] AC1 coberto
`
  assert.equal(utils.planToTodos(tpl).length, 3)
})

test('bash: fdfind e kb.py', () => {
  assert.equal(utils.isSafeCommand('fdfind foo'), true)
  assert.equal(utils.isSafeCommand('fdfind -x rm'), false)
  assert.equal(utils.isSafeCommand('fdfind --exec-batch rm'), false)
  assert.equal(utils.isSafeCommand('python3 ~/.pi/agent/claude-home/skills/obsidian-cli/scripts/kb.py search x'), true)
  assert.equal(utils.isSafeCommand('python3 ~/.pi/agent/claude-home/skills/obsidian-cli/scripts/kb.py capture x'), false)
  assert.equal(utils.isSafeCommand('python3 evil.py'), false)
})

const T2 = `## Resumo
- Tier: T2 (sinais: 3 módulos)
## Decisões e suposições
- A1 (~92%, base: convenção em src/x): usar SQLite
## Aceitação
- AC1: WHEN a task is posted THE SYSTEM SHALL persist it
- AC2: IF the disk is full THEN THE SYSTEM SHALL return 507
## Riscos e rollback
- Rollback: reverter o commit
### Fase 1: Base
1. Criar store SQLite
   - AC: AC1, AC2
   - check: \`python -m unittest\`
2. Gate e revisão
`
const lint = (p: string): string[] => utils.lintPlan(p)

test('lintPlan: planos válidos', () => {
  assert.deepEqual(lint('Tier: T0 (typo)\n1. corrigir typo'), [])
  assert.deepEqual(lint(T2), [])
})

test('lintPlan: R1 e R2', () => {
  assert.deepEqual(lint('1. tarefa um\n2. tarefa dois'), ['missing "Tier: Tn (signals)" line'])
  assert.deepEqual(lint('texto'), ['missing "Tier: Tn (signals)" line', 'no numbered tasks'])
})

test('lintPlan: R4 e R6 em T1 sem AC', () => {
  assert.deepEqual(lint('Tier: T1 (x)\n1. fazer algo'), ['no EARS acceptance criterion (AC1: WHEN … THE SYSTEM SHALL …)', 'no check command in any task'])
})

test('lintPlan: R5 AC não referenciado', () => {
  const p = 'Tier: T1 (x)\n- AC1: WHEN a THE SYSTEM SHALL b\n1. fazer algo\n   - check: x'
  assert.deepEqual(lint(p), ['AC1 is not covered by any task'])
  assert.deepEqual(lint(p + ' AC1'), [])
})

test('lintPlan: R3 confiança', () => {
  assert.deepEqual(lint('Tier: T0 (x)\n- A1: algo\n1. tarefa um'), ['assumption A1 has no confidence %'])
  assert.deepEqual(lint('Tier: T0 (x)\n- A1 (~92%, base x): algo\n1. tarefa um'), [])
})

test('lintPlan: R7 e R8', () => {
  assert.deepEqual(lint(T2.replace('## Riscos e rollback\n- Rollback: reverter o commit\n', '')), ['no risks/rollback section'])
  const t3 = T2.replace('Tier: T2', 'Tier: T3').replace('Rollback: reverter o commit', 'Risco: perda de dados').replace('## Riscos e rollback', '## Riscos')
  assert.deepEqual(lint(t3), ['T3 plan without rollback'])
})

test('lintPlan: EARS em português', () => {
  const p = 'Tier: T1 (x)\n- AC1: QUANDO a tarefa chega O SISTEMA DEVE gravar\n1. fazer algo AC1\n   - check: x'
  assert.deepEqual(lint(p), [])
})

test('lintPlan: linha de 200 000 caracteres é rápida', () => {
  const t = Date.now()
  lint(`Tier: T1 (x)\n- AC1: ${'WHEN '.repeat(40000)}\n1. ${'a '.repeat(100000)}`)
  lint(`- A1 ${'(~'.repeat(100000)}`)
  assert.ok(Date.now() - t < 500)
})

test('plan_mode_complete: rejeita duas vezes e aceita na terceira', async () => {
  const { tools, cmds, ctx } = setup()
  await cmds.plan.handler('', ctx)
  for (let i = 0; i < 2; i++) {
    const r = await tools.plan_mode_complete.execute('id', { plan: '1. tarefa um' })
    assert.match(r.content[0].text, /^Plan not accepted/)
    assert.equal(r.terminate, undefined)
  }
  const r = await tools.plan_mode_complete.execute('id', { plan: '1. tarefa um' })
  assert.equal(r.terminate, true)
  assert.match(r.content[0].text, /Unresolved lint: missing "Tier/)
})

test('plan_mode_complete: plano válido é aceito e salvo; contador zera', async () => {
  const { tools, cmds, ctx } = setup()
  await cmds.plan.handler('', ctx)
  const file = join(plans, `${new Date().toISOString().slice(0, 10)}-abcdef12.md`)
  const r = await tools.plan_mode_complete.execute('id', { plan: T2 })
  assert.equal(r.terminate, true)
  assert.equal(readFileSync(file, 'utf8'), T2)
  assert.ok(r.content[0].text.startsWith(`Plan submitted and saved to ${file}.`))
  assert.ok(!r.content[0].text.includes('Unresolved'))
  const r2 = await tools.plan_mode_complete.execute('id', { plan: '1. tarefa um' })
  assert.match(r2.content[0].text, /^Plan not accepted/)
})

test('contexto injetado: triagem T0', async () => {
  const { on, cmds, ctx } = setup()
  await cmds.plan.handler('', ctx)
  const text: string = (await on.before_agent_start({}, ctx)).message.content
  for (const s of ['Triage first', 'skip the skill', 'lints it and saves it', 'each AC cited by a task']) assert.ok(text.includes(s), s)
})

test('lintPlan: R9 título acima de 50 caracteres', () => {
  const ok = `Tier: T0 (x)\n1. ${'a'.repeat(50)}`
  assert.deepEqual(lint(ok), [])
  assert.deepEqual(lint(`Tier: T0 (x)\n1. curto\n7) ${'a'.repeat(51)}`), ['task 7 title is 51 characters (max 50, as shown): "A' + 'a'.repeat(50) + '"'])
})

test('lintPlan: R9 mede o título como o todo o mostra (sem crase nem negrito)', () => {
  // 54 caracteres crus, 50 exibidos
  assert.deepEqual(lint('Tier: T0 (x)\n1. Rename `lst` to `tasks` in store.py and test_app.py ok'), [])
  assert.equal(lint('Tier: T0 (x)\n1. Rename `lst` to `tasks` in store.py and test_app.py ok!').length, 1)
})

const BAD = 'Tier: T0 (x)\n1. tarefa um\n- A1: algo'
const planFileOf = () => join(plans, `${new Date().toISOString().slice(0, 10)}-abcdef12.md`)

test('rejeição salva o arquivo e a mensagem cita arquivo e @file', async () => {
  const { tools, cmds, ctx } = setup()
  await cmds.plan.handler('', ctx)
  const r = await tools.plan_mode_complete.execute('id', { plan: BAD })
  assert.equal(r.terminate, undefined)
  assert.equal(readFileSync(planFileOf(), 'utf8'), BAD)
  const t = r.content[0].text
  assert.ok(t.startsWith(`Plan not accepted. It was saved to ${planFileOf()}. Fix these there with the edit tool, then call plan_mode_complete with plan "@file" (do not resend the plan):\n- assumption A1 has no confidence %`), t)
})

test('@file após editar o arquivo aceita e gera os todos dele', async () => {
  const { tools, cmds, ctx } = setup()
  await cmds.plan.handler('', ctx)
  await tools.plan_mode_complete.execute('id', { plan: BAD })
  const good = 'Tier: T0 (x)\n1. tarefa do arquivo\n2. outra do arquivo'
  writeFileSync(planFileOf(), good)
  const r = await tools.plan_mode_complete.execute('id', { plan: ' @file ' })
  assert.equal(r.terminate, true)
  assert.equal(readFileSync(planFileOf(), 'utf8'), good)
  assert.match(r.content[0].text, /^Plan submitted and saved/)
})

test('@file sem arquivo não conta como rejeição', async () => {
  rmSync(planFileOf(), { force: true })
  const { tools, cmds, ctx } = setup()
  await cmds.plan.handler('', ctx)
  for (let i = 0; i < 3; i++) {
    const r = await tools.plan_mode_complete.execute('id', { plan: '@file' })
    assert.equal(r.content[0].text, 'No plan file to submit; pass the plan text.')
    assert.equal(r.terminate, undefined)
  }
  // contador intacto: duas rejeições ainda antes de aceitar
  for (let i = 0; i < 2; i++) assert.match((await tools.plan_mode_complete.execute('id', { plan: '1. x tarefa' })).content[0].text, /^Plan not accepted/)
  assert.equal((await tools.plan_mode_complete.execute('id', { plan: '1. x tarefa' })).terminate, true)
})

test('lintPlan: R5 aceita intervalo AC1–AC3 como cobertura', () => {
  const plan = ['Tier: T1 (teste)', '- AC1: WHEN a THE SYSTEM SHALL b', '- AC2: WHEN c THE SYSTEM SHALL d', '- AC3: IF e THEN THE SYSTEM SHALL f', '1. Implementar a regra nova', '   - AC: AC1–AC3', '   - check: `python -m unittest`'].join('\n')
  assert.deepEqual(utils.lintPlan(plan), [])
  assert.deepEqual(utils.lintPlan(plan.replace('AC1–AC3', 'AC1-AC2')), ['AC3 is not covered by any task'])
})

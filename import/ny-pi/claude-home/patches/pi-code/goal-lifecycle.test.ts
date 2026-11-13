// Ciclo de vida do /goal com um pi falso: retries do avaliador, retry/pausa de turno falho.
// node --experimental-strip-types --test ~/.pi/agent/claude-home/patches/pi-code/goal-lifecycle.test.ts
import assert from 'node:assert/strict'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

const tmp = mkdtempSync(join(tmpdir(), 'goal-life-'))
cpSync(`${homedir()}/.pi/agent/npm/node_modules/pi-code/extensions`, join(tmp, 'extensions'), { recursive: true })
mkdirSync(join(tmp, 'node_modules'))
const version = readFileSync(`${homedir()}/.pi/agent/install/current-version`, 'utf8').trim()
symlinkSync(`${homedir()}/.pi/agent/install/releases/${version}/node_modules/@earendil-works`, join(tmp, 'node_modules', '@earendil-works'))
for (const dep of ['typebox']) {
  try {
    symlinkSync(`${homedir()}/.pi/agent/install/releases/${version}/node_modules/${dep}`, join(tmp, 'node_modules', dep))
  } catch {}
}
const goalExtension = (await import(join(tmp, 'extensions/goal.ts'))).default
const mc = await import(join(tmp, 'extensions/internal/model-complete.ts'))

const session = { provider: 'anthropic', api: 'anthropic-messages', id: 'claude-opus-5-5', reasoning: true, thinkingLevelMap: { off: null, minimal: null, low: 'low' }, contextWindow: 1_000_000 }
const haiku = { provider: 'anthropic', api: 'anthropic-messages', id: 'claude-haiku-5-5', reasoning: true, thinkingLevelMap: { minimal: null }, contextWindow: 1_000_000 }
const oldHaiku = { provider: 'anthropic', id: 'claude-haiku-4-5-20251001', reasoning: true, contextWindow: 200_000 }

function harness(hasUI = true) {
  const handlers: Record<string, Function[]> = {}
  const sent: { content: string; options: any }[] = []
  const notes: { text: string; level: string }[] = []
  const branch: any[] = []
  let command: any
  const pi: any = {
    registerCommand: (_name: string, def: any) => (command = def),
    registerMessageRenderer: () => {},
    on: (event: string, fn: Function) => (handlers[event] ??= []).push(fn),
    events: { on: () => {} },
    sendMessage: (msg: any, options: any) => {
      sent.push({ content: msg.content, options })
      branch.push({ type: 'custom_message', customType: msg.customType, content: msg.content })
    },
    appendEntry: (customType: string, data: any) => branch.push({ type: 'custom', customType, data }),
  }
  goalExtension(pi)
  const ctx: any = {
    cwd: tmp,
    hasUI,
    model: session,
    modelRegistry: { getAvailable: () => [session, oldHaiku, haiku] },
    sessionManager: { getBranch: () => branch },
    ui: { notify: (text: string, level: string) => notes.push({ text, level }), setStatus: () => {}, theme: { fg: (_c: string, t: string) => t } },
    isIdle: () => true,
    isProjectTrusted: () => true,
    waitForIdle: async () => {},
  }
  const fire = async (event: string, payload: any = {}) => {
    for (const fn of handlers[event] ?? []) await fn(payload, ctx)
  }
  return { ctx, sent, notes, branch, fire, command: () => command }
}

const assistant = (stopReason = 'stop', errorMessage?: string) => ({ role: 'assistant', stopReason, errorMessage, content: [{ type: 'text', text: 'feito' }] })
const reply = (text: string, stopReason = 'stop') => ({ role: 'assistant', content: text ? [{ type: 'text', text }] : [], stopReason, usage: { totalTokens: 10 } })

test('avaliador: Haiku mais novo por padrão, retry com orçamento maior após corte, veredito final', async () => {
  const calls: any[] = []
  const replies = [reply('', 'length'), reply('{"ok": true, "reason": "ok"}')]
  mc.setCompleteBackend(async (model: any, _c: any, options: any) => {
    calls.push({ id: model.id, ...options })
    return replies.shift()
  })
  const h = harness()
  await h.fire('session_start')
  await h.command().handler('X pronto', h.ctx)
  await h.fire('agent_end', { messages: [assistant()] })
  assert.deepEqual(calls.map((c) => [c.id, c.maxTokens]), [['claude-haiku-5-5', 1024], ['claude-haiku-5-5', 4096]])
  assert.equal(calls[0].reasoning, undefined, 'Haiku 5.5 aceita thinking off')
  assert.match(h.sent.at(-1)!.content, /Goal achieved .*\nEvaluator \(anthropic\/claude-haiku-5-5\): ok/)
  mc.setCompleteBackend(null)
})

test('avaliador: falha irrecuperável no Haiku cai para o modelo da sessão (com reasoning mínimo)', async () => {
  const calls: any[] = []
  mc.setCompleteBackend(async (model: any, _c: any, options: any) => {
    calls.push({ id: model.id, reasoning: options.reasoning })
    if (model.id === 'claude-haiku-5-5') return { ...reply(''), stopReason: 'error', errorMessage: '404 not_found_error model' }
    return reply('{"ok": false, "reason": "falta Y"}')
  })
  const h = harness()
  await h.fire('session_start')
  await h.command().handler('X pronto', h.ctx)
  await h.fire('agent_start')
  await h.fire('tool_execution_start')
  await h.fire('agent_end', { messages: [assistant()] })
  assert.deepEqual(calls, [{ id: 'claude-haiku-5-5', reasoning: undefined }, { id: 'claude-opus-5-5', reasoning: 'low' }])
  assert.match(h.sent.at(-1)!.content, /Goal not yet met \(turn 1/)
  assert.equal(h.sent.at(-1)!.options.triggerTurn, true)
  mc.setCompleteBackend(null)
})

test('avaliador: 3 respostas ilegíveis pausam com aviso, goal continua ativo', async () => {
  let n = 0
  mc.setCompleteBackend(async () => {
    n += 1
    return reply('não sei')
  })
  const h = harness()
  await h.fire('session_start')
  await h.command().handler('X pronto', h.ctx)
  const before = h.sent.length
  await h.fire('agent_end', { messages: [assistant()] })
  assert.equal(n, 3)
  assert.equal(h.sent.length, before, 'nenhum turno novo')
  assert.match(h.notes.at(-1)!.text, /^Goal paused: the evaluator failed 3 times \(unreadable verdict: não sei\)/)
  await h.command().handler('', h.ctx)
  assert.match(h.notes.at(-1)!.text, /^Goal active: X pronto/)
  mc.setCompleteBackend(null)
})

test('turno falho transitório: 3 retries agendados e depois pausa; rate limit pausa direto', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const h = harness()
  await h.fire('session_start')
  await h.command().handler('X pronto', h.ctx)
  for (let attempt = 1; attempt <= 3; attempt++) {
    await h.fire('agent_end', { messages: [assistant('error', '529 overloaded_error')] })
    await h.fire('agent_settled')
    assert.match(h.notes.at(-1)!.text, new RegExp(`retrying in ${15 * 2 ** (attempt - 1)}s \\(${attempt}/3\\)`))
    const before = h.sent.length
    t.mock.timers.tick(15_000 * 2 ** (attempt - 1))
    assert.equal(h.sent.length, before + 1)
    assert.match(h.sent.at(-1)!.content, new RegExp(`^Goal retry ${attempt}/3 after a failed turn \\(overloaded`))
  }
  await h.fire('agent_end', { messages: [assistant('error', '529 overloaded_error')] })
  await h.fire('agent_settled')
  assert.match(h.notes.at(-1)!.text, /^Goal paused \(overloaded, after 3 automatic retries\)/)

  await h.fire('input', { source: 'interactive' })
  await h.fire('agent_end', { messages: [assistant('error', '429 rate_limit_error')] })
  await h.fire('agent_settled')
  assert.match(h.notes.at(-1)!.text, /^Goal paused \(rate limit\)/)
})

test('turno falho: prompt do usuário cancela o retry pendente; headless só pausa; erro irrecuperável limpa', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const h = harness()
  await h.fire('session_start')
  await h.command().handler('X pronto', h.ctx)
  await h.fire('agent_end', { messages: [assistant('error', 'fetch failed')] })
  await h.fire('agent_settled')
  const before = h.sent.length
  await h.fire('input', { source: 'interactive' })
  t.mock.timers.tick(60_000)
  assert.equal(h.sent.length, before)

  const headless = harness(false)
  await headless.fire('session_start')
  await headless.command().handler('X pronto', headless.ctx)
  await headless.fire('agent_end', { messages: [assistant('error', 'fetch failed')] })
  await headless.fire('agent_settled')
  assert.match(headless.notes.at(-1)!.text, /^Goal paused \(connection\)/)

  await h.fire('agent_end', { messages: [assistant('error', '401 authentication_error')] })
  await h.fire('agent_settled')
  assert.match(h.notes.at(-1)!.text, /^Goal cleared after an unrecoverable error \(authentication\)/)
})

test('PI_GOAL_MODEL escolhe o avaliador', async () => {
  const ids: string[] = []
  mc.setCompleteBackend(async (model: any) => {
    ids.push(model.id)
    return reply('{"ok": true, "reason": "r"}')
  })
  process.env.PI_GOAL_MODEL = 'claude-opus-5-5'
  try {
    const h = harness()
    await h.fire('session_start')
    await h.command().handler('X pronto', h.ctx)
    await h.fire('agent_end', { messages: [assistant()] })
    assert.deepEqual(ids, ['claude-opus-5-5'])
  } finally {
    delete process.env.PI_GOAL_MODEL
    mc.setCompleteBackend(null)
  }
})

test('veredito forçado por ferramenta no Haiku (schema), texto no Opus; ferramenta rejeitada cai para texto', async () => {
  const calls: any[] = []
  let rejectTool = false
  mc.setCompleteBackend(async (model: any, context: any, options: any) => {
    calls.push({ id: model.id, toolChoice: options.toolChoice, tools: context.tools?.map((x: any) => x.name), system: context.systemPrompt })
    if (options.toolChoice && rejectTool) return { ...reply(''), stopReason: 'error', errorMessage: '400 invalid_request_error: tool_choice' }
    if (options.toolChoice) return { role: 'assistant', content: [{ type: 'toolCall', id: 't1', name: 'goal_verdict', arguments: { ok: false, reason: 'falta Z' } }], stopReason: 'toolUse', usage: {} }
    return reply('{"ok": true, "reason": "texto"}')
  })
  const h = harness()
  await h.fire('session_start')
  await h.command().handler('X pronto', h.ctx)
  await h.fire('agent_start')
  await h.fire('tool_execution_start')
  await h.fire('agent_end', { messages: [assistant()] })
  assert.deepEqual(calls[0].toolChoice, { type: 'tool', name: 'goal_verdict' })
  assert.deepEqual(calls[0].tools, ['goal_verdict'])
  assert.match(calls[0].system, /calling the goal_verdict tool/)
  assert.match(h.sent.at(-1)!.content, /Goal not yet met \(turn 1.*: falta Z/)

  calls.length = 0
  rejectTool = true
  await h.fire('agent_end', { messages: [assistant()] })
  assert.deepEqual(calls.map((c) => [c.id, !!c.toolChoice]), [['claude-haiku-5-5', true], ['claude-haiku-5-5', false]])
  assert.match(h.sent.at(-1)!.content, /Goal achieved/)

  calls.length = 0
  process.env.PI_GOAL_MODEL = 'claude-opus-5-5'
  try {
    const o = harness()
    await o.fire('session_start')
    await o.command().handler('X pronto', o.ctx)
    await o.fire('agent_end', { messages: [assistant()] })
    assert.equal(calls[0].toolChoice, undefined, 'Opus 5.5 não desliga thinking: sem tool_choice forçado')
  } finally {
    delete process.env.PI_GOAL_MODEL
    mc.setCompleteBackend(null)
  }
})

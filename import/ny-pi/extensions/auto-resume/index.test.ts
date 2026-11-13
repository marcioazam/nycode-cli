// Testes de ~/.pi/agent/extensions/auto-resume/index.ts.
// Rodar: node --experimental-strip-types --test ~/.pi/agent/extensions/auto-resume/index.test.ts
import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import register, { decideResume, limitReset, markLimit, sleep } from './index.ts'

const err = (errorMessage: string) => ({ type: 'message', message: { role: 'assistant', stopReason: 'error', errorMessage } })
const ok = { type: 'message', message: { role: 'assistant', stopReason: 'stop' } }
const resumed = { type: 'custom_message', customType: 'auto-resume', content: 'x' }

test('sem erro: nada', () => {
  assert.equal(decideResume([ok]).action, 'none')
  assert.equal(decideResume([]).action, 'none')
})

test('503 retryável: tentativa 1 com 30s', () => {
  for (const m of ['503 credential validation failed', '503 status code (no body)']) {
    const d: any = decideResume([err(m)])
    assert.equal(d.action, 'resume')
    assert.equal(d.attempt, 1)
    assert.equal(d.delayMs, 30_000)
    assert.match(d.message, /^Auto-resume 1\/5: .*"503/)
  }
})

test('não retryável e overflow: nada', () => {
  assert.equal(decideResume([err('401 authentication_error: invalid x-api-key')]).action, 'none')
  assert.equal(decideResume([err('400 invalid_request_error: messages.0 bad')]).action, 'none')
  assert.equal(decideResume([err('prompt is too long: 250000 tokens > 200000 maximum')]).action, 'none')
  assert.equal(decideResume([err('insufficient_quota 429')]).action, 'none')
})

test('contagem consecutiva, reset após resposta ok, give_up em 5', () => {
  const e = err('503 status code (no body)')
  const after = (n: number) => [...Array.from({ length: n }, () => [e, resumed]).flat(), e]
  assert.equal((decideResume(after(1)) as any).delayMs, 90_000)
  assert.equal((decideResume(after(2)) as any).delayMs, 180_000)
  assert.equal((decideResume(after(4)) as any).delayMs, 600_000)
  assert.equal(decideResume(after(5)).action, 'give_up')
  assert.equal((decideResume([...after(4).slice(0, -1), ok, e]) as any).attempt, 1)
})

test('kill switch', () => {
  assert.equal(decideResume([err('503')], { PI_AUTO_RESUME: '0' }).action, 'none')
})

test('sleep abortável', async () => {
  const c = new AbortController()
  const p = sleep(60_000, c.signal)
  c.abort()
  assert.equal(await p, false)
  assert.equal(await sleep(1), true)
})

test('handler: continua com a mensagem; aborto e exceção liberam', async () => {
  let handler: any
  register({ on: (e: string, h: any) => e === 'agent_before_settle' && (handler = h) } as any, async () => true)
  const status: any[] = []
  const ctx = (branch: any[], wait = true) => ({ sessionManager: { getBranch: () => branch }, ui: { setStatus: (...a: any[]) => status.push(a) } })
  const r = await handler({ entries: [1] }, ctx([err('503')]))
  assert.equal(r.continue, true)
  assert.equal(r.entries.at(-1).customType, 'auto-resume')
  assert.equal(status.length, 2)
  assert.equal(status[1][1], undefined)
  register({ on: (e: string, h: any) => e === 'agent_before_settle' && (handler = h) } as any, async () => false)
  assert.equal(await handler({ entries: [] }, ctx([err('503')])), undefined)
  assert.equal(await handler({ entries: [] }, {}), undefined)
})

// ---- limite da conta (pedido 2026-11-13): sem retry, espera o reset e retoma ----
const LIMIT = '429 {"type":"error","error":{"type":"rate_limit_error","message":"This request would exceed your account\'s rate limit. Please try again later."}}'
const NOW = Date.UTC(2026, 10, 13, 15, 0, 0)

test('markLimit: só o limite da conta vira não-retryável para o pi (quota exceeded), o resto fica igual', () => {
  const m = markLimit(LIMIT)!
  assert.match(m, /quota exceeded/)
  assert.ok(m.endsWith(LIMIT))
  assert.equal(markLimit(m), undefined, 'idempotente')
  assert.equal(markLimit('429 Too Many Requests'), undefined, 'throttle curto continua com o retry do pi')
  assert.equal(markLimit('503 overloaded'), undefined)
})

test('limitReset: headers do 429, depois retry-after, depois o cache do HUD; só horários futuros', () => {
  const s = (ms: number) => String(Math.floor(ms / 1000))
  assert.equal(limitReset({ 'anthropic-ratelimit-unified-reset': s(NOW + 3_600_000) }, undefined, NOW), NOW + 3_600_000)
  assert.equal(limitReset({ 'anthropic-ratelimit-unified-reset': new Date(NOW + 60_000).toISOString() }, undefined, NOW), NOW + 60_000)
  const win = { 'anthropic-ratelimit-unified-5h-status': 'rejected', 'anthropic-ratelimit-unified-5h-reset': s(NOW + 2_460_000), 'anthropic-ratelimit-unified-7d-status': 'allowed', 'anthropic-ratelimit-unified-7d-reset': s(NOW + 9e8) }
  assert.equal(limitReset(win, undefined, NOW), NOW + 2_460_000, 'a janela rejeitada manda')
  assert.equal(limitReset({ 'retry-after': '120' }, undefined, NOW), NOW + 120_000)
  const cache = { rate_limits: { five_hour: { used_percentage: 99, resets_at: (NOW + 2_460_000) / 1000 }, seven_day: { used_percentage: 40, resets_at: (NOW + 9e8) / 1000 } } }
  assert.equal(limitReset({}, cache, NOW), NOW + 2_460_000, 'cache: a janela cheia')
  assert.equal(limitReset({}, { rate_limits: { seven_day: { used_percentage: 10, resets_at: (NOW + 5e6) / 1000 } } }, NOW), NOW + 5e6, 'nenhuma cheia: o reset mais próximo')
  assert.equal(limitReset({ 'anthropic-ratelimit-unified-reset': s(NOW - 1000) }, { rate_limits: { five_hour: { used_percentage: 100, resets_at: (NOW - 5) / 1000 } } }, NOW), undefined, 'passado não vale')
  assert.equal(limitReset({ 'retry-after': 'x' }, { junk: 1 }, NOW), undefined)
  assert.equal(limitReset({ 'retry-after': new Date(NOW + 300_000).toUTCString() }, undefined, NOW), NOW + 300_000, 'retry-after em HTTP-date')
  const nearest = { 'anthropic-ratelimit-unified-7d-reset': s(NOW + 9e7), 'retry-after': '600' }
  assert.equal(limitReset(nearest, undefined, NOW), NOW + 600_000, 'retry-after explícito vence a janela mais próxima não rejeitada')
  assert.equal(limitReset({ 'anthropic-ratelimit-unified-reset': s(NOW + 30 * 86_400_000) }, undefined, NOW), undefined, 'reset além de 8 dias é inválido (estouraria o setTimeout)')
})

test('decideResume: limite da conta espera até o reset + 1 min; desconhecido 15 min; 3 esperas e desiste; filhos não esperam', () => {
  const e = err(markLimit(LIMIT)!)
  const d: any = decideResume([e], {}, { now: NOW, resetAt: NOW + 2_460_000 })
  assert.equal(d.action, 'resume')
  assert.equal(d.delayMs, 2_460_000 + 60_000)
  assert.equal(d.kind, 'limit')
  assert.match(d.message, /usage limit/)
  assert.equal((decideResume([e], {}, { now: NOW }) as any).delayMs, 15 * 60_000)
  const lim = { type: 'custom_message', customType: 'auto-resume-limit', content: 'x' }
  assert.equal((decideResume([e, lim, e, lim, e], {}, { now: NOW }) as any).attempt, 3)
  assert.equal(decideResume([e, lim, e, lim, e, lim, e], {}, { now: NOW }).action, 'give_up')
  assert.equal(decideResume([e], { PI_CODE_SUBAGENT: '1' }, { now: NOW }).action, 'none', 'filho falha rápido; o principal espera')
  assert.equal(decideResume([e], { PI_AUTO_RESUME: '0' }, { now: NOW }).action, 'none')
  assert.equal((decideResume([err('503'), resumed, e], {}, { now: NOW }) as any).kind, 'limit')
})

test('handler: message_end marca o erro, after_provider_response guarda os headers do 429, settle espera e retoma', async (t) => {
  const h: Record<string, any> = {}
  for (const k of ['PI_CODE_SUBAGENT', 'PI_AUTO_RESUME']) {
    const v = process.env[k]
    delete process.env[k]
    t.after(() => { if (v !== undefined) process.env[k] = v })
  }
  const waits: number[] = []
  register({ on: (e: string, f: any) => (h[e] = f) } as any, async (ms: number) => (waits.push(ms), true), () => NOW)
  const msg = { role: 'assistant', stopReason: 'error', errorMessage: LIMIT }
  const r = await h.message_end({ message: msg })
  assert.match(r.message.errorMessage, /quota exceeded/)
  assert.equal(await h.message_end({ message: { role: 'assistant', stopReason: 'stop' } }), undefined)
  await h.after_provider_response({ status: 429, headers: { 'Anthropic-Ratelimit-Unified-Reset': String((NOW + 600_000) / 1000) } })
  await h.after_provider_response({ status: 200, headers: {} })
  const status: any[] = []
  const notes: any[] = []
  const ctx = { sessionManager: { getBranch: () => [{ type: 'message', message: r.message }] }, ui: { setStatus: (...a: any[]) => status.push(a), notify: (...a: any[]) => notes.push(a) } }
  const out = await h.agent_before_settle({ entries: [] }, ctx)
  assert.deepEqual(waits, [660_000], 'header do 429 sobrevive a um 200 sem headers de limite')
  assert.equal(out.continue, true)
  assert.equal(out.entries.at(-1).customType, 'auto-resume-limit')
  assert.match(status[0][1], /limit/)
  assert.equal(status.at(-1)[1], undefined)
  assert.equal(notes.length, 1)
})

test('handler: resposta bem-sucedida descarta headers de um 429 antigo', async () => {
  const h: Record<string, any> = {}
  const waits: number[] = []
  register({ on: (e: string, f: any) => (h[e] = f) } as any, async (ms: number) => (waits.push(ms), true), () => NOW)
  await h.after_provider_response({ status: 429, headers: { 'anthropic-ratelimit-unified-reset': String((NOW + 3 * 3_600_000) / 1000) } })
  await h.message_end({ message: { role: 'assistant', stopReason: 'stop' } })
  assert.equal(await h.message_end({ message: { role: 'user' } }), undefined)
  const r = await h.message_end({ message: { role: 'assistant', stopReason: 'error', errorMessage: LIMIT } })
  const ctx = { sessionManager: { getBranch: () => [{ type: 'message', message: r.message }] }, ui: { setStatus() {}, notify() {} } }
  const saved = process.env.PI_CODE_SUBAGENT
  delete process.env.PI_CODE_SUBAGENT
  const cfg = process.env.CLAUDE_CONFIG_DIR
  process.env.CLAUDE_CONFIG_DIR = '/nonexistent-auto-resume-test'
  try { await h.agent_before_settle({ entries: [] }, ctx) } finally {
    if (saved !== undefined) process.env.PI_CODE_SUBAGENT = saved
    if (cfg === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = cfg
  }
  assert.deepEqual(waits, [15 * 60_000], 'sem header nem cache: padrão de 15 min, não o reset de 3 h do 429 antigo')
})

test('handler: depois de 3 esperas desiste e avisa (ui ou stderr)', async () => {
  const h: Record<string, any> = {}
  register({ on: (e: string, f: any) => (h[e] = f) } as any, async () => true, () => NOW)
  const r = await h.message_end({ message: { role: 'assistant', stopReason: 'error', errorMessage: LIMIT } })
  const e = { type: 'message', message: r.message }
  const lim = { type: 'custom_message', customType: 'auto-resume-limit', content: 'x' }
  const branch = [e, lim, e, lim, e, lim, e]
  const saved = process.env.PI_CODE_SUBAGENT
  delete process.env.PI_CODE_SUBAGENT
  const notes: any[] = []
  const errs: string[] = []
  const write = process.stderr.write
  try {
    assert.equal(await h.agent_before_settle({ entries: [] }, { sessionManager: { getBranch: () => branch }, ui: { notify: (...a: any[]) => notes.push(a) } }), undefined)
    process.stderr.write = ((s: string) => (errs.push(s), true)) as any
    await h.agent_before_settle({ entries: [] }, { sessionManager: { getBranch: () => branch } })
  } finally {
    process.stderr.write = write
    if (saved !== undefined) process.env.PI_CODE_SUBAGENT = saved
  }
  assert.equal(notes[0][1], 'warning')
  assert.match(notes[0][0], /gave up after 3 waits/)
  assert.match(errs.join(''), /gave up after 3 waits/)
})

test('handler: Esc durante a espera descarta os headers usados (a próxima espera não herda o reset antigo)', async () => {
  const h: Record<string, any> = {}
  const waits: number[] = []
  register({ on: (e: string, f: any) => (h[e] = f) } as any, async (ms: number) => (waits.push(ms), false), () => NOW)
  await h.after_provider_response({ status: 429, headers: { 'anthropic-ratelimit-unified-reset': String((NOW + 3 * 3_600_000) / 1000) } })
  const r = await h.message_end({ message: { role: 'assistant', stopReason: 'error', errorMessage: LIMIT } })
  const ctx = { sessionManager: { getBranch: () => [{ type: 'message', message: r.message }] }, ui: { setStatus() {}, notify() {} } }
  const saved = process.env.PI_CODE_SUBAGENT
  const cfg = process.env.CLAUDE_CONFIG_DIR
  delete process.env.PI_CODE_SUBAGENT
  process.env.CLAUDE_CONFIG_DIR = '/nonexistent-auto-resume-test'
  try {
    assert.equal(await h.agent_before_settle({ entries: [] }, ctx), undefined, 'cancelado: não retoma')
    await h.agent_before_settle({ entries: [] }, ctx)
  } finally {
    if (saved !== undefined) process.env.PI_CODE_SUBAGENT = saved
    if (cfg === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = cfg
  }
  assert.deepEqual(waits, [3 * 3_600_000 + 60_000, 15 * 60_000])
})

test('handler: erro que não é de limite descarta headers de um 429 anterior', async () => {
  const h: Record<string, any> = {}
  const waits: number[] = []
  register({ on: (e: string, f: any) => (h[e] = f) } as any, async (ms: number) => (waits.push(ms), true), () => NOW)
  await h.after_provider_response({ status: 429, headers: { 'anthropic-ratelimit-unified-reset': String((NOW + 3 * 3_600_000) / 1000) } })
  assert.equal(await h.message_end({ message: { role: 'assistant', stopReason: 'error', errorMessage: '429 too many requests' } }), undefined)
  const r = await h.message_end({ message: { role: 'assistant', stopReason: 'error', errorMessage: LIMIT } })
  const ctx = { sessionManager: { getBranch: () => [{ type: 'message', message: r.message }] }, ui: { setStatus() {}, notify() {} } }
  const saved = process.env.PI_CODE_SUBAGENT
  const cfg = process.env.CLAUDE_CONFIG_DIR
  delete process.env.PI_CODE_SUBAGENT
  process.env.CLAUDE_CONFIG_DIR = '/nonexistent-auto-resume-test'
  try { await h.agent_before_settle({ entries: [] }, ctx) } finally {
    if (saved !== undefined) process.env.PI_CODE_SUBAGENT = saved
    if (cfg === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = cfg
  }
  assert.deepEqual(waits, [15 * 60_000], 'o 429 comum já foi tratado; seus headers não definem a espera do limite seguinte')
})

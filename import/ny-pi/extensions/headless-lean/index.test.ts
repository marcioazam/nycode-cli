// node --experimental-strip-types --test ~/.pi/agent/extensions/headless-lean/index.test.ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import ext, { headlessTools, NO_PLAN_MODE, NO_UI_QUESTION, rewriteResult, splitCwd } from './index.ts'

const CC = { type: 'ephemeral' }
const IDENTITY = "You are Claude Code, Anthropic's official CLI for Claude."
const prompt = (cwd: string) => `rules\n</skills>\n\n<cwd>\n${cwd}\n</cwd>\n\n<mcp_servers>\n- a\n</mcp_servers>`
const oauth = (cwd: string) => ({
  model: 'm',
  system: [
    { type: 'text', text: IDENTITY, cache_control: { ...CC } },
    { type: 'text', text: prompt(cwd), cache_control: { ...CC } },
  ],
  tools: [{ name: 'read', cache_control: { ...CC } }],
  messages: [{ role: 'user', content: [{ type: 'text', text: 'oi', cache_control: { ...CC } }] }],
})
const single = (cwd: string) => ({
  system: [{ type: 'text', text: prompt(cwd), cache_control: { ...CC } }],
  messages: [],
})
const marks = (v: unknown) => JSON.stringify(v).split('"cache_control"').length - 1
type Sys = { system: Array<{ type: string; text: string; cache_control?: unknown }> }

for (const [name, make, nStatic] of [
  ['OAuth (2 blocos)', oauth, 2],
  ['um bloco', single, 1],
] as const) {
  test(`splitCwd ${name}: prefixo em cache idêntico entre dois cwd, <cwd> num bloco final sem marcador`, () => {
    const before = marks(make('/a/one'))
    const [a, b] = ['/a/one', '/b/two/three'].map((cwd) => splitCwd(make(cwd)) as Sys)
    assert.equal(a.system.length, nStatic + 1)
    assert.deepEqual(a.system.slice(0, nStatic), b.system.slice(0, nStatic))
    assert.equal(JSON.stringify(a.system.slice(0, nStatic)), JSON.stringify(b.system.slice(0, nStatic)))
    for (const blk of a.system.slice(0, nStatic)) assert.deepEqual(blk.cache_control, CC)
    assert.equal(a.system[nStatic - 1].text, 'rules\n</skills>\n\n<mcp_servers>\n- a\n</mcp_servers>')
    assert.deepEqual(a.system[nStatic], { type: 'text', text: '<cwd>\n/a/one\n</cwd>' })
    assert.deepEqual(b.system[nStatic], { type: 'text', text: '<cwd>\n/b/two/three\n</cwd>' })
    assert.equal(marks(a), before)
    assert.ok(marks(a) <= 4)
  })
}

test('splitCwd não toca tools, messages nem a ordem dos blocos, e é idempotente', () => {
  const p = oauth('/x')
  const out = splitCwd(p) as ReturnType<typeof oauth>
  assert.deepEqual(out.tools, oauth('/x').tools)
  assert.deepEqual(out.messages, oauth('/x').messages)
  assert.equal(out.system[0].text, IDENTITY)
  assert.equal(splitCwd(out), undefined)
})

test('splitCwd com formato inesperado não faz nada e não lança', () => {
  const log: string[] = []
  const dbg = (m: string) => log.push(m)
  const noCache = { system: [{ type: 'text', text: prompt('/x') }] }
  const cases: unknown[] = [
    null,
    'x',
    7,
    {},
    { system: prompt('/x') },
    { system: [null, 3, { type: 'image' }] },
    { system: [{ type: 'text', text: 'sem cwd', cache_control: CC }] },
    noCache,
  ]
  for (const c of cases) {
    const snap = JSON.stringify(c)
    assert.equal(splitCwd(c, dbg), undefined)
    assert.equal(JSON.stringify(c), snap)
  }
  // sem system (continuação de thread) é normal e fica calado; system fora do formato é registrado
  assert.equal(log.length, 4)
  assert.equal(splitCwd({ system: 'x' }), undefined)
})

test('headlessTools tira question sempre e plan_mode_complete fora do modo plano', () => {
  const active = ['read', 'question', 'plan_mode_complete', 'bash', 'lsp_hover', 'AskAntigravity']
  assert.deepEqual(headlessTools(active, ['node', 'pi', '-p', 'Planeje antes de implementar.']), [
    'read',
    'bash',
    'lsp_hover',
    'AskAntigravity',
  ])
  for (const argv of [
    ['-p', '--plan', 'x'],
    ['-p', '/plan fazer x'],
    ['-p', '/plan'],
  ]) {
    assert.deepEqual(headlessTools(active, argv), ['read', 'plan_mode_complete', 'bash', 'lsp_hover', 'AskAntigravity'])
  }
  assert.deepEqual(headlessTools(active, ['-p', '/planeta', '--planner']), [
    'read',
    'bash',
    'lsp_hover',
    'AskAntigravity',
  ])
})

test('rewriteResult troca só os dois becos sem saída', () => {
  const t = (text: string) => [{ type: 'text', text }]
  assert.equal(rewriteResult('plan_mode_complete', t('Not in plan mode; tool ignored.')), NO_PLAN_MODE)
  assert.equal(
    rewriteResult('question', t('Error: UI not available (running in non-interactive mode)')),
    NO_UI_QUESTION,
  )
  assert.equal(
    rewriteResult('question', t('Qual?\nError: UI not available (running in non-interactive mode)')),
    NO_UI_QUESTION,
  )
  assert.equal(rewriteResult('plan_mode_complete', t('Plan approved.')), undefined)
  assert.equal(rewriteResult('question', t('User selected: a')), undefined)
  assert.equal(rewriteResult('bash', t('Not in plan mode; tool ignored.')), undefined)
  assert.equal(rewriteResult('question', undefined), undefined)
  assert.equal(rewriteResult('question', [null, { type: 'image' }]), undefined)
  assert.match(NO_PLAN_MODE, /no approval to wait for/)
  assert.match(NO_PLAN_MODE, /now, in this same turn/)
  assert.match(NO_UI_QUESTION, /ending in "\?"/)
  assert.match(NO_UI_QUESTION, /final reply/)
  assert.match(NO_UI_QUESTION, /without changing any file/)
})

type Handler = (event: unknown, ctx: unknown) => unknown
function load(active: string[], env: Record<string, string | undefined> = {}) {
  const saved = { ...process.env }
  for (const k of ['PI_HEADLESS_LEAN', 'CLAUDE_CODE_DISABLE_TERMINAL_TITLE']) delete process.env[k]
  Object.assign(process.env, env)
  const handlers: Record<string, Handler> = {}
  const sets: string[][] = []
  const pi = {
    on: (name: string, h: Handler) => {
      handlers[name] = h
    },
    getActiveTools: () => active,
    setActiveTools: (next: string[]) => {
      sets.push(next)
    },
  }
  ext(pi as never)
  const restore = () => {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k]
    Object.assign(process.env, saved)
  }
  return { handlers, sets, restore }
}

test('sem UI: session_start desativa as duas ferramentas e desliga o título', () => {
  const { handlers, sets, restore } = load(['read', 'question', 'plan_mode_complete'])
  try {
    handlers.session_start({}, { hasUI: false })
    assert.deepEqual(sets, [['read']])
    assert.equal(process.env.CLAUDE_CODE_DISABLE_TERMINAL_TITLE, '1')
  } finally {
    restore()
  }
})

test('com UI: ferramentas e título intactos; escolha explícita do título vence sem UI', () => {
  const ui = load(['read', 'question', 'plan_mode_complete'])
  try {
    ui.handlers.session_start({}, { hasUI: true })
    assert.deepEqual(ui.sets, [])
    assert.equal(process.env.CLAUDE_CODE_DISABLE_TERMINAL_TITLE, undefined)
  } finally {
    ui.restore()
  }
  const keep = load(['read'], { CLAUDE_CODE_DISABLE_TERMINAL_TITLE: '0' })
  try {
    keep.handlers.session_start({}, { hasUI: false })
    assert.deepEqual(keep.sets, [])
    assert.equal(process.env.CLAUDE_CODE_DISABLE_TERMINAL_TITLE, '0')
  } finally {
    keep.restore()
  }
})

test('tool_result devolve o texto novo em qualquer modo; before_provider_request só no Anthropic', () => {
  const { handlers, restore } = load([])
  try {
    const ignored = {
      toolName: 'plan_mode_complete',
      content: [{ type: 'text', text: 'Not in plan mode; tool ignored.' }],
    }
    assert.deepEqual(handlers.tool_result(ignored, { hasUI: true }), {
      content: [{ type: 'text', text: NO_PLAN_MODE }],
    })
    assert.equal(
      handlers.tool_result({ toolName: 'read', content: [{ type: 'text', text: 'x' }] }, { hasUI: false }),
      undefined,
    )
    assert.equal(
      handlers.before_provider_request({ payload: single('/x') }, { model: { api: 'openai-responses' } }),
      undefined,
    )
    const out = handlers.before_provider_request(
      { payload: single('/x') },
      { model: { api: 'anthropic-messages' } },
    ) as Sys
    assert.equal(out.system.length, 2)
    assert.equal((handlers.before_provider_request({ payload: single('/x') }, {}) as Sys).system.length, 2)
  } finally {
    restore()
  }
})

test('PI_HEADLESS_LEAN=0 não registra nada', () => {
  const { handlers, restore } = load([], { PI_HEADLESS_LEAN: '0' })
  try {
    assert.deepEqual(Object.keys(handlers), [])
  } finally {
    restore()
  }
})

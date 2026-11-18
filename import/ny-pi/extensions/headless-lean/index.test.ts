// node --experimental-strip-types --test ~/.pi/agent/extensions/headless-lean/index.test.ts
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import ext, {
  HEADLESS_PROMPT,
  headlessFloor,
  headlessTools,
  NO_PLAN_MODE,
  NO_UI_QUESTION,
  rewriteResult,
  splitCwd,
} from './index.ts'

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
  messages: [
    {
      role: 'user',
      content: [{ type: 'text', text: 'oi', cache_control: { ...CC } }],
    },
  ],
})
const single = (cwd: string) => ({
  system: [{ type: 'text', text: prompt(cwd), cache_control: { ...CC } }],
  messages: [],
})
const marks = (v: unknown) => JSON.stringify(v).split('"cache_control"').length - 1
type Sys = {
  system: Array<{ type: string; text: string; cache_control?: unknown }>
}

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
    assert.deepEqual(a.system[nStatic], {
      type: 'text',
      text: '<cwd>\n/a/one\n</cwd>',
    })
    assert.deepEqual(b.system[nStatic], {
      type: 'text',
      text: '<cwd>\n/b/two/three\n</cwd>',
    })
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
  const active = ['read', 'question', 'plan_mode_complete', 'bash', 'lsp_hover', 'codemode']
  assert.deepEqual(headlessTools(active, ['node', 'pi', '-p', 'Planeje antes de implementar.']), [
    'read',
    'bash',
    'lsp_hover',
    'codemode',
  ])
  for (const argv of [
    ['-p', '--plan', 'x'],
    ['-p', '/plan fazer x'],
    ['-p', '/plan'],
  ]) {
    assert.deepEqual(headlessTools(active, argv), ['read', 'plan_mode_complete', 'bash', 'lsp_hover', 'codemode'])
  }
  assert.deepEqual(headlessTools(active, ['-p', '/planeta', '--planner']), ['read', 'bash', 'lsp_hover', 'codemode'])
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
  for (const k of [
    'PI_HEADLESS_LEAN',
    'PI_HEADLESS_FLOOR',
    'PI_CODE_SUBAGENT_DEPTH',
    'CLAUDE_CONFIG_DIR',
    'CLAUDE_CODE_DISABLE_TERMINAL_TITLE',
  ])
    delete process.env[k]
  for (const [k, v] of Object.entries(env)) if (v !== undefined) process.env[k] = v
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

test('sem UI o prompt de sistema ganha o bloco headless uma vez; com UI fica como está', () => {
  const { handlers, restore } = load([])
  try {
    const out = handlers.before_agent_start({ systemPrompt: 'base' }, { hasUI: false }) as { systemPrompt: string }
    assert.equal(out.systemPrompt, `base\n\n${HEADLESS_PROMPT}`)
    assert.match(HEADLESS_PROMPT, /Nobody can reply/)
    assert.match(HEADLESS_PROMPT, /never ask for permission or confirmation to start/)
    assert.match(HEADLESS_PROMPT, /change no file and end with your questions/)
    assert.equal(handlers.before_agent_start({ systemPrompt: out.systemPrompt }, { hasUI: false }), undefined)
    assert.equal(handlers.before_agent_start({ systemPrompt: 'base' }, { hasUI: true }), undefined)
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

// --- item 6: piso de prefixo (contrato curto e sem lista de skills) ---
const FLOOR = '# Working contract (pi, headless)\n\n- Act by default.'
const BIG = '# Working contract (pi)\n\n## Precedence\n- long rules\n- more'
const SKILLS =
  "<skills>\n\nThe following skills provide specialized instructions for specific tasks.\nUse the read tool to load a skill's file when the task matches its description.\nResolve relative paths against the skill's directory (parent of SKILL.md). Use absolute paths in tool calls.\n\n<available_skills>\n  <skill>\n    <name>a</name>\n  </skill>\n</available_skills>\n</skills>"
const REAL = () =>
  `Intro\n\n<project_context>\nProject-specific instructions and guidelines:\n\n<project_instructions path="/x/claude-home/CLAUDE.md">\n${BIG}\n</project_instructions>\n\n<project_instructions path="/x/rules/safety.md">\n# Safety\n</project_instructions>\n</project_context>\n\n${SKILLS}\n\n<cwd>\n/w\n</cwd>\n\n<mcp_servers>\n- a\n</mcp_servers>`
const floorPayload = (text = REAL()) => ({
  system: [
    { type: 'text', text: IDENTITY, cache_control: { ...CC } },
    { type: 'text', text, cache_control: { ...CC } },
  ],
})

test('headlessFloor troca o contrato e tira as skills; resto do prompt intacto', () => {
  const out = headlessFloor(floorPayload(), FLOOR) as Sys
  assert.equal(
    out.system[1].text,
    `Intro\n\n<project_context>\nProject-specific instructions and guidelines:\n\n<project_instructions path="/x/claude-home/CLAUDE.md">\n${FLOOR}\n</project_instructions>\n\n<project_instructions path="/x/rules/safety.md">\n# Safety\n</project_instructions>\n</project_context>\n\n<cwd>\n/w\n</cwd>\n\n<mcp_servers>\n- a\n</mcp_servers>`,
  )
  assert.equal(out.system[0].text, IDENTITY)
  assert.deepEqual(out.system[1].cache_control, CC)
})

test('headlessFloor: conteúdo com $& não é interpretado como padrão', () => {
  const out = headlessFloor(floorPayload(), 'a $& b $1') as Sys
  assert.match(out.system[1].text, /\na \$& b \$1\n<\/project_instructions>/)
})

test('headlessFloor com formato inesperado deixa o payload e diz o motivo', () => {
  const log: string[] = []
  const dbg = (m: string) => log.push(m)
  const noSkills = REAL().replace(`${SKILLS}\n\n`, '')
  const noContract = REAL().replace(BIG, '# Other')
  const cases: unknown[] = [
    null,
    {},
    { system: 'x' },
    floorPayload(noSkills),
    floorPayload(noContract),
    floorPayload('x'),
  ]
  for (const c of cases) {
    const snap = JSON.stringify(c)
    assert.equal(headlessFloor(c, FLOOR, dbg), undefined)
    assert.equal(JSON.stringify(c), snap)
  }
  assert.equal(log.length, 4) // sem `system` (continuação de thread) é calado
})

function withConfig(file: string | null, fn: (dir: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), 'hfloor-'))
  if (file !== null) writeFileSync(join(dir, 'CLAUDE.headless.md'), file)
  try {
    fn(dir)
  } finally {
    rmSync(dir, { recursive: true })
  }
}
const run = (env: Record<string, string | undefined>, ctx: unknown, payload: unknown = floorPayload()) => {
  const { handlers, restore } = load([], env)
  try {
    return handlers.before_provider_request({ payload }, ctx) ?? payload // sem retorno = payload como está
  } finally {
    restore()
  }
}
const AN = { model: { api: 'anthropic-messages' } }

test('sessão headless de topo: contrato curto, sem skills, <cwd> continua no bloco final', () => {
  withConfig(`${FLOOR}\n`, (dir) => {
    for (const depth of [undefined, '0']) {
      const out = run({ CLAUDE_CONFIG_DIR: dir, PI_CODE_SUBAGENT_DEPTH: depth }, { hasUI: false, ...AN }) as Sys
      const all = out.system.map((b) => b.text).join('\n')
      assert.ok(all.includes(`\n${FLOOR}\n</project_instructions>`))
      assert.ok(!all.includes('# Working contract (pi)\n') && !all.includes('available_skills'))
      assert.equal(out.system.at(-1)?.text, '<cwd>\n/w\n</cwd>')
    }
  })
})

test('piso fica de fora: subagente, interativo, opt-out, arquivo ausente', () => {
  const untouched = (out: unknown) => {
    const all = (out as Sys).system.map((b) => b.text).join('\n')
    assert.ok(all.includes(BIG) && all.includes('available_skills'))
  }
  withConfig(FLOOR, (dir) => {
    untouched(run({ CLAUDE_CONFIG_DIR: dir, PI_CODE_SUBAGENT_DEPTH: '1' }, { hasUI: false, ...AN }))
    untouched(run({ CLAUDE_CONFIG_DIR: dir }, { hasUI: true, ...AN }))
    untouched(run({ CLAUDE_CONFIG_DIR: dir, PI_HEADLESS_FLOOR: '0' }, { hasUI: false, ...AN }))
  })
  withConfig(null, (dir) => untouched(run({ CLAUDE_CONFIG_DIR: dir }, { hasUI: false, ...AN })))
  untouched(run({}, { hasUI: false, ...AN })) // sem CLAUDE_CONFIG_DIR
  withConfig('', (dir) => untouched(run({ CLAUDE_CONFIG_DIR: dir }, { hasUI: false, ...AN })))
})

test('formato inesperado no handler: payload como está, sem lançar', () => {
  withConfig(FLOOR, (dir) => {
    const p = floorPayload('sem nada')
    assert.equal(run({ CLAUDE_CONFIG_DIR: dir }, { hasUI: false, ...AN }, p), p)
    assert.equal(p.system[1].text, 'sem nada')
  })
})

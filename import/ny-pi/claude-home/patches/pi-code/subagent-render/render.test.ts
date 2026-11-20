// Testes do desenho do subagent no transcript (subagent/transcript/*.ts e o gancho em subagent/index.ts):
// env -u PI_CODE_SUBAGENT -u PI_CODE_SUBAGENT_DEPTH -u PI_CODE_FLEET_DIR -u PI_CODE_FLEET_RUN_ID -u PI_CODE_TEAMS node --experimental-strip-types --test ~/.pi/agent/claude-home/patches/pi-code/subagent-render/render.test.ts
import assert from 'node:assert/strict'
import { homedir } from 'node:os'
import { test } from 'node:test'
import { fleetTestEnv } from '../subagent-panel/setup.ts'

const { ext } = fleetTestEnv('subagent-render-')
const tr = await import(`${ext}/subagent/transcript/index.ts`)
const fmt = await import(`${ext}/subagent/transcript/format.ts`)
const palette = await import(`${ext}/subagent/fleet-ui/palette.ts`)
await palette.ready

const CODE: Record<string, number> = { error: 91, success: 92, warning: 93, accent: 94, dim: 90, muted: 37, toolTitle: 96, toolOutput: 97 }
const theme = { fg: (role: string, t: string) => `\x1b[${CODE[role] ?? 39}m${t}\x1b[39m`, bold: (t: string) => `\x1b[1m${t}\x1b[22m` }
const mdTheme = new Proxy({}, { get: () => (t: string) => t })
const strip = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, '')
const lines = (c: { render(w: number): string[] }, plain = true, w = 200): string[] => c.render(w).map((l) => (plain ? strip(l).trimEnd() : l))
const text = (c: { render(w: number): string[] }, w = 200): string => lines(c, true, w).join('\n')

const call = (name: string, args: Record<string, unknown>) => ({ type: 'toolCall', id: name, name, arguments: args })
const asst = (content: unknown[], ts?: number) => ({ role: 'assistant', content, ...(ts === undefined ? {} : { timestamp: ts }) })
const usage = (over: Record<string, number> = {}) => ({ input: 100, output: 50, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 1, ...over })
const res = (over: Record<string, unknown> = {}) => ({
  agent: 'swarm-worker', agentSource: 'user', task: 'Harden the pi PreToolUse guard. OWNED FILES: a, b', exitCode: -1, messages: [], stderr: '', usage: usage(), ...over,
})
const running = res({
  messages: [asst([{ type: 'text', text: 'thinking aloud' }, call('read', { path: '/a' })]), asst([call('read', { path: `${homedir()}/.pi/agent/claude-home/hooks/test_guard.py`, offset: 80, limit: 140 })])],
  usage: usage({ contextTokens: 23400 }),
})
const done = res({
  task: 'Three small harness hygiene changes: x, y', exitCode: 0, usage: usage({ cost: 0.1234, contextTokens: 41000 }),
  messages: [asst([call('bash', { command: 'ls' })], 1000), asst([{ type: 'text', text: '## **Hecho** con `código`\nsecond line' }], 13000)],
})
const failed = res({ exitCode: 1, stopReason: 'error', errorMessage: 'boom happened', messages: [asst([call('edit', { path: '/x' })])] })
const partial = res({ exitCode: 0, partial: true, messages: [asst([{ type: 'text', text: 'half done' }])] })
const idle = res({ exitCode: 0 }) // a partial update of a child that has not produced anything yet

const wrap = (mode: string, results: unknown[], extra: Record<string, unknown> = {}) => ({
  content: [{ type: 'text', text: 'fallback text' }], details: { mode, agentScope: 'user', projectAgentsDir: null, results, ...extra },
})
const view = (result: unknown, opts: { expanded?: boolean; isPartial?: boolean } = {}, args: unknown = {}) =>
  tr.renderSubagentResult(result, { expanded: false, isPartial: false, ...opts }, theme, args, mdTheme)
const tasks = [{ agent: 'Explore', task: 'Scan it. Then report' }, { agent: 'swarm-worker', task: 'Run: sleep 15; echo hi' }]

// ---- format helpers ----

test('taskTitle: first line, sentence cut only when >= 12 chars remain, word-boundary ellipsis, never at ":"', () => {
  assert.equal(fmt.taskTitle('Harden the pi PreToolUse guard. OWNED FILES: x', 'a'), 'Harden the pi PreToolUse guard')
  assert.equal(fmt.taskTitle('Run: sleep 15; echo hi', 'a'), 'Run: sleep 15; echo hi')
  assert.equal(fmt.taskTitle('Do this:\nmore', 'a'), 'Do this:')
  assert.equal(fmt.taskTitle('\n\n  Second line here  \nthird', 'a'), 'Second line here')
  assert.equal(fmt.taskTitle('Fix it. Then do the rest', 'a'), 'Fix it. Then do the rest')
  assert.equal(fmt.taskTitle('Fix src/a.ts quickly', 'a'), 'Fix src/a.ts quickly')
  assert.equal(fmt.taskTitle('{previous}', 'agent-x'), 'agent-x')
  assert.equal(fmt.taskTitle('', 'agent-x'), 'agent-x')
  assert.equal(fmt.taskTitle('Summarize {previous} now', 'a'), 'Summarize now')
  const hard = fmt.taskTitle('x'.repeat(100), 'a')
  assert.equal(hard.length, 48)
  assert.ok(hard.endsWith('…') && !hard.includes('...'))
  const words = fmt.taskTitle('alpha beta gamma delta epsilon zeta eta theta iota kappa lambda', 'a')
  assert.equal(words, 'alpha beta gamma delta epsilon zeta eta theta…')
  assert.ok(words.length <= 48)
  assert.equal(fmt.taskTitle(`${'w'.repeat(47)} tail and more`, 'a'), `${'w'.repeat(47)}…`)
})

test('toolLine: Claude verbs, ~ for home, a read range only with offset and limit', () => {
  const h = homedir()
  assert.equal(fmt.toolLine('read', { path: `${h}/x.ts`, offset: 80, limit: 140 }), 'Read ~/x.ts:80-219')
  assert.equal(fmt.toolLine('read', { file_path: `${h}2/x.ts`, offset: 5 }), `Read ${h}2/x.ts:5-`)
  assert.equal(fmt.toolLine('read', { path: '/etc/os-release', limit: 0 }), 'Read /etc/os-release')
  assert.equal(fmt.toolLine('read', { path: '/etc/os-release', offset: 1, limit: 0 }), 'Read /etc/os-release:1-')
  assert.equal(fmt.toolLine('read', { path: '/etc/os-release' }), 'Read /etc/os-release')
  assert.equal(fmt.toolLine('read', {}), 'Read …')
  assert.equal(fmt.toolLine('bash', { command: 'cd /x\nls' }), 'Bash cd /x')
  assert.equal(fmt.toolLine('bash', {}), 'Bash …')
  assert.equal(fmt.toolLine('write', { path: '/w', content: 'a\nb\nc' }), 'Write /w (3 lines)')
  assert.equal(fmt.toolLine('write', { path: '/w' }), 'Write /w')
  assert.equal(fmt.toolLine('edit', { file_path: '/e' }), 'Edit /e')
  assert.equal(fmt.toolLine('grep', { pattern: 'foo', path: 'src' }), 'Grep /foo/ in src')
  assert.equal(fmt.toolLine('find', {}), 'Find * in .')
  assert.equal(fmt.toolLine('ls', {}), 'Ls .')
  assert.equal(fmt.toolLine('web_fetch', { url: 'u' }), 'web_fetch {"url":"u"}')
  assert.equal(fmt.toolLine('constructor', {}), 'constructor {}')
  const long = fmt.toolLine('bash', { command: 'x'.repeat(300) })
  assert.ok(long.length <= 72 && long.endsWith('…'))
  assert.ok(!fmt.toolLine('other', { a: 'y'.repeat(200) }).includes('...'))
})

test('formatToolCall colours the verb and argument', () => {
  const s = fmt.formatToolCall('read', { path: '/p', offset: 1, limit: 2 }, theme.fg)
  assert.equal(strip(s), 'Read /p:1-2')
  assert.ok(s.includes('\x1b['))
})

test('previewLine: first non-empty line without markdown marks, bounded', () => {
  assert.equal(fmt.previewLine('\n\n## **Hecho** con `código`\nsecond'), 'Hecho con código')
  assert.equal(fmt.previewLine('- *item* one'), 'item one')
  assert.equal(fmt.previewLine('status: complete\nblock_kind: none\n\nUbuntu 26.04'), 'Ubuntu 26.04', 'handback header lines are skipped')
  assert.equal(fmt.previewLine('**Status: complete.** All good'), 'Status: complete. All good', 'prose that starts with Status stays')
  assert.equal(fmt.previewLine('status: complete'), 'status: complete', 'header-only output still shows')
  assert.equal(fmt.previewLine('> quoted __bold__ snake_case_name'), 'quoted bold snake_case_name')
  assert.equal(fmt.previewLine(''), '')
  const long = fmt.previewLine('z'.repeat(300))
  assert.ok(long.length <= 72 && long.endsWith('…'))
})

test('resultStats: tools, tokens, cost and elapsed only when derivable', () => {
  assert.deepEqual(fmt.resultStats(done), { tools: 1, tokens: 41000, cost: 0.1234, elapsedMs: 12000 })
  assert.deepEqual(fmt.resultStats(running), { tools: 2, tokens: 23400, cost: 0, elapsedMs: undefined })
  assert.equal(fmt.resultStats(res({ usage: usage({ contextTokens: 0 }) })).tokens, 150)
  assert.equal(fmt.resultStats(res({ usage: usage({ input: 0, output: 0 }) })).tokens, 0)
  assert.equal(fmt.resultStats(res({ messages: [asst([], 5), asst([], 5)] })).elapsedMs, undefined)
  assert.equal(fmt.resultStats(res({ messages: [asst([], 5)] })).elapsedMs, undefined)
  assert.equal(fmt.statsText({ tools: 9, tokens: 41000, cost: 0.12, elapsedMs: 75000 }), '9 tools · 41.0k tok · $0.12 · 1m 15s')
  assert.equal(fmt.statsText({ tools: 1, tokens: 900, cost: 0.001, elapsedMs: 4000 }), '1 tool · 900 tok · <$0.01 · 4s')
  assert.equal(fmt.statsText({ tools: 0, tokens: 0, cost: 0, elapsedMs: undefined }), '')
  assert.equal(fmt.statsText({ tools: 0, tokens: 2_500_000, cost: 0, elapsedMs: undefined }), '0 tools · 2.5M tok')
  assert.equal(fmt.statsText({ tools: 1, tokens: 0, cost: 0, elapsedMs: 3_725_000 }), '1 tool · 1h 02m')
  assert.equal(fmt.statsText({ tools: 1, tokens: 0, cost: 0, elapsedMs: 100 }), '1 tool · 1s')
})

// ---- calls (1: no state glyph) ----

test('calls carry no state glyph: the call box cannot know the state', () => {
  assert.deepEqual(lines(tr.renderSubagentCall({ agent: 'swarm-worker', task: 'Harden the pi PreToolUse guard. OWNED FILES: a', agentScope: 'user' }, theme)), ['swarm-worker  Harden the pi PreToolUse guard [user]'])
  assert.deepEqual(lines(tr.renderSubagentCall({}, theme)), ['…'])
  assert.deepEqual(lines(tr.renderSubagentCall({ agent: 'Explore' }, theme)), ['Explore'])
  assert.deepEqual(lines(tr.renderSubagentCall({ tasks }, theme)), ['parallel · 2 agents'])
  assert.deepEqual(lines(tr.renderSubagentCall({ chain: tasks, agentScope: 'both' }, theme)), ['chain · 2 steps [both]'])
  assert.deepEqual(lines(tr.renderSubagentCall({ chain: [tasks[0]] }, theme)), ['chain · 1 step'])
  const raw = lines(tr.renderSubagentCall({ tasks }, theme), false)[0]
  assert.ok(raw.includes('\x1b[1m') && !raw.includes('●'))
})

// ---- single result ----

test('single running: "● <latest tool>", never prose', () => {
  const l = lines(view(wrap('single', [running]), { isPartial: true }))
  assert.deepEqual(l, ['  ⎿ ● Read ~/.pi/agent/claude-home/hooks/test_guard.py:80-219', '  ctrl+o expand'])
  assert.ok(!l.join('\n').includes('thinking aloud'))
  assert.deepEqual(lines(view(wrap('single', [res()]), { isPartial: true })), ['  ⎿ ● starting…', '  ctrl+o expand'])
  const prose = res({ messages: [asst([{ type: 'text', text: 'hm' }])] })
  assert.equal(lines(view(wrap('single', [prose])))[0], '  ⎿ ● working…')
})

test('single partial update (isPartial) with exitCode 0 is running, never Done', () => {
  for (const r of [idle, res({ exitCode: 0, messages: [asst([{ type: 'text', text: 'early words' }])] })]) {
    const t = text(view(wrap('single', [r]), { isPartial: true }))
    assert.ok(!t.includes('Done') && !t.includes('no output'), t)
    assert.ok(t.startsWith('  ⎿ ● '), t)
  }
  assert.deepEqual(lines(view(wrap('single', [idle]), { isPartial: true }))[0], '  ⎿ ● starting…')
  // The same result, final, is Done.
  assert.ok(text(view(wrap('single', [idle]))).startsWith('  ⎿ ✓ Done'))
  // A failure is a failure even in a partial update.
  assert.ok(text(view(wrap('single', [failed]), { isPartial: true })).startsWith('  ⎿ ✗ Failed'))
})

test('single done / partial / failed carry their own glyph and a clean preview', () => {
  assert.deepEqual(lines(view(wrap('single', [done]))), ['  ⎿ ✓ Done (1 tool · 41.0k tok · $0.12 · 12s)', '    Hecho con código', '  ctrl+o expand'])
  const p = lines(view(wrap('single', [partial])))
  assert.equal(p[0], '  ⎿ ◐ Partial (0 tools · 150 tok)')
  assert.equal(p[1], '    half done')
  const raw = lines(view(wrap('single', [done])), false)[0]
  assert.ok(raw.includes(theme.fg('success', '✓')))
  const f = lines(view(wrap('single', [failed])))
  assert.deepEqual(f.slice(0, 2), ['  ⎿ ✗ Failed (1 tool · 150 tok)', '    boom happened'])
  assert.ok(lines(view(wrap('single', [failed])), false)[1].includes('\x1b[91m'))
  const stderr = res({ exitCode: 2, stderr: 'oops\nbad', stopReason: 'aborted' })
  assert.equal(lines(view(wrap('single', [stderr])))[1], '    oops bad')
  assert.equal(lines(view(wrap('single', [res({ exitCode: 2 })])))[1], '    (no output)')
  assert.equal(lines(view(wrap('single', [res({ exitCode: 0 })])))[1], '    (no output)')
  const noMsg = res({ exitCode: 2, messages: [asst([{ type: 'text', text: 'final words' }])] })
  assert.equal(lines(view(wrap('single', [noMsg])))[1], '    final words')
  assert.equal(lines(view(wrap('single', [res({ exitCode: 2, stopReason: 'aborted' })])))[1], '    aborted')
})

test('failure: the error text shows in full, wrapped, capped at 3 lines with an ellipsis', () => {
  const msg = 'generating the report failed because the upstream provider rejected the request with a long explanation'
  const l = lines(view(wrap('single', [res({ exitCode: 1, errorMessage: msg })])))
  assert.deepEqual(l.slice(0, 2), ['  ⎿ ✗ Failed (0 tools · 150 tok)', `    ${msg}`])
  const long = `Error: ${'word '.repeat(60)}`
  const w = lines(view(wrap('single', [res({ exitCode: 1, errorMessage: long })])), true, 60)
  assert.equal(w.length, 5, w.join('\n'))
  assert.ok(w[1].startsWith('    Error: word') && w[2].startsWith('    word') && w[3].endsWith('…') && w[3].length <= 60)
  assert.equal(w[4], '  ctrl+o expand')
  const tree = lines(view(wrap('parallel', [res({ task: 'T', exitCode: 1, errorMessage: long }), done])), true, 60)
  assert.ok(tree[1].startsWith('  │  ⎿ Error: word') && tree[2].startsWith('  │    word') && tree[3].endsWith('…'), tree.join('\n'))
  assert.ok(lines(view(wrap('parallel', [res({ exitCode: 1, errorMessage: 'short' })])))[1] === '     ⎿ short')
})

// ---- tree results ----

test('parallel running: tree with latest tool per task and the aggregate glyph in the footer', () => {
  const l = lines(view(wrap('parallel', [running, done])))
  assert.deepEqual(l, [
    '  ├─ ● swarm-worker  Harden the pi PreToolUse guard   2 tools · 23.4k tok',
    '  │  ⎿ Read ~/.pi/agent/claude-home/hooks/test_guard.py:80-219',
    '  └─ ✓ swarm-worker  Three small harness hygiene changes: x, y   Done · 1 tool · 41.0k tok · $0.12 · 12s',
    '     ⎿ Hecho con código',
    '  ● 1/2 done · ctrl+o expand',
  ])
  const raw = lines(view(wrap('parallel', [running, done])), false).join('\n')
  assert.ok(raw.includes(theme.fg('warning', '●')) && raw.includes(theme.fg('success', '✓')))
})

test('parallel finished: ✓ footer, or ◐ with failures; chain ✗ with failures', () => {
  const ok = lines(view(wrap('parallel', [done, { ...done, task: 'Second thing to do here' }])))
  assert.ok(ok.at(-1)?.startsWith('  ✓ 2/2 done · 2 tools · 82.0k tok · $0.25 · ctrl+o expand'), ok.at(-1))
  const l = lines(view(wrap('parallel', [done, failed, partial])))
  assert.ok(l[0].startsWith('  ├─ ✓') && l[2].startsWith('  ├─ ✗') && l[2].includes('Failed · 1 tool'))
  assert.equal(l[3], '  │  ⎿ boom happened')
  assert.ok(l[4].startsWith('  └─ ◐') && l[4].includes('Partial'))
  assert.equal(l.at(-1), '  ◐ 3/3 done, 1 failed · 2 tools · 41.3k tok · $0.12 · ctrl+o expand')
  const c = lines(view(wrap('chain', [{ ...done, step: 1 }, { ...failed, step: 2 }])))
  assert.ok(c.at(-1)?.startsWith('  ✗ 2/2 done, 1 failed'))
})

test('chain: numbered steps; only the last step of a partial update is still running', () => {
  const l = lines(view(wrap('chain', [{ ...done, step: 1 }, { ...running, step: 2 }])))
  assert.ok(l[0].startsWith('  ├─ ✓ 1. swarm-worker  Three small'))
  assert.ok(l[2].startsWith('  └─ ● 2. swarm-worker  Harden'))
  assert.equal(l.at(-1), '  ● 1/2 done · ctrl+o expand')
  assert.ok(lines(view(wrap('chain', [done])))[0].includes('✓ 1. '))
  // Premature "Done (no output)": step 2 answered exitCode 0 with nothing yet while the update is partial.
  const p = lines(view(wrap('chain', [{ ...done, step: 1 }, { ...idle, step: 2 }]), { isPartial: true }))
  assert.ok(p[2].startsWith('  └─ ● 2. ') && !p.join('\n').includes('Done · 0'), p.join('\n'))
  assert.equal(p[3], '     ⎿ starting…')
  assert.equal(p.at(-1), '  ● 1/2 done · ctrl+o expand')
  const q = lines(view(wrap('chain', [{ ...done, step: 1 }, { ...done, step: 2 }]), { isPartial: false }))
  assert.ok(q.at(-1)?.startsWith('  ✓ 2/2 done'))
})

test('parallel partial update: a child with exitCode 0 and no output yet is still running', () => {
  const p = lines(view(wrap('parallel', [idle, done]), { isPartial: true }))
  assert.ok(p[0].startsWith('  ├─ ● ') && p[1] === '  │  ⎿ starting…' && p.at(-1) === '  ● 1/2 done · ctrl+o expand', p.join('\n'))
  assert.ok(lines(view(wrap('parallel', [idle, done])))[0].startsWith('  ├─ ✓ '))
})

test('chain titles come from the template task, not the substituted {previous} text', () => {
  const substituted = res({ step: 2, task: 'Summarize this long previous answer text that was substituted in', exitCode: -1 })
  const args = { chain: [{ agent: 'a', task: 'First one' }, { agent: 'swarm-worker', task: 'Summarize: {previous}' }] }
  const l = lines(view(wrap('chain', [{ ...done, step: 1 }, substituted]), {}, args))
  assert.ok(l[2].includes('2. swarm-worker  Summarize:') && !l[2].includes('previous answer'), l[2])
  const bare = { chain: [{ agent: 'a', task: 'x' }, { agent: 'swarm-worker', task: '{previous}' }] }
  assert.ok(lines(view(wrap('chain', [{ ...done, step: 1 }, substituted]), {}, bare))[2].includes('2. swarm-worker  swarm-worker'))
  // No args (or a step beyond them): the result's own task.
  assert.ok(lines(view(wrap('chain', [substituted]), {}, {}))[0].includes('Summarize this long previous'))
})

test('start of a run: placeholder rows from the call args instead of an empty block', () => {
  const p = lines(view(wrap('parallel', []), { isPartial: true }, { tasks }))
  assert.deepEqual(p, [
    '  ├─ ● Explore  Scan it. Then report',
    '  │  ⎿ starting…',
    '  └─ ● swarm-worker  Run: sleep 15; echo hi',
    '     ⎿ starting…',
    '  ● 0/2 done · ctrl+o expand',
  ])
  const half = lines(view(wrap('parallel', [running]), { isPartial: true }, { tasks }))
  assert.ok(half[0].startsWith('  ├─ ● swarm-worker  Harden') && half[2] === '  └─ ● swarm-worker  Run: sleep 15; echo hi' && half[3] === '     ⎿ starting…')
  const c = lines(view(wrap('chain', []), { isPartial: true }, { chain: tasks }))
  assert.ok(c[0] === '  ├─ ● 1. Explore  Scan it. Then report' && c[2].startsWith('  └─ ● 2. swarm-worker'), c.join('\n'))
  const s = lines(view(wrap('single', []), { isPartial: true }, { agent: 'Explore', task: 'x' }))
  assert.deepEqual(s, ['  ⎿ ● starting…', '  ctrl+o expand'])
  // Final result: nothing is padded; no details or nothing to draw falls back to the text.
  assert.equal(text(view(wrap('parallel', []), {}, { tasks })), 'fallback text')
  assert.equal(text(view(wrap('parallel', [done]), {}, { tasks })).split('\n').filter((x) => x.includes('├─') || x.includes('└─')).length, 1)
  assert.equal(text(view(wrap('parallel', []), { isPartial: true }, {})), 'fallback text')
  assert.equal(text(view({ content: [{ type: 'text', text: 'plain' }] }, { isPartial: true }, { tasks })), 'plain')
  assert.equal(text(view({ content: [] })), '(no output)')
  assert.equal(text(view(wrap('weird', [done]))), 'fallback text')
  assert.equal(text(view(wrap('single', [done, done]))), 'fallback text')
})

// ---- expanded ----

test('expanded single keeps the glyph header, tool list, output and usage', () => {
  const s = text(view(wrap('single', [done]), { expanded: true }))
  assert.ok(s.startsWith('✓ swarm-worker (user)'))
  assert.ok(s.includes('Task') && s.includes('Three small harness hygiene changes: x, y') && s.includes('Bash ls') && s.includes('second line') && s.includes('ctx:41k'))
  assert.ok(!s.includes('...'))
  const e = text(view(wrap('single', [failed]), { expanded: true }))
  assert.ok(e.includes('✗ swarm-worker') && e.includes('[error]') && e.includes('Error: boom happened'))
  assert.ok(text(view(wrap('single', [res({ exitCode: 0 })]), { expanded: true })).includes('(no output)'))
  assert.ok(text(view(wrap('single', [idle]), { expanded: true, isPartial: true })).startsWith('● swarm-worker'))
})

test('expanded parallel and chain keep the tree: rows like collapsed plus the details', () => {
  const l = lines(view(wrap('parallel', [running, done]), { expanded: true }))
  const at = (re: RegExp): number => l.findIndex((x) => re.test(x))
  assert.equal(l[0], '  ├─ ● swarm-worker  Harden the pi PreToolUse guard   2 tools · 23.4k tok')
  assert.equal(l[1], '  │  ⎿ Read ~/.pi/agent/claude-home/hooks/test_guard.py:80-219')
  assert.ok(l[2] === '  │  Task: Harden the pi PreToolUse guard. OWNED FILES: a, b' && l[3] === '  │  ⎿ Read /a', l.join('\n'))
  const last = at(/^ {2}└─ ✓ swarm-worker/)
  assert.ok(last > 0 && l[last + 1] === '     ⎿ Hecho con código')
  assert.ok(l.slice(last).some((x) => x.startsWith('     Task: Three small')) && l.slice(last).some((x) => x.startsWith('     ⎿ Bash ls')))
  assert.ok(l.slice(last).some((x) => x.includes('second line')) && l.slice(last).some((x) => x.includes('ctx:41k')))
  assert.ok(l.at(-1)?.startsWith('  ● 1/2 done') && l.at(-1)?.includes('Total:') && !l.join('\n').includes('ctrl+o expand'), l.at(-1))
  const c = text(view(wrap('chain', [{ ...done, step: 1 }, { ...failed, step: 2 }]), { expanded: true }))
  assert.ok(c.includes('├─ ✓ 1. swarm-worker') && c.includes('└─ ✗ 2. swarm-worker') && c.includes('⎿ boom happened') && c.includes('Total:'))
  assert.ok(c.trimEnd().split('\n').at(-1)?.startsWith('  ✗ 2/2 done, 1 failed'))
  const pad = lines(view(wrap('parallel', []), { expanded: true, isPartial: true }, { tasks }))
  assert.equal(pad[0], '  ├─ ● Explore  Scan it. Then report')
  assert.ok(pad.at(-1)?.startsWith('  ● 0/2 done'))
  assert.ok(lines(view(wrap('parallel', [done]), { expanded: true }), true, 40).every((x) => x.length <= 40))
})

test('NO_COLOR: no escape sequences anywhere', () => {
  process.env.NO_COLOR = '1'
  try {
    const all = [
      tr.renderSubagentCall({ agent: 'a', task: 't', agentScope: 'user' }, theme), tr.renderSubagentCall({ tasks }, theme), tr.renderSubagentCall({ chain: tasks }, theme),
      view(wrap('single', [failed])), view(wrap('parallel', [running, done])), view(wrap('chain', [done])),
      view(wrap('single', [done]), { expanded: true }), view(wrap('parallel', [done]), { expanded: true }), view(wrap('chain', [done]), { expanded: true }),
    ]
    for (const c of all) assert.ok(!c.render(100).join('\n').includes('\x1b['), 'escape found')
  } finally {
    delete process.env.NO_COLOR
  }
})

test('collapsed lines stay short whatever the task is', () => {
  const r = res({ task: 'y'.repeat(300), messages: [asst([call('bash', { command: 'z'.repeat(400) })])] })
  for (const l of lines(view(wrap('parallel', [r])))) assert.ok(l.length < 130, l)
})

// ---- the hook in subagent/index.ts ----

test('index.ts wires renderCall and renderResult (isPartial and args forwarded) to the transcript', async () => {
  const tools: any[] = []
  const pi = {
    on: () => {}, registerTool: (d: any) => void tools.push(d), registerCommand: () => {}, events: { emit: () => {}, on: () => () => {} }, getActiveTools: () => ['subagent'],
  }
  const { default: extension } = await import(`${ext}/subagent/index.ts`)
  extension(pi)
  const tool = tools.find((t) => t.name === 'subagent')
  assert.deepEqual(lines(tool.renderCall({ tasks }, theme, {})), ['parallel · 2 agents'])
  const out = tool.renderResult(wrap('parallel', []), { expanded: false, isPartial: true }, theme, { args: { tasks } })
  assert.equal(lines(out).at(-1), '  ● 0/2 done · ctrl+o expand')
  assert.ok(text(tool.renderResult(wrap('single', [idle]), { expanded: false, isPartial: false }, theme, { args: {} })).startsWith('  ⎿ ✓ Done'))
})

test('invalidate reaches the nested components and a redraw renders the same lines', () => {
  const c = view(wrap('parallel', [failed, done]), { expanded: true })
  const before = lines(c)
  c.invalidate()
  assert.deepEqual(lines(c), before)
})

test('NO_COLOR: the expanded markdown output carries no escapes even with a coloring markdown theme', () => {
  const ansiMd = new Proxy({}, { get: (_t, k) => (k === 'highlightCode' ? (c: string) => c.split('\n').map((l) => `\x1b[35m${l}\x1b[39m`) : k === 'codeBlockIndent' ? '  ' : (t: string) => `\x1b[95m${t}\x1b[39m`) })
  const md = res({ exitCode: 0, messages: [asst([{ type: 'text', text: '## Title\n**bold** `code` [l](http://x)\n\n```ts\nconst a = 1\n```' }])] })
  const render = (expanded: boolean, mode: string) => tr.renderSubagentResult(wrap(mode, [md]), { expanded, isPartial: false }, theme, {}, ansiMd).render(100).join('\n')
  assert.ok(render(true, 'single').includes('\x1b['), 'colors with NO_COLOR unset')
  process.env.NO_COLOR = '1'
  try {
    for (const mode of ['single', 'parallel', 'chain']) assert.ok(!render(true, mode).includes('\x1b['), `escape found in ${mode}`)
  } finally {
    delete process.env.NO_COLOR
  }
})

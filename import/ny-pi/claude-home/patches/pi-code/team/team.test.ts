// Testes do modo time (subagent/team/*): node --experimental-strip-types --test ~/.pi/agent/claude-home/patches/pi-code/team/team.test.ts
import assert from 'node:assert/strict'
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fleetTestEnv } from '../subagent-panel/setup.ts'

const { tmp, ext } = fleetTestEnv('team-test-')
const store = await import(`${ext}/subagent/fleet/store.ts`)
const teamStore = await import(`${ext}/subagent/team/store.ts`)
const route = await import(`${ext}/subagent/team/route.ts`)
const teamTypes = await import(`${ext}/subagent/team/types.ts`)
const tasks = await import(`${ext}/subagent/team/tasks.ts`)
const feed = await import(`${ext}/subagent/team/feed.ts`)
const ui = await import(`${ext}/subagent/team/ui.ts`)
const teamIndex = await import(`${ext}/subagent/team/index.ts`)
const child = await import(`${ext}/subagent/child.ts`)
const viewModel = await import(`${ext}/subagent/fleet-ui/view-model.ts`)
const panel = await import(`${ext}/subagent/fleet-ui/panel.ts`)
const viewer = await import(`${ext}/subagent/fleet-ui/viewer.ts`)

const rid = (n: number): string => `fg-${n.toString(16).padStart(8, '0')}`
const rec = (n: number, agent: string, over: Record<string, unknown> = {}) => ({
  v: 1, id: rid(n), parentId: null, depth: 1, agent, task: `task of ${agent}`, background: false, state: 'running',
  startedAt: n, updatedAt: n, turns: 0, toolCalls: 0, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, context: 0 }, cost: 0, ownerPid: process.pid, ...over,
})
const self = (n: number, agent: string) => ({ id: rid(n), agent, depth: 1 })
const lead = { id: 'main', agent: 'lead', depth: 0 }
const fleet = (...recs: ReturnType<typeof rec>[]): string => {
  const dir = mkdtempSync(join(tmp, 'fleet-'))
  for (const r of recs) store.writeRecord(dir, r)
  return dir
}
const inboxTexts = (dir: string, n: number): string[] => store.readInbox(dir, rid(n), 0).items.map((m: { text: string }) => m.text)
const withEnv = (vars: Record<string, string | undefined>, fn: () => void): void => {
  const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]))
  const set = (v: Record<string, string | undefined>): void => { for (const [k, x] of Object.entries(v)) { if (x === undefined) delete process.env[k]; else process.env[k] = x } }
  try { set(vars); fn() } finally { set(saved) }
}

test('send routes by run id, name, parent, lead and all, with the rendered text', () => {
  const dir = fleet(rec(1, 'boss'), rec(2, 'coder', { parentId: rid(1), depth: 2 }), rec(3, 'tester', { parentId: rid(1), depth: 2 }), rec(4, 'old', { state: 'done' }))
  const c = self(2, 'coder')
  assert.deepEqual(route.sendMessage(dir, c, { to: rid(3), kind: 'question', text: 'ready?' }).delivered.map((t: { id: string }) => t.id), [rid(3)])
  assert.equal(inboxTexts(dir, 3)[0], `[team message from coder (${rid(2)}) → you, question]: ready?\nreply with team send`)
  route.sendMessage(dir, c, { to: 'tester', kind: 'info', text: 'by name' })
  assert.equal(inboxTexts(dir, 3).length, 2)
  route.sendMessage(dir, c, { to: 'parent', kind: 'blocker', text: 'stuck' })
  assert.match(inboxTexts(dir, 1)[0]!, /from coder .* blocker\]: stuck/)
  route.sendMessage(dir, self(1, 'boss'), { to: 'parent', kind: 'info', text: 'to main' })
  route.sendMessage(dir, c, { to: 'lead', kind: 'handoff', text: 'done' })
  const mainBox = readFileSync(join(dir, 'main.inbox.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l).text)
  assert.equal(mainBox.length, 2)
  assert.match(mainBox[1], /from coder/)
  const all = route.sendMessage(dir, c, { to: 'all', kind: 'info', text: 'hi all' })
  assert.deepEqual(all.delivered.map((t: { id: string }) => t.id).sort(), [rid(1), rid(3), 'main'], 'all = every other live run plus the lead')
  assert.equal(inboxTexts(dir, 2).length, 0, 'sender excluded from all')
  assert.equal(inboxTexts(dir, 4).length, 0, 'finished run excluded')
  const fromLead = route.sendMessage(dir, lead, { to: 'all', kind: 'info', text: 'plan' })
  assert.equal(fromLead.delivered.length, 3)
})

test('send errors: ambiguity lists ids, unknown, finished, self, parent of lead, invalid input', () => {
  const dir = fleet(rec(1, 'worker'), rec(2, 'worker'), rec(3, 'solo'), rec(4, 'old', { state: 'done' }))
  const err = (s: object, to: string, extra: object = {}) => route.sendMessage(dir, s, { to, kind: 'info', text: 'x', ...extra }).error as string
  const ambiguous = err(self(3, 'solo'), 'worker')
  assert.match(ambiguous, /ambiguous/)
  assert.ok(ambiguous.includes(rid(1)) && ambiguous.includes(rid(2)))
  assert.match(err(self(3, 'solo'), 'nobody'), /no running agent named "nobody"/)
  assert.match(err(self(3, 'solo'), rid(9)), /no run/)
  assert.match(err(self(3, 'solo'), rid(4)), /not running/)
  assert.match(err(self(3, 'solo'), rid(3)), /yourself/)
  assert.match(err(self(3, 'solo'), 'solo'), /no running agent/)
  assert.match(err(lead, 'parent'), /no parent/)
  assert.match(err(lead, 'lead'), /yourself/)
  assert.match(err(self(3, 'solo'), 'lead', { kind: 'shout' }), /kind must be/)
  assert.match(err(self(3, 'solo'), 'lead', { text: ' ' }), /empty/)
  assert.match(err(self(3, 'solo'), 'lead', { text: 'y'.repeat(2001) }), /limit is 2000/)
  assert.equal(route.sendMessage(dir, self(1, 'worker'), { to: 'parent', kind: 'info', text: 'x' }).delivered[0].id, 'main', 'a depth-1 parent is the lead')
  const lonely = fleet(rec(1, 'a'))
  assert.deepEqual(route.sendMessage(lonely, self(1, 'a'), { to: 'all', kind: 'info', text: 'x' }).delivered.map((t: { id: string }) => t.id), ['main'], 'a lone run still reaches the lead')
  assert.match(route.sendMessage(fleet(), lead, { to: 'all', kind: 'info', text: 'x' }).error, /nobody else/)
  const orphan = fleet(rec(5, 'kid', { parentId: rid(8), depth: 2 }))
  assert.match(route.sendMessage(orphan, self(5, 'kid'), { to: 'parent', kind: 'info', text: 'x' }).error, /parent .* not running/)
})

test('budgets: 30 sends per run, 300 per tree', () => {
  const dir = fleet(rec(1, 'a'), rec(2, 'b'))
  for (let i = 0; i < 30; i++) assert.equal(route.sendMessage(dir, self(1, 'a'), { to: 'b', kind: 'info', text: `m${i}` }).ok, true)
  assert.match(route.sendMessage(dir, self(1, 'a'), { to: 'b', kind: 'info', text: 'one more' }).error, /30 per run/)
  assert.equal(route.sendMessage(dir, self(2, 'b'), { to: 'a', kind: 'info', text: 'still fine' }).ok, true)
  const big = fleet(rec(1, 'a'))
  for (let i = 0; i < 300; i++) assert.equal(teamStore.spendSend(big, `fg-${i.toString(16).padStart(8, '0')}`), undefined)
  assert.match(teamStore.spendSend(big, rid(2000)), /300 per tree/)
  assert.match(teamStore.spendSend(undefined as never, 'x') ?? 'no-dir', /./)
})

test('claims are exclusive (O_EXCL), one open claim per agent, files reserved', () => {
  const dir = fleet(rec(1, 'a'), rec(2, 'b'))
  const t1 = tasks.addTask(dir, lead, 'build api', ['src/api']).id
  const t2 = tasks.addTask(dir, lead, 'write docs', ['docs']).id
  const t3 = tasks.addTask(dir, lead, 'api tests', ['src/api/test.ts']).id
  assert.deepEqual([t1, t2, t3], ['t1', 't2', 't3'])
  const a = self(1, 'a')
  const b = self(2, 'b')
  const wins = [tasks.claimTask(dir, a, t1), tasks.claimTask(dir, b, t1)]
  assert.deepEqual(wins.map((r) => r.ok), [true, false])
  assert.match(wins[1].error, /already claimed by a/)
  assert.match(tasks.claimTask(dir, a, t2).error, /already hold t1/)
  assert.match(tasks.claimTask(dir, b, t3).error, /file conflict on src\/api\/test.ts: reserved by t1/)
  assert.equal(tasks.claimTask(dir, b, t2).ok, true)
  assert.match(tasks.doneTask(dir, b, t1, 'x').error, /only the claimer/)
  assert.equal(tasks.doneTask(dir, a, t1, 'built').ok, true)
  assert.match(tasks.doneTask(dir, a, t1, 'again').error, /already done/)
  assert.equal(tasks.claimTask(dir, a, t3).ok, true, 'done task frees its files and the agent')
  assert.match(tasks.claimTask(dir, a, 'bogus').error, /bad task id/)
  assert.match(tasks.claimTask(dir, a, 't99').error, /no task/)
  assert.match(tasks.doneTask(dir, a, 't99', '').error, /no task/)
  assert.match(tasks.doneTask(dir, a, t2, '').error, /held by/)
  const list = tasks.listTasks(dir)
  assert.equal(list.find((t: { id: string }) => t.id === 't1').done.note, 'built')
  assert.equal(tasks.roster(dir).find((r: { id: string }) => r.id === rid(2)).claimed, 't2')
  assert.match(tasks.addTask(dir, a, ' ').error, /empty/)
})

test('two processes claiming the same task: exactly one wins', async () => {
  const { spawn } = await import('node:child_process')
  const dir = fleet(rec(1, 'a'), rec(2, 'b'))
  tasks.addTask(dir, lead, 'one task')
  const script = join(tmp, 'claim.ts')
  writeFileSync(script, `import { claimTask } from '${ext}/subagent/team/tasks.ts'\nconst [dir, id, agent] = process.argv.slice(2)\nconsole.log(claimTask(dir, { id, agent, depth: 1 }, 't1').ok)\n`)
  const run = (id: string, agent: string): Promise<string> => new Promise((resolve) => {
    let out = ''
    const p = spawn(process.execPath, ['--experimental-strip-types', script, dir, id, agent], { stdio: ['ignore', 'pipe', 'ignore'] })
    p.stdout.on('data', (d) => { out += d })
    p.on('close', () => resolve(out.trim()))
  })
  const res = await Promise.all([run(rid(1), 'a'), run(rid(2), 'b')])
  assert.deepEqual(res.sort(), ['false', 'true'])
})

test('board appends and reads from a cursor; validates kind and size', () => {
  const dir = fleet(rec(1, 'a'))
  assert.deepEqual(tasks.readBoard(dir), { entries: [], next: 0 })
  assert.equal(tasks.appendBoard(dir, self(1, 'a'), 'fact', 'api is v2').ok, true)
  tasks.appendBoard(dir, lead, 'fail', 'test x broke')
  const first = tasks.readBoard(dir, 0)
  assert.equal(first.entries.length, 2)
  assert.equal(first.entries[0].agent, 'a')
  tasks.appendBoard(dir, lead, 'done', 'all green')
  const rest = tasks.readBoard(dir, first.next)
  assert.deepEqual(rest.entries.map((e: { text: string }) => e.text), ['all green'])
  assert.equal(tasks.readBoard(dir, Number.NaN).entries.length, 3)
  assert.match(tasks.appendBoard(dir, lead, 'gossip' as never, 'x').error, /board kind/)
  assert.match(tasks.appendBoard(dir, lead, 'fact', '').error, /empty/)
  assert.match(tasks.appendBoard(dir, lead, 'fact', 'z'.repeat(1001)).error, /limit is 1000/)
})

test('feed digest: only edit/write/bash of others, capped at 600, once per 20 s, silent when empty', () => {
  const dir = fleet(rec(1, 'me'), rec(2, 'peer'))
  const call = (n: number, tool: string, text: string) => store.appendTranscript(dir, rid(n), { t: 1, kind: 'tool_call', tool, text })
  call(1, 'edit', 'edit my own edit')
  call(2, 'read', 'read a.ts')
  call(2, 'edit', 'edit src/a.ts')
  call(2, 'bash', 'bash npm test')
  const state = feed.newFeedState()
  const first = feed.digest(dir, rid(1), state, 100_000)
  assert.match(first, /^\[team feed\]/)
  assert.ok(first.includes('peer: edit src/a.ts') && first.includes('peer: bash npm test'))
  assert.ok(!first.includes('my own edit') && !first.includes('read'))
  call(2, 'write', 'write b.ts')
  assert.equal(feed.digest(dir, rid(1), state, 110_000), undefined, 'rate limited')
  assert.match(feed.digest(dir, rid(1), state, 121_000), /peer: write b.ts/)
  assert.equal(feed.digest(dir, rid(1), state, 150_000), undefined, 'nothing new')
  for (let i = 0; i < 40; i++) call(2, 'bash', `bash command number ${i} ${'x'.repeat(60)}`)
  const capped = feed.digest(dir, rid(1), state, 200_000)
  assert.ok(capped.length <= 600, `len ${capped.length}`)
  assert.ok(capped.includes('command number 39'), 'newest kept')
  assert.ok(!capped.includes('command number 0 '), 'oldest dropped')
  const tiny = fleet(rec(1, 'me'), rec(2, 'peer'))
  store.appendTranscript(tiny, rid(2), { t: 1, kind: 'tool_call', tool: 'bash', text: 'x'.repeat(300) })
  assert.ok(feed.digest(tiny, rid(1), feed.newFeedState(), 50_000).length <= 600)
})

test('main inbox: all pending messages go out as one followUp; the offset moves on', () => {
  const dir = fleet(rec(1, 'a'), rec(2, 'b'))
  const sent: { text: string; opts: unknown }[] = []
  const pi = { sendUserMessage: (text: string, opts: unknown) => void sent.push({ text, opts }) }
  assert.equal(teamIndex.pollMainInbox(pi, dir, 0), 0)
  assert.equal(sent.length, 0)
  route.sendMessage(dir, self(1, 'a'), { to: 'lead', kind: 'question', text: 'q1' })
  route.sendMessage(dir, self(2, 'b'), { to: 'lead', kind: 'info', text: 'i2' })
  const next = teamIndex.pollMainInbox(pi, dir, 0)
  assert.equal(sent.length, 1)
  assert.deepEqual(sent[0]!.opts, { deliverAs: 'followUp' })
  assert.ok(sent[0]!.text.includes('q1') && sent[0]!.text.includes('i2'))
  assert.equal(teamIndex.pollMainInbox(pi, dir, next), next)
  assert.equal(sent.length, 1)
  const broken = { sendUserMessage: () => { throw new Error('switching') } }
  route.sendMessage(dir, self(1, 'a'), { to: 'lead', kind: 'info', text: 'q3' })
  assert.ok(teamIndex.pollMainInbox(broken, dir, next) > next)
})

test('feed poll steers once per due digest', () => {
  const dir = fleet(rec(1, 'me'), rec(2, 'peer'))
  store.appendTranscript(dir, rid(2), { t: 1, kind: 'tool_call', tool: 'edit', text: 'f.ts' })
  const sent: unknown[][] = []
  const pi = { sendUserMessage: (...a: unknown[]) => void sent.push(a) }
  const state = feed.newFeedState()
  teamIndex.pollFeed(pi, dir, rid(1), state, 100_000)
  teamIndex.pollFeed(pi, dir, rid(1), state, 100_500)
  assert.equal(sent.length, 1)
  assert.deepEqual(sent[0]![1], { deliverAs: 'steer' })
  store.appendTranscript(dir, rid(2), { t: 2, kind: 'tool_call', tool: 'edit', text: 'g.ts' })
  teamIndex.pollFeed({ sendUserMessage: () => { throw new Error('done') } }, dir, rid(1), state, 130_000)
})

test('tool dispatch through the child identity (env), including roster and board', () => {
  const dir = fleet(rec(1, 'boss'), rec(2, 'coder', { parentId: rid(1), depth: 2 }))
  withEnv({ PI_CODE_SUBAGENT_DEPTH: '2', PI_CODE_FLEET_RUN_ID: rid(2) }, () => {
    assert.equal(teamStore.selfOf(dir).agent, 'coder')
    assert.match(teamIndex.runTeamTool(dir, { action: 'send', to: 'parent', kind: 'info', text: 'hello' }), /sent to boss/)
    assert.match(teamIndex.runTeamTool(dir, { action: 'send', to: 'nobody', kind: 'info', text: 'hello' }), /no running agent/)
    const roster = JSON.parse(teamIndex.runTeamTool(dir, { action: 'roster' }))
    assert.deepEqual(roster.map((r: { agent: string; parent: string }) => [r.agent, r.parent]), [['boss', 'main'], ['coder', rid(1)]])
    assert.equal(teamIndex.runTeamTool(dir, { action: 'board', append: { kind: 'fact', text: 'f' } }), 'board entry added')
    assert.equal(JSON.parse(teamIndex.runTeamTool(dir, { action: 'board', since: 0 })).entries.length, 1)
    assert.equal(teamIndex.runTeamTool(dir, { action: 'tasks', add: { title: 'x', files: ['a'] } }), 'added t1')
    assert.match(teamIndex.runTeamTool(dir, { action: 'tasks', claim: { id: 't1' } }), /claimed t1/)
    assert.match(teamIndex.runTeamTool(dir, { action: 'tasks', claim: { id: 't1' } }), /already hold/)
    assert.equal(teamIndex.runTeamTool(dir, { action: 'tasks', done: { id: 't1', note: 'ok' } }), 't1 done')
    assert.equal(JSON.parse(teamIndex.runTeamTool(dir, { action: 'tasks', list: true }))[0].done.note, 'ok')
  })
  withEnv({ PI_CODE_SUBAGENT_DEPTH: undefined, PI_CODE_SUBAGENT: undefined, PI_CODE_FLEET_RUN_ID: undefined }, () => assert.equal(teamStore.selfOf(dir).id, 'main'))
})

function fakePi() {
  const calls = { tools: [] as { name: string; execute: (...a: unknown[]) => Promise<{ content: { text: string }[] }> }[], commands: new Map<string, { handler: (a: string, c: unknown) => Promise<void> }>(), handlers: new Map<string, (e: unknown) => unknown>(), active: ['read', 'subagent'] }
  const pi = {
    registerTool: (t: never) => void calls.tools.push(t),
    registerCommand: (n: string, o: never) => void calls.commands.set(n, o),
    on: (n: string, h: (e: unknown) => unknown) => void calls.handlers.set(n, h),
    getActiveTools: () => calls.active,
    setActiveTools: (a: string[]) => void (calls.active = a),
    sendUserMessage: () => {},
  }
  return { pi, calls }
}

test('off mode registers no tool, no prompt section; /team on then registers and activates', async () => {
  await withEnvAsync({ PI_CODE_TEAMS: undefined, PI_CODE_SUBAGENT_DEPTH: undefined, PI_CODE_SUBAGENT: undefined }, async () => {
    const { pi, calls } = fakePi()
    teamIndex.registerTeam(pi as never)
    assert.equal(calls.tools.length, 0)
    assert.equal(calls.handlers.get('before_agent_start')!({ systemPrompt: 'S' }), undefined)
    const notes: string[] = []
    const ctx = { ui: { notify: (m: string) => void notes.push(m) } }
    await calls.commands.get('team')!.handler('status', ctx)
    assert.match(notes[0]!, /team mode off; 0 running/)
    await calls.commands.get('team')!.handler('on', ctx)
    assert.equal(process.env.PI_CODE_TEAMS, '1')
    assert.equal(calls.tools.length, 1)
    assert.ok(calls.active.includes('team'))
    const prompt = calls.handlers.get('before_agent_start')!({ systemPrompt: 'S' }) as { systemPrompt: string }
    assert.match(prompt.systemPrompt, /## Team/)
    assert.match((await calls.tools[0]!.execute('id', { action: 'roster' })).content[0]!.text, /no fleet directory/)
    await calls.commands.get('team')!.handler('on', ctx)
    assert.equal(calls.tools.length, 1, 'registered once')
    await calls.commands.get('team')!.handler('off', ctx)
    assert.equal(process.env.PI_CODE_TEAMS, '0')
    assert.ok(!calls.active.includes('team'))
    assert.equal((await calls.tools[0]!.execute('id', { action: 'roster' })).content[0]!.text, 'team mode is off')
    calls.handlers.get('session_shutdown')!({})
    teamIndex.stopTeamTimer()
  })
})

test('PI_CODE_TEAMS=1 registers the tool at load, in a child too, and the child gets no /team command', async () => {
  await withEnvAsync({ PI_CODE_TEAMS: '1', PI_CODE_SUBAGENT_DEPTH: '1' }, async () => {
    const { pi, calls } = fakePi()
    teamIndex.registerTeam(pi as never)
    assert.deepEqual(calls.tools.map((t) => t.name), ['team'])
    assert.equal(calls.commands.size, 0)
    teamIndex.stopTeamTimer()
  })
})

async function withEnvAsync(vars: Record<string, string | undefined>, fn: () => Promise<void>): Promise<void> {
  const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]))
  const set = (v: Record<string, string | undefined>): void => { for (const [k, x] of Object.entries(v)) { if (x === undefined) delete process.env[k]; else process.env[k] = x } }
  try { set(vars); await fn() } finally { set(saved) }
}

test('a tools allowlist keeps the team tool only in team mode (withTeamTool, applied at the run.ts call site and to the background agents in index.ts)', () => {
  const agent = { name: 'r', tools: ['read', 'grep'] }
  withEnv({ PI_CODE_TEAMS: undefined }, () => assert.equal(teamTypes.withTeamTool(agent), agent))
  withEnv({ PI_CODE_TEAMS: '1' }, () => {
    assert.deepEqual(teamTypes.withTeamTool(agent).tools, ['read', 'grep', 'team'])
    assert.deepEqual(agent.tools, ['read', 'grep'], 'input untouched')
    const noList = { name: 'r', tools: undefined }
    assert.equal(teamTypes.withTeamTool(noList), noList, 'no allowlist = all tools')
    assert.equal(teamTypes.withTeamTool({ name: 'r', tools: [] }).tools?.length, 0)
    assert.ok(!child.agentInvocationArgs(agent as never).includes('team'), 'child.ts itself is untouched')
  })
})

test('panel and viewer read the conversation: ✉ counts per recipient, incremental, and a run sees what it sent or received', () => {
  withEnv({ PI_CODE_TEAMS: '1', PI_CODE_SUBAGENT: undefined, PI_CODE_SUBAGENT_DEPTH: undefined }, () => {
    const dir = store.ensureFleetDir()
    assert.ok(dir, 'fleet dir')
    try {
      const msg = (n: number, from: string, to: string, text: string) => ({ id: `m${n}`, t: n, from, fromAgent: from, to, toAgent: to, kind: 'info', text })
      teamStore.logMessage(dir, msg(1, rid(1), rid(2), 'a'))
      teamStore.logMessage(dir, msg(2, rid(3), rid(2), 'b'))
      assert.deepEqual([...ui.unreadCounts()!], [[rid(2), 2]])
      teamStore.logMessage(dir, msg(3, rid(2), 'main', 'c'))
      assert.deepEqual([...ui.unreadCounts()!].sort(), [[rid(2), 2], ['main', 1]], 'only new bytes are read')
      const conv = ui.conversationItems(rid(1), 0)
      assert.deepEqual(conv.items.map((i: { text: string; tool: string }) => [i.tool, i.text]), [['team', `✉ ${rid(1)} → ${rid(2)} [info]: a`]])
      assert.equal(ui.conversationItems(rid(1), conv.next).items.length, 0)
    } finally { store.removeFleetDir() }
  })
  withEnv({ PI_CODE_TEAMS: undefined }, () => {
    assert.equal(ui.unreadCounts(), undefined)
    assert.deepEqual(ui.conversationItems(rid(1), 7), { items: [], next: 7 })
  })
})

test('claim race on overlapping files: both pass the pre-check, the lower task number keeps its claim, the other rolls back', async () => {
  const fsMod = await import('node:fs')
  const { syncBuiltinESMExports } = await import('node:module')
  const dir = fleet(rec(1, 'a'), rec(2, 'b'))
  tasks.addTask(dir, lead, 'api', ['src/api'])
  tasks.addTask(dir, lead, 'api tests', ['src/api/test.ts'])
  const real = fsMod.default.writeFileSync
  // b's pre-check passed; a's claim on t1 lands before b's O_EXCL write on t2.
  fsMod.default.writeFileSync = ((file: string, ...rest: unknown[]) => {
    if (String(file).endsWith('claim-2.json')) {
      fsMod.default.writeFileSync = real
      syncBuiltinESMExports()
      assert.equal(tasks.claimTask(dir, self(1, 'a'), 't1').ok, true)
    }
    return (real as (...a: unknown[]) => void)(file, ...rest)
  }) as typeof real
  syncBuiltinESMExports()
  let res
  try { res = tasks.claimTask(dir, self(2, 'b'), 't2') } finally { fsMod.default.writeFileSync = real; syncBuiltinESMExports() }
  assert.equal(res.ok, false)
  assert.match(res.error, /file conflict on src\/api\/test.ts: reserved by t1/)
  const list = tasks.listTasks(dir)
  assert.equal(list.find((t: { id: string }) => t.id === 't1').claimedBy, rid(1))
  assert.equal(list.find((t: { id: string }) => t.id === 't2').claimedBy, undefined, 'rolled back')
  assert.equal(tasks.claimTask(dir, self(2, 'b'), 't2').ok, false, 'still reserved by t1')
})

// Testes do plano de dados da frota (subagent/fleet/*): node --experimental-strip-types --test ~/.pi/agent/claude-home/patches/pi-code/subagent-panel/fleet.test.ts
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fleetTestEnv } from './setup.ts'

const { tmp, ext } = fleetTestEnv('fleet-test-')
const store = await import(`${ext}/subagent/fleet/store.ts`)
const trackerMod = await import(`${ext}/subagent/fleet/tracker.ts`)
const detach = await import(`${ext}/subagent/fleet/detach.ts`)
const inbox = await import(`${ext}/subagent/fleet/inbox.ts`)
const sourceMod = await import(`${ext}/subagent/fleet/source.ts`)
const registryText = await import(`${ext}/subagent/registry-text.ts`)

const id = (n = 1): string => `fg-${n.toString(16).padStart(8, '0')}`
const tempDir = (): string => mkdtempSync(join(tmp, 'fleet-dir-'))

function withEnv(vars: Record<string, string | undefined>, fn: () => void): void {
  const saved: Record<string, string | undefined> = {}
  for (const k of Object.keys(vars)) saved[k] = process.env[k]
  try {
    for (const [k, v] of Object.entries(vars)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
    fn()
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  }
}

// Depth 0 with a fresh process-wide fleet dir; callers remove it with store.removeFleetDir().
function mainFleet(): string {
  delete process.env.PI_CODE_SUBAGENT_DEPTH
  delete process.env.PI_CODE_SUBAGENT
  return store.ensureFleetDir()
}

const baseRecord = (rid: string, over: Record<string, unknown> = {}) => ({
  v: 1,
  id: rid,
  parentId: null,
  depth: 1,
  agent: 'a',
  task: 't',
  background: false,
  state: 'running',
  startedAt: 1,
  updatedAt: 1,
  turns: 0,
  toolCalls: 0,
  tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, context: 0 },
  cost: 0,
  ownerPid: process.pid,
  ...over,
})

const deadPid = (): number => spawnSync(process.execPath, ['-e', '0']).pid as number

test('id guard: nothing is written or built for an invalid id', () => {
  const dir = tempDir()
  store.writeRecord(dir, baseRecord('../evil'))
  store.appendInbox(dir, '../x', { id: 'a', t: 1, text: 'x' })
  store.appendAck(dir, 'bad', { id: 'a', t: 1, outcome: 'steered' })
  store.appendTranscript(dir, 'nope', { t: 1, kind: 'note', text: 'x' })
  store.requestStop(dir, '../x')
  store.clearStop(dir, '../x')
  assert.deepEqual(readdirSync(dir), [])
  assert.equal(store.stopOrigin(dir, '../x'), undefined)
  assert.equal(store.stopOrigin(undefined, id()), undefined)
  assert.deepEqual(store.readInbox(dir, 'bad', 7), { items: [], next: 7 })
  assert.deepEqual(store.readAcks(dir, 'bad', 7), { items: [], next: 7 })
  assert.deepEqual(store.readTranscript(dir, 'bad', 7), { items: [], next: 7 })
  assert.equal(store.readRecord(dir, 'bad'), undefined)
  assert.equal(store.RUN_ID_RE.test('fg-0123abcd'), true)
  assert.equal(store.RUN_ID_RE.test('fg-0123ABCD'), false)
  rmSync(dir, { recursive: true })
})

test('readJsonl: partial line waits, offsets advance, bad lines skipped, missing file is empty', () => {
  const dir = tempDir()
  const file = join(dir, 'x.jsonl')
  assert.deepEqual(store.readJsonl(file, 0), { items: [], next: 0 })
  writeFileSync(file, '{"a":1}\n{"a":2')
  let r = store.readJsonl(file, 0)
  assert.deepEqual(r.items, [{ a: 1 }])
  assert.equal(r.next, 8)
  assert.deepEqual(store.readJsonl(file, r.next), { items: [], next: 8 })
  writeFileSync(file, '{"a":1}\n{"a":2}\nnot json\n{"a":3}\n')
  r = store.readJsonl(file, 8)
  assert.deepEqual(r.items, [{ a: 2 }, { a: 3 }])
  assert.equal(r.next, readFileSync(file).length)
  assert.deepEqual(store.readJsonl(file, r.next), { items: [], next: r.next })
  // maxBytes caps one read; no newline inside the window consumes nothing
  assert.deepEqual(store.readJsonl(file, 0, 3), { items: [], next: 0 })
  assert.equal(store.readJsonl(file, 0, 8).next, 8)
  rmSync(dir, { recursive: true })
})

test('transcript: capped at 4 MiB with one truncation note, later appends dropped', () => {
  const dir = tempDir()
  const rid = id(2)
  const text = 'x'.repeat(1_000_000)
  for (let i = 0; i < 7; i++) store.appendTranscript(dir, rid, { t: i, kind: 'assistant', text })
  const lines = readFileSync(join(dir, `${rid}.transcript.jsonl`), 'utf8').trim().split('\n')
  assert.equal(lines.length, 5)
  assert.deepEqual(JSON.parse(lines[4]).text, '[transcript truncated at 4 MB]')
  assert.equal(JSON.parse(lines[4]).kind, 'note')
  rmSync(dir, { recursive: true })
})

test('records: orphaned running run maps to failed, bad JSON and foreign files skipped, file untouched', () => {
  const dir = tempDir()
  const dead = deadPid()
  store.writeRecord(dir, baseRecord(id(3), { ownerPid: dead }))
  store.writeRecord(dir, baseRecord(id(4)))
  store.writeRecord(dir, baseRecord(id(5), { state: 'done', ownerPid: dead }))
  writeFileSync(join(dir, 'fg-00000006.json'), '{oops')
  writeFileSync(join(dir, 'fg-00000007.json'), JSON.stringify({ ...baseRecord(id(7)), v: 2 }))
  writeFileSync(join(dir, 'bad.json'), JSON.stringify(baseRecord('bad')))
  writeFileSync(join(dir, 'note.txt'), 'x')
  const byId = Object.fromEntries(store.readRecords(dir).map((r: { id: string }) => [r.id, r]))
  assert.deepEqual(Object.keys(byId).sort(), [id(3), id(4), id(5)])
  assert.equal(byId[id(3)].state, 'failed')
  assert.equal(byId[id(3)].error, 'orphaned')
  assert.equal(byId[id(4)].state, 'running')
  assert.equal(byId[id(5)].state, 'done')
  assert.equal(JSON.parse(readFileSync(join(dir, `${id(3)}.json`), 'utf8')).state, 'running')
  assert.deepEqual(store.readRecords(join(dir, 'missing')), [])
  assert.equal(store.pidAlive(process.pid), true)
  assert.equal(store.pidAlive(dead), false)
  rmSync(dir, { recursive: true })
})

test('currentFleetDir: depth 0 ignores the inherited env; depth >= 1 accepts only dirs directly under the root', () => {
  const inside = join(store.fleetRoot(), '123-abcdef12')
  withEnv({ PI_CODE_SUBAGENT_DEPTH: '1', PI_CODE_FLEET_DIR: inside, PI_CODE_FLEET_RUN_ID: id() }, () => {
    assert.equal(store.currentFleetDir(), inside)
    assert.deepEqual(store.fleetChildEnv(id(9)), { PI_CODE_FLEET_DIR: inside, PI_CODE_FLEET_RUN_ID: id(9) })
    assert.deepEqual(store.fleetChildEnv('bad'), {})
  })
  for (const bad of ['/tmp/elsewhere', 'relative/dir', join(inside, 'nested'), join(store.fleetRoot(), '..', 'x')]) {
    withEnv({ PI_CODE_SUBAGENT_DEPTH: '2', PI_CODE_FLEET_DIR: bad }, () => {
      assert.equal(store.currentFleetDir(), undefined)
      assert.deepEqual(store.fleetChildEnv(id()), {})
    })
  }
  withEnv({ PI_CODE_SUBAGENT_DEPTH: '1', PI_CODE_FLEET_DIR: undefined }, () => assert.equal(store.currentFleetDir(), undefined))
  withEnv({ PI_CODE_SUBAGENT_DEPTH: '0', PI_CODE_FLEET_DIR: inside }, () => assert.notEqual(store.currentFleetDir(), inside))
})

test('ensureFleetDir / sweep / removeFleetDir: one dir per process, orphans swept, own dir kept', () => {
  const dir = mainFleet()
  assert.equal(store.ensureFleetDir(), dir)
  assert.equal(store.currentFleetDir(), dir)
  assert.equal(dir.startsWith(store.fleetRoot()), true)
  const orphan = join(store.fleetRoot(), `${deadPid()}-deadbeef`)
  mkdirSync(orphan)
  writeFileSync(join(orphan, 'f'), 'x')
  const alive = join(store.fleetRoot(), `${process.pid}-cafebabe`)
  mkdirSync(alive)
  store.sweepOrphanFleetDirs()
  assert.equal(existsSync(orphan), false)
  assert.equal(existsSync(alive), true)
  assert.equal(existsSync(dir), true)
  rmSync(alive, { recursive: true })
  store.removeFleetDir()
  assert.equal(existsSync(dir), false)
  assert.equal(store.currentFleetDir(), undefined)
  store.removeFleetDir()
})

const readRec = (dir: string, rid: string) => JSON.parse(readFileSync(join(dir, `${rid}.json`), 'utf8'))
const lineOf = (event: unknown): string => JSON.stringify(event)

test('tracker: scripted event stream fills record and transcript; writes are throttled', (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'] })
  const dir = mainFleet()
  const rid = id(10)
  const tr = trackerMod.startTracking({ id: rid, agent: 'worker', task: '  do\n  the   thing ', model: 'm', background: false })
  assert.ok(tr)
  let rec = readRec(dir, rid)
  assert.equal(rec.task, 'do the thing')
  assert.equal(rec.depth, 1)
  assert.equal(rec.parentId, null)
  assert.equal(rec.state, 'running')
  assert.equal(rec.ownerPid, process.pid)
  tr.setPid(4242)
  tr.onLine(lineOf({ type: 'message_start', message: { role: 'assistant' } }))
  tr.onLine(lineOf({ type: 'message_update', message: { role: 'assistant' } }))
  tr.onLine('not json')
  tr.onLine(lineOf({ type: 'message_end', message: { role: 'user', content: [{ type: 'text', text: 'hello' }, { type: 'text', text: 'world' }] } }))
  tr.onLine(lineOf({ type: 'tool_execution_start', toolName: 'bash', args: { command: 'ls   -la\u001b[31m' } }))
  tr.onLine(lineOf({ type: 'message_start', message: { role: 'assistant' } }))
  assert.equal(readRec(dir, rid).activity, undefined, 'throttled: no write inside 250 ms')
  t.mock.timers.tick(250)
  assert.equal(readRec(dir, rid).activity, 'bash ls -la', 'one trailing write')
  tr.flush()
  rec = readRec(dir, rid)
  assert.equal(rec.activity, 'bash ls -la')
  assert.equal(rec.toolCalls, 1)
  assert.equal(rec.pid, 4242)
  tr.onLine(lineOf({ type: 'tool_execution_end', toolName: 'bash', isError: true, result: { content: [{ type: 'text', text: 'out' }] } }))
  tr.onLine(
    lineOf({
      type: 'message_end',
      message: { role: 'assistant', content: [{ type: 'text', text: 'line1\nfinal   \u0007line  \n\n' }], usage: { input: 10, output: 5, cacheRead: 1, cacheWrite: 2, totalTokens: 18, cost: { total: 0.5 } } },
    }),
  )
  tr.onLine(lineOf({ type: 'message_end', message: { role: 'assistant', content: [], stopReason: 'error', errorMessage: 'boom' } }))
  tr.flush()
  rec = readRec(dir, rid)
  assert.equal(rec.turns, 2)
  assert.deepEqual(rec.tokens, { input: 10, output: 5, cacheRead: 1, cacheWrite: 2, context: 18 })
  assert.equal(rec.cost, 0.5)
  assert.equal(rec.activity, 'final line')
  assert.equal(rec.error, 'boom')
  const { items } = store.readTranscript(dir, rid, 0)
  assert.deepEqual(
    items.map((i: { kind: string }) => i.kind),
    ['user', 'tool_call', 'tool_result', 'assistant'],
  )
  assert.equal(items[0].text, 'hello\nworld')
  assert.equal(items[2].isError, true)
  assert.equal(items[2].text, 'out')
  assert.equal(items[3].text, 'line1\nfinal   \u0007line  \n\n')
  tr.finish({ exitCode: 0 })
  tr.onLine(lineOf({ type: 'tool_execution_start', toolName: 'x', args: {} }))
  assert.equal(readRec(dir, rid).toolCalls, 1, 'ignored after finish')
  store.removeFleetDir()
})

test('tracker: tool preview picks the first known argument, falls back to JSON', () => {
  const dir = mainFleet()
  const rid = id(11)
  const tr = trackerMod.startTracking({ id: rid, agent: 'a', task: 't', background: false })
  tr.onLine(lineOf({ type: 'tool_execution_start', toolName: 'read', args: { path: '/a/b' } }))
  tr.onLine(lineOf({ type: 'tool_execution_start', toolName: 'odd', args: { n: 1 } }))
  tr.onLine(lineOf({ type: 'tool_execution_end', toolName: 'odd', result: {} }))
  const calls = store.readTranscript(dir, rid, 0).items.filter((i: { kind: string }) => i.kind === 'tool_call')
  assert.deepEqual(
    calls.map((c: { text: string }) => c.text),
    ['read /a/b', 'odd {"n":1}'],
  )
  store.removeFleetDir()
})

test('tracker: a resumed run keeps counters, clears the end state and the stop marker', () => {
  const dir = mainFleet()
  const rid = id(12)
  const first = trackerMod.startTracking({ id: rid, agent: 'a', task: 'one', background: true })
  first.onLine(lineOf({ type: 'message_end', message: { role: 'assistant', content: [], usage: { input: 3, output: 4, totalTokens: 7, cost: { total: 1 } } } }))
  store.requestStop(dir, rid)
  first.finish({ exitCode: 1, error: 'x' })
  const ended = readRec(dir, rid)
  assert.equal(ended.state, 'cancelled')
  assert.equal(ended.stoppedBy, 'user')
  const again = trackerMod.startTracking({ id: rid, agent: 'a', task: 'two', background: true })
  const rec = readRec(dir, rid)
  assert.equal(rec.startedAt, ended.startedAt)
  assert.equal(rec.turns, 1)
  assert.equal(rec.cost, 1)
  assert.equal(rec.tokens.input, 3)
  assert.equal(rec.state, 'running')
  assert.equal(rec.endedAt, undefined)
  assert.equal(rec.exitCode, undefined)
  assert.equal(rec.error, undefined)
  assert.equal(rec.stoppedBy, undefined)
  assert.equal(rec.task, 'two')
  assert.equal(store.stopOrigin(dir, rid), undefined)
  assert.equal(store.readTranscript(dir, rid, 0).items.at(-1).text, '— resumed —')
  again.finish({ exitCode: 0 })
  assert.equal(readRec(dir, rid).state, 'done')
  store.removeFleetDir()
})

test('tracker: finish states and idempotence', () => {
  const dir = mainFleet()
  const cases: Array<[Record<string, unknown>, string]> = [
    [{ exitCode: 0 }, 'done'],
    [{}, 'done'],
    [{ exitCode: 2 }, 'failed'],
    [{ exitCode: 0, error: 'e'.repeat(500) }, 'failed'],
    [{ aborted: true, exitCode: 143 }, 'cancelled'],
    [{ cancelled: true }, 'cancelled'],
  ]
  cases.forEach(([opts, state], i) => {
    const rid = id(100 + i)
    const tr = trackerMod.startTracking({ id: rid, agent: 'a', task: 't', background: false })
    tr.finish(opts)
    tr.finish({ exitCode: 9 })
    const rec = readRec(dir, rid)
    assert.equal(rec.state, state, JSON.stringify(opts))
    assert.equal(typeof rec.endedAt, 'number')
    assert.ok((rec.error?.length ?? 0) <= 300)
  })
  assert.equal(trackerMod.startTracking({ id: 'bad', agent: 'a', task: 't', background: false }), undefined)
  store.removeFleetDir()
  assert.equal(trackerMod.startTracking({ id: id(), agent: 'a', task: 't', background: false }), undefined)
})

test('tracker at depth 2 records its parent run id', () => {
  const root = store.fleetRoot()
  const fleetDir = join(root, `${process.pid}-0badf00d`)
  mkdirSync(fleetDir, { recursive: true, mode: 0o700 })
  withEnv({ PI_CODE_SUBAGENT_DEPTH: '1', PI_CODE_FLEET_DIR: fleetDir, PI_CODE_FLEET_RUN_ID: id(20) }, () => {
    const tr = trackerMod.startTracking({ id: id(21), agent: 'a', task: 't', background: false })
    tr.finish({})
    const rec = readRec(fleetDir, id(21))
    assert.equal(rec.parentId, id(20))
    assert.equal(rec.depth, 2)
  })
  rmSync(fleetDir, { recursive: true })
})

test('source: send outcomes, list and transcript', () => {
  const dir = mainFleet()
  const resumed: string[] = []
  const deps = { resume: (rid: string) => (resumed.push(rid), true) }
  const src = sourceMod.getFleetSource(deps)
  assert.equal(sourceMod.fleetSourceForUi(), src)
  assert.equal(sourceMod.getFleetSource(deps), src, 'memoised')
  store.writeRecord(dir, baseRecord(id(30)))
  store.writeRecord(dir, baseRecord(id(31), { state: 'done', background: true }))
  store.writeRecord(dir, baseRecord(id(32), { state: 'done', background: false }))
  store.writeRecord(dir, baseRecord(id(33), { state: 'done', background: true, depth: 2 }))
  assert.equal(src.send(id(99), 'hi'), 'unknown')
  assert.equal(src.send(id(30), '   '), 'not-running')
  assert.equal(src.send(id(30), 'hi there'), 'queued')
  const queued = store.readInbox(dir, id(30), 0).items
  assert.equal(queued.length, 1)
  assert.equal(queued[0].text, 'hi there')
  assert.equal(queued[0].id.length, 8)
  assert.equal(src.send(id(31), 'more'), 'resumed')
  assert.deepEqual(resumed, [id(31)])
  assert.equal(src.send(id(32), 'more'), 'not-running')
  assert.equal(src.send(id(33), 'more'), 'not-running')
  assert.equal(src.list().length, 4)
  store.appendTranscript(dir, id(30), { t: 1, kind: 'note', text: 'n' })
  assert.equal(src.readTranscript(id(30), 0).items.length, 1)
  assert.equal(src.stop(id(99)), 'unknown')
  assert.equal(src.stop(id(31)), 'not-running')
  store.removeFleetDir()
  assert.deepEqual(src.list(), [])
  assert.deepEqual(src.readTranscript(id(30), 5), { items: [], next: 5 })
  assert.equal(src.send(id(30), 'x'), 'unknown')
  assert.equal(src.stop(id(30)), 'unknown')
  assert.deepEqual(sourceMod.fleetStatusLines(), [])
})

function sleeper(env: Record<string, string | undefined>) {
  const child = spawn('sleep', ['30'], { detached: true, stdio: 'ignore', env })
  child.unref()
  const exited = new Promise<boolean>((resolve) => {
    child.on('exit', () => resolve(true))
    setTimeout(() => resolve(false), 2000).unref()
  })
  return { pid: child.pid as number, exited }
}

test('a resume the user sent from the panel says so in the completion notice (fails before: the model saw a run it never resumed)', () => {
  const run = { id: 'bg-0000abcd', agent: 'Explore', state: 'done', turns: 2, output: 'resumed-ok' }
  const plain = registryText.backgroundCompletionText(run)
  assert.doesNotMatch(plain, /agent panel/)
  const fromPanel = registryText.backgroundCompletionText(run, 'echo resumed-ok')
  assert.match(fromPanel, /^Report only, no action needed: the user messaged this run from the agent panel/)
  assert.match(fromPanel, /Do not resume or repeat it\. The user's message to the run was: "echo resumed-ok"\n\n/)
  assert.equal(fromPanel.endsWith(plain), true)
  assert.match(registryText.backgroundCompletionText(run, 'x'.repeat(900)), /"x{500}…"/)
})

test('stop origin: {cancel} is the agent, the panel is the user (fails before: every stop was recorded as the user)', async () => {
  const dir = mainFleet()
  const plain = { ...process.env }
  delete plain.PI_CODE_FLEET_RUN_ID
  const own = sleeper({ ...plain, PI_CODE_FLEET_RUN_ID: id(50) })
  store.writeRecord(dir, baseRecord(id(50), { pid: own.pid }))
  assert.equal(sourceMod.stopOwnRun(id(50)), 'stopping')
  assert.equal(store.stopOrigin(dir, id(50)), 'agent')
  assert.equal(await own.exited, true)
  const t = trackerMod.startTracking({ id: id(51), agent: 'a', task: 't', background: false })
  store.requestStop(dir, id(51), 'agent')
  t.finish({ exitCode: 143 })
  assert.equal(readRec(dir, id(51)).stoppedBy, 'agent')
  assert.equal(readRec(dir, id(51)).state, 'cancelled')
  assert.equal(trackerMod.stopNote('agent'), trackerMod.AGENT_STOP_NOTE)
  assert.equal(trackerMod.stopNote('user'), trackerMod.USER_STOP_NOTE)
  assert.notEqual(trackerMod.AGENT_STOP_NOTE, trackerMod.USER_STOP_NOTE)
  // panel stop (default) and an empty marker from an older build both read as the user
  store.requestStop(dir, id(52))
  assert.equal(store.stopOrigin(dir, id(52)), 'user')
  writeFileSync(join(dir, `${id(53)}.stop`), '')
  assert.equal(store.stopOrigin(dir, id(53)), 'user')
  assert.equal(store.stopOrigin(dir, id(54)), undefined)
  assert.equal(store.stopOrigin(undefined, id(54)), undefined)
  store.removeFleetDir()
})

test('stopRun: refused when /proc environ lacks the run id; stopping kills the group when present', async () => {
  const dir = mainFleet()
  const plain = { ...process.env }
  delete plain.PI_CODE_FLEET_RUN_ID
  const stranger = sleeper(plain)
  store.writeRecord(dir, baseRecord(id(40), { pid: stranger.pid }))
  assert.equal(sourceMod.stopRun(id(40)), 'refused')
  assert.equal(store.stopOrigin(dir, id(40)), undefined)
  store.writeRecord(dir, baseRecord(id(41)))
  assert.equal(sourceMod.stopRun(id(41)), 'refused', 'no pid')
  process.kill(-stranger.pid, 'SIGKILL')
  await stranger.exited

  const own = sleeper({ ...plain, PI_CODE_FLEET_RUN_ID: id(42) })
  store.writeRecord(dir, baseRecord(id(42), { pid: own.pid }))
  assert.equal(sourceMod.stopRun(id(42)), 'stopping')
  assert.equal(store.stopOrigin(dir, id(42)), 'user')
  assert.equal(await own.exited, true, 'process group died within 2 s')

  const gone = sleeper({ ...plain, PI_CODE_FLEET_RUN_ID: id(43) })
  process.kill(-gone.pid, 'SIGKILL')
  await gone.exited
  store.writeRecord(dir, baseRecord(id(43), { pid: gone.pid }))
  assert.equal(sourceMod.stopRun(id(43)), 'refused', 'reaped pid no longer has the env')
  store.removeFleetDir()
})

test('stopOwnForegroundRuns stops only this process foreground children', async () => {
  const dir = mainFleet()
  const plain = { ...process.env }
  const mine = sleeper({ ...plain, PI_CODE_FLEET_RUN_ID: id(50) })
  const other = sleeper({ ...plain, PI_CODE_FLEET_RUN_ID: id(51) })
  store.writeRecord(dir, baseRecord(id(50), { pid: mine.pid }))
  store.writeRecord(dir, baseRecord(id(51), { pid: other.pid, ownerPid: process.pid + 1 }))
  sourceMod.stopOwnForegroundRuns()
  assert.equal(await mine.exited, true)
  assert.equal(store.stopOrigin(dir, id(51)), undefined)
  process.kill(-other.pid, 'SIGKILL')
  store.removeFleetDir()
  sourceMod.stopOwnForegroundRuns()
})

test('detach: detachAll resolves detached, flips trackers to background, finishForeground clears', async () => {
  const dir = mainFleet()
  assert.equal(detach.hasForeground(), false)
  assert.equal(detach.currentForegroundCall(), undefined)
  let release: () => void = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const { call, result } = detach.runDetachable(async () => {
    assert.equal(detach.currentForegroundCall() !== undefined, true)
    await Promise.resolve()
    trackerMod.startTracking({ id: id(60), agent: 'a', task: 't', background: false })
    await gate
    return 'done'
  })
  await new Promise((r) => setImmediate(r))
  assert.equal(detach.hasForeground(), true)
  assert.equal(call.isDetached, false)
  assert.equal(readRec(dir, id(60)).background, false)
  assert.equal(call.trackers.size, 1)
  assert.equal(detach.detachAll(), 1)
  await call.detached
  assert.equal(call.isDetached, true)
  assert.equal(readRec(dir, id(60)).background, true)
  assert.equal(detach.hasForeground(), false)
  assert.equal(detach.detachAll(), 0)
  release()
  assert.equal(await result, 'done')
  detach.finishForeground(call)

  const second = detach.runDetachable(async () => 1)
  assert.equal(detach.hasForeground(), true)
  await second.result
  detach.finishForeground(second.call)
  assert.equal(detach.hasForeground(), false)
  // a tracker started inside an already detached call is background from the start
  const third = detach.runDetachable(async () => {
    await new Promise((r) => setImmediate(r))
    trackerMod.startTracking({ id: id(61), agent: 'a', task: 't', background: false })
  })
  detach.detachAll()
  await third.result
  assert.equal(readRec(dir, id(61)).background, true)
  store.removeFleetDir()
})

// A call that waits for its signal, settled from outside: the shape of a foreground subagent call.
function pendingWork() {
  let resolve: (v: string) => void = () => {}
  let seen: AbortSignal | undefined
  const work = (signal: AbortSignal) => {
    seen = signal
    return new Promise<string>((res, rej) => {
      resolve = res
      if (signal.aborted) return rej(new Error('aborted')) // an abort listener added late never fires
      signal.addEventListener('abort', () => rej(new Error('aborted')), { once: true })
    })
  }
  return { work, resolve: (v: string) => resolve(v), signal: () => seen }
}

test('raceDetach: an aborted call cannot be detached (fails before: Ctrl+B after Esc revived it and woke the model)', async () => {
  const turn = new AbortController()
  const w = pendingWork()
  const out = detach.raceDetach(turn.signal, w.work)
  assert.equal(detach.hasForeground(), true)
  turn.abort()
  assert.equal(detach.hasForeground(), false, 'aborted call left the detachable set')
  assert.equal(detach.detachAll(), 0)
  assert.equal(w.signal()?.aborted, true)
  await assert.rejects(out, /aborted/)

  // already aborted when the call starts: the work sees an aborted signal, nothing to detach
  const pre = new AbortController()
  pre.abort()
  const w2 = pendingWork()
  const out2 = detach.raceDetach(pre.signal, w2.work)
  assert.equal(w2.signal()?.aborted, true)
  assert.equal(detach.detachAll(), 0)
  await assert.rejects(out2, /aborted/)
})

test('raceDetach: done, detach-then-abort keeps running, rejection propagates', async () => {
  const turn = new AbortController()
  const w = pendingWork()
  const out = detach.raceDetach(turn.signal, w.work)
  w.resolve('r1')
  assert.deepEqual(await out, { done: 'r1' })
  assert.equal(detach.hasForeground(), false)

  // detached: the turn's later abort (Esc on the next turn) does not reach the moved call
  const w2 = pendingWork()
  const out2 = detach.raceDetach(turn.signal, w2.work)
  assert.equal(detach.detachAll(), 1)
  const moved = await out2
  assert.equal('detached' in moved, true)
  turn.abort()
  assert.equal(w2.signal()?.aborted, false)
  w2.resolve('late')
  assert.equal(await (moved as { detached: Promise<string> }).detached, 'late')
  assert.equal(detach.hasForeground(), false)

  // no outer signal, work fails before any detach: the error reaches the caller
  const out3 = detach.raceDetach(undefined, async () => {
    throw new Error('boom')
  })
  await assert.rejects(out3, /boom/)
  assert.equal(detach.hasForeground(), false)
})

test('fleetStatusLines lists detached depth-1 running runs outside the registry', () => {
  const dir = mainFleet()
  store.writeRecord(dir, baseRecord(id(70), { background: true, agent: 'ghost' }))
  store.writeRecord(dir, baseRecord(id(71), { background: false }))
  store.writeRecord(dir, baseRecord(id(72), { background: true, depth: 2 }))
  store.writeRecord(dir, baseRecord(id(73), { background: true, state: 'done' }))
  assert.deepEqual(sourceMod.fleetStatusLines(), [`${id(70)} (ghost) running — moved to the background (Ctrl+B)`])
  assert.match(registryText.statusWithFleet(), /Moved to the background:\n.*ghost/)
  assert.equal(registryText.cancelResultText(id(73)), `Run ${id(73)} already finished; nothing to cancel.`)
  assert.match(registryText.cancelResultText(id(99)), /^Unknown background run/)
  store.removeFleetDir()
  assert.doesNotMatch(registryText.statusWithFleet(), /Moved to the background/)
})

test('inbox: pollInboxOnce steers each message and acks; a throwing pi acks too-late', () => {
  const dir = tempDir()
  const rid = id(80)
  store.appendInbox(dir, rid, { id: 'm1', t: 1, text: 'first' })
  store.appendInbox(dir, rid, { id: 'm2', t: 2, text: 'second' })
  const sent: Array<[string, unknown]> = []
  const pi = { sendUserMessage: (text: string, opts: unknown) => void sent.push([text, opts]) }
  let off = inbox.pollInboxOnce(pi, dir, rid, 0)
  assert.deepEqual(sent, [
    ['first', { deliverAs: 'steer' }],
    ['second', { deliverAs: 'steer' }],
  ])
  assert.deepEqual(
    store.readAcks(dir, rid, 0).items.map((a: { id: string; outcome: string }) => [a.id, a.outcome]),
    [
      ['m1', 'steered'],
      ['m2', 'steered'],
    ],
  )
  store.appendInbox(dir, rid, { id: 'm3', t: 3, text: 'late' })
  off = inbox.pollInboxOnce({ sendUserMessage: () => { throw new Error('gone') } }, dir, rid, off)
  assert.equal(store.readAcks(dir, rid, 0).items.at(-1).outcome, 'too-late')
  assert.equal(inbox.pollInboxOnce(pi, dir, rid, off), off)
  rmSync(dir, { recursive: true })
})

test('inbox watcher: only depth >= 1 with a valid env; polls every second; stop and restart clear the handle', (t) => {
  const root = store.fleetRoot()
  mkdirSync(root, { recursive: true, mode: 0o700 })
  const fleetDir = join(root, `${process.pid}-0badf00d`)
  mkdirSync(fleetDir, { recursive: true })
  const sent: string[] = []
  const pi = { sendUserMessage: (text: string) => void sent.push(text) }
  t.mock.timers.enable({ apis: ['setInterval'] })
  const slotKey = Symbol.for('pi-code.fleet.inbox')
  const slot = globalThis as Record<symbol, unknown>
  withEnv({ PI_CODE_SUBAGENT_DEPTH: '0', PI_CODE_FLEET_RUN_ID: id(90) }, () => {
    inbox.startInboxWatcher(pi)
    assert.equal(slot[slotKey], undefined)
  })
  withEnv({ PI_CODE_SUBAGENT_DEPTH: '1', PI_CODE_FLEET_DIR: fleetDir, PI_CODE_FLEET_RUN_ID: 'bad' }, () => {
    inbox.startInboxWatcher(pi)
    assert.equal(slot[slotKey], undefined)
  })
  withEnv({ PI_CODE_SUBAGENT_DEPTH: '1', PI_CODE_FLEET_DIR: fleetDir, PI_CODE_FLEET_RUN_ID: id(90) }, () => {
    inbox.startInboxWatcher(pi)
    const first = slot[slotKey]
    assert.ok(first)
    store.appendInbox(fleetDir, id(90), { id: 'a', t: 1, text: 'hello' })
    t.mock.timers.tick(1000)
    assert.deepEqual(sent, ['hello'])
    t.mock.timers.tick(1000)
    assert.deepEqual(sent, ['hello'], 'offset advanced, no redelivery')
    inbox.startInboxWatcher(pi)
    assert.notEqual(slot[slotKey], first)
    inbox.stopInboxWatcher()
    assert.equal(slot[slotKey], undefined)
  })
  rmSync(fleetDir, { recursive: true })
})

test('onChange: debounced listener fed by the poll; last unsubscribe stops it; works before the dir exists', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] })
  let calls = 0
  const src = sourceMod.createFleetSource({ resume: () => false })
  const offNoDir = src.onChange(() => calls++)
  t.mock.timers.tick(1000)
  t.mock.timers.tick(100)
  assert.equal(calls, 1)
  const dir = mainFleet()
  const off2 = src.onChange(() => calls++)
  t.mock.timers.tick(1000)
  t.mock.timers.tick(100)
  assert.equal(calls, 3, 'both listeners called once through one debounce')
  off2()
  offNoDir()
  t.mock.timers.tick(5000)
  assert.equal(calls, 3)
  offNoDir()
  store.removeFleetDir()
  assert.equal(existsSync(dir), false)
})

// ---- fix lane: regressions F1-F6 ----

test('F1 finishExitCode: a maxTurns cap (SIGTERM, exit 143) finishes as done (fails before: helper missing, run.ts passed 143 -> failed)', () => {
  const dir = mainFleet()
  assert.equal(trackerMod.finishExitCode(true, 143), 0)
  assert.equal(trackerMod.finishExitCode(false, 143), 143)
  assert.equal(trackerMod.finishExitCode(false, null), undefined)
  const tr = trackerMod.startTracking({ id: id(200), agent: 'a', task: 't', background: false })
  tr.finish({ exitCode: trackerMod.finishExitCode(true, 143) })
  assert.equal(readRec(dir, id(200)).state, 'done')
  store.removeFleetDir()
})

test('F2 resume truncates the inbox and acks (fails before: the old steer is still readable from offset 0)', () => {
  const dir = mainFleet()
  const rid = id(210)
  trackerMod.startTracking({ id: rid, agent: 'a', task: 't', background: true }).finish({ exitCode: 0 })
  store.appendInbox(dir, rid, { id: 'old', t: 1, text: 'stale steer' })
  store.appendAck(dir, rid, { id: 'old', t: 1, outcome: 'steered' })
  assert.equal(store.readInbox(dir, rid, 0).items.length, 1)
  trackerMod.startTracking({ id: rid, agent: 'a', task: 't2', background: true })
  assert.deepEqual(store.readInbox(dir, rid, 0), { items: [], next: 0 })
  assert.deepEqual(store.readAcks(dir, rid, 0), { items: [], next: 0 })
  store.removeFleetDir()
})

test('F3 detach state survives a second module instance (fails before: instance B has its own empty inFlight)', () => {
  // Two instances in a separate process with coverage off: loaded here, the coverage report shows only the last instance.
  const url = JSON.stringify(`${ext}/subagent/fleet/detach.ts`)
  const script = `
    const a = await import(${url} + '?a')
    const b = await import(${url} + '?b')
    if (a === b) throw new Error('same instance')
    const { call, result } = a.runDetachable(async () => 'x')
    const before = b.hasForeground()
    const moved = b.detachAll()
    await call.detached
    await result
    a.finishForeground(call)
    console.log(JSON.stringify({ before, moved, detached: call.isDetached, after: b.hasForeground() }))`
  const env = { ...process.env }
  env.NODE_V8_COVERAGE = '' // an own empty key: child_process re-adds a deleted one to every child
  const out = spawnSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', script], { encoding: 'utf8', env })
  assert.equal(out.status, 0, out.stderr)
  assert.deepEqual(JSON.parse(out.stdout.trim().split('\n').pop() ?? ''), { before: true, moved: 1, detached: true, after: false })
})

test('F4 foreign-owner runs: hidden from fleetStatusLines, stopOwnRun refuses (fails before: listed; stopOwnRun missing)', () => {
  const dir = mainFleet()
  store.writeRecord(dir, baseRecord(id(220), { background: true, agent: 'mine' }))
  store.writeRecord(dir, baseRecord(id(221), { background: true, agent: 'theirs', ownerPid: process.ppid }))
  assert.deepEqual(sourceMod.fleetStatusLines(), [`${id(220)} (mine) running — moved to the background (Ctrl+B)`])
  assert.equal(sourceMod.stopOwnRun(id(221)), 'not-owned')
  assert.equal(store.stopOrigin(dir, id(221)), undefined)
  assert.equal(sourceMod.stopOwnRun(id(229)), 'unknown')
  assert.match(registryText.cancelResultText(id(221)), /^Unknown background run/)
  assert.equal(store.stopOrigin(dir, id(221)), undefined)
  store.removeFleetDir()
})

test('F5 sigkillIfStillOwned: kills only a still-running, still-owned run (fails before: export missing)', async () => {
  const dir = mainFleet()
  const plain = { ...process.env }
  const live = sleeper({ ...plain, PI_CODE_FLEET_RUN_ID: id(230) })
  store.writeRecord(dir, baseRecord(id(230), { pid: live.pid }))
  store.writeRecord(dir, baseRecord(id(230), { pid: live.pid, state: 'done' }))
  assert.equal(sourceMod.sigkillIfStillOwned(dir, id(230), live.pid), false, 'record no longer running')
  process.kill(-live.pid, 0) // still alive
  const strangerEnv = { ...plain }
  delete strangerEnv.PI_CODE_FLEET_RUN_ID
  store.writeRecord(dir, baseRecord(id(230), { pid: live.pid }))
  assert.equal(sourceMod.sigkillIfStillOwned(dir, id(231), live.pid), false, 'pid env lacks that run id')
  assert.equal(sourceMod.sigkillIfStillOwned(dir, id(230), live.pid), true)
  assert.equal(await live.exited, true)
  store.removeFleetDir()
})

test('F6 fleet root safety (fails before: checkRootSafe missing, ensureFleetDir trusted any root)', () => {
  const base = tempDir()
  const safe = join(base, 'safe')
  mkdirSync(safe, { mode: 0o700 })
  chmodSync(safe, 0o700)
  const open = join(base, 'open')
  mkdirSync(open)
  chmodSync(open, 0o755)
  const link = join(base, 'link')
  symlinkSync(safe, link)
  assert.equal(store.checkRootSafe(safe), true)
  assert.equal(store.checkRootSafe(open), false)
  assert.equal(store.checkRootSafe(link), false)
  assert.equal(store.checkRootSafe(join(base, 'missing')), false)

  store.removeFleetDir()
  const tmpBase = tempDir()
  withEnv({ TMPDIR: tmpBase }, () => {
    const root = store.fleetRoot()
    mkdirSync(root)
    chmodSync(root, 0o755)
    assert.equal(store.ensureFleetDir(), undefined)
    // A root we do not trust is never swept (fails before: the sweep ran without the own-dir guard).
    const planted = join(root, `${deadPid()}-deadbeef`)
    mkdirSync(planted)
    store.sweepOrphanFleetDirs()
    assert.equal(existsSync(planted), true)
    rmSync(planted, { recursive: true })
    chmodSync(root, 0o700)
    const dir = store.ensureFleetDir()
    assert.equal(typeof dir, 'string')
    store.removeFleetDir()
  })
  rmSync(base, { recursive: true })
  rmSync(tmpBase, { recursive: true })
})

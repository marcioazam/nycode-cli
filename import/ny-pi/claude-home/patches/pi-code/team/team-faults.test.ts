// Testes de falha e do relógio do modo time (cobertura das linhas do patch): node --experimental-strip-types --test ~/.pi/agent/claude-home/patches/pi-code/team/team-faults.test.ts
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { mock, test } from 'node:test'
import { fleetTestEnv } from '../subagent-panel/setup.ts'

const { tmp, ext } = fleetTestEnv('team-faults-')
// palette.ts lê o config do HUD ao primeiro uso: um HOME vazio faz o catch valer.
const realHome = process.env.HOME
process.env.HOME = mkdtempSync(join(tmp, 'home-'))
const palette = await import(`${ext}/subagent/fleet-ui/palette.ts`)
process.env.HOME = realHome
const store = await import(`${ext}/subagent/fleet/store.ts`)
const teamStore = await import(`${ext}/subagent/team/store.ts`)
const tasks = await import(`${ext}/subagent/team/tasks.ts`)
const route = await import(`${ext}/subagent/team/route.ts`)
const teamIndex = await import(`${ext}/subagent/team/index.ts`)

const withEnv = async (vars: Record<string, string | undefined>, fn: () => void | Promise<void>): Promise<void> => {
  const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]))
  const set = (v: Record<string, string | undefined>): void => { for (const [k, x] of Object.entries(v)) { if (x === undefined) delete process.env[k]; else process.env[k] = x } }
  try { set(vars); await fn() } finally { set(saved) }
}
const rid = (n: number): string => `fg-${n.toString(16).padStart(8, '0')}`
const rec = (n: number, agent: string) => ({
  v: 1, id: rid(n), parentId: null, depth: 1, agent, task: 't', background: false, state: 'running',
  startedAt: n, updatedAt: n, turns: 0, toolCalls: 0, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, context: 0 }, cost: 0, ownerPid: process.pid,
})
const fakePi = () => {
  const sent: { text: string; deliverAs?: string }[] = []
  const tools: { execute: (...a: unknown[]) => Promise<{ content: { text: string }[] }> }[] = []
  const pi = {
    registerTool: (t: never) => void tools.push(t), registerCommand: () => {}, on: () => {},
    getActiveTools: () => [], setActiveTools: () => {},
    sendUserMessage: (text: string, o?: { deliverAs?: string }) => void sent.push({ text, deliverAs: o?.deliverAs }),
  }
  return { pi, sent, tools }
}

test('hudColors falls back to no colors when the HUD config is missing', () => {
  assert.deepEqual(palette.hudColors(), {})
})

test('teamDir is undefined when the team directory cannot be created', () => {
  const file = join(tmp, 'not-a-dir')
  writeFileSync(file, 'x')
  assert.equal(teamStore.teamDir(file), undefined)
  assert.equal(tasks.addTask(file, { id: 'main', agent: 'lead', depth: 0 }, 'x').ok, false)
})

test('addTask stops at 9999 tasks', () => {
  const dir = mkdtempSync(join(tmp, 'fleet-'))
  const td = teamStore.teamDir(dir)!
  for (let n = 1; n < 10_000; n++) writeFileSync(join(td, `task-${n}.json`), JSON.stringify({ id: `t${n}`, title: 'x', files: [], by: 'main', t: 1 }))
  assert.match(tasks.addTask(dir, { id: 'main', agent: 'lead', depth: 0 }, 'one more').error, /too many tasks/)
})

test('the tool runs against a real fleet dir; the 1 s tick delivers the lead inbox and the peer feed', async () => {
  mock.timers.enable({ apis: ['setInterval'] })
  try {
    await withEnv({ PI_CODE_TEAMS: '1', PI_CODE_SUBAGENT_DEPTH: undefined, PI_CODE_SUBAGENT: undefined, PI_CODE_FLEET_DIR: undefined, PI_CODE_FLEET_RUN_ID: undefined }, async () => {
      const dir = store.ensureFleetDir()!
      store.writeRecord(dir, rec(1, 'a'))
      store.writeRecord(dir, rec(2, 'b'))
      const { pi, sent, tools } = fakePi()
      teamIndex.registerTeam(pi as never)
      assert.equal((await tools[0]!.execute('id', { action: 'tasks', add: { title: 'x' } })).content[0]!.text, 'added t1')

      route.sendMessage(dir, { id: rid(1), agent: 'a', depth: 1 }, { to: 'lead', kind: 'info', text: 'ping lead' })
      mock.timers.tick(1000)
      assert.equal(sent.length, 1)
      assert.equal(sent[0]!.deliverAs, 'followUp')
      assert.match(sent[0]!.text, /ping lead/)

      await withEnv({ PI_CODE_SUBAGENT_DEPTH: '1', PI_CODE_FLEET_DIR: dir, PI_CODE_FLEET_RUN_ID: rid(1) }, () => {
        store.appendTranscript(dir, rid(2), { t: 1, kind: 'tool_call', tool: 'edit', text: 'edit src/a.ts' })
        mock.timers.tick(1000)
      })
      assert.equal(sent.length, 2)
      assert.equal(sent[1]!.deliverAs, 'steer')
      assert.match(sent[1]!.text, /b: edit src\/a.ts/)

      teamIndex.stopTeamTimer()
      mock.timers.tick(5000)
      assert.equal(sent.length, 2, 'stopped timer is silent')
      store.removeFleetDir()
    })
  } finally {
    teamIndex.stopTeamTimer()
    mock.timers.reset()
  }
})

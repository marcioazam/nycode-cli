/**
 * Agent team entry (local patch, team.patch): the `team` tool, the /team command, the
 * lead's inbox and the peer feed. Everything is inert unless PI_CODE_TEAMS=1 (or /team on):
 * no tool, no prompt section, no timer. Contract: types.ts.
 */
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { type Static, Type } from 'typebox'
import { addPromptSection } from '../../internal/prompt-options.ts'
import { stringEnum } from '../../internal/string-enum.ts'
import { currentFleetDir, readJsonl } from '../fleet/store.ts'
import { subagentDepth } from '../nesting/index.ts'
import { digest, type FeedState, newFeedState } from './feed.ts'
import { sendMessage } from './route.ts'
import { mainInboxFile, selfOf } from './store.ts'
import { addTask, appendBoard, claimTask, doneTask, listTasks, readBoard, roster } from './tasks.ts'
import { KINDS, BOARD_KINDS, teamEnabled, type Result } from './types.ts'

const TICK_MS = 1000
const SLOT = Symbol.for('pi-code.team.state')

interface Slot {
  timer?: ReturnType<typeof setInterval>
  mainOffset: number
  feed: FeedState
}
const slot = (): Slot => {
  const holder = globalThis as Record<symbol, Slot | undefined>
  return (holder[SLOT] ??= { mainOffset: 0, feed: newFeedState() })
}

interface Sink {
  sendUserMessage(text: string, options?: { deliverAs?: 'steer' | 'followUp' }): unknown
}

/** The lead's inbox: every pending message in ONE followUp, so a batch costs one main turn. Returns the next offset. */
export function pollMainInbox(pi: Sink, fleetDir: string, from: number): number {
  const { items, next } = readJsonl<{ text: string }>(mainInboxFile(fleetDir), from)
  if (items.length > 0) {
    try {
      pi.sendUserMessage(items.map((m) => m.text).join('\n\n'), { deliverAs: 'followUp' })
    } catch {
      /* the session is switching: the batch is lost like an unacked steer */
    }
  }
  return next
}

/** A member's peer feed: one steer when the digest is due and not empty. */
export function pollFeed(pi: Sink, fleetDir: string, selfId: string, state: FeedState, now: number): void {
  const text = digest(fleetDir, selfId, state, now)
  if (!text) return
  try {
    pi.sendUserMessage(text, { deliverAs: 'steer' })
  } catch {
    /* run is finishing */
  }
}

function tick(pi: Sink): void {
  const dir = currentFleetDir()
  if (!teamEnabled() || !dir) return
  const s = slot()
  if (subagentDepth() === 0) s.mainOffset = pollMainInbox(pi, dir, s.mainOffset)
  else pollFeed(pi, dir, selfOf(dir).id, s.feed, Date.now())
}

export function stopTeamTimer(): void {
  const s = slot()
  if (s.timer) clearInterval(s.timer)
  s.timer = undefined
}

function startTeamTimer(pi: Sink): void {
  stopTeamTimer()
  if (!teamEnabled()) return
  const timer = setInterval(() => tick(pi), TICK_MS)
  timer.unref()
  slot().timer = timer
}

const Params = Type.Object({
  action: stringEnum(['send', 'roster', 'board', 'tasks'] as const, { description: 'send a message, list the roster, use the board, or use the task queue' }),
  to: Type.Optional(Type.String({ description: 'send: run id, agent name (unique in the tree), parent, lead or all' })),
  kind: Type.Optional(stringEnum(KINDS, { description: 'send: message kind' })),
  text: Type.Optional(Type.String({ description: 'send: message, at most 2000 chars' })),
  append: Type.Optional(Type.Object({ kind: stringEnum(BOARD_KINDS), text: Type.String({ description: 'at most 1000 chars' }) }, { description: 'board: add an entry' })),
  since: Type.Optional(Type.Number({ description: 'board: entries after this cursor (the `next` of the last read)' })),
  add: Type.Optional(Type.Object({ title: Type.String(), files: Type.Optional(Type.Array(Type.String())) }, { description: 'tasks: add a task' })),
  claim: Type.Optional(Type.Object({ id: Type.String() }, { description: 'tasks: claim a task exclusively (one open claim per agent)' })),
  done: Type.Optional(Type.Object({ id: Type.String(), note: Type.Optional(Type.String()) }, { description: 'tasks: finish your claimed task' })),
  list: Type.Optional(Type.Boolean({ description: 'tasks: list tasks' })),
})
type Args = Static<typeof Params>

const reply = (text: string) => ({ content: [{ type: 'text' as const, text }], details: {} })
const show = (r: Result<Record<string, unknown>>, ok: (r: Record<string, unknown>) => string): string => (r.ok ? ok(r) : r.error)

/** Runs one tool call against the fleet dir; pure of pi so the tests drive it directly. */
export function runTeamTool(dir: string, args: Args): string {
  const self = selfOf(dir)
  switch (args.action) {
    case 'send': {
      const r = sendMessage(dir, self, { to: args.to ?? '', kind: args.kind as never, text: args.text ?? '' })
      return r.ok ? `sent to ${r.delivered.map((t) => `${t.agent} (${t.id})`).join(', ')}` : r.error
    }
    case 'roster':
      return JSON.stringify(roster(dir))
    case 'board': {
      if (args.append) return show(appendBoard(dir, self, args.append.kind, args.append.text), () => 'board entry added')
      return JSON.stringify(readBoard(dir, args.since))
    }
    default: {
      if (args.add) return show(addTask(dir, self, args.add.title, args.add.files), (r) => `added ${String(r.id)}`)
      if (args.claim) return show(claimTask(dir, self, args.claim.id), (r) => `claimed ${args.claim?.id}; files reserved: ${JSON.stringify((r.task as { files: string[] }).files)}`)
      if (args.done) return show(doneTask(dir, self, args.done.id, args.done.note ?? ''), () => `${args.done?.id} done`)
      return JSON.stringify(listTasks(dir))
    }
  }
}

const GUIDE = 'Team mode is on: other agents of this tree are running. Use the `team` tool (send, roster, board, tasks) for short typed messages, shared facts and exclusive task claims; replies reach the recipient at its next turn. Keep messages short; claim a task before editing its files.'

export function registerTeam(pi: ExtensionAPI): void {
  let registered = false
  const registerTool = (): void => {
    if (registered) return
    registered = true
    pi.registerTool({
      name: 'team',
      label: 'Team',
      description: 'Talk to the other agents of this run tree: send short typed messages (to a run id, agent name, parent, lead or all), read the roster, append to or read the shared board, and add, claim or finish tasks with exclusive claims.',
      parameters: Params,
      async execute(_id, params) {
        if (!teamEnabled()) return reply('team mode is off')
        const dir = currentFleetDir()
        if (!dir) return reply('team: no fleet directory (team mode needs PI_CODE_TEAMS=1 in the main session)')
        return reply(runTeamTool(dir, params))
      },
    })
  }
  const setTool = (on: boolean): void => {
    const active = pi.getActiveTools?.() ?? []
    if (on && !active.includes('team')) pi.setActiveTools?.([...active, 'team'])
    if (!on && active.includes('team')) pi.setActiveTools?.(active.filter((n) => n !== 'team'))
  }

  if (teamEnabled()) {
    registerTool()
    startTeamTimer(pi)
  }

  pi.on('before_agent_start', (event) => {
    if (!teamEnabled() || !pi.getActiveTools().includes('team')) return
    if (addPromptSection(event, 'team', GUIDE)) return
    return { systemPrompt: `${event.systemPrompt}\n\n## Team\n\n${GUIDE}` }
  })
  pi.on('session_shutdown', () => stopTeamTimer())

  if (subagentDepth() > 0) return
  pi.registerCommand('team', {
    description: 'Agent team mode: /team on|off|status',
    handler: async (args, ctx) => /* NOSONAR typescript:S7503 - handler type is Promise<void> */ {
      const word = args.trim().toLowerCase()
      if (word === 'on' || word === 'off') {
        if (word === 'on') {
          process.env.PI_CODE_TEAMS = '1'
          registerTool()
          setTool(true)
          startTeamTimer(pi)
        } else {
          process.env.PI_CODE_TEAMS = '0'
          stopTeamTimer()
          setTool(false)
        }
        ctx.ui.notify(`team mode ${word}${word === 'on' ? ' (agents started from now on join it)' : ''}`, 'info')
        return
      }
      const dir = currentFleetDir()
      const live = dir ? roster(dir).filter((r) => r.state === 'running').length : 0
      ctx.ui.notify(`team mode ${teamEnabled() ? 'on' : 'off'}; ${live} running member${live === 1 ? '' : 's'}`, 'info')
    },
  })
}

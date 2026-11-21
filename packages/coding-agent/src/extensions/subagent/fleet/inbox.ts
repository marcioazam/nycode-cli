/**
 * Child side of the parent's messages: a subagent process polls its own inbox file and
 * steers each message into its running turn. Only depth >= 1 with a valid fleet env.
 * Acks: `steered` when queued, `consumed` at the first turn_start after it (the message
 * reached the model), `too-late` for what the agent never got to (final drain).
 */
import { subagentDepth } from '../nesting/index.ts'
import { appendAck, currentFleetDir, readInbox, validRunId } from './store.ts'
import { FLEET_ENV } from './types.ts'

const SLOT = Symbol.for('pi-code.fleet.inbox')
const POLL_MS = 1000

export interface InboxTarget {
  sendUserMessage(text: string, options?: { deliverAs?: 'steer' | 'followUp' }): unknown
  on?(event: 'turn_start' | 'agent_settled' | 'session_shutdown', handler: () => void): unknown
}

/** The running watcher's run, and the steered messages no turn has started for yet. */
let active: { dir: string; id: string; offset: number } | undefined
const pending = new Set<string>()
const hooked = new WeakSet<object>()

/** One poll: deliver every complete new message, ack each; returns the next offset. */
export function pollInboxOnce(nycode: InboxTarget, dir: string, id: string, from: number): number {
  const { items, next } = readInbox(dir, id, from)
  for (const msg of items) {
    let outcome: 'steered' | 'too-late' = 'steered'
    // Before the call: an idle agent may start its turn inside sendUserMessage.
    pending.add(msg.id)
    try {
      nycode.sendUserMessage(msg.text, { deliverAs: 'steer' })
    } catch {
      outcome = 'too-late'
      pending.delete(msg.id)
    }
    appendAck(dir, id, { id: msg.id, t: Date.now(), outcome })
  }
  return next
}

function settlePending(dir: string, id: string, outcome: 'consumed' | 'too-late'): void {
  for (const msgId of pending) appendAck(dir, id, { id: msgId, t: Date.now(), outcome })
  pending.clear()
}

/** The agent is done or going away: what it never turned into a turn, and what arrived after the last poll, is too late. */
function drainInbox(): void {
  if (!active) return
  const { dir, id } = active
  settlePending(dir, id, 'too-late')
  const { items, next } = readInbox(dir, id, active.offset)
  for (const msg of items) appendAck(dir, id, { id: msg.id, t: Date.now(), outcome: 'too-late' })
  active.offset = next
}

function hook(nycode: InboxTarget): void {
  if (hooked.has(nycode)) return
  hooked.add(nycode)
  nycode.on?.('turn_start', () => {
    if (active) settlePending(active.dir, active.id, 'consumed')
  })
  nycode.on?.('agent_settled', drainInbox)
  nycode.on?.('session_shutdown', drainInbox)
}

export function stopInboxWatcher(): void {
  const holder = globalThis as Record<symbol, unknown>
  const handle = holder[SLOT] as ReturnType<typeof setInterval> | undefined
  if (handle) clearInterval(handle)
  holder[SLOT] = undefined
}

export function startInboxWatcher(nycode: InboxTarget): void {
  stopInboxWatcher()
  active = undefined
  pending.clear()
  const dir = currentFleetDir()
  const id = process.env[FLEET_ENV.runId]
  if (subagentDepth() < 1 || !dir || !validRunId(id)) return
  const watch = { dir, id, offset: 0 }
  active = watch
  hook(nycode)
  const handle = setInterval(() => {
    watch.offset = pollInboxOnce(nycode, dir, id, watch.offset)
  }, POLL_MS)
  handle.unref()
  ;(globalThis as Record<symbol, unknown>)[SLOT] = handle
}

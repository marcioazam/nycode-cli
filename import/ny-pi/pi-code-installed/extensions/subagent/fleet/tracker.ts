/**
 * Per-run tracker: turns a child's JSON event stream into the fleet's RunRecord and
 * transcript. One tracker per spawned child, owned by the spawner. Record writes are
 * throttled (<= 1 per 250 ms); message_update deltas are ignored so there is no
 * per-token I/O.
 */
import { AsyncLocalStorage } from 'node:async_hooks'
import { subagentDepth } from '../nesting/index.ts'
import { currentForegroundCall } from './detach.ts'
import { appendTranscript, clearStop, currentFleetDir, readRecord, resetInbox, stopOrigin, validRunId, writeRecord } from './store.ts'
import { FLEET_ENV, type RunRecord, type StopOrigin, type TranscriptItem } from './types.ts'

export const USER_STOP_NOTE = 'Stopped by the user from the agent panel.'
export const AGENT_STOP_NOTE = 'Cancelled by its parent agent (subagent cancel).'
export const stopNote = (by: StopOrigin): string => (by === 'agent' ? AGENT_STOP_NOTE : USER_STOP_NOTE)

const WRITE_INTERVAL_MS = 250
const ACTIVITY_MAX = 120
// CSI sequences first: matched by the control-char class alone, ESC would go and leave `[31m` behind.
const CONTROL_RE = /\u001b\[[0-9;?]*[ -/]*[@-~]|[\u0000-\u001f\u007f]/g

/** The `subagent` tool call in flight: execute() runs inside it, so every lane it starts (fg, bg, chain, parallel) records the call id. */
export const toolCallScope = new AsyncLocalStorage<string>()

let currentPlanStep: number | undefined
/** Fed by the `pi-code:plan-state` listener; undefined = no plan running. */
export function setPlanStep(step: number | undefined): void {
  currentPlanStep = step
}
/** `toolCallId` and `planStep` of the call that is starting a lane now; absent fields are omitted. */
export function laneCorrelation(): { toolCallId?: string; planStep?: number } {
  const toolCallId = toolCallScope.getStore()
  return { ...(toolCallId ? { toolCallId } : {}), ...(currentPlanStep === undefined ? {} : { planStep: currentPlanStep }) }
}
/** How a lane ended, from its record (the stop callback of a background run is outside the call's scope): the extra fields of the `stop` event. */
export function laneOutcome(id: string): { toolCallId?: string; planStep?: number; state?: string; exitCode?: number; partial?: true } {
  const dir = currentFleetDir()
  const rec = dir ? readRecord(dir, id) : undefined
  return rec ? { ...(rec.toolCallId ? { toolCallId: rec.toolCallId } : {}), ...(rec.planStep === undefined ? {} : { planStep: rec.planStep }), state: rec.state, ...(rec.exitCode === undefined ? {} : { exitCode: rec.exitCode }), ...(rec.partial ? { partial: true as const } : {}) } : {}
}

export interface FinishOptions {
  exitCode?: number
  error?: string
  aborted?: boolean
  cancelled?: boolean
  /** Cut at maxTurns: the record gets `partial` (state stays `done`). */
  partial?: boolean
}

/** A maxTurns cap ends with our own SIGTERM (exit 143): that is a clean finish, as run.ts resolves it. */
export const finishExitCode = (partial: boolean, code: number | null): number | undefined => (partial ? 0 : (code ?? undefined))

export interface RunTracker {
  setPid(pid: number | undefined): void
  onLine(line: string): void
  markBackground(): void
  finish(o: FinishOptions): void
  flush(): void
}

export interface TrackOptions {
  id: string
  agent: string
  task: string
  model?: string
  effort?: string
  background: boolean
  /** First activity line, before the child has said anything (the lane exists from the moment it is queued). */
  activity?: string
}

type Json = Record<string, any>

const LEVELS = new Set(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])
const META_MAX = 120

/** The model and thinking level the child is launched with, read from its argv (`--model id[:level]`,
 * `--thinking level`); absent fields are unknown, never defaulted. */
export function configuredRuntime(args: readonly string[]): { model?: string; effort?: string } {
  const out: { model?: string; effort?: string } = {}
  const value = (flag: string): string | undefined => {
    const i = args.indexOf(flag)
    return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined
  }
  const model = value('--model')
  if (model) {
    const colon = model.lastIndexOf(':')
    if (colon > 0 && LEVELS.has(model.slice(colon + 1))) {
      out.model = model.slice(0, colon)
      out.effort = model.slice(colon + 1)
    } else out.model = model
  }
  const thinking = value('--thinking')
  if (out.effort === undefined && thinking && LEVELS.has(thinking)) out.effort = thinking
  return out
}

const cleanMeta = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.replace(CONTROL_RE, ' ').replace(/ +/g, ' ').trim().slice(0, META_MAX) || undefined : undefined)

const collapse = (text: string): string => text.replace(/\s+/g, ' ').trim()
const cleanActivity = (text: string): string => text.replace(CONTROL_RE, ' ').replace(/ +/g, ' ').trim().slice(0, ACTIVITY_MAX)

function textOf(content: unknown, join: string): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((b: Json) => b?.type === 'text' && typeof b.text === 'string')
    .map((b: Json) => b.text)
    .join(join)
}

function argPreview(args: unknown): string {
  const a = (args ?? {}) as Json
  for (const key of ['command', 'path', 'file_path', 'pattern', 'query', 'url', 'agent', 'task']) {
    if (typeof a[key] === 'string') return collapse(a[key])
  }
  return collapse(JSON.stringify(args) ?? '')
}

function parentRunId(): string | null {
  if (subagentDepth() < 1) return null
  const id = process.env[FLEET_ENV.runId]
  return validRunId(id) ? id : null
}

function freshRecord(o: TrackOptions, background: boolean): RunRecord {
  const now = Date.now()
  return {
    v: 1,
    id: o.id,
    parentId: parentRunId(),
    depth: subagentDepth() + 1,
    agent: o.agent,
    task: collapse(o.task).slice(0, 300),
    ...(o.model ? { model: o.model } : {}),
    ...(o.effort ? { effort: o.effort } : {}),
    ...(o.activity ? { activity: o.activity } : {}),
    ...laneCorrelation(),
    background,
    state: 'running',
    startedAt: now,
    updatedAt: now,
    turns: 0,
    toolCalls: 0,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, context: 0 },
    cost: 0,
    ownerPid: process.pid,
  }
}

export function startTracking(o: TrackOptions): RunTracker | undefined {
  const dir = currentFleetDir()
  if (!dir || !validRunId(o.id)) return undefined
  const call = currentForegroundCall()
  const prior = readRecord(dir, o.id)
  const rec = freshRecord(o, o.background || (call?.isDetached ?? false))
  if (prior) {
    Object.assign(rec, { startedAt: prior.startedAt, turns: prior.turns, toolCalls: prior.toolCalls, tokens: prior.tokens, cost: prior.cost })
    clearStop(dir, o.id)
    resetInbox(dir, o.id)
    appendTranscript(dir, o.id, { t: Date.now(), kind: 'note', text: '— resumed —' })
  }
  const tracker = new Tracker(dir, rec)
  call?.trackers.add(tracker)
  tracker.flush(true)
  return tracker
}

class Tracker implements RunTracker {
  private inFlight = 0
  private finished = false
  private dirty = false
  private lastWrite = 0
  private timer: ReturnType<typeof setTimeout> | undefined

  private readonly dir: string
  private readonly rec: RunRecord

  constructor(dir: string, rec: RunRecord) {
    this.dir = dir
    this.rec = rec
  }

  setPid(pid: number | undefined): void {
    this.rec.pid = pid
    this.schedule()
  }

  markBackground(): void {
    this.rec.background = true
    this.write()
  }

  onLine(line: string): void {
    let ev: Json
    try {
      ev = JSON.parse(line)
    } catch {
      return
    }
    if (!ev || typeof ev !== 'object' || this.finished) return
    switch (ev.type) {
      case 'message_start':
        if (ev.message?.role === 'assistant') this.observeRuntime(ev.message)
        if (ev.message?.role === 'assistant' && this.inFlight === 0) this.setActivity('thinking…')
        break
      case 'thinking_level_changed':
        this.observeEffort(ev.level)
        break
      case 'message_end':
        this.onMessageEnd(ev.message ?? {})
        break
      case 'tool_execution_start':
        this.onToolStart(ev)
        break
      case 'tool_execution_end':
        this.inFlight = Math.max(0, this.inFlight - 1)
        this.note({ kind: 'tool_result', tool: ev.toolName, isError: Boolean(ev.isError), text: textOf(ev.result?.content, '\n').slice(0, 2000) })
        break
      default:
        return
    }
    this.schedule()
  }

  finish(o: FinishOptions): void {
    if (this.finished) return
    this.finished = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    const by = stopOrigin(this.dir, this.rec.id)
    const stopped = by !== undefined
    if (by) this.rec.stoppedBy = by
    this.rec.state = stopped || o.cancelled || o.aborted ? 'cancelled' : (o.exitCode ?? 0) === 0 && !o.error ? 'done' : 'failed'
    this.rec.endedAt = Date.now()
    this.rec.exitCode = o.exitCode
    if (o.partial) this.rec.partial = true
    if (o.error) this.rec.error = o.error.slice(0, 300)
    this.write()
  }

  flush(force = false): void {
    if (this.dirty || force) this.write()
  }

  private onMessageEnd(msg: Json): void {
    if (msg.role === 'user') {
      this.note({ kind: 'user', text: textOf(msg.content, '\n').slice(0, 4000) })
      return
    }
    if (msg.role !== 'assistant') return
    this.observeRuntime(msg)
    this.rec.turns++
    const u = msg.usage
    if (u && typeof u === 'object') {
      const t = this.rec.tokens
      t.input += Number(u.input) || 0
      t.output += Number(u.output) || 0
      t.cacheRead += Number(u.cacheRead) || 0
      t.cacheWrite += Number(u.cacheWrite) || 0
      if (typeof u.totalTokens === 'number') t.context = u.totalTokens
      if (typeof u.cost?.total === 'number') this.rec.cost += u.cost.total
    }
    const text = textOf(msg.content, '\n')
    if (text.trim()) {
      this.note({ kind: 'assistant', text: text.slice(0, 20000) })
      const last = text.split('\n').reverse().find((l) => l.trim())
      if (last && this.inFlight === 0) this.setActivity(last)
    }
    if (msg.stopReason === 'error' && msg.errorMessage) this.rec.error = String(msg.errorMessage).slice(0, 300)
  }

  /** The physical provider/model/level of an assistant message replace what the argv configured. */
  private observeRuntime(msg: Json): void {
    const model = cleanMeta(msg.model)
    if (model) {
      this.rec.model = model
      this.rec.modelSeen = true
      const provider = cleanMeta(msg.provider)
      if (provider) this.rec.provider = provider
      else delete this.rec.provider
    }
    this.observeEffort(msg.thinkingLevel)
  }

  private observeEffort(level: unknown): void {
    if (typeof level !== 'string' || !/^[a-z]{1,16}$/.test(level)) return
    this.rec.effort = level
    this.rec.effortSeen = true
  }

  private onToolStart(ev: Json): void {
    this.rec.toolCalls++
    this.inFlight++
    const preview = collapse(`${ev.toolName} ${argPreview(ev.args)}`)
    this.note({ kind: 'tool_call', tool: ev.toolName, text: preview.slice(0, 300) })
    this.setActivity(preview.slice(0, 120))
  }

  private setActivity(text: string): void {
    this.rec.activity = cleanActivity(text)
  }

  private note(item: Omit<TranscriptItem, 't'>): void {
    appendTranscript(this.dir, this.rec.id, { t: Date.now(), ...item })
  }

  private schedule(): void {
    if (this.finished) return
    this.dirty = true
    const wait = this.lastWrite + WRITE_INTERVAL_MS - Date.now()
    if (wait <= 0) {
      this.write()
      return
    }
    if (this.timer) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      this.write()
    }, wait)
    this.timer.unref()
  }

  private write(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    this.dirty = false
    this.lastWrite = Date.now()
    this.rec.updatedAt = this.lastWrite
    writeRecord(this.dir, this.rec)
  }
}

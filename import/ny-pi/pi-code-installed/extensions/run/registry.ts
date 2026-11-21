/**
 * Run section registry (local patch): one list for the shells the `run` tool starts, the ones detected from the
 * bash tool (nohup / trailing `&`) and the background subagents (read from subagent/background.ts, never copied:
 * the state stays there). Pure bookkeeping, no UI and no process control. In memory only: a new session starts empty
 * (live shells keep running, detached, and are not listed again). Record: docs/pi-run-section-2026-11-13.md.
 */
import { allBackgroundRuns, backgroundRun, type BackgroundRun } from '../subagent/background.ts'
import { fleetSourceForUi } from '../subagent/fleet/source.ts'
import type { RunRecord as FleetRecord } from '../subagent/fleet/types.ts'

export type RunKind = 'shell' | 'agent'
/** Stored states; `new-output` and `silent` are derived from them by `displayState`. */
export type BaseState = 'running' | 'done' | 'failed' | 'stopped'
export type RunState = BaseState | 'new-output' | 'silent'

export const MAX_LIVE = 8
export const TAIL_LINES = 1000
/** Finished runs stay listed this long (or until `x`). */
export const KEEP_MS = 30 * 60_000
/** A running run with no output for this long reads as silent. */
export const SILENT_MS = 5 * 60_000

export interface RunRecord {
  id: string
  kind: RunKind
  name: string
  command: string
  cwd: string
  pid?: number
  pgid?: number
  startedAt: number
  endedAt?: number
  /** Unknown for detected shells (the exit of a process that is not our child is not observable). */
  exitCode?: number
  signal?: string
  state: BaseState
  /** The agent waits for it: a finish message starts a turn (shells), a mark only (agents). */
  awaited: boolean
  logPath?: string
  /** Last TAIL_LINES lines, complete lines only. */
  tail: string[]
  /** Subagent cost in dollars when known. */
  cost?: number
  turns?: number
  /** Agent cut at its maxTurns limit: state `done`, output incomplete. */
  capped?: true
  /** Found in a bash command, not started by the tool: it is not our child and has no process group of its own. */
  detected?: boolean
  /** `r` can restart it with `bash -lc command`. */
  repeatable?: boolean
  outputSeq: number
  seenSeq: number
  lastOutputAt: number
  stopRequested?: boolean
  /** `wait` calls in flight: they deliver the result, so the finish message is skipped. */
  waiters: number
  /** Internal: byte offset read from the log, partial last line, utf-8 decoder. */
  offset?: number
  partial?: string
  decoder?: { write(b: Buffer): string; end(): string }
}

type Listener = () => void

export class RunRegistry {
  now: () => number = Date.now
  private readonly shells = new Map<string, RunRecord>()
  /** Only for background runs that have no fleet record (no fleet dir): the first time they were observed. */
  private readonly agentSeen = new Map<string, { startedAt: number; endedAt?: number }>()
  private fleetCache: { at: number; rows: FleetRecord[] } | undefined
  private readonly dismissed = new Set<string>()
  private readonly awaitedAgents = new Set<string>()
  private readonly changeListeners = new Set<Listener>()
  private readonly finishListeners = new Set<(r: RunRecord) => void>()
  private seq = 0

  onChange(fn: Listener): () => void {
    this.changeListeners.add(fn)
    return () => void this.changeListeners.delete(fn)
  }

  onFinish(fn: (r: RunRecord) => void): () => void {
    this.finishListeners.add(fn)
    return () => void this.finishListeners.delete(fn)
  }

  emit(): void {
    for (const fn of [...this.changeListeners]) fn()
  }

  newId(): string {
    this.seq += 1
    return `r${(this.now() % 1_000_000).toString(36)}${this.seq}`
  }

  liveShells(): RunRecord[] {
    return [...this.shells.values()].filter((r) => r.state === 'running')
  }

  /** Adds a shell; throws a clear error at the live limit. */
  add(init: Pick<RunRecord, 'name' | 'command' | 'cwd'> & Partial<RunRecord>): RunRecord {
    if (this.liveShells().length >= MAX_LIVE) {
      throw new Error(`limite de ${MAX_LIVE} runs vivos atingido: pare um (run stop) ou espere um terminar antes de iniciar outro`)
    }
    const now = this.now()
    const rec: RunRecord = {
      kind: 'shell',
      state: 'running',
      awaited: false,
      tail: [],
      outputSeq: 0,
      seenSeq: 0,
      waiters: 0,
      startedAt: now,
      lastOutputAt: now,
      ...init,
      id: init.id ?? this.newId(),
    }
    this.shells.set(rec.id, rec)
    this.emit()
    return rec
  }

  /** Appends decoded text: complete lines go to the ring buffer, the unfinished one waits for its newline. */
  push(rec: RunRecord, text: string): void {
    if (!text) return
    const parts = ((rec.partial ?? '') + text).split('\n')
    rec.partial = parts.pop() ?? ''
    if (rec.partial.length > 8192) {
      parts.push(rec.partial)
      rec.partial = ''
    }
    if (parts.length > 0) {
      rec.tail.push(...parts)
      if (rec.tail.length > TAIL_LINES) rec.tail.splice(0, rec.tail.length - TAIL_LINES)
    }
    rec.outputSeq += 1
    rec.lastOutputAt = this.now()
    this.emit()
  }

  /** Flushes the unfinished line (the process ended without a newline). */
  flush(rec: RunRecord): void {
    if (rec.partial) {
      rec.tail.push(rec.partial)
      rec.partial = ''
      if (rec.tail.length > TAIL_LINES) rec.tail.splice(0, rec.tail.length - TAIL_LINES)
    }
  }

  finish(rec: RunRecord, result: { exitCode?: number; signal?: string }): void {
    if (rec.state !== 'running') return
    this.flush(rec)
    rec.endedAt = this.now()
    rec.exitCode = result.exitCode
    rec.signal = result.signal
    if (rec.stopRequested) rec.state = 'stopped'
    else if (result.exitCode === undefined && !result.signal) rec.state = 'done'
    else rec.state = result.exitCode === 0 ? 'done' : 'failed'
    this.emit()
    for (const fn of [...this.finishListeners]) fn(rec)
  }

  /** Every run, live first (by start) then finished (by end); agents come from background.ts; finished ones past KEEP_MS go. */
  snapshot(): RunRecord[] {
    const now = this.now()
    for (const [id, r] of this.shells) if (r.endedAt !== undefined && now - r.endedAt > KEEP_MS) this.shells.delete(id)
    const all = [...this.shells.values(), ...this.agents(now)]
    const live = all.filter((r) => r.state === 'running').sort((a, b) => a.startedAt - b.startedAt)
    const done = all.filter((r) => r.state !== 'running').sort((a, b) => (a.endedAt ?? 0) - (b.endedAt ?? 0))
    return [...live, ...done]
  }

  get(id: string): RunRecord | undefined {
    return this.shells.get(id) ?? this.agents(this.now()).find((r) => r.id === id)
  }

  /** The fleet changed on disk: the next read goes to the files (the section calls this from the source's onChange). */
  fleetChanged(): void {
    this.fleetCache = undefined
  }

  /** Depth-1 lanes of the fleet (fg and bg, the single source of agent state), read at most once a second between changes. */
  private fleetLanes(now: number): FleetRecord[] {
    if (this.fleetCache && now - this.fleetCache.at < 1000) return this.fleetCache.rows
    let rows: FleetRecord[] = []
    try {
      rows = fleetSourceForUi().list().filter((r) => r.depth === 1)
    } catch {
      // the fleet source exists only after session_start at depth 0
    }
    this.fleetCache = { at: now, rows }
    return rows
  }

  private agents(now: number): RunRecord[] {
    const out: RunRecord[] = []
    const lanes = this.fleetLanes(now)
    const inFleet = new Set(lanes.map((r) => r.id))
    for (const f of lanes) {
      if (this.dismissed.has(f.id)) continue
      if (f.state !== 'running' && now - (f.endedAt ?? f.updatedAt) > KEEP_MS) continue
      out.push(agentRecord(f, backgroundRun(f.id), this.awaitedAgents.has(f.id)))
    }
    // No fleet record (no fleet dir): the registry's own run, timed from when it was first seen.
    for (const b of allBackgroundRuns()) {
      if (inFleet.has(b.id) || this.dismissed.has(b.id)) continue
      const seen = this.agentSeen.get(b.id) ?? { startedAt: now }
      this.agentSeen.set(b.id, seen)
      const live = b.state === 'running' || b.live === true
      if (!live && seen.endedAt === undefined) seen.endedAt = now
      if (seen.endedAt !== undefined && now - seen.endedAt > KEEP_MS) continue
      out.push(agentRecordFromRegistry(b, seen, this.awaitedAgents.has(b.id)))
    }
    return out
  }

  /** `x`: drops finished runs (agent ones are only hidden; background.ts keeps them for resume). */
  clearFinished(): number {
    let n = 0
    for (const [id, r] of this.shells) if (r.state !== 'running') (this.shells.delete(id), n++)
    for (const r of this.agents(this.now())) if (r.state !== 'running') (this.dismissed.add(r.id), n++)
    if (n > 0) this.emit()
    return n
  }

  setAwaited(rec: RunRecord, value: boolean): void {
    if (rec.kind === 'agent') value ? this.awaitedAgents.add(rec.id) : this.awaitedAgents.delete(rec.id)
    else rec.awaited = value
    this.emit()
  }

  /** New session: nothing carries over (live shells keep running detached and are not listed again). */
  resetSession(): void {
    this.shells.clear()
    for (const b of allBackgroundRuns()) this.dismissed.add(b.id)
    for (const f of this.fleetLanes(this.now())) this.dismissed.add(f.id)
    this.awaitedAgents.clear()
    this.emit()
  }

  /** Resolves with the run once it is no longer running, or with the running one at the timeout/abort. */
  waitFor(id: string, timeoutMs: number, signal?: AbortSignal): Promise<RunRecord | undefined> {
    const rec = this.get(id)
    if (!rec) return Promise.resolve(undefined)
    if (rec.kind === 'shell') rec.waiters += 1
    const deadline = this.now() + timeoutMs
    return new Promise((resolve) => {
      const done = (): void => {
        clearInterval(timer)
        signal?.removeEventListener('abort', done)
        if (rec.kind === 'shell') rec.waiters -= 1
        resolve(this.get(id))
      }
      const timer = setInterval(() => {
        const cur = this.get(id)
        if (!cur || cur.state !== 'running' || this.now() >= deadline) done()
      }, 100)
      signal?.addEventListener('abort', done)
      if (signal?.aborted) done()
    })
  }
}

/** Display state: running splits into new output (unread) and silent (no output for SILENT_MS). */
export function displayState(r: RunRecord, now: number): RunState {
  if (r.state !== 'running' || r.kind === 'agent') return r.state // agents expose no output stream
  if (r.outputSeq > r.seenSeq) return 'new-output'
  return now - r.lastOutputAt > SILENT_MS ? 'silent' : 'running'
}

const lastLines = (text: string | undefined): string[] => (text ? text.split('\n').slice(-TAIL_LINES) : [])

function agentRecordFromRegistry(b: BackgroundRun, seen: { startedAt: number; endedAt?: number }, awaited: boolean): RunRecord {
  const live = b.state === 'running' || b.live === true
  const state: BaseState = live && b.state === 'running' ? 'running' : b.state === 'cancelled' ? 'stopped' : b.state === 'failed' ? 'failed' : b.state === 'done' ? 'done' : 'running'
  const task = b.task.split('\n')[0] ?? ''
  return {
    id: b.id,
    kind: 'agent',
    name: `${b.agent} · ${task}`,
    command: task,
    cwd: b.spawn.cwd,
    startedAt: seen.startedAt,
    endedAt: seen.endedAt,
    exitCode: b.exitCode,
    state,
    awaited,
    tail: lastLines(b.output ?? b.stderr),
    turns: b.turns,
    outputSeq: 0,
    seenSeq: 0,
    lastOutputAt: seen.startedAt,
    waiters: 0,
  }
}

/** A fleet lane (start, end, state, turns, cost: the lane's own record) joined with the registry run that has the tail and the cwd. */
function agentRecord(f: FleetRecord, b: BackgroundRun | undefined, awaited: boolean): RunRecord {
  const task = f.task.split('\n')[0] ?? ''
  const state: BaseState = f.state === 'cancelled' ? 'stopped' : f.state
  return {
    id: f.id,
    kind: 'agent',
    name: `${f.agent} · ${task}`,
    command: task,
    cwd: b?.spawn.cwd ?? '',
    startedAt: f.startedAt,
    endedAt: f.endedAt,
    exitCode: f.exitCode,
    state,
    awaited,
    tail: lastLines(b?.output ?? b?.stderr ?? f.activity),
    turns: f.turns,
    cost: f.cost,
    ...(f.partial ? { capped: true as const } : {}),
    outputSeq: 0,
    seenSeq: 0,
    lastOutputAt: f.startedAt,
    waiters: 0,
  }
}

let shared: RunRegistry | undefined
const KEY = Symbol.for('pi-code.run.registry')
/** One registry per process: /reload evaluates the modules again, the live shells must stay listed. */
export function sharedRegistry(): RunRegistry {
  const g = globalThis as unknown as Record<symbol, RunRegistry | undefined>
  shared = g[KEY] ??= new RunRegistry()
  return shared
}

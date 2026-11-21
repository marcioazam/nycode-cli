/**
 * Process control of the Run section (local patch): start a detached shell (own process group, output straight to
 * a log file so it outlives nycode), follow a log incrementally, watch the liveness of detected pids and stop with the
 * staged signals SIGINT → SIGTERM (7.5 s) → SIGKILL (+2.5 s). Linux (/proc) for the descendant walk.
 */
import { spawn } from 'node:child_process'
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { StringDecoder } from 'node:string_decoder'

import { cancelBackgroundRun } from '../subagent/fleet/background.ts'
import type { RunRecord, RunRegistry } from './registry.ts'

export const TERM_AFTER_MS = 7500
export const KILL_AFTER_MS = 2500
const POLL_MS = 500
const LIVENESS_EVERY = 4 // polls: 2 s
const MAX_READ = 1 << 20

export const runsDir = (): string => process.env.NYCODE_RUNS_DIR ?? join(homedir(), '.local', 'state', 'pi-runs')

/** Reads what the log grew by since the last call (bounded per call) into the ring buffer. */
export function readNew(reg: RunRegistry, rec: RunRecord): void {
  if (!rec.logPath) return
  let fd: number | undefined
  try {
    const size = statSync(rec.logPath).size
    let offset = rec.offset ?? 0
    if (size < offset) offset = 0 // truncated by the process: start over
    if (size === offset) return
    fd = openSync(rec.logPath, 'r')
    const buf = Buffer.alloc(Math.min(size - offset, MAX_READ))
    const n = readSync(fd, buf, 0, buf.length, offset)
    rec.offset = offset + n
    rec.decoder ??= new StringDecoder('utf8')
    reg.push(rec, rec.decoder.write(buf.subarray(0, n)))
  } catch {
    // file not there (yet) or unreadable: no output, no error
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

/** kill -0, treating a zombie as gone. */
export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM'
  }
  try {
    return !/^\d+ \(.*\) Z /.test(readFileSync(`/proc/${pid}/stat`, 'utf8'))
  } catch {
    return true
  }
}

/** pid plus every descendant (via /proc ppid links). */
export function tree(pid: number): number[] {
  const kids = new Map<number, number[]>()
  try {
    for (const name of readdirSync('/proc')) {
      if (!/^\d+$/.test(name)) continue
      try {
        const stat = readFileSync(`/proc/${name}/stat`, 'utf8')
        const ppid = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1])
        kids.set(ppid, [...(kids.get(ppid) ?? []), Number(name)])
      } catch {
        // gone while scanning
      }
    }
  } catch {
    return [pid]
  }
  const out = [pid]
  for (let i = 0; i < out.length && out.length < 4096; i++) out.push(...(kids.get(out[i]!) ?? []))
  return out
}

/** `known`: descendants seen at stop time; they are signalled again even after their parent died and orphaned them. */
function signal(rec: RunRecord, sig: NodeJS.Signals, known: Set<number> = new Set()): void {
  const send = (pid: number, target = pid): void => {
    try {
      process.kill(target, sig)
    } catch {
      // already gone
    }
  }
  if (rec.pgid && !rec.detected) return send(rec.pgid, -rec.pgid)
  if (rec.pid) for (const p of new Set([...known, ...tree(rec.pid)])) send(p)
}

export interface StopTimings {
  termMs?: number
  killMs?: number
}

/** Staged stop; every timer is unref'd and dies with the run. Subagents go through cancelBackgroundRun. */
export function stopRun(reg: RunRegistry, rec: RunRecord, timings: StopTimings = {}): 'stopping' | 'not-running' {
  if (rec.kind === 'agent') return cancelBackgroundRun(rec.id) === 'cancelled' ? 'stopping' : 'not-running'
  if (rec.state !== 'running') return 'not-running'
  rec.stopRequested = true
  const known = new Set<number>()
  if (rec.detected && rec.pid) for (const p of tree(rec.pid)) known.add(p)
  signal(rec, 'SIGINT', known)
  const timers: Array<ReturnType<typeof setTimeout>> = []
  const stage = (ms: number, sig: NodeJS.Signals): void => {
    const t = setTimeout(() => {
      if (rec.state === 'running' || [...known].some(alive)) signal(rec, sig, known)
    }, ms)
    t.unref?.()
    timers.push(t)
  }
  const term = timings.termMs ?? TERM_AFTER_MS
  stage(term, 'SIGTERM')
  stage(term + (timings.killMs ?? KILL_AFTER_MS), 'SIGKILL')
  const off = reg.onFinish((r) => {
    // A detected root may die first and orphan its children: the staged timers keep going for them.
    if (r !== rec || (rec.detected && [...known].some(alive))) return
    for (const t of timers) clearTimeout(t)
    off()
  })
  reg.emit()
  return 'stopping'
}

let timer: ReturnType<typeof setInterval> | undefined
let ticks = 0

/** One poll of every live shell: new log bytes, and the liveness of detected pids every 2 s. Exported for tests. */
export function pollOnce(reg: RunRegistry, checkLiveness: boolean): void {
  for (const rec of reg.liveShells()) {
    readNew(reg, rec)
    if (checkLiveness && rec.detected && rec.pid && !alive(rec.pid)) {
      readNew(reg, rec)
      reg.finish(rec, {})
    }
  }
}

/** Starts the poll timer while a shell is live (unref'd); it stops itself when none is. */
export function ensurePolling(reg: RunRegistry): void {
  if (timer) return
  timer = setInterval(() => {
    ticks += 1
    pollOnce(reg, ticks % LIVENESS_EVERY === 0)
    if (reg.liveShells().length === 0) {
      clearInterval(timer)
      timer = undefined
    }
  }, POLL_MS)
  timer.unref?.()
}

export interface StartOptions {
  command: string
  cwd: string
  name?: string
  awaited?: boolean
}

const label = (command: string): string => command.replace(/\s+/g, ' ').trim().slice(0, 80)

/** Starts `bash -lc command` detached in a new process group, stdout+stderr to the log. Throws on a bad cwd or at the live limit. */
export function startShell(reg: RunRegistry, opts: StartOptions): RunRecord {
  if (!existsSync(opts.cwd)) throw new Error(`cwd não existe: ${opts.cwd}`)
  const dir = runsDir()
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const rec = reg.add({ name: opts.name || label(opts.command), command: opts.command, cwd: opts.cwd, awaited: opts.awaited ?? false, repeatable: true })
  rec.logPath = join(dir, `${rec.id}.log`)
  const fd = openSync(rec.logPath, 'a', 0o600)
  try {
    const child = spawn('bash', ['-lc', opts.command], { cwd: opts.cwd, detached: true, stdio: ['ignore', fd, fd] })
    rec.pid = rec.pgid = child.pid
    child.on('error', (err) => {
      reg.push(rec, `${err.message}\n`)
      reg.finish(rec, { exitCode: 127 })
    })
    child.on('exit', (code, sig) => {
      readNew(reg, rec)
      reg.finish(rec, { exitCode: code ?? undefined, signal: sig ?? undefined })
    })
    child.unref()
  } catch (e) {
    reg.finish(rec, { exitCode: 127 })
    throw e
  } finally {
    closeSync(fd)
  }
  ensurePolling(reg)
  return rec
}

/** Registers a process found in a bash command (not our child: no group of its own, exit unknown). */
export function registerDetected(reg: RunRegistry, d: { pid: number; command: string; cwd: string; logPath?: string; repeatable: boolean }): RunRecord {
  const rec = reg.add({ name: label(d.command), command: d.command, cwd: d.cwd, pid: d.pid, detected: true, repeatable: d.repeatable })
  if (d.logPath) rec.logPath = d.logPath
  readNew(reg, rec)
  ensurePolling(reg)
  return rec
}

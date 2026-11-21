/**
 * Fleet file layer (contract: types.ts). Every write swallows errors: the fleet is
 * observability and must never fail the run it describes. Only ensureFleetDir creates
 * a directory; a write into a vanished dir just fails quietly.
 */
import { randomUUID } from 'node:crypto'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { subagentDepth } from '../nesting/index.ts'
import { FLEET_ENV, type InboxAck, type InboxMessage, type RunRecord, type StopOrigin, type TranscriptItem } from './types.ts'

export const RUN_ID_RE = /^[a-z]{2}-[0-9a-f]{8}$/
const DIR_SLOT = Symbol.for('pi-code.fleet.dir')
const TRANSCRIPT_CAP = 4 * 1024 * 1024
const TRUNCATED_NOTE = '[transcript truncated at 4 MB]'

const slot = globalThis as Record<symbol, unknown>

export const fleetRoot = (): string => path.join(os.tmpdir(), `pi-code-fleet-${process.getuid?.() ?? 'u'}`)

export const validRunId = (id: unknown): id is string => typeof id === 'string' && RUN_ID_RE.test(id)

/** Depth 0 only: one dir per process, reused across /reload through globalThis. */
/** A shared /tmp root is trusted only when it is our own real directory, closed to group and others. */
export function checkRootSafe(root: string): boolean {
  try {
    const st = fs.lstatSync(root)
    return st.isDirectory() && st.uid === process.getuid?.() && (st.mode & 0o077) === 0
  } catch {
    return false
  }
}

/** Undefined disables the fleet (unsafe root or any error): session_start must never throw. */
export function ensureFleetDir(): string | undefined {
  try {
    const existing = slot[DIR_SLOT] as string | undefined
    if (existing) return existing
    const root = fleetRoot()
    fs.mkdirSync(root, { recursive: true, mode: 0o700 })
    if (!checkRootSafe(root)) return undefined
    const dir = path.join(root, `${process.pid}-${randomUUID().slice(0, 8)}`)
    fs.mkdirSync(dir, { mode: 0o700 })
    slot[DIR_SLOT] = dir
    return dir
  } catch {
    return undefined
  }
}

/** Depth 0 ignores an inherited PI_CODE_FLEET_DIR: a pi launched from a bash tool must not join its parent's fleet. */
export function currentFleetDir(): string | undefined {
  if (subagentDepth() === 0) return slot[DIR_SLOT] as string | undefined
  const dir = process.env[FLEET_ENV.dir]
  return dir && path.isAbsolute(dir) && path.dirname(dir) === fleetRoot() ? dir : undefined
}

export function fleetChildEnv(id: string): Record<string, string> {
  const dir = currentFleetDir()
  if (!dir || !validRunId(id)) return {}
  return { [FLEET_ENV.dir]: dir, [FLEET_ENV.runId]: id }
}

export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

export function sweepOrphanFleetDirs(): void {
  const root = fleetRoot()
  const own = slot[DIR_SLOT] as string | undefined
  // Only a process that created its own dir (root checked safe) sweeps: never a root someone else planted.
  if (!own) return
  let names: string[]
  try {
    names = fs.readdirSync(root)
  } catch {
    return
  }
  for (const name of names) {
    const m = /^(\d+)-[0-9a-f]{8}$/.exec(name)
    const full = path.join(root, name)
    if (!m || full === own || pidAlive(Number(m[1]))) continue
    try {
      fs.rmSync(full, { recursive: true })
    } catch {
      /* best effort */
    }
  }
}

export function removeFleetDir(): void {
  const dir = slot[DIR_SLOT] as string | undefined
  slot[DIR_SLOT] = undefined
  if (!dir) return
  try {
    fs.rmSync(dir, { recursive: true })
  } catch {
    /* best effort */
  }
}

export function writeRecord(dir: string, rec: RunRecord): void {
  if (!validRunId(rec.id)) return
  const final = path.join(dir, `${rec.id}.json`)
  const tmp = `${final}.tmp-${process.pid}`
  try {
    fs.writeFileSync(tmp, JSON.stringify(rec))
    fs.renameSync(tmp, final)
  } catch {
    /* best effort */
  }
}

export function readRecord(dir: string, id: string): RunRecord | undefined {
  if (!validRunId(id)) return undefined
  try {
    return mapOrphan(JSON.parse(fs.readFileSync(path.join(dir, `${id}.json`), 'utf8')))
  } catch {
    return undefined
  }
}

function mapOrphan(raw: unknown): RunRecord | undefined {
  const rec = raw as RunRecord | null
  if (!rec || typeof rec !== 'object' || rec.v !== 1 || !validRunId(rec.id)) return undefined
  if (rec.state === 'running' && !(typeof rec.ownerPid === 'number' && pidAlive(rec.ownerPid))) return { ...rec, state: 'failed', error: 'orphaned' }
  return rec
}

export function readRecords(dir: string): RunRecord[] {
  let names: string[]
  try {
    names = fs.readdirSync(dir)
  } catch {
    return []
  }
  const out: RunRecord[] = []
  for (const name of names) {
    if (!name.endsWith('.json')) continue
    try {
      const rec = mapOrphan(JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')))
      if (rec) out.push(rec)
    } catch {
      /* bad JSON skipped */
    }
  }
  return out
}

export function appendJsonl(file: string, obj: unknown): void {
  try {
    fs.appendFileSync(file, `${JSON.stringify(obj)}\n`)
  } catch {
    /* best effort */
  }
}

/** Reads whole lines in [from, from+maxBytes); `next` advances only past a newline, so a half-written line is retried. */
export function readJsonl<T>(file: string, from: number, maxBytes = 1024 * 1024): { items: T[]; next: number } {
  const empty = { items: [] as T[], next: from }
  let fd: number | undefined
  try {
    fd = fs.openSync(file, 'r')
    const size = fs.fstatSync(fd).size
    if (size <= from) return empty
    const len = Math.min(size, from + maxBytes) - from
    const buf = Buffer.alloc(len)
    const n = fs.readSync(fd, buf, 0, len, from)
    const cut = buf.subarray(0, n).lastIndexOf(0x0a)
    if (cut < 0) return empty
    const items: T[] = []
    for (const line of buf.subarray(0, cut).toString('utf8').split('\n')) {
      if (!line) continue
      try {
        items.push(JSON.parse(line) as T)
      } catch {
        /* bad line skipped */
      }
    }
    return { items, next: from + cut + 1 }
  } catch {
    return empty
  } finally {
    if (fd !== undefined) fs.closeSync(fd)
  }
}

const transcriptFile = (dir: string, id: string): string => path.join(dir, `${id}.transcript.jsonl`)
const transcriptBytes = new Map<string, { bytes: number; capped: boolean }>()

export function appendTranscript(dir: string, id: string, item: TranscriptItem): void {
  if (!validRunId(id)) return
  const file = transcriptFile(dir, id)
  const key = file
  let state = transcriptBytes.get(key)
  if (!state) {
    let bytes = 0
    try {
      bytes = fs.statSync(file).size
    } catch {
      /* new file */
    }
    state = { bytes, capped: false }
    transcriptBytes.set(key, state)
  }
  if (state.capped) return
  const line = `${JSON.stringify(item)}\n`
  if (state.bytes + Buffer.byteLength(line) > TRANSCRIPT_CAP) {
    state.capped = true
    appendJsonl(file, { t: Date.now(), kind: 'note', text: TRUNCATED_NOTE })
    return
  }
  state.bytes += Buffer.byteLength(line)
  appendJsonl(file, item)
}

export function readTranscript(dir: string, id: string, from: number): { items: TranscriptItem[]; next: number } {
  if (!validRunId(id)) return { items: [], next: from }
  return readJsonl<TranscriptItem>(transcriptFile(dir, id), from)
}

const inboxFile = (dir: string, id: string): string => path.join(dir, `${id}.inbox.jsonl`)
const ackFile = (dir: string, id: string): string => path.join(dir, `${id}.inbox-ack.jsonl`)

/** A resumed run reuses its id: the new child's watcher starts at offset 0 and must not replay old steers. */
export function resetInbox(dir: string, id: string): void {
  if (!validRunId(id)) return
  for (const file of [inboxFile(dir, id), ackFile(dir, id)]) {
    try {
      if (fs.existsSync(file)) fs.writeFileSync(file, '')
    } catch {
      /* best effort */
    }
  }
}

export function appendInbox(dir: string, id: string, msg: InboxMessage): void {
  if (validRunId(id)) appendJsonl(inboxFile(dir, id), msg)
}

export function readInbox(dir: string, id: string, from: number): { items: InboxMessage[]; next: number } {
  return validRunId(id) ? readJsonl<InboxMessage>(inboxFile(dir, id), from) : { items: [], next: from }
}

/** Inbox messages of a run that no `consumed` ack covers: sent, but never reached the model. */
export function undeliveredCount(dir: string, id: string): number {
  const consumed = new Set(readAcks(dir, id, 0).items.filter((ack) => ack.outcome === 'consumed').map((ack) => ack.id))
  return readInbox(dir, id, 0).items.filter((msg) => !consumed.has(msg.id)).length
}

export function appendAck(dir: string, id: string, ack: InboxAck): void {
  if (validRunId(id)) appendJsonl(ackFile(dir, id), ack)
}

export function readAcks(dir: string, id: string, from: number): { items: InboxAck[]; next: number } {
  return validRunId(id) ? readJsonl<InboxAck>(ackFile(dir, id), from) : { items: [], next: from }
}

/** The marker holds who stopped the run, so the parent's note and the record name the right actor. */
export function requestStop(dir: string, id: string, by: StopOrigin = 'user'): void {
  if (!validRunId(id)) return
  try {
    fs.writeFileSync(path.join(dir, `${id}.stop`), by)
  } catch {
    /* best effort */
  }
}

/** An empty marker (older build) reads as the user. */
export function stopOrigin(dir: string | undefined, id: string): StopOrigin | undefined {
  if (!dir || !validRunId(id)) return undefined
  try {
    return fs.readFileSync(path.join(dir, `${id}.stop`), 'utf8').trim() === 'agent' ? 'agent' : 'user'
  } catch {
    return undefined
  }
}

/** A resumed run starts clean: the previous stop must not cancel it again. */
export function clearStop(dir: string, id: string): void {
  if (!validRunId(id)) return
  try {
    fs.rmSync(path.join(dir, `${id}.stop`))
  } catch {
    /* none */
  }
}

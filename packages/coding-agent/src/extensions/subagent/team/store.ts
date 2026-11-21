/** Team file layer: identity, budgets and the message log. Contract: types.ts. */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { subagentDepth } from '../nesting/index.ts'
import { appendJsonl, currentFleetDir, readJsonl, readRecord } from '../fleet/store.ts'
import { FLEET_ENV } from '../fleet/types.ts'
import { LEAD_ID, LIMITS, type Self, type TeamMessage } from './types.ts'

/** The team dir, created on demand; undefined when there is no fleet dir. */
export function teamDir(fleetDir: string | undefined = currentFleetDir()): string | undefined {
  if (!fleetDir) return undefined
  const dir = path.join(fleetDir, 'team')
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
    return dir
  } catch {
    return undefined
  }
}

export const mainInboxFile = (fleetDir: string): string => path.join(fleetDir, 'main.inbox.jsonl')

export function selfOf(fleetDir: string): Self {
  const depth = subagentDepth()
  const id = process.env[FLEET_ENV.runId]
  if (depth === 0 || !id) return { id: LEAD_ID, agent: 'lead', depth: 0 }
  return { id, agent: readRecord(fleetDir, id)?.agent ?? 'agent', depth }
}

/** Appends one byte and returns the file size: an O_APPEND write is atomic, so concurrent senders get distinct sizes. */
function bump(file: string): number {
  const fd = fs.openSync(file, 'a', 0o600)
  try {
    fs.writeSync(fd, 'x')
    return fs.fstatSync(fd).size
  } finally {
    fs.closeSync(fd)
  }
}

const sizeOf = (file: string): number => {
  try {
    return fs.statSync(file).size
  } catch {
    return 0
  }
}

/** Charges one send to the run and to the tree; an error string when either budget is spent. */
export function spendSend(fleetDir: string, selfId: string): string | undefined {
  const dir = teamDir(fleetDir)
  if (!dir) return 'team: no fleet directory'
  const own = path.join(dir, `sends.${selfId}`)
  if (sizeOf(own) >= LIMITS.perRun) return `team: send budget spent (${LIMITS.perRun} per run)`
  bump(own)
  if (bump(path.join(dir, 'sends.tree')) > LIMITS.perTree) return `team: send budget spent (${LIMITS.perTree} per tree)`
  return undefined
}

const messagesFile = (fleetDir: string): string => path.join(fleetDir, 'team', 'messages.jsonl')

export function logMessage(fleetDir: string, msg: TeamMessage): void {
  if (teamDir(fleetDir)) appendJsonl(messagesFile(fleetDir), msg)
}

export function readMessages(fleetDir: string, from: number): { items: TeamMessage[]; next: number } {
  return readJsonl<TeamMessage>(messagesFile(fleetDir), from)
}

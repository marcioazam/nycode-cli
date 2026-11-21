/** Peer action feed: a short digest of what the other members edited, wrote or ran. Contract: types.ts. */
import { readRecords, readTranscript } from '../fleet/store.ts'
import { LIMITS } from './types.ts'

const ACTIONS = new Set(['edit', 'write', 'bash'])

export interface FeedState {
  last: number
  offsets: Map<string, number>
}

export const newFeedState = (): FeedState => ({ last: 0, offsets: new Map() })

/** At most one digest per LIMITS.feedMs, never about `selfId`; undefined when nothing new. Newest lines win the cap. */
export function digest(dir: string, selfId: string, state: FeedState, now: number): string | undefined {
  if (now - state.last < LIMITS.feedMs) return undefined
  state.last = now
  const lines: string[] = []
  for (const rec of readRecords(dir)) {
    if (rec.id === selfId) continue
    const { items, next } = readTranscript(dir, rec.id, state.offsets.get(rec.id) ?? 0)
    state.offsets.set(rec.id, next)
    for (const item of items) if (item.kind === 'tool_call' && item.tool && ACTIONS.has(item.tool)) lines.push(`${rec.agent}: ${item.text.replace(/\s+/g, ' ').slice(0, 80)}`)
  }
  if (lines.length === 0) return undefined
  const head = "[team feed] others' recent actions:"
  let out = head
  const kept: string[] = []
  for (let i = lines.length - 1; i >= 0; i--) {
    if (head.length + kept.reduce((n, l) => n + l.length + 1, 0) + lines[i]!.length + 1 > LIMITS.digest) break
    kept.unshift(lines[i]!)
  }
  if (kept.length === 0) kept.push(lines[lines.length - 1]!.slice(0, LIMITS.digest - head.length - 1))
  out += `\n${kept.join('\n')}`
  return out
}

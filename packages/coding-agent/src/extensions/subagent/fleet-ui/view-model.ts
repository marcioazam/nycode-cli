/**
 * Pure view model of the agent fleet panel and the /tasks browser: tree, visibility,
 * collapse and the row data. No I/O, no clock (callers pass `now`).
 * Record: docs/pi-agent-fleet-2026-11-12.md (A1, A7).
 */
import type { RunRecord, RunState } from '../fleet/types.ts'
import { listMeta } from './runtime-label.ts'

export const FINISHED_TTL_MS = 30_000
/** A running run silent this long shows as quiet (◌). */
export const QUIET_MS = 120_000

export interface FleetRow {
  id: string
  parentId: string | null
  /** Tree depth: 1 = hangs from main (a missing parent counts as main). */
  depth: number
  agent: string
  /** `[model · effort]` candidates, widest first; `?` where unknown. */
  meta?: string[]
  /** First line of the run's task, whitespace collapsed. */
  task: string
  /** 1-based start order among visible rows of the same agent type; 0 when the type is unique. */
  nth: number
  state: RunState
  /** Finished by its maxTurns cap: `done` with incomplete output (the panel labels it `parcial`). */
  partial?: true
  activity: string
  error?: string
  elapsedMs: number
  contextTokens: number
  cost: number
  /** Visible descendants hidden by a collapse. */
  hiddenDescendants: number
  /** Running runs with no recorded activity for QUIET_MS (the record's `updatedAt`; there is no heartbeat, so a long tool call can look quiet: it says "quiet", never "stalled"). */
  quietMs: number
  /** Collapsed rows: state of the hidden descendants, so a failure below a folded parent stays visible. */
  hiddenSummary?: { running: number; failed: number }
  /** Visible direct children, whether or not collapsed. */
  childCount: number
  collapsed: boolean
  guides: string
  /** Team messages received by this run; absent when none or team mode is off. */
  unread?: number
}

export interface RowOptions {
  now: number
  collapsed?: ReadonlySet<string>
  dismissed?: ReadonlySet<string>
  /** true: apply the panel's hiding rules; false: the /tasks browser shows everything. */
  panel: boolean
  /** /tasks lists the newest root first. */
  newestRootFirst?: boolean
  /** Team mode: messages received per run id (the ✉n badge). */
  unread?: ReadonlyMap<string, number>
  /** Painel: `main` é a raiz desenhada, então os rows de 1º grau também levam guia (├─ / └─). */
  mainRoot?: boolean
}

interface Node {
  rec: RunRecord
  depth: number
  children: Node[]
  visible: boolean
}

function byStart(a: Node, b: Node): number {
  return a.rec.startedAt - b.rec.startedAt || (a.rec.id < b.rec.id ? -1 : 1)
}

export function buildTree(records: readonly RunRecord[]): Node[] {
  const nodes = new Map<string, Node>()
  for (const rec of records) nodes.set(rec.id, { rec, depth: 1, children: [], visible: true })
  const roots: Node[] = []
  for (const node of nodes.values()) {
    const parent = node.rec.parentId === null || node.rec.parentId === node.rec.id ? undefined : nodes.get(node.rec.parentId)
    if (parent) parent.children.push(node)
    else roots.push(node)
  }
  const setDepth = (node: Node, depth: number): void => {
    node.depth = depth
    node.children.sort(byStart)
    for (const child of node.children) setDepth(child, depth + 1)
  }
  roots.sort(byStart)
  for (const root of roots) setDepth(root, 1)
  return roots
}

function ownVisible(node: Node, parent: Node | undefined, opts: RowOptions): boolean {
  const { rec } = node
  if (opts.dismissed?.has(rec.id)) return false
  if (rec.state === 'running') return true
  if (!parent) {
    if (rec.state === 'done') return false
    return opts.now < (rec.endedAt ?? rec.updatedAt) + FINISHED_TTL_MS
  }
  return parent.rec.state === 'running'
}

function markVisible(node: Node, parent: Node | undefined, parentVisible: boolean, opts: RowOptions): void {
  node.visible = parentVisible && (!opts.panel ? true : ownVisible(node, parent, opts))
  for (const child of node.children) markVisible(child, node, node.visible, opts)
}

function summarize(node: Node): { running: number; failed: number } {
  const sum = { running: 0, failed: 0 }
  const walk = (n: Node): void => {
    for (const child of n.children) {
      if (!child.visible) continue
      if (child.rec.state === 'running') sum.running += 1
      else if (child.rec.state === 'failed') sum.failed += 1
      walk(child)
    }
  }
  walk(node)
  return sum
}

function countVisible(node: Node): number {
  let n = 0
  for (const child of node.children) if (child.visible) n += 1 + countVisible(child)
  return n
}

export function buildRows(records: readonly RunRecord[], opts: RowOptions): FleetRow[] {
  const roots = buildTree(records)
  for (const root of roots) markVisible(root, undefined, true, opts)
  if (opts.newestRootFirst) roots.reverse()
  const rows: FleetRow[] = []
  const emit = (node: Node, ancestors: string, isLast: boolean): void => {
    const { rec } = node
    const visibleChildren = node.children.filter((c) => c.visible)
    const isCollapsed = opts.collapsed?.has(rec.id) === true && visibleChildren.length > 0
    const guides = node.depth === 1 && !opts.mainRoot ? '' : ancestors + (isLast ? '└─ ' : '├─ ')
    rows.push({
      id: rec.id,
      parentId: node.depth === 1 ? null : rec.parentId,
      depth: node.depth,
      agent: rec.agent,
      meta: listMeta(rec),
      task: firstLine(rec.task),
      nth: 0,
      state: rec.state,
      ...(rec.partial ? { partial: true as const } : {}),
      activity: rec.activity ?? '',
      error: rec.error,
      elapsedMs: Math.max(0, (rec.endedAt ?? opts.now) - rec.startedAt),
      contextTokens: rec.tokens.context,
      cost: rec.cost,
      quietMs: rec.state === 'running' ? Math.max(0, opts.now - rec.updatedAt) : 0,
      hiddenDescendants: isCollapsed ? countVisible(node) : 0,
      ...(isCollapsed ? { hiddenSummary: summarize(node) } : {}),
      childCount: visibleChildren.length,
      collapsed: isCollapsed,
      guides,
      ...(opts.unread?.get(rec.id) ? { unread: opts.unread.get(rec.id) } : {}),
    })
    if (isCollapsed) return
    // Sem mainRoot o 1º grau não tem coluna de guia; deeper levels carry '│  ' or blanks forward.
    const next = node.depth === 1 && !opts.mainRoot ? '' : ancestors + (isLast ? '   ' : '│  ')
    visibleChildren.forEach((child, i) => emit(child, next, i === visibleChildren.length - 1))
  }
  const top = roots.filter((r) => r.visible)
  top.forEach((root, i) => emit(root, '', i === top.length - 1))
  numberRepeats(rows, records)
  return rows
}

function firstLine(text: string | undefined): string {
  return (text ?? '').split(/\r?\n/, 1)[0]!.replace(/\s+/g, ' ').trim()
}

/** Repeated agent types among the visible rows get `nth` 1, 2, … in start order. */
function numberRepeats(rows: FleetRow[], records: readonly RunRecord[]): void {
  const started = new Map(records.map((r) => [r.id, r.startedAt]))
  const groups = new Map<string, FleetRow[]>()
  for (const row of rows) groups.set(row.agent, [...(groups.get(row.agent) ?? []), row])
  for (const group of groups.values()) {
    if (group.length < 2) continue
    group.sort((a, b) => (started.get(a.id) ?? 0) - (started.get(b.id) ?? 0) || (a.id < b.id ? -1 : 1))
    group.forEach((row, i) => (row.nth = i + 1))
  }
}

/** Depth-1 runs that reached 'done' within the last 30 s (the `✓ N finished · /tasks` hint). */
export function finishedCount(records: readonly RunRecord[], now: number): number {
  const ids = new Set(records.map((r) => r.id))
  return records.filter((r) => {
    const top = r.parentId === null || !ids.has(r.parentId)
    return top && r.state === 'done' && now < (r.endedAt ?? r.updatedAt) + FINISHED_TTL_MS
  }).length
}

export function runningCount(rows: readonly FleetRow[]): number {
  return rows.filter((r) => r.state === 'running').length
}

/** Ancestor chain of a record, root first, the record itself last. Cycle-safe. */
export function chainOf(records: readonly RunRecord[], id: string): RunRecord[] {
  const byId = new Map(records.map((r) => [r.id, r]))
  const chain: RunRecord[] = []
  const seen = new Set<string>()
  for (let cur = byId.get(id); cur && !seen.has(cur.id); cur = cur.parentId ? byId.get(cur.parentId) : undefined) {
    seen.add(cur.id)
    chain.unshift(cur)
  }
  return chain
}

/** Records with the same parent as `id` (siblings, itself included) and its direct children, by start time. */
export function neighbours(records: readonly RunRecord[], id: string): { siblings: RunRecord[]; children: RunRecord[]; parent?: RunRecord } {
  const byId = new Map(records.map((r) => [r.id, r]))
  const me = byId.get(id)
  if (!me) return { siblings: [], children: [] }
  const parent = me.parentId ? byId.get(me.parentId) : undefined
  const sameParent = (r: RunRecord): boolean => (parent ? r.parentId === parent.id : r.parentId === null || !byId.has(r.parentId))
  const sort = (list: RunRecord[]): RunRecord[] => list.sort((a, b) => a.startedAt - b.startedAt || (a.id < b.id ? -1 : 1))
  return {
    siblings: sort(records.filter(sameParent)),
    children: sort(records.filter((r) => r.parentId === id)),
    parent,
  }
}

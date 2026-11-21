/**
 * Plan table (UI only): `# · estado · tarefa · fim` rows for the Plan section.
 * Times come from what the UI observes in this session (when a step became active or done), never from
 * the plan file: a step already done when first seen shows `--:--`. State beyond done/doing/todo
 * (`status`) renders when a producer sets it on the item; none does yet.
 * Record: docs/pi-interactive-display-2026-11-13.md ("Plan table").
 */
import { truncateToWidth, visibleWidth } from '@nycode/tui'

import type { UiTheme } from '../subagent/fleet-ui/panel.ts'
import type { TodoItem } from './utils.ts'

/** `mm:ss`, or `h:mm:ss` from one hour. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pair = (n: number): string => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pair(m)}:${pair(s)}` : `${pair(m)}:${pair(s)}`
}

/** Start/finish instants of the steps as this session saw them; in memory only. */
export class PlanTimes {
  private origin?: number
  /** Instant the last open step finished; the clock stops there until a step opens again. */
  private doneAt?: number
  /** Instant the user paused the plan: the clock and the running step stand still until `resume`. */
  private pausedAt?: number
  private readonly started = new Map<number, number>()
  private readonly finished = new Map<number, number>()

  /** Records transitions seen in `items` at `now`; the first open step starts when the previous one finished. */
  observe(items: readonly TodoItem[], now: number): void {
    if (items.length === 0) return this.reset()
    this.origin ??= now
    this.doneAt = items.every((i) => i.completed || i.status === 'skipped') ? (this.doneAt ?? now) : undefined
    let last = this.origin
    for (const item of items) {
      if (item.completed) {
        if (!this.finished.has(item.step)) this.finished.set(item.step, now)
        last = Math.max(last, this.finished.get(item.step) ?? last)
      } else if (item.status === 'skipped' && this.started.has(item.step) && !this.finished.has(item.step)) {
        this.finished.set(item.step, now)
      } else if (item.doing !== undefined && !item.status) {
        // Todo mode: only the todo in progress runs a clock; one that went back to pending loses it. No break: later ones may be in progress.
        if (item.doing) {
          if (!this.started.has(item.step)) this.started.set(item.step, now)
        } else if (!this.finished.has(item.step)) this.started.delete(item.step)
      } else if (!item.status && !this.started.has(item.step)) {
        this.started.set(item.step, last)
        break
      }
    }
  }

  reset(): void {
    this.origin = undefined
    this.doneAt = undefined
    this.pausedAt = undefined
    this.started.clear()
    this.finished.clear()
  }

  /** Instant the plan was first seen: spend is counted from here. */
  get startedAt(): number | undefined {
    return this.origin
  }

  get paused(): boolean {
    return this.pausedAt !== undefined
  }

  pause(now: number): void {
    this.pausedAt ??= now
  }

  /** The pause gap is cut out of the origin and of every open step. */
  resume(now: number): void {
    if (this.pausedAt === undefined) return
    const gap = now - this.pausedAt
    this.pausedAt = undefined
    if (this.origin !== undefined) this.origin += gap
    for (const [step, at] of this.started) if (!this.finished.has(step)) this.started.set(step, at + gap)
  }

  elapsed(now: number): number | undefined {
    return this.origin === undefined ? undefined : (this.doneAt ?? this.pausedAt ?? now) - this.origin
  }

  /** [start, end] of a step in ms: end is its finish, else the pause or now; undefined when it never started. */
  window(step: number, now: number): { from: number; to: number } | undefined {
    const from = this.started.get(step)
    return from === undefined ? undefined : { from, to: this.finished.get(step) ?? this.pausedAt ?? now }
  }

  /** Duration of a finished step; undefined when it was already done the first time it was seen. */
  took(step: number): number | undefined {
    const end = this.finished.get(step)
    const start = this.started.get(step)
    return end === undefined || start === undefined ? undefined : end - start
  }

  /** Wall-clock instant a step finished; undefined when it was already done the first time it was seen. */
  finishedAt(step: number): number | undefined {
    return this.started.has(step) ? this.finished.get(step) : undefined
  }

  running(step: number, now: number): number | undefined {
    const start = this.started.get(step)
    return start === undefined || this.finished.has(step) ? undefined : (this.pausedAt ?? now) - start
  }
}

/** The step in progress: the first one neither done nor marked (blocked/failed/skipped); in todo mode (`doing` set) the todo in progress. */
export const activeStep = (items: readonly TodoItem[]): number | undefined =>
  items.some((i) => i.doing !== undefined) ? items.find((i) => i.doing && !i.completed)?.step : items.find((i) => !i.completed && !i.status)?.step

export type Role = 'success' | 'task' | 'dim' | 'warning' | 'error' | 'text'
export const STATES: Record<string, { sym: string; label: string; role: Role }> = {
  done: { sym: '✓', label: 'feito', role: 'success' },
  doing: { sym: '▸', label: 'fazendo', role: 'task' },
  todo: { sym: '○', label: 'a fazer', role: 'dim' },
  blocked: { sym: '‖', label: 'bloqueado', role: 'warning' },
  failed: { sym: '✕', label: 'falhou', role: 'error' },
  skipped: { sym: '⊘', label: 'pulado', role: 'dim' },
  paused: { sym: '∥', label: 'pausado', role: 'warning' },
}
const MIN_TASK = 24

/** Column plan for a width. Ladder: full → short time (clock only) →
 * state as a symbol only → symbol + task. Each level keeps at least MIN_TASK cells (16 once compact) for the task. */
export interface Cols {
  num: number
  state: number
  label: boolean
  time: number
  short: boolean
  task: number
  header: boolean
}
const LEVELS: Array<Omit<Cols, 'task'>> = [
  { num: 4, state: 12, label: true, time: 17, short: false, header: true },
  { num: 4, state: 12, label: true, time: 8, short: true, header: true },
  { num: 3, state: 2, label: false, time: 8, short: true, header: true },
  { num: 0, state: 2, label: false, time: 0, short: true, header: false },
]
export function columns(width: number): Cols {
  for (const [i, l] of LEVELS.entries()) {
    const task = width - l.num - l.state - l.time - 1
    if (task >= (i < 3 ? MIN_TASK : 12) || i === LEVELS.length - 1) return { ...l, task: Math.max(4, task) }
  }
  throw new Error('unreachable')
}

const pad = (text: string, width: number): string => text + ' '.repeat(Math.max(0, width - visibleWidth(text)))
const cut = (text: string, width: number): string => pad(truncateToWidth(text, width, '…'), width)

/** Detail line under a row that carries a `note`: indented to the task column, painted with the state's role.
 * Aligned with the task text so the columns stay straight; null when there is nothing to say or the layout has no room (symbol-only levels). */
export function tableDetail(item: TodoItem, theme: UiTheme, width: number, active: number | undefined): string | null {
  const note = item.note?.trim()
  if (!note) return null
  const c = columns(width)
  if (!c.header) return null
  const key = item.completed ? 'done' : (item.status ?? (active === item.step ? 'doing' : 'todo'))
  const role: Role = key === 'todo' || key === 'done' || key === 'skipped' ? 'dim' : STATES[key]!.role
  const indent = ' '.repeat(c.num + (c.label ? c.state : 2))
  return truncateToWidth(indent + theme.fg(role, `↳ ${note}`), width, theme.fg(role, '…'))
}

/** Tokens and dollars the session spent since `since` (ms): assistant messages of the branch, as pi records them. */
export function spendSince(entries: readonly unknown[], since: number, until = Infinity): { tokens: number; cost: number } {
  let tokens = 0
  let cost = 0
  for (const e of entries as Array<{ type?: string; timestamp?: string; message?: { role?: string; usage?: { totalTokens?: number; cost?: { total?: number } } } }>) {
    if (e.type !== 'message' || e.message?.role !== 'assistant' || !e.message.usage) continue
    const at = e.timestamp ? Date.parse(e.timestamp) : undefined
    if (at !== undefined && (at < since || at > until)) continue
    tokens += e.message.usage.totalTokens ?? 0
    cost += e.message.usage.cost?.total ?? 0
  }
  return { tokens, cost }
}

/** `41k tok · $0.62`, `$<0.01` is shown as `<$0.01`. */
export function formatSpend(spend: { tokens: number; cost: number }): string {
  const tok = spend.tokens >= 1_000_000 ? `${(spend.tokens / 1e6).toFixed(1)}M` : spend.tokens >= 1000 ? `${Math.round(spend.tokens / 1000)}k` : String(spend.tokens)
  return `${tok} tok · ${spend.cost > 0 && spend.cost < 0.01 ? '<$0.01' : `$${spend.cost.toFixed(2)}`}`
}

/** Counts of marked steps for the Plan title, in the order the user cares about: blocked, failed. */
export function markCounts(items: readonly TodoItem[]): { blocked: number; failed: number; skipped: number } {
  const n = (status: string): number => items.filter((i) => !i.completed && i.status === status).length
  return { blocked: n('blocked'), failed: n('failed'), skipped: n('skipped') }
}

export function tableHeader(theme: UiTheme, width: number): string {
  const c = columns(width)
  if (!c.header) return ''
  const line = pad('#', c.num) + pad(c.label ? 'estado' : '', c.state) + pad('tarefa', c.task + 1) + (c.time ? pad('fim', c.time) : '')
  return truncateToWidth(theme.fg('dim', line.trimEnd()), width)
}

export function tableRow(item: TodoItem, theme: UiTheme, width: number, times: PlanTimes, now: number, _motion: boolean, active: number | undefined, opts: { selected?: boolean; paused?: boolean } = {}): string {
  const c = columns(width)
  const key = item.completed ? 'done' : (item.status ?? (active === item.step ? (opts.paused ? 'paused' : 'doing') : 'todo'))
  const st = STATES[key]!
  const doing = key === 'doing' || key === 'paused'
  const paint = (text: string, role: Role = st.role): string => (doing ? theme.bold(theme.fg(role, text)) : theme.fg(role, text))
  let time = '—'
  if (key === 'paused') time = formatDuration(times.running(item.step, now) ?? 0)
  else if (key === 'done') {
    // Clock time the step finished (owner request 2026-11-14: "really show when each one finished"), then how long it
    // took; the short rung keeps the clock only. Unknown when the step was already done the first time it was seen.
    const at = times.finishedAt(item.step)
    const took = times.took(item.step)
    const clock = at === undefined ? '--:--' : new Date(at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    time = c.short || took === undefined ? clock : `${clock} · ${formatDuration(took)}`
  } else if (doing) {
    const run = times.running(item.step, now)
    time = run === undefined ? '' : formatDuration(run)
  } else if (key === 'failed') time = c.short ? '' : 'falhou'
  else if (key === 'blocked') time = c.short ? '' : 'bloqueado'
  // Sem ícone de estado (dono, 2026-11-15): com coluna de estado vai o nome na cor; sem ela, só a cor da tarefa diz o estado.
  const taskRole: Role = !c.label ? st.role : key === 'done' || key === 'todo' || key === 'skipped' ? 'dim' : doing ? 'text' : st.role
  const mark = opts.selected ? '❯' : ' '
  const num = c.num ? theme.fg(opts.selected ? 'accent' : doing ? 'task' : 'dim', pad(String(item.step).padStart(2, '0'), 2) + mark + ' '.repeat(Math.max(0, c.num - 3))) : ''
  const state = c.label ? paint(st.label) : ''
  const text = cut(item.text, c.task)
  const line =
    num +
    pad(state, c.state) +
    (doing ? theme.bold(theme.fg(taskRole, text)) : theme.fg(taskRole, text)) +
    ' ' +
    (c.time ? pad(paint(time, key === 'todo' || key === 'skipped' ? 'dim' : st.role), c.time) : '')
  return truncateToWidth(line, width)
}

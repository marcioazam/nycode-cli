/**
 * Agent panel below the prompt: row renderer (shared with the /tasks browser), the
 * render function of the panel and `PanelController`, the testable key state machine.
 * Record: docs/pi-agent-fleet-2026-11-12.md (A1, A2, A4, A7).
 */
import { isKeyRelease, matchesKey, truncateToWidth, visibleWidth } from '@nycode/tui'

import { formatDuration, formatTokens } from '../../_shared/goal/goal-evaluator.ts'
import type { FleetSource, StopOutcome } from '../fleet/types.ts'
import { buildRows, finishedCount, QUIET_MS, runningCount } from './view-model.ts'
import type { FleetRow } from './view-model.ts'
import { motionEnabled, SPINNER, spinnerAt } from './style/palette.ts'
import { unreadCounts } from '../team/ui.ts'
import { styleModelMeta } from './style/chrome.ts'
import { nav } from '../section-nav/nav.ts'

/** The part of nycode's Theme the fleet UI uses. */
export interface UiTheme {
  fg(color: string, text: string): string
  bold(text: string): string
}

export const MAX_ROWS = 10
export const ARM_MS = 2_000

const SUPERSCRIPT = ['⁰', '¹', '²', '³', '⁴', '⁵', '⁶', '⁷', '⁸', '⁹']
export function superscript(n: number): string {
  return String(n)
    .split('')
    .map((d) => SUPERSCRIPT[Number(d)] ?? d)
    .join('')
}

export function formatCost(cost: number): string {
  return cost < 0.01 ? '<$0.01' : `$${cost.toFixed(2)}`
}

/** Stats columns: fixed widths, right-aligned inside each, so values do not shift between ticks. */
const COL_ELAPSED = 7
const COL_TOKENS = 10
const COL_COST = 7
const STAT_SEP = ' | '

export function formatStats(row: Pick<FleetRow, 'elapsedMs' | 'contextTokens' | 'cost'>): { elapsed: string; tokens: string; cost: string } {
  return {
    elapsed: formatDuration(row.elapsedMs).padStart(COL_ELAPSED),
    tokens: `${formatTokens(row.contextTokens)} tok`.padStart(COL_TOKENS),
    cost: formatCost(row.cost).padStart(COL_COST),
  }
}

/** Colunas de stats da direita, da mais larga à mais estreita (cai custo, depois tokens): linhas dos agentes e o main alinham. */
function statVariants(st: { elapsed: string; tokens: string; cost: string }, theme: UiTheme): Array<{ w: number; text: string }> {
  const sep = theme.fg('dim', STAT_SEP)
  return [
    { w: COL_ELAPSED + COL_TOKENS + COL_COST + 2 * STAT_SEP.length, text: theme.fg('dim', st.elapsed) + sep + theme.fg('dim', st.tokens) + sep + theme.fg('cost', st.cost) },
    { w: COL_ELAPSED + COL_TOKENS + STAT_SEP.length, text: theme.fg('dim', st.elapsed) + sep + theme.fg('dim', st.tokens) },
    { w: visibleWidth(st.elapsed), text: theme.fg('dim', st.elapsed) },
  ]
}

/** Estado vivo da sessão principal; campo ausente = valor indisponível (coluna em branco, nunca um número errado). */
export interface MainStats {
  state: 'idle' | 'thinking' | 'working'
  elapsedMs?: number
  contextTokens?: number
  cost?: number
}

function mainStats(main: MainStats | undefined): { elapsed: string; tokens: string; cost: string } {
  const st: Partial<MainStats> = main ?? {}
  const blank = (w: number): string => ' '.repeat(w)
  return {
    elapsed: st.elapsedMs === undefined ? blank(COL_ELAPSED) : formatDuration(st.elapsedMs).padStart(COL_ELAPSED),
    tokens: st.contextTokens === undefined ? blank(COL_TOKENS) : `${formatTokens(st.contextTokens)} tok`.padStart(COL_TOKENS),
    cost: st.cost === undefined ? blank(COL_COST) : formatCost(st.cost).padStart(COL_COST),
  }
}

const MAIN_STATE: Record<MainStats['state'], { text: string; color: string }> = {
  idle: { text: 'idle', color: 'dim' },
  thinking: { text: 'thinking…', color: 'success' },
  working: { text: 'working', color: 'success' },
}

/** Linha do main, raiz da árvore: estado e dica à esquerda (a dica só se couber), stats nas mesmas colunas dos agentes.
 * Devolve a dica não encaixada para a linha própria; os stats nunca caem antes dela. */
function layoutMain(view: PanelView, mainLeft: string, theme: UiTheme, width: number): { line: string; hintOnOwnLine: boolean } {
  const mainSelected = view.focused && view.selectedId === null
  const head = theme.fg(mainSelected ? 'accent' : 'text', mainLeft)
  const v = statVariants(mainStats(view.main), theme)[0]!
  const stats = view.main ? v : undefined
  const statW = stats ? stats.w : 0
  const state = view.main ? MAIN_STATE[view.main.state] : undefined
  const room = width - visibleWidth(mainLeft) - statW - (stats ? 2 : 0) - 1
  const stateW = state ? visibleWidth(state.text) : 0
  const hintW = visibleWidth(view.hint)
  const withHint = hintW > 0 && (state ? stateW + TASK_SEP.length + hintW : hintW) <= room
  let body = ''
  if (state && room >= 1) body += theme.fg(state.color, truncateToWidth(state.text, room, ELLIPSIS))
  if (withHint && view.hint) body += (state ? theme.fg('dim', TASK_SEP) : '') + theme.fg(view.hintColor, view.hint)
  const left = head + (body ? ' ' + body : '')
  const line = stats ? left + ' '.repeat(Math.max(1, width - visibleWidth(left) - statW)) + stats.text : left
  return { line: truncateToWidth(line, width), hintOnOwnLine: !withHint && view.hint !== '' }
}

interface DegreeStyle {
  glyph: string
  name: string
  activity: string
  badge: string
}

export function degreeStyle(depth: number): DegreeStyle {
  if (depth <= 1) return { glyph: '○', name: 'text', activity: 'muted', badge: '' }
  if (depth === 2) return { glyph: '◦', name: 'muted', activity: 'dim', badge: '²' }
  return { glyph: '·', name: 'dim', activity: 'dim', badge: superscript(depth) }
}

/** Activity text and color: the run's state overrides the activity once it finished. */
export function activityOf(row: FleetRow, style: DegreeStyle): { text: string; color: string } {
  if (row.state === 'done') return { text: '✓ done', color: 'success' }
  if (row.state === 'failed') return { text: `✗ ${row.error || 'failed'}`, color: 'error' }
  if (row.state === 'cancelled') return { text: '■ stopped', color: 'warning' }
  if (isQuiet(row)) return { text: `quiet ${formatDuration(row.quietMs)}`, color: 'warning' }
  return { text: row.activity, color: style.activity }
}

/** Running with no recorded activity for QUIET_MS. */
export const isQuiet = (row: Pick<FleetRow, 'state' | 'quietMs'>): boolean => row.state === 'running' && row.quietMs >= QUIET_MS

/** `(+3)` for a folded parent, with what runs or failed below it: `(+3 · ● 1 · ✕ 1)`. */
function hiddenMark(row: FleetRow, theme: UiTheme): string {
  const sum = row.hiddenSummary
  const parts = [`+${row.hiddenDescendants}`]
  const colored = [sum?.running ? theme.fg('success', `● ${sum.running}`) : '', sum?.failed ? theme.fg('error', `✕ ${sum.failed}`) : ''].filter(Boolean)
  return theme.fg('dim', ` (${parts[0]}`) + colored.map((c) => theme.fg('dim', ' · ') + c).join('') + theme.fg('dim', ')')
}

const MIN_ACTIVITY = 12
const MIN_TASK = 12
/** Fewest task columns a row gives up for the full model label before it settles for less. */
const MIN_TASK_LAST = 6
const TASK_SEP = ' · '
const ELLIPSIS = '…'

/** One agent row, never wider than `width` (themes may add visible characters the layout cannot see).
 * `frame` (spinner index) animates running rows; without it they keep the static degree glyph. */
export function renderRow(row: FleetRow, selected: boolean, theme: UiTheme, width: number, frame?: number): string {
  return truncateToWidth(layoutRow(row, selected, theme, width, frame), width)
}

function layoutRow(row: FleetRow, selected: boolean, theme: UiTheme, width: number, frame?: number): string {
  const style = degreeStyle(row.depth)
  const finished = row.state !== 'running'
  const nameColor = selected ? 'accent' : finished ? 'dim' : style.name
  const spinning = !finished && frame !== undefined
  // Column 0 like the status line below: the selection shows as ❯ in the glyph slot, not as a gutter.
  const quiet = isQuiet(row)
  const glyph = selected ? '❯' : quiet ? '◌' : spinning ? SPINNER[frame % SPINNER.length]! : style.glyph
  const glyphColor = selected ? 'accent' : quiet ? 'warning' : spinning ? 'success' : nameColor
  const name = row.depth === 1 && !finished ? theme.bold(theme.fg(nameColor, row.agent)) : theme.fg(nameColor, row.agent)
  const head =
    (row.guides ? theme.fg('dim', row.guides) : '') +
    theme.fg(glyphColor, glyph) +
    ' ' +
    name +
    (row.nth > 0 ? theme.fg('dim', `#${row.nth}`) : '') +
    (style.badge ? theme.fg('dim', style.badge) : '') +
    (row.unread ? theme.fg('warning', ` ✉${row.unread}`) : '') +
    (row.hiddenDescendants > 0 ? hiddenMark(row, theme) : '')
  const act = activityOf(row, style)
  const variants = statVariants(formatStats(row), theme)
  const taskW = visibleWidth(row.task)
  const actW = visibleWidth(act.text)
  const finish = (left: string, v: { w: number; text: string }): string => left + ' '.repeat(Math.max(1, width - visibleWidth(left) - v.w)) + v.text
  // Body room beside a head: one space before it and at least one before the stats.
  type Mode = 'strict' | 'last' | 'bare'
  const place = (h: string, mode: Mode, minLast = 1, labelled = false): string | undefined => {
    const headW = visibleWidth(h)
    const room = (v: { w: number }): number => width - headW - 1 - v.w - 1
    // Task rows keep the task, then the activity; stats drop cost, then tokens, before the activity goes.
    const need = taskW > 0 ? Math.min(taskW, MIN_TASK) + (actW > 0 ? TASK_SEP.length + Math.min(actW, MIN_ACTIVITY) : 0) : Math.min(actW, MIN_ACTIVITY)
    // With the model label the activity gives way before the label does: the task alone is enough room.
    const floor = labelled && taskW > 0 ? Math.min(taskW, MIN_TASK) : need
    if (mode === 'strict') {
      // Labelled tier: the cost is nonessential, so it never takes the room the task still needs.
      for (const v of labelled ? variants.slice(1, 2) : variants.slice(0, 2)) {
        const avail = room(v)
        if (need === 0 && width - headW - v.w >= 1) return finish(h, v)
        if (need === 0 || avail < floor) continue
        return finish(h + ' ' + (avail >= need ? body(row.task, act, avail, theme) : theme.fg('task', truncateToWidth(row.task, avail, ELLIPSIS))), v)
      }
      return undefined
    }
    const last = variants[2]!
    if (mode === 'last') return taskW > 0 && room(last) >= minLast ? finish(h + ' ' + theme.fg('task', truncateToWidth(row.task, room(last), ELLIPSIS)), last) : undefined
    return width - headW - last.w >= 1 ? finish(h, last) : undefined
  }
  // Model and effort sit in the head, before the task, so a long task cannot swallow them. Priority: the label
  // (any candidate, widest first), then the task, then the stats. Tiers, each tried over every candidate:
  // 1. task and activity at their minimums, stats dropping cost then tokens (the layout without a label);
  // 2. task alone at its minimum, activity gone, tokens kept but no cost;
  // 3. elapsed only, task truncated; 4. elapsed only, no task. Only then is the label itself dropped.
  const heads = (row.meta ?? []).map((m) => head + ' ' + styleModelMeta(m, theme, !finished))
  const first = (mode: Mode, minLast = 1, labelled = false): string | undefined => heads.map((h) => place(h, mode, minLast, labelled)).find((l) => l !== undefined)
  return (
    first('strict') ??
    first('strict', 1, true) ??
    first('last', Math.min(taskW, MIN_TASK_LAST)) ??
    first('bare') ??
    place(head, 'strict') ??
    place(head, 'last') ??
    place(head, 'bare') ??
    truncateToWidth(head, width)
  )
}

/** Task (priority) and activity within `avail` columns, activity truncated first. */
function body(task: string, act: { text: string; color: string }, avail: number, theme: UiTheme): string {
  const taskW = visibleWidth(task)
  const actW = visibleWidth(act.text)
  if (taskW === 0) return theme.fg(act.color, truncateToWidth(act.text, avail, ELLIPSIS))
  if (actW === 0) return theme.fg('task', truncateToWidth(task, avail, ELLIPSIS))
  if (taskW + TASK_SEP.length + actW <= avail) return theme.fg('task', task) + theme.fg('dim', TASK_SEP) + theme.fg(act.color, act.text)
  const taskShown = truncateToWidth(task, avail - TASK_SEP.length - Math.min(actW, MIN_ACTIVITY), ELLIPSIS)
  const left = avail - visibleWidth(taskShown) - TASK_SEP.length
  return theme.fg('task', taskShown) + theme.fg('dim', TASK_SEP) + theme.fg(act.color, truncateToWidth(act.text, left, ELLIPSIS))
}

export interface PanelView {
  rows: FleetRow[]
  focused: boolean
  selectedId: string | null
  /** Live state and stats of the main session; absent when the source is unknown. */
  main?: MainStats
  /** Dica do main: na linha dele quando cabe, senão numa linha própria. */
  hint: string
  hintColor: 'muted' | 'dim' | 'warning'
  running: number
  finished: number
  /** Chip-row summary counts (running and quiet over every visible row, any depth). */
  counts: { running: number; quiet: number; failed: number; done: number }
  /** Spinner frame for running rows; undefined = static glyphs (reduced motion, NO_COLOR). */
  frame?: number
  /** Sub Agents section folded: the widget shows its title and summary only. */
  collapsed?: boolean
}

export function renderPanel(view: PanelView, theme: UiTheme, width: number): string[] {
  // Finished runs are counted in the title summary (`✓ N done`); no footer line for them.
  if (view.rows.length === 0) return []
  const mainSelected = view.focused && view.selectedId === null
  const mainLeft = `${mainSelected ? '❯' : view.focused ? '○' : '●'} main`
  const main = layoutMain(view, mainLeft, theme, width)
  const lines = [main.line]
  if (main.hintOnOwnLine) lines.push(truncateToWidth(theme.fg(view.hintColor, `  ${view.hint}`), width))
  const selIdx = view.rows.findIndex((r) => r.id === view.selectedId)
  let start = selIdx < MAX_ROWS ? 0 : selIdx - (MAX_ROWS - 1)
  start = Math.max(0, Math.min(start, view.rows.length - MAX_ROWS))
  const shown = view.rows.slice(start, start + MAX_ROWS)
  for (const row of shown) lines.push(renderRow(row, view.focused && row.id === view.selectedId, theme, width, view.frame))
  const more = view.rows.length - shown.length
  if (more > 0) lines.push(truncateToWidth(theme.fg('dim', `… ${more} more`), width))
  // One blank line separates the panel from the status line widget below it.
  return [...lines, '']
}

// ---- controller -------------------------------------------------------------------

export type Action = { type: 'open'; id: string } | { type: 'stop'; id: string } | { type: 'detach' } | { type: 'dismiss'; id: string }

export interface KeyEnv {
  editorText: string
  editorFocused: boolean
  overlayOpen: boolean
}

export interface ControllerDeps {
  getSource: () => FleetSource | undefined
  now: () => number
  /** Estado e stats do main para a linha raiz; ausente = linha sem estado nem colunas. */
  getMain?: (now: number) => MainStats | undefined
}

/** Keys that do something for the selected row only: x stops a running row but dismisses a finished one, →← fold only parents. */
export function focusHint(row: FleetRow | undefined): string {
  if (!row) return '↑↓ select · →← fold · esc back'
  return ['↑↓ select', 'enter open', row.childCount > 0 ? '→← fold' : '', row.state === 'running' ? 'x stop' : 'x dismiss', 'esc back'].filter(Boolean).join(' · ')
}

/** Every record below `id`, any depth (the stop key acts on one run: this is what stays under it). */
export function descendantCount(records: ReadonlyArray<{ id: string; parentId: string | null }>, id: string): number {
  const kids = (of: string): number => records.filter((r) => r.parentId === of).reduce((n, r) => n + 1 + kids(r.id), 0)
  return kids(id)
}

export class PanelController {
  focused = false
  selectedId: string | null = null
  readonly collapsed = new Set<string>()
  readonly dismissed = new Set<string>()
  /** The Sub Agents tab is not the open one (section-nav/nav.ts); runs go on, ↓ still reaches the tab. */
  get sectionCollapsed(): boolean {
    return nav.isFolded('subagents')
  }
  private armed: { id: string; until: number } | undefined
  private lastIndex = 0
  private readonly deps: ControllerDeps

  constructor(deps: ControllerDeps) {
    this.deps = deps
  }

  rows(): FleetRow[] {
    const source = this.deps.getSource()
    if (!source) return []
    return buildRows(source.list(), { now: this.deps.now(), collapsed: this.collapsed, dismissed: this.dismissed, panel: true, mainRoot: true, unread: unreadCounts() })
  }

  view(): PanelView {
    const source = this.deps.getSource()
    const now = this.deps.now()
    const rows = this.rows()
    this.repair(rows)
    const running = runningCount(rows)
    let hint: string
    let hintColor: PanelView['hintColor'] = 'muted'
    const armedRow = this.armed && now < this.armed.until ? rows.find((r) => r.id === this.armed?.id) : undefined
    if (armedRow) {
      hint = `press x again to stop ${armedRow.agent}${armedRow.childCount > 0 ? ` (${descendantCount(this.deps.getSource()?.list() ?? [], armedRow.id)} below)` : ''}`
      hintColor = 'warning'
    } else if (this.focused) {
      hint = focusHint(rows.find((r) => r.id === this.selectedId))
      hintColor = 'dim'
    } else {
      hint = `${running} running · ↓ to manage`
    }
    return {
      rows,
      focused: this.focused,
      selectedId: this.selectedId,
      hint,
      hintColor,
      running,
      finished: source ? finishedCount(source.list(), now) : 0,
      counts: {
        running,
        quiet: rows.filter(isQuiet).length,
        failed: rows.filter((r) => r.state === 'failed').length,
        done: source ? finishedCount(source.list(), now) : 0,
      },
      frame: motionEnabled() ? spinnerAt(now) : undefined,
      main: this.deps.getMain?.(now),
      collapsed: this.sectionCollapsed,
    }
  }

  /** Any tab change (nav.changed): folded, the rows are hidden, so the selection can only rest on the title (main). */
  tabChanged(): void {
    if (this.sectionCollapsed && this.focused) this.select(this.rows(), null)
    this.armed = undefined
  }

  /** Enter on the group title (section-nav): the keyboard goes to the first row (the root row when folded). False when there are no rows. */
  enterBody(): boolean {
    const rows = this.rows()
    if (rows.length === 0) return false
    this.focused = true
    this.select(rows, this.sectionCollapsed ? null : rows[0]!.id)
    return true
  }

  /** Esc (or ↑ on the root row): the body gives the keyboard back to the group title. */
  private leave(): void {
    this.unfocus()
    nav.back('subagents')
  }

  /** Keep the selection on a visible row: nearest remaining row, else main; unfocus when empty. */
  repair(rows: FleetRow[]): void {
    if (!this.focused) return
    if (rows.length === 0) return this.unfocus()
    if (this.selectedId === null) return
    const idx = rows.findIndex((r) => r.id === this.selectedId)
    if (idx >= 0) {
      this.lastIndex = idx
      return
    }
    this.selectedId = rows[Math.min(this.lastIndex, rows.length - 1)]?.id ?? null
  }

  private unfocus(): void {
    this.focused = false
    this.selectedId = null
    this.armed = undefined
  }

  private select(rows: FleetRow[], id: string | null): void {
    this.selectedId = id
    this.armed = undefined
    if (id !== null) this.lastIndex = Math.max(0, rows.findIndex((r) => r.id === id))
  }

  handleKey(data: string, env: KeyEnv): { consume: boolean; action?: Action } {
    if (isKeyRelease(data)) return { consume: false }
    if (env.overlayOpen || !env.editorFocused) {
      if (this.focused) this.unfocus()
      return { consume: false }
    }
    if (matchesKey(data, 'ctrl+b')) {
      const source = this.deps.getSource()
      return source?.hasForeground() ? { consume: true, action: { type: 'detach' } } : { consume: false }
    }
    const rows = this.rows()
    if (!this.focused) return { consume: false }
    this.repair(rows)
    if (!this.focused) return { consume: false }
    const ids: Array<string | null> = [null, ...rows.map((r) => r.id)]
    const pos = Math.max(0, ids.indexOf(this.selectedId))
    // Folded: no row is visible, so none can be opened, stopped or dismissed by a key.
    const row = this.selectedId === null || this.sectionCollapsed ? undefined : rows[pos - 1]
    if (matchesKey(data, 'down')) {
      // The body ends at its last row (Esc goes back to the title); folded: nothing below the root row.
      if (this.sectionCollapsed) return { consume: true }
      this.select(rows, ids[Math.min(ids.length - 1, pos + 1)] ?? null)
      return { consume: true }
    }
    if (matchesKey(data, 'up')) {
      if (pos === 0) this.leave()
      else this.select(rows, ids[pos - 1] ?? null)
      return { consume: true }
    }
    if (matchesKey(data, 'enter')) {
      if (!row) {
        this.leave()
        return { consume: true }
      }
      return { consume: true, action: { type: 'open', id: row.id } }
    }
    if (matchesKey(data, 'right') && row) {
      if (row.collapsed) this.collapsed.delete(row.id)
      else if (row.childCount > 0) this.select(rows, ids[pos + 1] ?? null)
      return { consume: true }
    }
    if (matchesKey(data, 'left') && row) {
      if (row.childCount > 0 && !row.collapsed) this.collapsed.add(row.id)
      else this.select(rows, row.parentId !== null && ids.includes(row.parentId) ? row.parentId : null)
      return { consume: true }
    }
    if (matchesKey(data, 'x') && row) {
      if (row.state !== 'running') {
        this.dismissed.add(row.id)
        this.armed = undefined
        this.repair(this.rows())
        return { consume: true, action: { type: 'dismiss', id: row.id } }
      }
      const now = this.deps.now()
      if (this.armed?.id === row.id && now < this.armed.until) {
        this.armed = undefined
        return { consume: true, action: { type: 'stop', id: row.id } }
      }
      this.armed = { id: row.id, until: now + ARM_MS }
      return { consume: true }
    }
    if (matchesKey(data, 'escape')) {
      this.leave()
      return { consume: true }
    }
    this.unfocus()
    return { consume: false }
  }
}

export function stopMessage(outcome: StopOutcome, agent: string): { text: string; level: 'info' | 'warning' } {
  switch (outcome) {
    case 'stopping':
      return { text: `Stopping ${agent}…`, level: 'info' }
    case 'not-running':
      return { text: `${agent} is not running`, level: 'info' }
    case 'refused':
      return { text: `Could not stop ${agent}: the process no longer matches the run`, level: 'warning' }
    default:
      return { text: `${agent}: run not found`, level: 'warning' }
  }
}

export interface ActionEnv {
  source: FleetSource
  notify: (message: string, type?: 'info' | 'warning' | 'error') => void
  open: (id: string) => void
}

/** Runs the side effect of an action the controller returned. */
export function executeAction(action: Action, env: ActionEnv): void {
  if (action.type === 'open') return env.open(action.id)
  if (action.type === 'detach') {
    const n = env.source.detachForeground()
    if (n > 0) env.notify(`Moved ${n} subagent call(s) to the background`, 'info')
    return
  }
  if (action.type === 'stop') {
    const agent = env.source.list().find((r) => r.id === action.id)?.agent ?? action.id
    const msg = stopMessage(env.source.stop(action.id), agent)
    env.notify(msg.text, msg.level)
  }
}

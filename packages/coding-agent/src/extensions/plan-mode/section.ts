/**
 * Plan section below the status line (replaces the string[] `plan-todos` widget, which pi cut at 10 lines
 * above the editor). One persistent component: a blank spacing line, the PLAN chip with `done/total`, a rule, then a bounded scrolling body;
 * nothing at all while the plan has no items. Fullscreen mode (default) routes mouse events to `handleMouse`
 * with local coordinates; regular mode has no mouse, so ↓ on an empty editor reaches the same focus by keyboard.
 * Focus: a body click returns `focus:true` (pi gives Plan keyboard focus and blurs the editor); Esc, a click
 * elsewhere (the editor takes focus) or any other key returns to the editor, which keeps its draft.
 * Record: docs/pi-interactive-display-2026-11-13.md ("Plan section").
 */
import type { ExtensionContext } from '../../core/extensions/types.ts'
import { matchesKey, truncateToWidth, visibleWidth } from '@nycode/tui'

import { heading, rule, tabbed } from '../subagent/fleet-ui/style/chrome.ts'
import { hudTheme, motionEnabled } from '../subagent/fleet-ui/style/palette.ts'
import { nav } from '../subagent/section-nav/nav.ts'
import { fleetSourceForUi } from '../subagent/fleet/source.ts'
import { bridge, clampOffset, viewportSize } from '../subagent/fleet-ui/section.ts'
import type { UiTheme } from '../subagent/fleet-ui/panel.ts'
import { applyMarks, drawerLines, planMarkdown, validKeys, stepSpend, type Mark } from './manage.ts'
import { formatDuration, formatSpend, markCounts, spendSince, PlanTimes, activeStep, tableDetail, tableHeader, tableRow } from './table.ts'
import type { TodoItem } from './utils.ts'

const KEY = 'plan-section'
const OPEN_PLAN = 'o abrir plano'

/** Set by plan-mode/index.ts: where the plan file lives (shown in the drawer). */
let planPath = ''
export const setPlanPath = (p: string): void => {
  planPath = p
}
const planFileHint = (): string | undefined => planPath || undefined
type Tui = { requestRender(): void; setFocus?(c: unknown): void; focusedComponent?: unknown; terminal?: { rows?: number } }
type Prev = { handleInput?(data: string): void; focused?: boolean }
type MouseEvent = { type?: string; x?: number; y?: number; wheelDelta?: number }

/** What the section asks of its owner (plan-mode/index.ts): tell the agent, stop its run, open the plan file. */
export interface PlanHost {
  /** A note for the agent about what the user did to the plan (delivered with the next turn, or steered into a running one). */
  notify(text: string, trigger?: boolean): void
  /** Stops the agent's current run (Pause). */
  abort(): void
  /** Opens the plan as a file; resolves a short message to show when it could not. */
  open(markdown: string): Promise<string | undefined>
  /** Asks the user for a short text (skip reason); undefined = cancelled. */
  ask?(title: string): Promise<string | undefined>
  /** Opens the plan in a modal (title and description per step); without it `o` opens the file. */
  show?(items: readonly TodoItem[]): void
  /** Marks or the user's pause changed: the owner writes them to the session so they survive /reload (D7). */
  persist?(): void
}

/** What the owner knows beyond the items: the plan on hold (PLAN WAITING / PLAN BLOCKED) and the todo tool's progress (D3, D4). */
export interface PlanExtra {
  hold?: 'waiting' | 'blocked'
  todo?: { done: number; total: number; doing?: string }
}

const MARK_STATUS = new Set(['blocked', 'failed', 'skipped'])

export class PlanSection {
  /** Not the open tab (section-nav/nav.ts). */
  get collapsed(): boolean {
    return nav.isFolded('plan')
  }
  offset = 0
  /** Selected step (index into the items); the keys below act on it while Plan is focused. */
  cursor = 0
  drawer = false
  host?: PlanHost
  private raw: TodoItem[] = []
  private marks = new Map<number, Mark>()
  private items: TodoItem[] = []
  private tui?: Tui
  private theme?: UiTheme
  private ctx?: ExtensionContext
  private prev?: Prev
  private nativeFocus = false
  private registered = false
  private readonly times = new PlanTimes()
  private hold?: 'waiting' | 'blocked'
  private todo?: PlanExtra['todo']
  /** The hold (not the user) stopped the clock: Pause then stays the user's own state. */
  private held = false
  /** A pause restored from the session, applied once the clocks observed the items. */
  private pendingPause = false
  /** The clocks restarted at a resume: the footer says so (they are not persisted). */
  private resumed = false
  private timer?: ReturnType<typeof setInterval>
  /** D13: `agent state` of the running fleet lanes by `planStep`, refreshed on fleet changes (never read per render). */
  private lanes = new Map<number, string[]>()
  private offFleet?: () => void
  /** Clock the table reads; tests replace it. */
  now: () => number = Date.now

  /** Set by pi's TUI when focus moves: losing it (a click elsewhere, an overlay) forgets the editor to return to. */
  get focused(): boolean {
    return this.nativeFocus
  }
  set focused(value: boolean) {
    this.nativeFocus = value
    if (!value) this.prev = undefined
  }

  /** Native focus, from a click or from ↓: pi's fullscreen viewport would take PageUp/PageDown/Home/End for the transcript
   * unless the focused component says it captures them (pi-tui `capturesViewportInput`). */
  get capturesViewportInput(): boolean {
    return this.nativeFocus
  }

  /** Plan owns the keyboard. */
  focusedVisible(): boolean {
    return this.nativeFocus
  }

  private visible(): number {
    return viewportSize(this.tui?.terminal?.rows ?? 24)
  }

  /** Whose list the section shows: a plan execution or the todo tool (header PLAN/TODO). */
  private source: 'plan' | 'todo' = 'plan'
  /** True while a finished todo list (or no list) keeps the widget off. */
  private hidden = false

  update(ctx: ExtensionContext, items: TodoItem[], source: 'plan' | 'todo' = 'plan', extra?: PlanExtra): void {
    this.ctx = ctx
    if (extra) {
      this.hold = extra.hold
      this.todo = extra.todo
    }
    const hadItems = this.items.length > 0 && !this.hidden
    // Another list is not the same run: its clock, spend and marks start over (a todo left over from an
    // earlier task once inherited a whole plan's time and 4M tokens, 2026-11-13).
    if (source !== this.source) {
      this.source = source
      this.resetManagement()
      this.times.reset()
      this.resumed = false
    }
    if (items.length === 0) this.resetManagement()
    this.raw = items
    items = applyMarks(items, this.marks)
    this.items = items
    this.cursor = Math.min(this.cursor, Math.max(0, items.length - 1))
    this.times.observe(items, this.now())
    this.syncHold()
    this.offset = clampOffset(this.offset, items.length, this.visible())
    // The window follows the work: a list longer than the window used to stay on its finished head, with the
    // running and pending rows off screen (2026-11-15). One finished row stays above as context.
    const open = items.findIndex((i) => !i.completed)
    if (open >= 0 && (open < this.offset || open >= this.offset + this.visible())) {
      this.offset = clampOffset(Math.max(0, open - 1), items.length, this.visible())
    }
    this.syncTimer()
    // A finished todo list hides itself (a plan keeps its done state); a new open item brings it back.
    const hide = items.length === 0 || (source === 'todo' && items.every((i) => i.completed))
    this.hidden = hide
    if (hide) {
      this.remove()
    } else {
      this.ensure()
      this.syncTimer()
      this.tui?.requestRender()
    }
    bridge.planActive = () => this.items.length > 0 && !this.hidden
    bridge.reassertPlan = () => this.reassert()
    nav.register({
      id: 'plan',
      active: () => this.items.length > 0 && !this.hidden,
      hasBody: true,
      label: () => `${this.source === 'todo' ? 'Todo' : 'Plan'} ${this.items.filter((i) => i.completed).length}/${this.items.length}`,
      changed: () => this.tabChanged(),
      enter: () => this.focusByKeyboard(),
    })
    if (hadItems !== !hide) bridge.onPlanChange?.()
  }

  private resetManagement(): void {
    this.marks.clear()
    this.cursor = 0
    this.drawer = false
    this.times.resume(this.now())
  }

  /** The user's pause (a hold also stops the clock, but is not a pause). */
  get paused(): boolean {
    return this.pendingPause || (this.times.paused && !this.held)
  }

  /** Marks for the session entry (D7). */
  exportMarks(): Array<[number, Mark]> {
    return [...this.marks]
  }

  /** Marks and pause from a session entry (JSON on disk: every field is checked). `resumed`: the clocks start over, the footer says so. */
  restore(saved: { marks?: unknown; paused?: unknown } | undefined, resumed: boolean): void {
    this.marks.clear()
    if (Array.isArray(saved?.marks)) {
      for (const m of saved.marks) {
        const [step, mark] = Array.isArray(m) ? m : []
        if (Number.isInteger(step) && mark && MARK_STATUS.has(mark.status)) this.marks.set(step, { status: mark.status, note: typeof mark.note === 'string' ? mark.note : '' })
      }
    }
    this.pendingPause = saved?.paused === true
    this.resumed = resumed
  }

  /** A hold stops the step clock until the next prompt (the pause machinery of PlanTimes); a user pause is left alone. */
  private syncHold(): void {
    const now = this.now()
    if (this.pendingPause) {
      this.pendingPause = false
      if (this.times.paused && this.held) this.held = false
      this.times.pause(now)
    }
    if (this.hold && !this.times.paused) {
      this.times.pause(now)
      this.held = true
    } else if (!this.hold && this.held) {
      this.times.resume(now)
      this.held = false
    }
  }

  private selected(): TodoItem | undefined {
    return this.items[this.cursor]
  }

  private moveCursor(delta: number): void {
    this.cursor = Math.max(0, Math.min(this.items.length - 1, this.cursor + delta))
    const v = this.visible()
    if (this.cursor < this.offset) this.offset = this.cursor
    else if (this.cursor >= this.offset + v) this.offset = this.cursor - v + 1
    this.offset = clampOffset(this.offset, this.items.length, v)
  }

  private flash?: { text: string; until: number }

  private say(text: string): void {
    this.flash = { text, until: this.now() + 4000 }
    this.tui?.requestRender()
  }

  /** s: skip the selected step (asks why); r: reopen it. The agent is told either way. */
  private async skipOrReopen(): Promise<void> {
    const item = this.selected()
    if (!item || item.completed) return
    if (item.status === 'skipped') {
      this.marks.delete(item.step)
      this.refresh()
      this.host?.persist?.()
      this.host?.notify(`O usuário reabriu o passo ${item.step} do plano ("${item.text}"): execute-o.`)
      return
    }
    const reason = this.host?.ask ? await this.host.ask(`Pular passo ${item.step}: motivo (opcional)`) : ''
    if (reason === undefined) return
    this.marks.set(item.step, { status: 'skipped', note: reason.trim() || 'pulado pelo usuário' })
    this.refresh()
    this.host?.persist?.()
    this.host?.notify(`O usuário pulou o passo ${item.step} do plano ("${item.text}")${reason.trim() ? `: ${reason.trim()}` : ''}. Não o execute; siga para o próximo.`)
  }

  private togglePause(): void {
    const now = this.now()
    this.pendingPause = false
    if (this.times.paused) {
      this.held = false
      this.times.resume(now)
      this.host?.notify('O usuário retomou o plano: continue do passo atual.', true)
    } else {
      this.times.pause(now)
      this.host?.abort()
      this.host?.notify('O usuário pausou o plano. Não continue até ele retomar.')
    }
    this.syncTimer()
    this.tui?.requestRender()
    this.host?.persist?.()
  }

  private async openFile(): Promise<void> {
    const msg = await this.host?.open(planMarkdown(this.items))
    if (msg) this.say(msg)
  }

  /** `o` and the footer button: the plan modal, or the file when the host has no modal. */
  private openPlan(): void {
    if (this.host?.show) this.host.show(this.items)
    else void this.openFile()
  }

  private refresh(): void {
    if (this.ctx) this.update(this.ctx, this.raw)
  }

  /** Session boundary: widget, listener and bridge links go away. */
  shutdown(ctx: ExtensionContext | undefined = this.ctx): void {
    this.items = []
    this.raw = []
    this.marks.clear()
    this.drawer = false
    this.times.reset()
    this.hold = undefined
    this.todo = undefined
    this.held = false
    this.pendingPause = false
    this.resumed = false
    this.syncTimer()
    this.prev = undefined
    this.nativeFocus = false
    this.remove(ctx)
    bridge.planActive = () => false
    bridge.reassertPlan = () => {}
    nav.unregister('plan')
  }

  /** One tick per second while a step is running and the body shows: the counter runs without other events. */
  private syncTimer(): void {
    const want = !this.collapsed && this.registered && activeStep(this.items) !== undefined
    if (want && !this.timer) {
      this.timer = setInterval(() => this.tui?.requestRender(), 1000)
      this.timer.unref?.()
    } else if (!want && this.timer) {
      clearInterval(this.timer)
      this.timer = undefined
    }
  }

  private ensure(): void {
    const ui = this.ctx?.ui
    // Print/RPC modes hand out a ctx.ui without TUI hooks: no widget, no key listener there.
    if (!ui || this.ctx?.hasUI === false || typeof ui.setWidget !== 'function') return
    if (!this.registered) {
      this.register()
    }
  }

  private register(): void {
    this.ctx?.ui.setWidget(
      KEY,
      (tui, theme) => {
        this.tui = tui as unknown as Tui
        this.theme = hudTheme(theme as unknown as UiTheme)
        return this as never
      },
      { placement: 'belowEditor' },
    )
    this.registered = true
    this.subscribeFleet()
  }

  /** D13: no fleet source yet (or none at this depth) leaves the table as it was. */
  private subscribeFleet(): void {
    if (this.offFleet) return
    try {
      const fleet = fleetSourceForUi()
      this.offFleet = fleet.onChange(() => {
        this.readLanes()
        this.tui?.requestRender()
      })
      this.readLanes()
    } catch {
      // no fleet source: no agent on the step line
    }
  }

  private readLanes(): void {
    const next = new Map<number, string[]>()
    try {
      for (const r of fleetSourceForUi().list()) {
        if (r.state !== 'running' || r.planStep === undefined) continue
        next.set(r.planStep, [...(next.get(r.planStep) ?? []), `${r.agent} ${r.state}`])
      }
    } catch {
      // fleet gone: nothing to show
    }
    this.lanes = next
  }

  private reassert(): void {
    if (this.registered && this.items.length > 0) this.register()
  }

  private remove(ctx: ExtensionContext | undefined = this.ctx): void {
    if (!this.registered) return
    try {
      ctx?.ui.setWidget(KEY, undefined)
    } catch {
      // Session gone: the widget went with it.
    }
    this.registered = false
    this.offFleet?.()
    this.offFleet = undefined
    this.lanes = new Map()
    this.syncTimer()
  }

  // ---- render ----

  invalidate(): void {}

  private spendCache?: { at: number; text: string }
  /** Row of the footer line in the last render (local coordinates); -1 while folded. */
  private footerRow = -1

  /** Tokens and dollars of this session since the plan began, cached for 2 s (the branch is walked once per refresh, not per frame). */
  private spend(now: number): string {
    if (this.spendCache && Math.abs(now - this.spendCache.at) < 2000) return this.spendCache.text
    let text = ''
    try {
      const since = this.times.startedAt
      const entries = this.ctx?.sessionManager?.getBranch?.() ?? []
      if (since !== undefined && entries.length > 0) {
        const spent = spendSince(entries, since)
        text = spent.tokens > 0 || spent.cost > 0 ? formatSpend(spent) : ''
      }
    } catch {
      text = '' // stale session context
    }
    this.spendCache = { at: now, text }
    return text
  }

  render(width: number): string[] {
    nav.stamp('plan')
    const theme = this.theme
    if (!theme || this.items.length === 0) return []
    const total = this.items.length
    const done = this.items.filter((i) => i.completed).length
    const visible = this.visible()
    this.offset = clampOffset(this.offset, total, visible)
    const focus = this.focusedVisible()
    // Scrolled window as done/shown (user request 2026-11-13: a bare `1–6` read as a count).
    const shown = this.items.slice(this.offset, this.offset + visible)
    const range = !this.collapsed && total > visible ? ` · ${shown.filter((i) => i.completed).length}/${shown.length} na tela` : ''
    const paused = this.paused
    // Keys live in the title: a line that appears on focus would move the transcript under the user's eyes.
    const flash = this.flash && this.flash.until > this.now() ? ` · ${this.flash.text}` : ''
    let hint = ''
    const now = this.now()
    const elapsed = this.times.elapsed(now)
    const spend = this.spend(now)
    const todo = this.source === 'plan' && this.todo ? ` · todo ${this.todo.done}/${this.todo.total}${this.todo.doing ? ` · ${this.todo.doing}` : ''}` : ''
    const info = `${elapsed === undefined ? '' : ` · ${formatDuration(elapsed)}${this.resumed ? ' desde a retomada' : ''}`}${spend ? ` · ${spend}` : ''}${todo}${paused ? ' · pausado' : ''}${range}${flash}`
    const lead = `${this.source === 'todo' ? 'TODO' : 'PLAN'} ${done}/${total}${info}`
    if (focus) {
      // Keys that fit, most useful first; `esc back` always stays (the way out must never be cut). The tab names take the start of the bar.
      const keys = validKeys(this.selected(), paused).filter(([k]) => k !== 'esc').map(([k, l]) => `${k} ${l}`)
      const room = width - visibleWidth(info) - ' · esc back'.length // the footer line has the whole width
      // `o abrir plano` is the footer button: it always stays, the other keys fit around it (shown in their own order).
      const fit: string[] = [OPEN_PLAN]
      for (const k of keys) if (k !== OPEN_PLAN && visibleWidth(` · ${[...fit, k].join(' · ')}`) <= room) fit.push(k)
      hint = ` · ${keys.filter((k) => fit.includes(k)).join(' · ')} · esc back`
    }
    const title = `${lead}${hint}`
    // Focused: the chip turns accent (the hint says how to leave); the leading blank line separates the group from Status Line.
    const marks = markCounts(this.items)
    const colored = [
      marks.blocked ? theme.fg('warning', `${marks.blocked} bloqueado${marks.blocked > 1 ? 's' : ''}`) : '',
      marks.failed ? theme.fg('error', `${marks.failed} falhou`) : '',
      marks.skipped ? theme.fg('dim', `${marks.skipped} pulado${marks.skipped > 1 ? 's' : ''}`) : '',
      done + marks.skipped === total && done > 0 ? theme.fg('success', 'concluído') : '',
    ].filter(Boolean)
    const tail = colored.join(theme.fg('dim', ' · '))
    const base = heading(title, theme, width, this.source, focus ? 'accent' : undefined)
    const head = tail ? truncateToWidth(base + theme.fg('dim', ' · ') + tail, width) : base
    // Time, spend, window and keys sit on a footer line under the table (owner request 2026-11-14; they used to follow the
    // tab name on the bar). The line is always there, so focusing never moves the transcript. The bar keeps the marks.
    // The button is there focused or not (a click on the line opens the plan modal); the info text gives way to it.
    const button = focus ? hint : ` · ${OPEN_PLAN}`
    const infoText = truncateToWidth(info.replace(/^ · /, ''), Math.max(0, width - visibleWidth(button)))
    const footer = truncateToWidth(theme.fg('dim', infoText ? infoText + button : button.replace(/^ · /, '')), width)
    const detail = tail
    const redraw = (): void => this.tui?.requestRender()
    this.footerRow = -1
    if (this.collapsed) return tabbed('plan', ['', head, rule(theme, width)], detail, theme, width, redraw)
    const motion = motionEnabled()
    const active = activeStep(this.items)
    const body = this.items.slice(this.offset, this.offset + visible).flatMap((i) => {
      const sel = focus && this.items[this.cursor] === i
      const out = [this.row(i, theme, width, now, motion, active, sel)]
      const detail = tableDetail(i, theme, width, active)
      if (detail !== null && !(sel && this.drawer)) out.push(detail)
      if (sel && this.drawer) out.push(...this.drawerFor(i, active, width, theme))
      return out
    })
    const header = tableHeader(theme, width)
    const lines = tabbed('plan', ['', head, rule(theme, width), ...(header ? [header] : []), ...body, footer], detail, theme, width, redraw)
    this.footerRow = lines.length - 1
    return lines
  }

  /** The running step on hold: `bloqueado` (the table's own state) or `em espera` (the paused row, relabelled). */
  private row(item: TodoItem, theme: UiTheme, width: number, now: number, motion: boolean, active: number | undefined, selected: boolean): string {
    const agents = !item.completed && !item.status && active === item.step ? this.lanes.get(item.step) : undefined
    const i = agents ? { ...item, text: `${item.text} · ${agents.join(' · ')}` } : item
    const onHold = this.hold !== undefined && !i.completed && !i.status && active === i.step
    if (!onHold) return tableRow(i, theme, width, this.times, now, motion, active, { selected, paused: this.paused })
    if (this.hold === 'blocked') return tableRow({ ...i, status: 'blocked' }, theme, width, this.times, now, motion, active, { selected })
    const row = tableRow(i, theme, width, this.times, now, motion, active, { selected, paused: true })
    return i.text.includes('pausado') ? row : row.replace('pausado', 'em espera')
  }

  private drawerFor(item: TodoItem, active: number | undefined, width: number, theme: UiTheme): string[] {
    const now = this.now()
    const held = this.hold !== undefined && !item.completed && !item.status && active === item.step
    const key = item.completed ? 'feito' : item.status === 'skipped' ? 'pulado' : held ? (this.hold === 'blocked' ? 'bloqueado' : 'em espera') : active === item.step ? (this.paused ? 'pausado' : 'fazendo') : 'a fazer'
    const w = this.times.window(item.step, now)
    const entries = this.ctx?.sessionManager?.getBranch?.() ?? []
    const done = item.completed
    return drawerLines(
      item,
      {
        state: key,
        agent: item.agent,
        tookMs: done && w ? w.to - w.from : undefined,
        runningMs: !done && w && key !== 'a fazer' ? w.to - w.from : undefined,
        spend: stepSpend(entries, this.times, item.step, now),
        file: planFileHint(),
      },
      theme,
      width,
    )
  }

  // ---- mouse (fullscreen mode): local coordinates; the bar rows (0-2) belong to this widget only when it draws the bar ----

  handleMouse(event: MouseEvent): { handled?: boolean; focus?: boolean; render?: boolean } | undefined {
    if (this.items.length === 0) return undefined
    if (event.type === 'click') {
      const y = event.y ?? -1
      if (y < nav.barRows('plan')) return nav.clickBar(event.x, y) ? { handled: true, render: true } : undefined
      if (this.collapsed) return undefined
      // The footer button: opens the plan modal, the keyboard stays where it was.
      if (y === this.footerRow) {
        this.openPlan()
        return { handled: true, render: true }
      }
      // Remember who held the keyboard (the editor) so Esc and typing can give it back.
      const current = this.tui?.focusedComponent as Prev | undefined
      if (current && current !== (this as unknown)) this.prev = current
      return { focus: true, render: true }
    }
    // The wheel belongs to Plan only while it is focused and has a body; otherwise it scrolls the chat.
    if (event.type === 'wheel' && this.focusedVisible() && !this.collapsed) {
      const lines = event.wheelDelta ?? 0 // logical lines, negative = up (pi's wheel acceleration included)
      this.scrollBy(lines === 0 ? 0 : Math.trunc(lines) || Math.sign(lines))
      return { handled: true, render: true }
    }
    return undefined
  }

  private scrollBy(delta: number): void {
    this.offset = clampOffset(this.offset + delta, this.items.length, this.visible())
  }

  /** Any tab change (nav.changed): timer only while the body shows, window kept inside the list. */
  private tabChanged(): void {
    this.syncTimer()
    this.offset = clampOffset(this.offset, this.items.length, this.visible())
    this.tui?.requestRender()
  }

  /** Keys shared by both focus modes; true when Plan used the key. */
  private navigate(data: string): boolean {
    const page = this.visible()
    const list = !this.collapsed
    if (matchesKey(data, 'down')) list ? this.moveCursor(1) : this.scrollBy(1)
    else if (matchesKey(data, 'up')) {
      list ? this.moveCursor(-1) : this.scrollBy(-1)
    } else if (matchesKey(data, 'pageDown')) list ? this.moveCursor(page) : this.scrollBy(page)
    else if (matchesKey(data, 'pageUp')) list ? this.moveCursor(-page) : this.scrollBy(-page)
    else if (matchesKey(data, 'home')) list ? this.moveCursor(-Infinity) : (this.offset = 0)
    else if (matchesKey(data, 'end')) list ? this.moveCursor(Infinity) : (this.offset = clampOffset(Infinity, this.items.length, page))
    else if (matchesKey(data, 'enter') && list) this.drawer = !this.drawer
    else if (list && data === 's') void this.skipOrReopen()
    else if (list && data === 'r' && this.selected()?.status === 'skipped') void this.skipOrReopen()
    else if (data === 'p') this.togglePause()
    else if (data === 'o') this.openPlan()
    else return false
    return true
  }

  // ---- keys while pi gave Plan native focus (after a body click) ----

  handleInput(data: string): void {
    if (this.navigate(data)) return void this.tui?.requestRender()
    const editor = this.prev
    this.release()
    if (matchesKey(data, 'escape')) return nav.back('plan')
    // Anything else is for the editor: typing and chords alike arrive there once, nothing is lost. Ctrl+Enter
    // (send now) is a core shortcut that only fires while the editor holds focus: from Plan, Esc first, then the chord.
    editor?.handleInput?.(data)
  }

  private release(): void {
    const editor = this.prev
    if (this.nativeFocus && editor) this.tui?.setFocus?.(editor)
    this.nativeFocus = false
    this.prev = undefined
    this.tui?.requestRender()
  }

  // ---- keyboard path: ↓ on an empty editor gives Plan REAL native focus (same as a body click) ----

  private focusByKeyboard(): boolean {
    const tui = this.tui
    if (this.items.length === 0 || !tui?.setFocus) return false
    const current = tui.focusedComponent as Prev | undefined
    if (current && current !== (this as unknown)) this.prev = current
    tui.setFocus(this)
    tui.requestRender()
    return true
  }

}

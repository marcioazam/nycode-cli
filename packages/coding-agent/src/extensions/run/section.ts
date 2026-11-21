/**
 * Run section below Plan (local patch): a belowEditor widget, same mechanics as plan-mode/section.ts: native focus
 * by Enter on its title (section-nav: ↓ on an empty editor focuses the first title) or by a click, Esc back to the title,
 * a 1 s render timer only while a run is live and the body shows, nothing at all while there are no runs.
 * Rendering is in view.ts.
 */
import { matchesKey } from '@nycode/tui'
import type { ExtensionContext } from '../../core/extensions/types.ts'

import { hudTheme, motionEnabled, SPINNER_MS } from '../subagent/fleet-ui/style/palette.ts'
import type { UiTheme } from '../subagent/fleet-ui/panel.ts'
import { fleetSourceForUi } from '../subagent/fleet/source.ts'
import { editorOwnsFocus } from '../subagent/fleet-ui/section.ts'
import { tabbed } from '../subagent/fleet-ui/style/chrome.ts'
import { nav } from '../subagent/section-nav/nav.ts'
import type { RunRecord, RunRegistry } from './registry.ts'
import { startShell, stopRun } from './shell.ts'
import { MAX_ROWS, renderRun, type View } from './view.ts'

const KEY = 'run-section'

type Tui = { requestRender(): void; setFocus?(c: unknown): void; focusedComponent?: unknown; terminal?: { rows?: number } }
type Prev = { handleInput?(data: string): void }
type MouseEvent = { type?: string; x?: number; y?: number; wheelDelta?: number }

export class RunSection {
  /** Not the open tab (section-nav/nav.ts). */
  get collapsed(): boolean {
    return nav.isFolded('run')
  }
  selectedId?: string
  offset = 0
  follow = true
  expanded = false
  filter = ''
  filtering = false
  now: () => number = Date.now
  private frozen?: string[]
  private flash?: { text: string; until: number }
  private lineIds: Array<string | undefined> = []
  private tui?: Tui
  private theme?: UiTheme
  private ctx?: ExtensionContext
  private prev?: Prev
  private nativeFocus = false
  private registered = false
  private offInput?: () => void
  private offChange?: () => void
  private offFleet?: () => void
  private timer?: ReturnType<typeof setInterval>

  private readonly reg: RunRegistry

  constructor(reg: RunRegistry) {
    this.reg = reg
  }

  get focused(): boolean {
    return this.nativeFocus
  }
  set focused(value: boolean) {
    this.nativeFocus = value
    if (!value) this.prev = undefined
  }

  /** Keeps nycode's fullscreen viewport from taking PageUp/PageDown/Home/End while Run is focused. */
  get capturesViewportInput(): boolean {
    return this.nativeFocus
  }

  // ---- lifecycle ----

  /** Session start: wires the registry and the bridge; the widget appears with the first run. */
  start(ctx: ExtensionContext): void {
    this.ctx = ctx
    this.offChange ??= this.reg.onChange(() => this.sync())
    this.subscribeFleet()
    nav.register({
      id: 'run',
      active: () => this.registered,
      hasBody: true,
      label: () => {
        const rows = this.reg.snapshot()
        return `Run ${rows.filter((r) => r.state === 'running').length || rows.length}`
      },
      changed: () => this.tabChanged(),
      enter: () => this.focusByKeyboard(),
    })
    this.sync()
  }

  /** Agent lanes live in the fleet: its change event replaces the tool_result + timer polling. Retried from sync() until the source exists. */
  private subscribeFleet(): void {
    if (this.offFleet) return
    try {
      this.offFleet = fleetSourceForUi().onChange(() => {
        this.reg.fleetChanged()
        this.sync()
      })
    } catch {
      // no fleet source yet (session_start at depth 0 creates it)
    }
  }

  /** Session boundary: timer, listener, widget and bridge links go away (live shells keep running, detached). */
  shutdown(ctx: ExtensionContext | undefined = this.ctx): void {
    this.offChange?.()
    this.offChange = undefined
    this.offFleet?.()
    this.offFleet = undefined
    this.offInput?.()
    this.offInput = undefined
    this.nativeFocus = false
    this.prev = undefined
    this.remove(ctx)
    nav.unregister('run')
  }

  /** Re-reads the registry: the widget shows only while a run is live; finished ones stay in the registry (tool, history). */
  sync(): void {
    this.subscribeFleet()
    const rows = this.reg.snapshot()
    if (!rows.some((r) => r.state === 'running')) this.remove()
    else {
      this.ensure()
      this.fixSelection()
    }
    this.syncTimer(rows)
    this.tui?.requestRender()
  }

  private syncTimer(rows: RunRecord[] = this.reg.snapshot()): void {
    const want = !this.collapsed && this.registered && rows.some((r) => r.state === 'running')
    if (want && !this.timer) {
      // Spinner frames (title and row pulse) need the Sub Agents cadence; without motion the old 1 s tick.
      this.timer = setInterval(() => this.sync(), motionEnabled() ? SPINNER_MS : 1000)
      this.timer.unref?.()
    } else if (!want && this.timer) {
      clearInterval(this.timer)
      this.timer = undefined
    }
  }

  private ensure(): void {
    const ui = this.ctx?.ui
    if (!ui || this.ctx?.hasUI === false || typeof ui.setWidget !== 'function' || this.registered) return
    ui.setWidget(
      KEY,
      (tui, theme) => {
        this.tui = tui as unknown as Tui
        this.theme = hudTheme(theme as unknown as UiTheme)
        return this as never
      },
      { placement: 'belowEditor' },
    )
    this.registered = true
    if (typeof ui.onTerminalInput === 'function') this.offInput ??= ui.onTerminalInput((data) => this.onKey(data))
  }

  private remove(ctx: ExtensionContext | undefined = this.ctx): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = undefined
    }
    if (!this.registered) return
    try {
      ctx?.ui.setWidget(KEY, undefined)
    } catch {
      // session gone: the widget went with it
    }
    this.registered = false
    this.nativeFocus = false
    this.prev = undefined
  }

  // ---- state ----

  private visibleRows(): RunRecord[] {
    const q = this.filter.toLowerCase()
    const rows = this.reg.snapshot()
    return q ? rows.filter((r) => `${r.name} ${r.command} ${r.id}`.toLowerCase().includes(q)) : rows
  }

  private fixSelection(): void {
    const rows = this.visibleRows()
    if (!rows.some((r) => r.id === this.selectedId)) this.selectedId = rows[0]?.id
    this.scrollIntoView(rows)
  }

  private scrollIntoView(rows: RunRecord[]): void {
    const at = Math.max(0, rows.findIndex((r) => r.id === this.selectedId))
    if (at < this.offset) this.offset = at
    else if (at >= this.offset + MAX_ROWS) this.offset = at - MAX_ROWS + 1
    this.offset = Math.max(0, Math.min(this.offset, Math.max(0, rows.length - MAX_ROWS)))
  }

  private select(rows: RunRecord[], delta: number): void {
    const at = Math.max(0, rows.findIndex((r) => r.id === this.selectedId))
    this.selectedId = rows[Math.max(0, Math.min(rows.length - 1, at + delta))]?.id
    this.frozen = undefined
    if (!this.follow) this.freeze()
    this.scrollIntoView(rows)
  }

  private selected(): RunRecord | undefined {
    return this.visibleRows().find((r) => r.id === this.selectedId)
  }

  private freeze(): void {
    this.frozen = [...(this.selected()?.tail ?? [])]
  }

  private say(text: string): void {
    this.flash = { text, until: this.now() + 4000 }
    this.tui?.requestRender()
  }

  // ---- render ----

  invalidate(): void {}

  render(width: number): string[] {
    const theme = this.theme
    if (!theme) return []
    nav.stamp('run')
    const rows = this.visibleRows()
    const total = this.reg.snapshot().length
    this.scrollIntoView(rows)
    const now = this.now()
    const sel = rows.find((r) => r.id === this.selectedId)
    if (this.nativeFocus && sel) sel.seenSeq = sel.outputSeq
    const view: View = {
      rows,
      total,
      now,
      collapsed: this.collapsed,
      focused: this.nativeFocus,
      selectedId: this.selectedId,
      offset: this.offset,
      follow: this.follow,
      frozen: this.frozen,
      expanded: this.expanded,
      filter: this.filter,
      filtering: this.filtering,
      motion: motionEnabled(),
      flash: this.flash && this.flash.until > now ? this.flash.text : undefined,
    }
    const out = renderRun(view, theme, width)
    this.lineIds = out.ids
    return tabbed('run', out.lines, out.detail, theme, width, () => this.tui?.requestRender())
  }

  // ---- mouse (fullscreen): local rows; the bar rows (0-2) belong to this widget only when it draws the bar. `lineIds` is indexed by the body layout (body from row 3). ----

  handleMouse(event: MouseEvent): { handled?: boolean; focus?: boolean; render?: boolean } | undefined {
    if (this.lineIds.length === 0) return undefined
    if (event.type === 'click') {
      const y = event.y ?? -1
      const bar = nav.barRows('run')
      if (y < bar) return nav.clickBar(event.x, y) ? { handled: true, render: true } : undefined
      if (this.collapsed) return undefined
      const id = this.lineIds[y - bar + 3]
      if (id) this.selectedId = id
      const current = this.tui?.focusedComponent as Prev | undefined
      if (current && current !== (this as unknown)) this.prev = current
      return { focus: true, render: true }
    }
    return undefined
  }

  /** Any tab change (nav.changed): timer only while the body shows. */
  private tabChanged(): void {
    this.syncTimer()
    this.tui?.requestRender()
  }

  // ---- actions ----

  private stop(r: RunRecord): void {
    this.say(stopRun(this.reg, r) === 'stopping' ? `parando ${r.name}` : 'não está rodando')
  }

  private repeat(r: RunRecord): void {
    if (r.kind !== 'shell') return this.say('r: só para shells')
    if (r.state === 'running') return this.say('r: ainda está rodando')
    if (!r.repeatable) return this.say('r: este comando não pode ser repetido sozinho')
    try {
      const n = startShell(this.reg, { command: r.command, cwd: r.cwd, name: r.name, awaited: r.awaited })
      this.selectedId = n.id
      this.say(`repetido como ${n.id}`)
    } catch (e) {
      this.say((e as Error).message)
    }
  }

  private toggleAwaited(r: RunRecord): void {
    if (r.state !== 'running') return this.say('w: só para runs em andamento')
    this.reg.setAwaited(r, !r.awaited)
    this.say(r.awaited ? 'o agente espera por este run' : 'o agente não espera mais')
  }

  /** Keys shared by both focus paths; true when Run used the key. */
  private navigate(data: string): boolean {
    if (this.filtering) return this.filterKey(data)
    const rows = this.visibleRows()
    const open = !this.collapsed
    if (matchesKey(data, 'down')) {
      if (open) this.select(rows, 1)
    } else if (matchesKey(data, 'up')) {
      if (open) this.select(rows, -1)
    } else if (matchesKey(data, 'pageDown')) open && this.select(rows, MAX_ROWS)
    else if (matchesKey(data, 'pageUp')) open && this.select(rows, -MAX_ROWS)
    else if (matchesKey(data, 'home')) open && this.select(rows, -Infinity)
    else if (matchesKey(data, 'end')) open && this.select(rows, Infinity)
    else if (!open) return false
    else if (matchesKey(data, 'enter')) this.expanded = !this.expanded
    else if (data === 'f') {
      this.follow = !this.follow
      if (this.follow) this.frozen = undefined
      else this.freeze()
    } else if (data === 'x') this.say(`${this.reg.clearFinished()} concluídos removidos`)
    else if (data === '/') this.filtering = true
    else if (data === 'k' || data === 'r' || data === 'w') {
      const r = this.selected()
      if (!r) return true
      if (data === 'k') this.stop(r)
      else if (data === 'r') this.repeat(r)
      else this.toggleAwaited(r)
    } else return false
    this.fixSelection()
    return true
  }

  /** Filter prompt: every key belongs to it. */
  private filterKey(data: string): boolean {
    if (matchesKey(data, 'escape')) {
      this.filter = ''
      this.filtering = false
    } else if (matchesKey(data, 'enter')) this.filtering = false
    else if (matchesKey(data, 'backspace')) this.filter = this.filter.slice(0, -1)
    else if (data.length === 1 && data >= ' ' && data !== '\x7f') this.filter += data
    this.fixSelection()
    return true
  }

  handleInput(data: string): void {
    if (this.navigate(data)) return void this.tui?.requestRender()
    const editor = this.prev
    this.release()
    if (matchesKey(data, 'escape')) return nav.back('run')
    editor?.handleInput?.(data)
  }

  private release(): void {
    const editor = this.prev
    if (this.nativeFocus && editor) this.tui?.setFocus?.(editor)
    this.nativeFocus = false
    this.prev = undefined
    this.tui?.requestRender()
  }

  private focusByKeyboard(): boolean {
    const tui = this.tui
    if (!this.registered || !tui?.setFocus) return false
    const current = tui.focusedComponent as Prev | undefined
    if (current && current !== (this as unknown)) this.prev = current
    tui.setFocus(this)
    tui.requestRender()
    return true
  }

  /** Entry: Alt+↓ from anywhere (the ↓ path goes through the group titles, section-nav/nav.ts). */
  private onKey(data: string): { consume: boolean } | undefined {
    if (!this.registered || this.nativeFocus) return undefined
    if (matchesKey(data, 'alt+down') && editorOwnsFocus(this.tui) && this.focusByKeyboard()) return { consume: true }
    return undefined
  }
}

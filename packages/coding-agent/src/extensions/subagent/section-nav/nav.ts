/**
 * Tabs of the groups under the editor (Status, Sub Agents, Todo/Plan, Run) and their two-level keyboard navigation.
 * One tab is always open (default Status); only the open tab shows its body. The first active group
 * in render order draws the bar (chrome.ts `tabbed`). Level 1: ↓ on an empty editor focuses the open tab, ← → walk the tabs,
 * Enter opens the tab and enters its body (Status has none: Enter only opens), Space opens without entering, nothing folds, ↑ and Esc return
 * to the editor. Level 2: the body keeps its own keys; Esc returns to the same tab. The editor keeps native focus while a
 * tab is focused. Visual order is not fixed (nycode moves a re-set widget last), so every group stamps its render.
 * Records: docs/pi-group-tabs-2026-11-14.md (tabs), docs/pi-group-navigation-2026-11-14.md (levels).
 */
import { isKeyRelease, matchesKey } from '@nycode/tui'

export type GroupId = 'run' | 'plan' | 'subagents' | 'status'

export interface NavGroup {
  id: GroupId
  /** The group shows now (a hidden or empty group has no tab and never keeps the focus). */
  active(): boolean
  /** Items to navigate; false = informational group. */
  hasBody: boolean
  /** Tab name with its count (`Agentes 2`). */
  label(): string
  /** Any tab change: the group redoes timers and selection and asks for a render. */
  changed(): void
  /** Give the body the keyboard; false when it cannot take it. */
  enter(): boolean
}

export interface TabSpec {
  id: GroupId
  label: string
  open: boolean
  focus: boolean
}
export interface TabBand {
  id: GroupId
  from: number
  to: number
}

/** Tab order, fixed. */
const TAB_ORDER: GroupId[] = ['status', 'subagents', 'plan', 'run']
/** Fallback order for a group not yet rendered. */
const DEFAULT_ORDER: GroupId[] = ['run', 'plan', 'subagents', 'status']

export class GroupNav {
  private readonly groups = new Map<GroupId, NavGroup>()
  private readonly stamps = new Map<GroupId, number>()
  private pass = new Set<GroupId>()
  private seq = 0
  /** Tab that holds the keyboard focus (level 1). */
  title: GroupId | undefined
  private opened: GroupId = 'status'
  private bands: TabBand[] = []
  private readonly details = new Map<GroupId, string>()
  private barDetail: string | undefined
  /** Width of the tab names in the last bar (the detail gets the rest). */
  tabsWidth = 0

  register(group: NavGroup): void {
    this.groups.set(group.id, group)
  }

  unregister(id: GroupId): void {
    this.groups.delete(id)
    this.stamps.delete(id)
    this.pass.delete(id)
    this.details.delete(id)
    if (this.title === id) this.title = undefined
  }

  // ---- tabs ----

  /** Active groups in tab order. */
  tabs(): GroupId[] {
    return TAB_ORDER.filter((id) => this.isActive(id))
  }

  isActive(id: GroupId): boolean {
    return this.groups.get(id)?.active() === true
  }

  /** The tab whose body shows: the open tab, or the first active one when that is inactive. */
  shown(): GroupId | undefined {
    const tabs = this.tabs()
    return tabs.includes(this.opened) ? this.opened : tabs[0]
  }

  /** `id` has no body on screen. A group that is not active (or unknown) counts as open: it draws nothing anyway. */
  isFolded(id: GroupId): boolean {
    return this.isActive(id) && this.shown() !== id
  }

  open(id: GroupId): void {
    if (this.opened === id) return
    this.opened = id
    this.notify()
  }

  /** Session start: Status open, nothing focused. */
  resetTabs(): void {
    this.opened = 'status'
    this.title = undefined
  }

  private notify(): void {
    for (const g of this.groups.values()) g.changed()
  }

  /** The group that draws the bar: the first active one in the last render pass. */
  owner(): GroupId | undefined {
    return this.order()[0]
  }

  /** Rows of the bar at the top of the widget of `id` (0 unless it draws the bar). */
  barRows(id: GroupId): number {
    return this.owner() === id ? 3 : 0
  }

  specs(): TabSpec[] {
    const shown = this.shown()
    return this.tabs().map((id) => ({ id, label: this.groups.get(id)!.label(), open: shown === id, focus: this.isTitle(id) }))
  }

  /** Detail of the open group, set at each of its renders; a bar already drawn with another text asks for a new render. */
  setDetail(id: GroupId, text: string, redraw: () => void): void {
    this.details.set(id, text)
    if (this.shown() === id && this.barDetail !== undefined && this.barDetail !== text) redraw()
  }

  shownDetail(): string {
    const shown = this.shown()
    return (shown && this.details.get(shown)) || ''
  }

  /** Keyboard hint of the focused tab for the detail area. */
  hint(): string | undefined {
    const id = this.title
    if (id === undefined || !this.isTitle(id)) return undefined
    return '← → tabs · enter open · esc back'
  }

  /** The bar was drawn: remember where each name is (clicks) and the detail it showed. */
  drew(bands: TabBand[], tabsWidth: number): void {
    this.bands = bands
    this.tabsWidth = tabsWidth
    this.barDetail = this.shownDetail()
  }

  /** Click on the tab row or its rule (local rows 1 and 2 of the bar): opens the tab under column `x` (the open one: nothing, but the click is consumed). */
  clickBar(x: number | undefined, y: number | undefined): boolean {
    if (x === undefined || (y !== 1 && y !== 2)) return false
    const band = this.bands.find((b) => x >= b.from && x < b.to)
    if (!band) return false
    this.open(band.id)
    return true
  }

  /** Called first in every group render: the order of the last render pass is the visual order. */
  stamp(id: GroupId): void {
    if (this.pass.has(id)) this.pass = new Set()
    this.pass.add(id)
    this.stamps.set(id, ++this.seq)
  }

  /** Active groups, top to bottom. */
  order(): GroupId[] {
    const active = [...this.groups.values()].filter((g) => g.active()).map((g) => g.id)
    const seen = active.filter((id) => this.pass.has(id)).sort((a, b) => this.stamps.get(a)! - this.stamps.get(b)!)
    return [...seen, ...DEFAULT_ORDER.filter((id) => active.includes(id) && !this.pass.has(id))]
  }

  /** The tab of `id` is the focused one (a group that went away never is). */
  isTitle(id: GroupId): boolean {
    return this.title === id && this.groups.get(id)?.active() === true
  }

  /** Esc (or a lost body) returns to the tab of `id`. */
  back(id: GroupId): void {
    if (this.groups.get(id)?.active()) this.title = id
  }

  /** ↓ on an empty editor: the open tab. False when no group shows. */
  focusFirst(): boolean {
    const first = this.shown()
    this.title = first
    return first !== undefined
  }

  /** Keys while a tab is focused (or the entry ↓ from the editor); true = consumed. */
  handleKey(data: string, env: { editorText: string; editorFocused: boolean; overlayOpen: boolean }): boolean {
    if (isKeyRelease(data)) return false
    if (!env.editorFocused || env.overlayOpen) {
      this.title = undefined
      return false
    }
    if (this.title === undefined || !this.isTitle(this.title)) {
      this.title = undefined
      // Real bottom limit of a multi-line editor is not exposed by nycode's editor: only an empty one hands ↓ over.
      return matchesKey(data, 'down') && env.editorText === '' && this.focusFirst()
    }
    const group = this.groups.get(this.title)!
    const tabs = this.tabs()
    const at = tabs.indexOf(group.id)
    if (matchesKey(data, 'left')) {
      this.title = tabs[Math.max(0, at - 1)]
      return true
    }
    if (matchesKey(data, 'right')) {
      this.title = tabs[Math.min(tabs.length - 1, at + 1)]
      return true
    }
    if (matchesKey(data, 'up') || matchesKey(data, 'escape')) {
      this.title = undefined
      return true
    }
    if (matchesKey(data, 'enter')) {
      if (!group.hasBody) this.open(group.id)
      else {
        this.open(group.id)
        this.title = undefined
        if (!group.enter()) this.title = group.id
      }
      return true
    }
    if (matchesKey(data, 'space')) {
      this.open(group.id)
      return true
    }
    this.title = undefined
    return false
  }
}

/** One instance per process: nycode loads each extension in its own module graph (moduleCache: false), so a plain
 * module-level instance would give status-line and each section its own bar (internal/shared-slot.ts). */
const NAV_SLOT = Symbol.for('pi-code.group-nav')
export const nav: GroupNav = ((globalThis as Record<symbol, unknown>)[NAV_SLOT] ??= new GroupNav()) as GroupNav

/**
 * The /subagents-setup modal (docs/subagent-routing-2026-11-13.md, AC1): step 1 marks the models subagents may
 * use, step 2 marks, per marked model, the efforts allowed. up/down move, space toggles, enter confirms the
 * step, esc cancels without saving. Pure state + render so it is testable without a TUI.
 */
import { isKeyRelease, matchesKey, truncateToWidth } from '@earendil-works/pi-tui'
import type { Component } from '@earendil-works/pi-tui'
import { type Effort, EFFORTS, type RoutingPolicy } from './policy.ts'

export interface SetupModel {
  key: string
  /** Efforts this model supports, ascending. */
  levels: Effort[]
}

export interface SetupOptions {
  models: SetupModel[]
  current: RoutingPolicy | undefined
  /** The new policy on enter at the last step, undefined on esc. */
  done: (policy: RoutingPolicy | undefined) => void
  requestRender?: () => void
}

/** What a model not in the current policy starts with: the everyday levels, else everything it supports. */
const DEFAULT_LEVELS: readonly Effort[] = ['low', 'medium', 'high']

export class SetupComponent implements Component {
  private step: 'models' | 'efforts' = 'models'
  private cursor = 0
  private error = ''
  private readonly marked: Set<string>
  private readonly efforts = new Map<string, Set<Effort>>()
  private queue: SetupModel[] = []
  private page = 0

  private readonly opts: SetupOptions

  constructor(opts: SetupOptions) {
    this.opts = opts
    this.marked = new Set(opts.models.filter((m) => opts.current?.models[m.key]).map((m) => m.key))
  }

  private get items(): string[] {
    return this.step === 'models' ? this.opts.models.map((m) => m.key) : (this.queue[this.page]?.levels ?? [])
  }

  private isOn(item: string): boolean {
    return this.step === 'models' ? this.marked.has(item) : (this.efforts.get(this.queue[this.page]!.key)?.has(item as Effort) ?? false)
  }

  private toggle(): void {
    const item = this.items[this.cursor]
    if (item === undefined) return
    this.error = ''
    const set = this.step === 'models' ? this.marked : this.efforts.get(this.queue[this.page]!.key)!
    if (set.has(item as Effort)) set.delete(item as Effort)
    else set.add(item as Effort)
  }

  private enter(): void {
    if (this.step === 'models') {
      this.queue = this.opts.models.filter((m) => this.marked.has(m.key))
      if (this.queue.length === 0) {
        this.error = 'Mark at least one model.'
        return
      }
      for (const m of this.queue) {
        if (this.efforts.has(m.key)) continue
        const own = this.opts.current?.models[m.key]?.filter((e) => m.levels.includes(e))
        const fallback = m.levels.filter((e) => DEFAULT_LEVELS.includes(e))
        this.efforts.set(m.key, new Set(own?.length ? own : fallback.length ? fallback : m.levels))
      }
      this.step = 'efforts'
      this.page = 0
      this.cursor = 0
      return
    }
    if (this.efforts.get(this.queue[this.page]!.key)!.size === 0) {
      this.error = 'Mark at least one effort.'
      return
    }
    if (this.page + 1 < this.queue.length) {
      this.page++
      this.cursor = 0
      return
    }
    const models: Record<string, Effort[]> = {}
    for (const m of this.queue) models[m.key] = EFFORTS.filter((e) => this.efforts.get(m.key)!.has(e))
    this.opts.done({ version: 1, models })
  }

  handleInput(data: string): void {
    if (isKeyRelease(data)) return
    if (matchesKey(data, 'escape')) return this.opts.done(undefined)
    if (matchesKey(data, 'up')) this.cursor = Math.max(0, this.cursor - 1)
    else if (matchesKey(data, 'down')) this.cursor = Math.min(this.items.length - 1, this.cursor + 1)
    else if (matchesKey(data, 'space')) this.toggle()
    else if (matchesKey(data, 'enter')) this.enter()
    else return
    this.opts.requestRender?.()
  }

  render(width: number): string[] {
    const title = this.step === 'models' ? 'Subagent models: which may subagents use?' : `Efforts for ${this.queue[this.page]!.key} (${this.page + 1}/${this.queue.length})`
    const rows = this.items.map((item, i) => `${i === this.cursor ? '>' : ' '} [${this.isOn(item) ? 'x' : ' '}] ${item}`)
    const lines = [title, '', ...rows, '', this.error || 'up/down move · space toggle · enter next/save · esc cancel']
    return lines.map((line) => truncateToWidth(line, width))
  }

  invalidate(): void {}
}

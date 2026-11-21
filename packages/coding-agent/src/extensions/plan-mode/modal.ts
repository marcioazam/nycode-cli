/**
 * Plan modal (UI only): the whole plan in an overlay, each step with its title and the description kept
 * from the plan text (`TodoItem.description`). Pure rendering and key handling: the owner (index.ts) opens
 * the overlay, reads the plan title and opens the file.
 * Record: docs/pi-plan-modal-2026-11-14.md.
 */
import { matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi } from '@nycode/tui'

import type { UiTheme } from '../subagent/fleet-ui/panel.ts'
import { activeStep, STATES } from './table.ts'
import type { TodoItem } from './utils.ts'

export interface PlanModalOpts {
  title: string
  /** Plan file, shown under the steps. */
  file?: string
}

/** First markdown heading of the plan text, else `Plan`. */
export function planTitle(markdown: string): string {
  for (const line of markdown.split('\n')) {
    const text = line.trimStart()
    if (text.startsWith('#')) return text.replace(/^#+/, '').trim().slice(0, 200) || 'Plan'
  }
  return 'Plan'
}

const FOOTER = '↑↓ rolar · e abrir arquivo · esc fechar'
/** Title column: glyph, space, `NN`, two spaces. */
const INDENT = ' '.repeat(6)

function parts(items: readonly TodoItem[], opts: PlanModalOpts, theme: UiTheme, width: number): { head: string; body: string[]; foot: string[] } {
  const dim = (s: string): string => theme.fg('dim', s)
  const inner = Math.max(1, width - 4)
  const row = (text: string): string => {
    const cut = truncateToWidth(text, inner)
    return truncateToWidth(dim('│ ') + cut + ' '.repeat(Math.max(0, inner - visibleWidth(cut))) + dim(' │'), width)
  }
  const wrap = (text: string, paint: (s: string) => string): string[] => wrapTextWithAnsi(text, Math.max(1, inner - INDENT.length)).map((l) => row(INDENT + paint(l)))
  const active = activeStep(items)
  const body = items.flatMap((item, i) => {
    const key = item.completed ? 'done' : (item.status ?? (active === item.step ? 'doing' : 'todo'))
    const st = STATES[key]!
    const quiet = key === 'done' || key === 'skipped'
    const title = key === 'doing' ? theme.bold(item.text) : quiet ? dim(item.text) : item.text
    return [
      ...(i > 0 ? [row('')] : []),
      row(`${theme.fg(st.role, st.sym)} ${dim(String(item.step).padStart(2, '0'))}  ${title}`),
      ...(item.description ?? '').split('\n').filter(Boolean).flatMap((l) => wrap(l, dim)),
      ...(item.note ? wrap(`nota: ${item.note}`, (s) => theme.fg(key === 'skipped' ? 'dim' : 'warning', s)) : []),
    ]
  })
  if (opts.file) body.push(row(''), row(dim(`plano: ${opts.file}`)))
  const done = items.filter((i) => i.completed).length
  const label = truncateToWidth(`PLAN ${done}/${items.length} · ${opts.title}`, Math.max(1, width - 5))
  const head = truncateToWidth(dim('┌ ') + theme.bold(label) + dim(` ${'─'.repeat(Math.max(0, width - visibleWidth(label) - 4))}┐`), width)
  return { head, body, foot: [row(dim(FOOTER)), truncateToWidth(dim(`└${'─'.repeat(Math.max(0, width - 2))}┘`), width)] }
}

/** The modal unscrolled: frame, `PLAN done/total · title`, each step with its description, the key line. */
export function planModalLines(items: readonly TodoItem[], opts: PlanModalOpts, theme: UiTheme, width: number): string[] {
  const p = parts(items, opts, theme, width)
  return [p.head, ...p.body, ...p.foot]
}

export interface PlanModalHooks {
  /** Closes the modal. */
  done(): void
  /** Opens the plan file with the desktop handler; the modal stays open. */
  open(): void
  /** Rows the overlay may take (frame included). */
  rows(): number
}

/** Scrolling component for `ctx.ui.custom(..., { overlay: true })`. */
export class PlanModal {
  offset = 0
  private bodyRows = 0
  private readonly items: readonly TodoItem[]
  private readonly opts: PlanModalOpts
  private readonly theme: UiTheme
  private readonly hooks: PlanModalHooks
  constructor(items: readonly TodoItem[], opts: PlanModalOpts, theme: UiTheme, hooks: PlanModalHooks) {
    this.items = items
    this.opts = opts
    this.theme = theme
    this.hooks = hooks
  }

  private view(): number {
    return Math.max(1, this.hooks.rows() - 3) // head, key line, bottom border
  }

  private scrollTo(offset: number): void {
    this.offset = Math.max(0, Math.min(offset, this.bodyRows - this.view()))
  }

  invalidate(): void {}

  render(width: number): string[] {
    const p = parts(this.items, this.opts, this.theme, width)
    this.bodyRows = p.body.length
    this.scrollTo(this.offset)
    return [p.head, ...p.body.slice(this.offset, this.offset + this.view()), ...p.foot]
  }

  handleInput(data: string): void {
    const page = this.view()
    if (matchesKey(data, 'escape') || data === 'q') this.hooks.done()
    else if (data === 'e') this.hooks.open()
    else if (matchesKey(data, 'down')) this.scrollTo(this.offset + 1)
    else if (matchesKey(data, 'up')) this.scrollTo(this.offset - 1)
    else if (matchesKey(data, 'pageDown')) this.scrollTo(this.offset + page)
    else if (matchesKey(data, 'pageUp')) this.scrollTo(this.offset - page)
    else if (matchesKey(data, 'home')) this.scrollTo(0)
    else if (matchesKey(data, 'end')) this.scrollTo(Infinity)
  }
}

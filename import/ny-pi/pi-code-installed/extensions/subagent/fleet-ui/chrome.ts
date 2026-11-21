/**
 * Terminal chrome of the agent panel and the status line widget (local patch): section headings, the thin
 * rule between them, the model label colors and the duration clock. Pure; colors come from the UI roles
 * (Tokyo Night through palette.ts), never from literals. Record: docs/pi-interactive-display-2026-11-13.md.
 */
import { truncateToWidth, visibleWidth } from '@earendil-works/pi-tui'

import { nav } from '../section-nav/nav.ts'
import type { GroupId, TabBand, TabSpec } from '../section-nav/nav.ts'
import type { UiTheme } from './panel.ts'

export const SUBAGENTS_TITLE = 'Sub Agents'
export const STATUSLINE_TITLE = 'Status Line'
/** U+25F7: a text glyph, one cell in pi-tui and no emoji presentation (the stopwatch emoji is two cells in some terminals). */
export const CLOCK = '◷'

/** Themes in older hosts may lack `bold`: plain text then. */
const bold = (theme: UiTheme, text: string): string => (typeof theme.bold === 'function' ? theme.bold(text) : text)

/** Section kinds: an upper-case name and one UI role each, so the three chips differ at a glance. */
export const HEADING_KINDS = {
  subagents: { role: 'accent', name: SUBAGENTS_TITLE.toUpperCase() },
  statusline: { role: 'success', name: STATUSLINE_TITLE.toUpperCase() },
  plan: { role: 'warning', name: 'PLAN' },
  /** The todo tool's list (no plan executing): its own chip, so it never reads as a plan. */
  todo: { role: 'task', name: 'TODO' },
  /** Background shells and subagents (extensions/run). */
  run: { role: 'text', name: 'RUN' },
} as const
export type HeadingKind = keyof typeof HEADING_KINDS

/** Title chip: ` NAME ` in reverse video of the role's color (the inverse of the fg is a colored background, no hex), bold. */
export function chip(kind: HeadingKind, theme: UiTheme, role: string = HEADING_KINDS[kind].role): string {
  return bold(theme, `\x1b[7m${theme.fg(role, ` ${HEADING_KINDS[kind].name} `)}\x1b[27m`)
}

/** Heading line: the kind's chip, then the detail (count, state, range) dim. `title` starts with the kind's name
 * (any case); `role` overrides the chip color (focused). Cut to the width. */
export function heading(title: string, theme: UiTheme, width: number, kind: HeadingKind, role?: string): string {
  const detail = title.slice(HEADING_KINDS[kind].name.length)
  return truncateToWidth(chip(kind, theme, role) + (detail ? theme.fg('dim', detail) : ''), width)
}

/** Focused title (level 1 of the group navigation, section-nav/nav.ts): the whole heading line in reverse video of the group's
 * role, padded to the full width and led by `❯`, so it reads without color too (NO_COLOR keeps reverse video and the glyph). */
export function focusBand(head: string, kind: HeadingKind, theme: UiTheme, width: number): string {
  const plain = head.replace(/\x1b\[[0-9;]*m/g, '')
  const text = truncateToWidth(`❯${plain}${' · enter open · esc back'}`, width, '')
  return bold(theme, `\x1b[7m${theme.fg(HEADING_KINDS[kind].role, text + ' '.repeat(Math.max(0, width - visibleWidth(text))))}\x1b[27m`)
}

/** Thin rule across the full width. */
export function rule(theme: UiTheme, width: number): string {
  return theme.fg('dim', '─'.repeat(Math.max(0, width)))
}

const TAB_GAP = '   '

/** Session thinking level, read when the bar is drawn: pi paints the editor border with `thinking<Level>`, and the open
 * tab takes that same role so both match (falls back to `text` without a level). Set by status-line.ts. */
let thinkingLevel: () => string | undefined = () => undefined
export const setThinkingSource = (read: () => string | undefined): void => void (thinkingLevel = read)
const openRole = (): string => {
  const level = thinkingLevel()
  return level ? `thinking${level[0]!.toUpperCase()}${level.slice(1)}` : 'text'
}

/** Tab bar (docs/pi-group-tabs-2026-11-14.md): a blank line, the tab names then the open group's detail (two spaces after the
 * last tab, cut to the width), and a rule with `━` under the open tab (editor border color, bold) and under the focused one
 * (bold); other tabs dim, rule `─`. Without color the `━` alone marks the open tab. `bands` are the name columns (clicks).
 * System cyan (`syntaxType`, owner 2026-11-15) marks where the focus is: the focused tab, else the open one (focus in the editor). */
export function tabBar(tabs: TabSpec[], detail: string, theme: UiTheme, width: number): { lines: string[]; bands: TabBand[]; tabsWidth: number } {
  const bands: TabBand[] = []
  let col = 0
  const tabFocus = tabs.some((t) => t.focus)
  const role = (t: TabSpec): string => ((tabFocus ? t.focus : t.open) ? 'syntaxType' : openRole())
  const names = tabs.map((t) => {
    const w = visibleWidth(t.label)
    bands.push({ id: t.id, from: col, to: col + w })
    col += w + TAB_GAP.length
    return t.open || t.focus ? bold(theme, theme.fg(role(t), t.label)) : theme.fg('dim', t.label)
  })
  const tabsWidth = Math.max(0, col - TAB_GAP.length)
  let line = ''
  let at = 0
  const dash = (n: number): void => void (n > 0 && ((line += theme.fg('dim', '─'.repeat(n))), (at += n)))
  tabs.forEach((t, i) => {
    const from = Math.min(bands[i]!.from, width)
    const to = Math.min(bands[i]!.to, width)
    dash(from - at)
    const n = to - at
    if (n <= 0) return
    line += t.open || t.focus ? bold(theme, theme.fg(role(t), '━'.repeat(n))) : theme.fg('dim', '─'.repeat(n))
    at = to
  })
  dash(width - at)
  const head = names.join(TAB_GAP) + (detail ? '  ' + detail : '')
  return { lines: ['', truncateToWidth(head, width), line], bands, tabsWidth }
}

/** Wraps the lines a group builds as `['', title, rule, ...body]`: an inactive group is left alone; an active one keeps its
 * body only while its tab is open (the three header lines go) and, when it is first in render order, leads with the bar.
 * `detail` is the group's old title without the label and count; `redraw` asks for one more render when it changed after the bar drew. */
export function tabbed(id: GroupId, lines: string[], detail: string, theme: UiTheme, width: number, redraw: () => void): string[] {
  if (!nav.isActive(id)) return lines
  const shown = nav.shown() === id
  if (shown) nav.setDetail(id, detail, nav.owner() === id ? () => {} : redraw) // the bar of this very pass reads it
  let bar: string[] = []
  if (nav.owner() === id) {
    const hint = nav.hint()
    const drawn = tabBar(nav.specs(), hint === undefined ? nav.shownDetail() : theme.fg('dim', hint), theme, width)
    nav.drew(drawn.bands, drawn.tabsWidth)
    bar = drawn.lines
  }
  return [...bar, ...(shown ? lines.slice(3) : [])]
}

/** Sub Agents chip and its rule above the panel lines; the group opens with a blank line (the spacing after the editor or the previous group) and never ends with one.
 * Only with child rows does it add the title and rule: no orphan title or rule without them.
 */
export function frameSubAgents(lines: string[], hasRows: boolean, theme: UiTheme, width: number, summary?: string, titleFocus = false): string[] {
  if (lines.length === 0) return lines
  const band = (h: string): string => (titleFocus ? focusBand(h, 'subagents', theme, width) : h)
  // No child rows (only the finished hint): still a group, so it opens with the blank line and does not end with one.
  if (!hasRows) return ['', ...(lines.at(-1) === '' ? lines.slice(0, -1) : lines)]
  const body = lines.at(-1) === '' ? lines.slice(0, -1) : lines
  const head = summary ? truncateToWidth(chip('subagents', theme) + ' ' + summary, width) : heading(SUBAGENTS_TITLE, theme, width, 'subagents')
  return ['', band(head), rule(theme, width), ...body]
}

export interface FleetCounts {
  running: number
  quiet: number
  failed: number
  done: number
}

/** Chip-row summary: `x/y`, x = runs that ended (done or failed), y = all counted runs; nothing while there are none.
 * Cyan (the HUD `text` role) while any run is going, red when one failed, green once every run ended cleanly. */
export function summaryLine(c: FleetCounts, theme: UiTheme): string {
  const total = c.running + c.failed + c.done
  if (total === 0) return ''
  const role = c.failed ? 'error' : c.running ? 'text' : 'success'
  return theme.fg(role, `${c.failed + c.done}/${total}`)
}

/** Status Line group: a blank line, the chip and its rule above the rows; the widget only exists while there are rows. */
export function frameStatusLine(rows: string[], theme: UiTheme, width: number): string[] {
  if (rows.length === 0) return rows
  return ['', heading(STATUSLINE_TITLE, theme, width, 'statusline'), rule(theme, width), ...rows]
}

/** Footer-only status line (one row, or the built-in segment): the chip leads the value inline,
 * `<chip> value`, no rule; the clock is tidied too. */
export function labelFooter(value: string, theme: UiTheme, names: readonly string[] = []): string {
  return chip('statusline', theme) + ' ' + tidyClock(unbracketModel(value, names))
}

/** `[provider/model · effort]` as painted: model bold accent (plain accent once finished), provider and effort dim.
 * The text is exactly the candidate's, so widths and truncation are unchanged. */
export function styleModelMeta(meta: string, theme: UiTheme, live: boolean): string {
  const m = /^\[(.*?)( ?· ?)(.*)\]$/.exec(meta)
  if (!m) return theme.fg('dim', meta)
  const [, id = '', sep = '', effort = ''] = m
  const slash = id.indexOf('/')
  const provider = slash > 0 ? id.slice(0, slash + 1) : ''
  // Neutral on purpose (design study 2026-11-13): color is for state and deviations, so only a costly effort stands out.
  const model = theme.fg(live ? 'text' : 'dim', id.slice(provider.length))
  const dim = (s: string): string => (s ? theme.fg('dim', s) : '')
  const eff = /^(max|xhigh)$/i.test(effort) && live ? theme.fg('warning', effort) : dim(effort)
  return dim('[') + dim(provider) + model + dim(sep) + eff + dim(']')
}

/** The HUD's stopwatch emoji (with or without VS16, any spaces) and its duration become `◷ 1h10m`:
 * a single-cell glyph, one space, units tight. Only a duration right after the clock is touched. */
export function tidyClock(row: string): string {
  return row.replace(/⏱\uFE0F?[ \t]*(<?\d+[dhms](?: \d+[dhms])*)/g, (_all, dur: string) => `${CLOCK} ${dur.replace(/ /g, '')}`)
}

/** Display names of the live model (`name`, `id`, bare id): what the HUD prints first in its model segment. */
export function modelNames(model: { id?: string; name?: string } | undefined): string[] {
  return [model?.name, model?.id, model?.id?.split('/').at(-1)].filter((n): n is string => !!n)
}

/** The HUD's first row opens with `[Model ◐ effort]`: drop only those outer brackets (colors, text and the effort
 * icon stay). Anchored at the row start after any SGR codes, and only when the bracketed text starts with the live
 * model's name: a first segment that is not the model (a folder, with the model hidden) keeps its brackets. */
export function unbracketModel(row: string, names: readonly string[]): string {
  const m = /^((?:\x1b\[[0-9;:]*m)*)\[(.*?)\]/.exec(row)
  if (!m) return row
  const inner = (m[2] ?? '').replace(/\x1b\[[0-9;:]*m/g, '').toLowerCase()
  if (!names.some((n) => inner === n.toLowerCase() || inner.startsWith(n.toLowerCase() + ' '))) return row
  return (m[1] ?? '') + (m[2] ?? '') + row.slice(m[0].length)
}

/** A status row as shown: the model segment unbracketed (first row only) and the clock tidied. */
export function tidyRow(row: string, first: boolean, names: readonly string[]): string {
  return tidyClock(first ? unbracketModel(row, names) : row)
}

const ANSI = /\x1b\[[0-9;:]*m/g
const plainOf = (t: string): string => t.replace(ANSI, '')
const HUD_LABELS: Record<string, string> = { Context: 'ctx', Usage: '5h', Weekly: 'wk' }

/** Label rename for the context/usage rows (`Context` → `ctx`, `Usage` → `5h`, `Weekly` → `wk`), keeping the color codes around it. */
function shortLabels(part: string): string {
  return part.replace(/(Context|Usage|Weekly)\b/, (m) => HUD_LABELS[m] ?? m)
}

const ANSI_RUN = '(?:\\x1b\\[[0-9;:]*m)*'
const BAR = new RegExp(`(?:${ANSI_RUN}[━─╸╺╾╼]+)+`)

/** Redraws the meter bar of `part` with `cells` cells (0 drops it), keeping the filled/empty colors in proportion. */
export function fitBar(part: string, cells: number): string {
  const m = BAR.exec(part)
  if (!m) return part
  if (cells <= 0) return part.slice(0, m.index).replace(/\s+$/, ' ') + part.slice(m.index + m[0].length).replace(/^((?:\x1b\[[0-9;:]*m)*)\s+/, '$1')
  const segs = [...m[0].matchAll(new RegExp(`(${ANSI_RUN})([━─╸╺╾╼]+)`, 'g'))].map((x) => ({ code: x[1] ?? '', len: [...(x[2] ?? '')].length, ch: (x[2] ?? '')[0] ?? '━' }))
  const total = segs.reduce((n, x) => n + x.len, 0)
  if (total <= cells) return part
  let seen = 0
  let used = 0
  const out = segs.map((x) => {
    seen += x.len
    const upto = Math.round((seen * cells) / total)
    const n = upto - used
    used = upto
    return n > 0 ? x.code + x.ch.repeat(n) : ''
  })
  return part.slice(0, m.index) + out.join('') + part.slice(m.index + m[0].length)
}

/** HUD rows laid out as the one default (design study 2026-11-13, chosen by the user), at every width:
 * one identity line (two when it does not fit), ONE meters line (parenthetical details go, then the bars shrink, then they drop,
 * then one meter per line), then tools and the extra rows each on a line; no blank lines or rules.
 * Only when the first row is the HUD's `│`-separated model row; else the rows come back truncated and untouched. */
export function layoutStatus(rows: string[], theme: UiTheme, width: number): string[] {
  const fit = (lines: string[]): string[] => lines.map((l) => truncateToWidth(l, width))
  const split = (row: string): string[] => row.split(/\s*│\s*/).map((p) => p.trim()).filter(Boolean)
  const head = rows[0] === undefined ? [] : split(rows[0])
  if (rows.length < 2 || head.length < 2 || !head.some((p) => /◷|⏱/.test(p) || /^\S*Cost\b/.test(plainOf(p)))) return fit(rows)
  const dot = theme.fg('dim', ' · ')
  const isRight = (p: string): boolean => /◷|⏱/.test(p) || /^Cost\b/.test(plainOf(p))
  const stripCost = (p: string): string => p.replace(/Cost (?=\S)/, '')
  const reset = (p: string): string => p.replace(/\s+((?:\x1b\[[0-9;:]*m)*)$/, '$1') + '\x1b[0m' // no stray space before the separator
  const idLeft = head.filter((p) => !isRight(p)).map(reset)
  const idRight = head.filter(isRight).map((p) => reset(stripCost(p)))
  const meters = split(rows[1] ?? '').map((p) => reset(shortLabels(p)))
  const tools = rows[2] === undefined ? '' : rows[2].replace(/\s\|\s/g, '  ')
  const extra = rows.slice(3).map((r) => r.replace(/\s\|\s/g, '  '))

  const oneLine = [...idLeft, ...idRight].join(dot)
  const lines = visibleWidth(oneLine) <= width ? [oneLine] : [idLeft.join(dot), idRight.join(dot)].filter(Boolean)
  const tries: string[][] = [meters, meters.map((p) => p.replace(/\s*\([^)]*\)/g, ''))]
  for (const cells of [8, 5, 3, 0]) tries.push(tries[1]!.map((p) => fitBar(p, cells)))
  const flow = tries.map((t) => t.join(dot)).find((l) => visibleWidth(l) <= width)
  lines.push(...(flow === undefined ? tries.at(-1)! : [flow]))
  if (tools) lines.push(tools)
  lines.push(...extra)
  return fit(lines)
}

/** The HUD's todo line (`All todos complete (7/7)`, `▸ task (2/7)`) is not shown: the Plan section owns task progress. */
export function dropTodoRows(rows: string[]): string[] {
  return rows.filter((r, i) => i < 2 || !/\(\d+\/\d+\)\s*$/.test(plainOf(r)))
}

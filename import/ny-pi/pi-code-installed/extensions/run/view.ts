/**
 * Render of the Run section (variant B of docs/pi-run-section-2026-11-13.md): chip + counts, a rule, one line per
 * run, the selected one with its tail inline, and the key help in the footer of the group. Pure: theme, width and
 * state in, lines out. Glyph and text always go together (never color alone); NO_COLOR/theme decide the colors.
 */
import { truncateToWidth, visibleWidth } from '@earendil-works/pi-tui'

import { chip, rule, summaryLine } from '../subagent/fleet-ui/chrome.ts'
import { SPINNER, spinnerAt } from '../subagent/fleet-ui/palette.ts'
import type { UiTheme } from '../subagent/fleet-ui/panel.ts'
import { displayState, type RunRecord, type RunState } from './registry.ts'
import { clock } from './tool.ts'

export const GLYPH: Record<RunState, string> = { running: '■', 'new-output': '◆', silent: '◇', done: '✓', failed: '✖', stopped: '□' }
/** Running pulse with squares (user request 2026-11-13: square, not a dot); one cell each. */
const PULSE = ['▫', '▪', '■', '■', '▪', '▫']
const ROLE: Record<RunState, string> = { running: 'success', 'new-output': 'accent', silent: 'warning', done: 'success', failed: 'error', stopped: 'dim' }
export const AWAITED = '◷'
export const MAX_ROWS = 8
export const TAIL_SHOWN = 5
export const TAIL_EXPANDED = 15
const TIME_W = 8

export interface View {
  rows: RunRecord[]
  /** Total before the filter, for the header. */
  total: number
  now: number
  collapsed: boolean
  focused: boolean
  selectedId?: string
  offset: number
  follow: boolean
  /** Tail kept when follow is off. */
  frozen?: string[]
  expanded: boolean
  filter: string
  filtering: boolean
  motion: boolean
  flash?: string
}

/** Terminal output is data: no escapes or control characters in the lines drawn, only the text after the last `\r`. */
export function sanitize(line: string): string {
  const last = line.split('\r').filter(Boolean).pop() ?? ''
  // eslint-disable-next-line no-control-regex
  return last.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?/g, '').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/\t/g, '  ').replace(/[\x00-\x1f\x7f]/g, '')
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`
const ago = (ms: number): string => {
  const m = Math.floor(ms / 60_000)
  return m < 1 ? 'agora' : `há ${m} min`
}

function detail(r: RunRecord, st: RunState, now: number): string {
  const wait = r.awaited && r.state === 'running' ? `${AWAITED} agente espera` : ''
  const parts: string[] = []
  if (r.state === 'running') {
    if (st === 'new-output') parts.push('novo output')
    else if (st === 'silent') parts.push(`sem output há ${Math.floor((now - r.lastOutputAt) / 60_000)} min`)
    else if (r.kind === 'agent') parts.push(plural(r.turns ?? 0, 'turno', 'turnos'))
    if (r.cost !== undefined) parts.push(`US$ ${r.cost.toFixed(2)}`)
    if (wait) parts.push(wait)
  } else {
    const since = ago(now - (r.endedAt ?? now))
    if (st === 'stopped') parts.push(`parado · ${since}`)
    else if (r.capped) parts.push(`parcial · ${since}`)
    else if (r.exitCode !== undefined) parts.push(`exit ${r.exitCode} · ${since}`)
    else parts.push(`${r.signal ? `sinal ${r.signal}` : 'terminou'} · ${since}`)
  }
  return parts.join(' · ')
}

export function counts(rows: RunRecord[], now: number): string {
  const n: Record<RunState, number> = { running: 0, 'new-output': 0, silent: 0, done: 0, failed: 0, stopped: 0 }
  for (const r of rows) n[displayState(r, now)] += 1
  return (Object.keys(GLYPH) as RunState[]).filter((s) => n[s] > 0).map((s) => `${GLYPH[s]}${n[s]}`).join(' ')
}

export const KEYS = ['↑↓ mover', '⏎ tail', 'f seguir', 'k parar', 'r repetir', 'w agente espera', 'x limpar concluídos', '/ filtro', 'esc voltar'] as const

/** Footer: the keys that fit, most useful first; `esc voltar` always stays. */
export function footer(theme: UiTheme, width: number, view: View): string {
  if (view.filtering) return truncateToWidth(theme.fg('dim', `/ filtro: ${view.filter}▮ · ⏎ aplicar · esc limpar`), width)
  const keys = KEYS.slice(0, -1)
  const fit: string[] = []
  for (const k of keys) if (visibleWidth([...fit, k, KEYS.at(-1)!].join(' · ')) <= width) fit.push(k)
  const text = [...fit, KEYS.at(-1)!].join(' · ')
  return truncateToWidth(theme.fg('dim', text), width)
}

/** Lines of the group and, per line, the run id it belongs to (mouse hits). Empty without runs. */
/** `detail`: the title without chip and count (the tab bar shows it): summary and filter. */
export function renderRun(view: View, theme: UiTheme, width: number): { lines: string[]; ids: Array<string | undefined>; detail: string } {
  if (view.total === 0) return { lines: [], ids: [], detail: '' }
  const { now, rows } = view
  const filterNote = view.filter && !view.filtering ? theme.fg('dim', ` · filtro "${view.filter}"`) : ''
  // Same title as Sub Agents (user request 2026-11-13): `ended/total`, cyan while any runs, red on a failure, green when all ended clean.
  const st = rows.map((r) => displayState(r, now))
  const ended = (s: RunState): boolean => s === 'done' || s === 'failed' || s === 'stopped'
  const summary = summaryLine({ running: st.filter((s) => !ended(s)).length, quiet: 0, failed: st.filter((s) => s === 'failed').length, done: st.filter((s) => s === 'done' || s === 'stopped').length }, theme)
  // Spinner beside the count while any run is live (user request 2026-11-14), the Sub Agents spinner and cadence.
  const spin = view.motion && st.some((s) => !ended(s)) ? theme.fg('text', SPINNER[spinnerAt(now)]!) + ' ' : ''
  const plainHead = truncateToWidth(chip('run', theme, view.focused ? 'accent' : undefined) + ' ' + spin + summary + filterNote, width)
  const head = plainHead
  const tabDetail = [spin + summary, view.filter && !view.filtering ? theme.fg('dim', `filtro "${view.filter}"`) : ''].filter(Boolean).join(theme.fg('dim', ' · '))
  if (view.collapsed) return { lines: ['', head, rule(theme, width)], ids: [undefined, undefined, undefined], detail: tabDetail }

  const lines: string[] = ['', head, rule(theme, width)]
  const ids: Array<string | undefined> = [undefined, undefined, undefined]
  const push = (l: string, id?: string): void => void (lines.push(l), ids.push(id))
  const shown = rows.slice(view.offset, view.offset + MAX_ROWS)
  // One detail column for every row: the time column lines up however long each detail is.
  const infoCol = Math.min(Math.max(0, ...shown.map((r) => visibleWidth(detail(r, displayState(r, now), now)))), Math.floor(width / 3))
  for (const r of shown) {
    const st = displayState(r, now)
    const sel = view.focused && r.id === view.selectedId
    const glyph = st === 'running' && view.motion ? PULSE[Math.floor(now / 200) % PULSE.length]! : GLYPH[st]
    const time = clock((r.endedAt ?? now) - r.startedAt).padStart(TIME_W)
    const info = detail(r, st, now)
    const infoW = infoCol
    const nameW = Math.max(4, width - 2 - 1 - TIME_W - (infoW ? infoW + 2 : 0))
    const name = truncateToWidth(sanitize(r.name), nameW, '…', true)
    const row = `${theme.fg(sel ? 'accent' : ROLE[st], glyph)} ${sel ? `\x1b[7m${theme.bold(name)}\x1b[27m` : name} ${theme.fg('dim', time)}${infoW ? '  ' + theme.fg('dim', truncateToWidth(info, infoW, '…', true)) : ''}`
    push(truncateToWidth(row, width), r.id)
    if (sel) {
      const n = view.expanded ? TAIL_EXPANDED : TAIL_SHOWN
      const source = view.follow ? r.tail : (view.frozen ?? r.tail)
      const tail = source.slice(-n)
      const bar = theme.fg('dim', '  │ ')
      for (const t of tail.length ? tail : ['(sem output ainda)']) push(truncateToWidth(bar + theme.fg('dim', sanitize(t)), width), r.id)
      const state = view.follow ? 'seguindo ▮' : 'parado de seguir'
      const logHint = r.logPath ? ` · log completo em ${r.logPath}` : ''
      push(truncateToWidth(theme.fg('dim', `  └ ${state}  (f ${view.follow ? 'para parar de seguir' : 'para seguir'} · ${source.length} linhas em memória${logHint})`), width), r.id)
    }
  }
  if (rows.length > shown.length) push(truncateToWidth(theme.fg('dim', `  … ${view.offset + 1}–${view.offset + shown.length} de ${rows.length}`), width))
  if (view.focused) {
    push(rule(theme, width))
    push(footer(theme, width, view))
    if (view.flash) push(truncateToWidth(theme.fg('warning', view.flash), width))
  }
  return { lines, ids, detail: tabDetail }
}

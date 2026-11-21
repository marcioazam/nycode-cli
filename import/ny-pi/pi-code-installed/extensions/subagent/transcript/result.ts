/**
 * How the results of a subagent call are drawn. Collapsed (default) is a Claude Code style tree:
 * one row per agent (state glyph, name, task title, stats) and one detail line under it (the latest
 * tool while running, the error or the first output line after), then a footer that opens with the
 * aggregate glyph. Expanded (ctrl+o) keeps the same tree and adds task, tool list, output and usage
 * under each row. The state lives here, not in the call box above.
 */

import type { getMarkdownTheme, Theme } from '@earendil-works/pi-coding-agent'
import { Container, Markdown, Spacer, Text } from '@earendil-works/pi-tui'

import { formatUsageStats, getDisplayItems, getFinalOutput } from '../render.ts'
import type { SingleResult } from '../types.ts'
import { clip, formatToolCall, LINE_MAX, previewLine, resultStats, statsText, toolParts } from './format.ts'
import { Indent, type T, themed, Wrapped } from './layout.ts'

type MarkdownTheme = ReturnType<typeof getMarkdownTheme>
export type State = 'running' | 'done' | 'failed' | 'partial'

/** A result as drawn: the state already decided (a partial update is running) and the title chosen. */
export interface Entry {
  r: SingleResult
  state: State
  title: string
  step?: number
}

const EXPAND_HINT = 'ctrl+o expand'
const ERROR_LINES = 3

const STATE_STYLE: Record<State, { glyph: string; role: 'warning' | 'success' | 'error'; label: string }> = {
  running: { glyph: '●', role: 'warning', label: '' },
  done: { glyph: '✓', role: 'success', label: 'Done' },
  failed: { glyph: '✗', role: 'error', label: 'Failed' },
  partial: { glyph: '◐', role: 'warning', label: 'Partial' },
}

const glyph = (t: T, state: State): string => t.fg(STATE_STYLE[state].role, STATE_STYLE[state].glyph)

/** `live`: this result comes from a partial update, so exitCode 0 means "nothing final yet", not "done". */
export function stateOf(r: SingleResult, live: boolean): State {
  if (r.exitCode === -1) return 'running'
  if (r.exitCode !== 0 || r.stopReason === 'error' || r.stopReason === 'aborted') return 'failed'
  if (r.partial) return 'partial'
  return live ? 'running' : 'done'
}

// ---- pieces ----

function runningDetail(t: T, r: SingleResult): string {
  const items = getDisplayItems(r.messages)
  const last = items.findLast((i) => i.type === 'toolCall')
  if (!last) return t.fg('muted', items.length ? 'working…' : 'starting…')
  const { verb, arg } = toolParts(last.name, last.args)
  return t.fg('accent', verb) + t.fg('dim', clip(` ${arg}`, LINE_MAX - verb.length))
}

/** The whole error, one line of words (Wrapped folds and caps it at the width it gets). */
function errorText(r: SingleResult): string {
  const err = r.errorMessage || r.stderr || getFinalOutput(r.messages) || r.stopReason || ''
  return err.replace(/\s+/g, ' ').trim() || '(no output)'
}

/** The line(s) under a row: the latest tool while running, the error in full after a failure, the output preview after a finish. */
function detail(t: T, r: SingleResult, state: State, first: string, rest: string): Wrapped | Text {
  if (state === 'running') return new Text(`${first}${runningDetail(t, r)}`, 0, 0)
  if (state === 'failed') return new Wrapped(first, rest, t.fg('error', errorText(r)), ERROR_LINES, t.fg('error', '…'))
  const out = previewLine(getFinalOutput(r.messages))
  return new Text(`${first}${out ? t.fg('toolOutput', out) : t.fg('muted', '(no output)')}`, 0, 0)
}

function addToolList(container: Container, r: SingleResult, t: T): void {
  for (const item of getDisplayItems(r.messages)) {
    if (item.type === 'toolCall') container.addChild(new Text(`${t.fg('muted', '⎿')} ${formatToolCall(item.name, item.args, t.fg.bind(t))}`, 0, 0))
  }
}

function addOutput(container: Container, r: SingleResult, t: T, mdTheme: MarkdownTheme): void {
  const finalOutput = getFinalOutput(r.messages)
  if (finalOutput) {
    container.addChild(new Spacer(1))
    container.addChild(new Markdown(finalOutput.trim(), 0, 0, mdTheme))
  } else if (getDisplayItems(r.messages).length === 0) container.addChild(new Text(t.fg('muted', '(no output)'), 0, 0))
  const usageStr = formatUsageStats(r.usage, r.model)
  if (usageStr) {
    container.addChild(new Spacer(1))
    container.addChild(new Text(t.fg('dim', usageStr), 0, 0))
  }
}

/** Task, tool list, output and usage of one result: the part expanded adds to the collapsed row. */
function body(r: SingleResult, t: T, mdTheme: MarkdownTheme): Container {
  const container = new Container()
  container.addChild(new Text(t.fg('muted', 'Task: ') + t.fg('dim', r.task), 0, 0))
  addToolList(container, r, t)
  addOutput(container, r, t, mdTheme)
  return container
}

// ---- single ----

export function renderSingle(e: Entry, expanded: boolean, theme: Theme, mdTheme: MarkdownTheme): Container {
  const t = themed(theme)
  const { r, state } = e
  const container = new Container()
  if (expanded) {
    let header = `${glyph(t, state)} ${t.fg('toolTitle', t.bold(r.agent))}${t.fg('muted', ` (${r.agentSource})`)}`
    if (state === 'failed' && r.stopReason) header += ` ${t.fg('error', `[${r.stopReason}]`)}`
    container.addChild(new Text(header, 0, 0))
    if (state === 'failed' && r.errorMessage) container.addChild(new Text(t.fg('error', `Error: ${r.errorMessage}`), 0, 0))
    container.addChild(body(r, t, mdTheme))
    return container
  }
  const lead = `  ${t.fg('muted', '⎿')} ${glyph(t, state)} `
  if (state === 'running') container.addChild(new Text(`${lead}${runningDetail(t, r)}`, 0, 0))
  else {
    const stats = statsText(resultStats(r))
    container.addChild(new Text(`${lead}${t.fg(STATE_STYLE[state].role, STATE_STYLE[state].label)}${stats ? t.fg('dim', ` (${stats})`) : ''}`, 0, 0))
    container.addChild(detail(t, r, state, '    ', '    '))
  }
  container.addChild(new Text(t.fg('muted', `  ${EXPAND_HINT}`), 0, 0))
  return container
}

// ---- chain and parallel: one tree, steps numbered for the chain ----

/** "Done · 9 tools · …" for a finished run; just the stats while running (elapsed would be a stale partial span). */
function rowStats(r: SingleResult, state: State): string {
  const s = resultStats(r)
  const stats = statsText(state === 'running' ? { ...s, elapsedMs: undefined } : s)
  return [STATE_STYLE[state].label, stats].filter(Boolean).join(' · ')
}

function row(t: T, e: Entry, prefix: string, numbered: boolean, index: number): string {
  const num = numbered ? `${e.step ?? index + 1}. ` : ''
  const stats = rowStats(e.r, e.state)
  return `${prefix}${glyph(t, e.state)} ${num}${t.fg('toolTitle', t.bold(e.r.agent))}  ${e.title}${stats ? `   ${t.fg('dim', stats)}` : ''}`
}

function counts(entries: Entry[]): { text: string; running: number } {
  const running = entries.filter((e) => e.state === 'running').length
  const failed = entries.filter((e) => e.state === 'failed').length
  return { text: `${entries.length - running}/${entries.length} done${failed ? `, ${failed} failed` : ''}`, running }
}

function aggregate(entries: Entry[], failedState: State): State {
  if (entries.some((e) => e.state === 'running')) return 'running'
  return entries.some((e) => e.state === 'failed') ? failedState : 'done'
}

function totals(entries: Entry[]): string {
  const all = entries.map((e) => resultStats(e.r))
  return statsText({ tools: all.reduce((n, s) => n + s.tools, 0), tokens: all.reduce((n, s) => n + s.tokens, 0), cost: all.reduce((n, s) => n + s.cost, 0), elapsedMs: undefined })
}

function totalUsage(entries: Entry[]): string {
  const sum = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 }
  for (const { r } of entries) for (const k of Object.keys(sum) as (keyof typeof sum)[]) sum[k] += r.usage[k]
  return formatUsageStats(sum)
}

export function renderTree(mode: 'chain' | 'parallel', entries: Entry[], expanded: boolean, theme: Theme, mdTheme: MarkdownTheme): Container {
  const t = themed(theme)
  const container = new Container()
  const numbered = mode === 'chain'
  entries.forEach((e, i) => {
    const last = i === entries.length - 1
    container.addChild(new Text(row(t, e, `  ${t.fg('muted', last ? '└─' : '├─')} `, numbered, i), 0, 0))
    const bar = t.fg('muted', last ? ' ' : '│')
    container.addChild(detail(t, e.r, e.state, `  ${bar}  ${t.fg('muted', '⎿')} `, `  ${bar}    `))
    if (expanded) container.addChild(new Indent(body(e.r, t, mdTheme), `  ${bar}  `))
  })
  const { text, running } = counts(entries)
  const mark = glyph(t, aggregate(entries, mode === 'chain' ? 'failed' : 'partial'))
  const tail = expanded ? [text, ...(totalUsage(entries) ? [`Total: ${totalUsage(entries)}`] : [])] : [text, running ? '' : totals(entries), EXPAND_HINT]
  container.addChild(new Text(`  ${mark} ${t.fg('muted', tail.filter(Boolean).join(' · '))}`, 0, 0))
  return container
}

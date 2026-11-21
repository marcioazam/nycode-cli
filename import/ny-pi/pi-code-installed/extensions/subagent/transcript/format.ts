/**
 * One-line formatters for the transcript rendering of subagent calls: task titles, Claude-style
 * tool lines, output previews and run stats. Pure strings; the pristine ../render.ts keeps the
 * usage, final-output and display-item helpers that the dispatch code shares.
 */

import * as os from 'node:os'
import type { Message } from '@earendil-works/pi-ai'
import type { Theme } from '@earendil-works/pi-coding-agent'

import { getDisplayItems } from '../render.ts'

const ELLIPSIS = '…'
export const LINE_MAX = 72
export const TITLE_MAX = 48
const SENTENCE_MIN = 12

export const clip = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}${ELLIPSIS}` : text)

/** Cut at the last word boundary that keeps the result (ellipsis included) within max. */
function clipWords(text: string, max: number): string {
  if (text.length <= max) return text
  let head = text.slice(0, max - 1)
  if (text[max - 1] !== ' ') {
    const space = head.lastIndexOf(' ')
    if (space > 0) head = head.slice(0, space)
  }
  return `${head.trimEnd()}${ELLIPSIS}`
}

/**
 * A one-line label for a task: its first non-empty line, cut at a sentence end ('. ' or the end)
 * only when at least 12 characters precede it, then shortened at a word boundary. Never cut at ':'
 * ("Run: sleep 15" must not become "Run"). '{previous}' is dropped, so a chain template reads clean.
 */
export function taskTitle(task: string, fallback: string, max = TITLE_MAX): string {
  const line = task.replaceAll('{previous}', '').split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).find(Boolean) ?? ''
  const sentence = line.search(/\.(\s|$)/)
  const title = sentence >= SENTENCE_MIN ? line.slice(0, sentence) : line
  return title ? clipWords(title, max) : fallback
}

/** The first non-empty line of an output without markdown emphasis, code ticks or heading marks. */
export function previewLine(output: string, max = LINE_MAX): string {
  const lines = output.split('\n').filter((l) => l.trim())
  // Agent handbacks open with `status: complete` / `block_kind: none` headers; preview the first real line.
  const line = lines.find((l) => !/^[a-z_]+: \S+$/.test(l.trim())) ?? lines[0] ?? ''
  return clip(line.replace(/^[#>*\-\s]+/, '').replace(/\*+|__|`+/g, '').trim(), max)
}

function shortenPath(p: string): string {
  const home = os.homedir()
  return p === home || p.startsWith(`${home}/`) ? `~${p.slice(home.length)}` : p
}

const str = (v: unknown, fallback: string): string => (typeof v === 'string' && v ? v : fallback)
const pathOf = (a: Record<string, unknown>, fallback: string): string => shortenPath(str(a.file_path ?? a.path, fallback))

/** A range only when pi was asked for one: both offset and limit, or an open-ended offset. */
function readArg(a: Record<string, unknown>): string {
  const offset = typeof a.offset === 'number' ? a.offset : undefined
  const limit = typeof a.limit === 'number' && a.limit > 0 ? a.limit : undefined
  const path = pathOf(a, ELLIPSIS)
  if (offset === undefined) return path
  return `${path}:${offset}-${limit === undefined ? '' : offset + limit - 1}`
}

// A Map, not an object literal: a tool named after an Object.prototype key (constructor,
// toString) must fall through to the generic preview.
const TOOLS = new Map<string, [verb: string, arg: (a: Record<string, unknown>) => string]>([
  ['bash', ['Bash', (a) => clip(str(a.command, ELLIPSIS).split('\n')[0], 60)]],
  ['read', ['Read', readArg]],
  ['write', ['Write', (a) => `${pathOf(a, ELLIPSIS)}${typeof a.content === 'string' && a.content.includes('\n') ? ` (${a.content.split('\n').length} lines)` : ''}`]],
  ['edit', ['Edit', (a) => pathOf(a, ELLIPSIS)]],
  ['ls', ['Ls', (a) => pathOf(a, '.')]],
  ['find', ['Find', (a) => `${str(a.pattern, '*')} in ${pathOf(a, '.')}`]],
  ['grep', ['Grep', (a) => `/${str(a.pattern, '')}/ in ${pathOf(a, '.')}`]],
])

export function toolParts(name: string, args: Record<string, unknown>): { verb: string; arg: string } {
  const tool = TOOLS.get(name)
  if (tool) return { verb: tool[0], arg: tool[1](args) }
  return { verb: name, arg: clip(JSON.stringify(args), 50) }
}

export const toolLine = (name: string, args: Record<string, unknown>, max = LINE_MAX): string => {
  const { verb, arg } = toolParts(name, args)
  return clip(`${verb} ${arg}`, max)
}

export function formatToolCall(toolName: string, args: Record<string, unknown>, themeFg: Theme['fg']): string {
  const { verb, arg } = toolParts(toolName, args)
  return themeFg('accent', verb) + themeFg('dim', ` ${arg}`)
}

export interface RunStats {
  tools: number
  tokens: number
  cost: number
  /** Span between the first and last message timestamp; undefined when the messages do not carry two distinct ones. */
  elapsedMs: number | undefined
}

export function resultStats(r: { messages: Message[]; usage: { input: number; output: number; cost: number; contextTokens?: number } }): RunStats {
  const stamps = r.messages.map((m) => (m as { timestamp?: unknown }).timestamp).filter((t): t is number => typeof t === 'number')
  const span = stamps.length > 1 ? Math.max(...stamps) - Math.min(...stamps) : 0
  return {
    tools: getDisplayItems(r.messages).filter((i) => i.type === 'toolCall').length,
    tokens: r.usage.contextTokens || r.usage.input + r.usage.output,
    cost: r.usage.cost,
    elapsedMs: span > 0 ? span : undefined,
  }
}

const tokText = (n: number): string => (n < 1000 ? `${n}` : n < 1e6 ? `${(n / 1000).toFixed(1)}k` : `${(n / 1e6).toFixed(1)}M`)

function elapsedText(ms: number): string {
  const s = Math.max(1, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`
  return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`
}

/** "9 tools · 41.0k tok · $0.12 · 1m 15s"; empty when nothing was measured. */
export function statsText(s: RunStats): string {
  if (!s.tools && !s.tokens && !s.cost && s.elapsedMs === undefined) return ''
  const parts = [`${s.tools} tool${s.tools === 1 ? '' : 's'}`]
  if (s.tokens) parts.push(`${tokText(s.tokens)} tok`)
  if (s.cost > 0) parts.push(s.cost < 0.01 ? '<$0.01' : `$${s.cost.toFixed(2)}`)
  if (s.elapsedMs !== undefined) parts.push(elapsedText(s.elapsedMs))
  return parts.join(' · ')
}

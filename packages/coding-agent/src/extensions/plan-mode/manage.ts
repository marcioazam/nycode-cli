/**
 * Plan management (UI): the user's own marks over the plan items (skip), the detail drawer of one step,
 * the keys that are valid for it, and opening the plan as a file. No I/O except `openPlanFile`.
 * Record: docs/pi-interactive-display-2026-11-13.md ("Plan: gestão interativa").
 */
import { spawn } from 'node:child_process'
import { truncateToWidth, wrapTextWithAnsi } from '@nycode/tui'

import type { UiTheme } from '../subagent/fleet-ui/panel.ts'
import { formatDuration, formatSpend, PlanTimes, spendSince } from './table.ts'
import type { TodoItem } from './utils.ts'

/** What the user did to a step; never touches a step the agent has already completed. */
export interface Mark {
  status: 'skipped'
  note: string
}

export function applyMarks(items: readonly TodoItem[], marks: ReadonlyMap<number, Mark>): TodoItem[] {
  if (marks.size === 0) return items.slice()
  return items.map((i) => {
    const mark = marks.get(i.step)
    return mark && !i.completed ? { ...i, status: mark.status, note: mark.note } : i
  })
}

/** Keys that work on `item` right now (Plan focused). Order is the order shown. */
export function validKeys(item: TodoItem | undefined, paused: boolean): Array<[string, string]> {
  const keys: Array<[string, string]> = [['↵', 'detalhes'], ['o', 'abrir plano']]
  if (item && !item.completed) keys.push(item.status === 'skipped' ? ['r', 'reabrir'] : ['s', 'pular'])
  keys.push(['p', paused ? 'retomar' : 'pausar'], ['esc', 'back'])
  return keys
}

export interface DrawerInfo {
  state: string
  agent?: string
  tookMs?: number
  runningMs?: number
  spend?: { tokens: number; cost: number }
  file?: string
}

/** The drawer under the selected row: a framed block of facts; empty facts are left out. */
export function drawerLines(item: TodoItem, info: DrawerInfo, theme: UiTheme, width: number): string[] {
  const dim = (s: string): string => theme.fg('dim', s)
  const facts = [
    info.state,
    info.agent ? `agente ${info.agent}` : '',
    info.tookMs !== undefined ? `levou ${formatDuration(info.tookMs)}` : info.runningMs !== undefined ? `há ${formatDuration(info.runningMs)}` : '',
    info.spend && (info.spend.tokens > 0 || info.spend.cost > 0) ? formatSpend(info.spend) : '',
  ].filter(Boolean)
  // The step's description (bullets of the plan text): at most 6 wrapped lines, then `…`.
  const wrapped = (item.description ?? '').split('\n').filter(Boolean).flatMap((l) => wrapTextWithAnsi(l, Math.max(8, Math.min(width, 72) - 3)))
  const description = wrapped.length > 6 ? [...wrapped.slice(0, 6), '…'] : wrapped
  const body = [
    dim('│ ') + facts.join(dim(' · ')),
    ...description.map((l) => dim('│ ') + dim(l)),
    item.note ? dim('│ ') + theme.fg(item.status === 'skipped' ? 'dim' : 'warning', `nota: ${item.note}`) : '',
    dim('│ ') + dim(`tarefa: ${item.text}`),
    info.file ? dim('│ ') + dim(`plano: ${info.file}`) : '',
  ].filter(Boolean)
  const title = `passo ${String(item.step).padStart(2, '0')}`
  return [dim(`┌ ${title} ${'─'.repeat(Math.max(0, Math.min(width, 72) - title.length - 3))}`), ...body, dim('└' + '─'.repeat(Math.max(0, Math.min(width, 72) - 1)))].map((l) => truncateToWidth(' ' + l, width))
}

/** Spend of one step: the session's assistant messages between its start and finish (or now). */
export function stepSpend(entries: readonly unknown[], times: PlanTimes, step: number, now: number): { tokens: number; cost: number } | undefined {
  const w = times.window(step, now)
  return w ? spendSince(entries, w.from, w.to) : undefined
}

/** A checklist file for plans that live only as todos (no plan-mode file). */
export function planMarkdown(items: readonly TodoItem[]): string {
  const box = (i: TodoItem): string => (i.completed ? 'x' : i.status === 'skipped' ? '-' : ' ')
  return `# Plan\n\n${items.map((i) => `- [${box(i)}] ${i.step}. ${i.text}${i.note ? ` — ${i.note}` : ''}`).join('\n')}\n`
}

/** Opens a file with the desktop handler, detached. Resolves false when nothing could be started (no handler, headless). */
export function openPlanFile(path: string, platform: string = process.platform): Promise<boolean> {
  const cmd = platform === 'darwin' ? 'open' : platform === 'win32' ? 'explorer' : 'xdg-open'
  return new Promise((resolve) => {
    try {
      const child = spawn(cmd, [path], { stdio: 'ignore', detached: true })
      child.once('error', () => resolve(false))
      child.once('spawn', () => {
        child.unref()
        resolve(true)
      })
    } catch {
      resolve(false)
    }
  })
}

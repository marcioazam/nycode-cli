/** Indicador de trabalho: gradiente Tokyo Night, fase (pensando/escrevendo/ferramenta) e tempo decorrido. */

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { reducedMotion } from '../ui/a11y.ts'
import { icon } from './icons.ts'

const BRAILLE = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧']
const GRADIENT = ['mdHeading', 'syntaxType', 'accent', 'syntaxType']
const TARGET_MAX = 40

export type Tool = { name: string; target: string }
export type PhaseState = { phase: 'pensando' | 'escrevendo'; tools: Tool[]; elapsedMs: number }
type Fg = { fg: (key: string, text: string) => string }

/** 4s, 59s, 1m 05s, 1h 02m. */
export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}

export const truncate = (s: string, max = TARGET_MAX): string => (s.length > max ? `${s.slice(0, max - 1)}…` : s)

/** Alvo curto de uma chamada: path, primeira linha do comando ou padrão. */
export function toolTarget(args: unknown): string {
  const a = (args ?? {}) as Record<string, unknown>
  const raw = [a.path, a.command, a.pattern].find((v) => typeof v === 'string' && v !== '')
  return typeof raw === 'string' ? truncate(raw.split('\n')[0]) : ''
}

export function phaseText(state: PhaseState): string {
  const { tools } = state
  let phase: string = state.phase
  if (tools.length === 1) phase = tools[0].target ? `${tools[0].name} · ${tools[0].target}` : tools[0].name
  else if (tools.length > 1) phase = `${tools.length} ferramentas`
  return `${phase} · ${formatElapsed(state.elapsedMs)}`
}

export function frames(theme: Fg, motion: boolean): string[] {
  if (!motion) return [theme.fg('accent', '●')]
  return BRAILLE.map((f, i) => theme.fg(GRADIENT[i % GRADIENT.length], f))
}

export default function (pi: ExtensionAPI) {
  let timer: ReturnType<typeof setInterval> | undefined
  let startedAt = 0
  let phase: PhaseState['phase'] = 'pensando'
  const running = new Map<string, Tool>()

  const enabled = (ctx: { hasUI: boolean }) => ctx.hasUI && process.env.PI_CODE_SUBAGENT !== '1'
  const stop = () => {
    if (timer) clearInterval(timer)
    timer = undefined
  }
  const render = (ctx: any) => ctx.ui.setWorkingMessage(phaseText({ phase, tools: [...running.values()], elapsedMs: Date.now() - startedAt }))

  pi.on('session_start', (_e, ctx) => {
    if (!enabled(ctx)) return
    ctx.ui.setWorkingIndicator({ frames: frames(ctx.ui.theme, !reducedMotion()), intervalMs: 80 })
    ctx.ui.setHiddenThinkingLabel(`${icon('think')} raciocinando…`)
  })
  pi.on('agent_start', (_e, ctx) => {
    if (!enabled(ctx)) return
    stop()
    startedAt = Date.now()
    phase = 'pensando'
    running.clear()
    render(ctx)
    timer = setInterval(() => render(ctx), 1000)
    timer.unref?.()
  })
  pi.on('message_update', (_e, ctx) => {
    if (!enabled(ctx) || !timer || phase === 'escrevendo') return
    phase = 'escrevendo'
    render(ctx)
  })
  pi.on('tool_execution_start', (e: any, ctx) => {
    if (!enabled(ctx) || !timer) return
    running.set(e.toolCallId, { name: e.toolName, target: toolTarget(e.args) })
    render(ctx)
  })
  pi.on('tool_execution_end', (e: any, ctx) => {
    if (!enabled(ctx) || !timer) return
    running.delete(e.toolCallId)
    if (running.size === 0) phase = 'pensando'
    render(ctx)
  })
  pi.on('agent_settled', (_e, ctx) => {
    if (!enabled(ctx)) return
    stop()
    running.clear()
    ctx.ui.setWorkingMessage()
  })
  pi.on('session_shutdown', () => stop())
}

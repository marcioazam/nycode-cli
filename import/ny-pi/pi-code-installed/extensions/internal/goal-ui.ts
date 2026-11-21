/** Pure rendering helpers for the /goal UI (transcript lines, footer text, status panel),
 * modeled on Claude Code's goal_status attachment and /goal panel. */
import { formatDuration, formatTokens, type GoalSummary } from './goal-evaluator.ts'

export interface GoalMessageDetails {
  kind: 'set' | 'not_met' | 'achieved' | 'failed' | 'cleared' | 'checkin' | 'retry' | 'error'
  condition?: string
  reason?: string
  summary?: GoalSummary
  turn?: number
}

export interface GoalStyle {
  accent: (s: string) => string
  success: (s: string) => string
  error: (s: string) => string
  warning: (s: string) => string
  dim: (s: string) => string
  bold?: (s: string) => string
}

const turnos = (n: number): string => `${n} ${n === 1 ? 'turno' : 'turnos'}`

/** Display-only summary (the model-facing summaryText stays English). */
function resumo(s: GoalSummary): string {
  return `${formatDuration(s.durationMs)} · ${turnos(s.iterations)} · ${formatTokens(s.tokens)} tok`
}

/** Status text: turns are left out at 0 and the elapsed part during the first second. */
export function indicatorText(elapsedMs: number, turns = 0): string {
  return ['◎ objetivo', ...(turns > 0 ? [turnos(turns)] : []), ...(elapsedMs < 1000 ? [] : [formatDuration(elapsedMs)])].join(' · ')
}

const firstLine = (s: string): string => s.split('\n', 1)[0] ?? ''

/** Lines of one goal transcript message; `hint` is the styled expand hint. */
export function goalMessageLines(content: string, details: GoalMessageDetails | undefined, expanded: boolean, style: GoalStyle, hint: string): string[] {
  const { dim } = style
  const stats = (d: GoalMessageDetails): string => (d.summary ? dim(` (${resumo(d.summary)})`) : '')
  const extra = (d: GoalMessageDetails): string[] => [
    ...(d.condition ? [dim(`  Objetivo: ${d.condition}`)] : []),
    ...(d.reason ? [dim(`  Motivo: ${d.reason}`)] : []),
    ...(d.summary?.evaluator ? [dim(`  Avaliador: ${d.summary.evaluator}`)] : []),
  ]
  const fallback = (): string[] => (expanded ? [dim(content)] : [dim(firstLine(content)) + ' ' + hint])
  if (!details) return fallback()
  switch (details.kind) {
    case 'achieved':
      return [style.success('✓ Objetivo atingido') + stats(details) + (expanded ? '' : ' ' + hint), ...(expanded ? extra(details) : [])]
    case 'failed':
      return [
        style.error('✗ Objetivo não pôde ser atingido') + stats(details),
        ...(expanded ? extra(details) : details.reason ? [dim(`  ${details.reason}`)] : []),
      ]
    case 'not_met':
      return [dim('○ Objetivo ainda não atingido · continuando') + (expanded ? '' : ' ' + hint), ...(expanded ? extra(details) : [])]
    case 'set':
      return [style.accent('◎') + ` Objetivo definido ${details.condition ?? ''}`, ...(expanded ? [dim(content)] : [])]
    case 'cleared':
      return [dim(`Objetivo encerrado: ${details.condition ?? firstLine(content)}`)]
    case 'error':
      return [style.warning(firstLine(content))]
    default:
      return fallback()
  }
}

export interface GoalPanelState {
  active?: GoalSummary
  achieved?: GoalSummary
}

/** Content lines of the /goal status panel (the component adds the border and wrapping). */
export function goalPanelLines(state: GoalPanelState, style: GoalStyle): string[] {
  const { dim } = style
  const bold = style.bold ?? ((s: string) => s)
  const { active, achieved } = state
  const s = active ?? achieved
  if (!s) return ['Nenhum objetivo · ' + dim('/goal <condição> define um'), '', dim('esc fecha')]
  const stats = active
    ? `há ${formatDuration(s.durationMs)}${s.iterations > 0 ? ` · ${turnos(s.iterations)}` : ''} · ${formatTokens(s.tokens)} tok`
    : resumo(s)
  return [
    active ? bold(style.accent('◎ Objetivo ativo')) : bold(style.success('✓ Objetivo atingido')),
    dim(stats),
    '',
    `${dim('Objetivo:')} ${s.condition}`,
    ...(s.lastReason ? [`${dim('Última checagem:')} ${s.lastReason}`] : []),
    ...(active && s.evaluator ? [`${dim('Avaliador:')} ${s.evaluator}`] : []),
    '',
    dim(active ? '/goal clear encerra · esc fecha' : '/goal <condição> define outro · esc fecha'),
  ]
}

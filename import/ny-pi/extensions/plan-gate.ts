/**
 * Plan gate do pi: um plano aprovado roda até o fim e fecha com o `plan-reviewer`.
 *
 * Porta de ~/.claude/hooks/plan/plan_gate.py. No Claude, o hook guarda estado em arquivos e lê um ledger de edições;
 * no pi tudo já está no ramo da sessão, então o estado é derivado dele:
 * - aprovação: a última mensagem `plan-mode-execute` (pi-code plan-mode, "Execute the plan");
 * - veredito: a linha `PLAN_REVIEW: complete|incomplete` no resultado de um `subagent` que chamou `plan-reviewer`
 *   (single ou `tasks`); a posição da chamada é o início da revisão, então uma edição durante ou depois a invalida;
 * - edições: chamadas `edit`/`write` depois da aprovação (como o ledger do Claude, `bash` não conta);
 * - libera sem bloquear: `PLAN CANCELLED` (encerra), `PLAN BLOCKED:`, `PLAN WAITING:` (ou `PLANO ...`) na resposta
 *   final, e plan mode ligado;
 * - desiste (com aviso) depois de 3 paradas sem progresso ou 30 bloqueios.
 * Bloquear = `agent_before_settle` acrescenta uma mensagem `plan-gate` e pede continuação. Cada decisão grava uma
 * entrada `custom` `plan-gate` (estado, contadores, assinatura), que também é o log. `PI_PLAN_GATE=0` desliga.
 * Falha aberta: qualquer exceção libera. Testes: ~/.pi/agent/claude-home/bin/tests/plan-gate.test.ts.
 */

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

type Entry = Record<string, any>
export interface GateRecord {
  state: 'blocked' | 'allowed' | 'completed' | 'cancelled' | 'gave_up'
  why: string
  blocks: number
  noProgress: number
  sig: string
}
export interface GateDecision {
  action: 'none' | 'allow' | 'block' | 'give_up'
  why?: string
  message?: string
  record?: GateRecord
}

const MAX_NO_PROGRESS = 3
const MAX_BLOCKS = 30
const GAPS_LIMIT = 400
const VERDICT = /^\s*PLAN_REVIEW:\s*(complete|incomplete)\b/gim
const CANCELLED = /PLAN CANCELLED|PLANO CANCELADO/i
const BLOCKED = /PLAN BLOCKED:|PLANO BLOQUEADO:/i
const WAITING = /PLAN WAITING:|PLANO AGUARDANDO:/i
const STATES: Record<string, string> = {
  no_review: 'no plan-reviewer verdict yet',
  review_incomplete: 'the last review was incomplete',
  edit_after_review: 'files were edited after the last complete review',
}
const INSTRUCTION =
  'Finish the remaining plan items and the final gate (gate-runner), then call subagent {agent: "plan-reviewer"} with ' +
  'the plan, the /docs record and the git base; fix every gap through workers, review again. Stop only on ' +
  'PLAN_REVIEW: complete, or end with PLAN BLOCKED: <reason> (needs a user decision or authorization), ' +
  'PLAN WAITING: <background work> or PLAN CANCELLED (user cancelled).'

const role = (e: Entry): string | undefined => (e.type === 'message' ? e.message?.role : undefined)
const blocks = (e: Entry): Entry[] => (Array.isArray(e.message?.content) ? e.message.content : [])
const textOf = (e: Entry): string =>
  typeof e.content === 'string' ? e.content : blocks(e).filter((b) => b?.type === 'text').map((b) => String(b.text ?? '')).join('\n')

function callsReviewer(args: any): boolean {
  if (!args || typeof args !== 'object') return false
  if (args.agent === 'plan-reviewer') return true
  const many = [...(Array.isArray(args.tasks) ? args.tasks : []), ...(Array.isArray(args.chain) ? args.chain : [])]
  return many.some((t: any) => t?.agent === 'plan-reviewer')
}

function gapsOf(before: string): string {
  const lines = before.trimEnd().split('\n')
  let start = lines.length
  while (start > 0 && /^\s*[-*]\s/.test(lines[start - 1])) start--
  const text = start < lines.length ? lines.slice(start).join(' ') : before
  return text.replace(/\s+/g, ' ').trim().slice(0, GAPS_LIMIT)
}

export function decidePlanGate(entries: Entry[], env: Record<string, string | undefined> = process.env): GateDecision {
  if (env.PI_PLAN_GATE === '0') return { action: 'none' }
  let approved = -1
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].type === 'custom_message' && entries[i].customType === 'plan-mode-execute') {
      approved = i
      break
    }
  }
  if (approved < 0) return { action: 'none' }

  let lastRecord: GateRecord | undefined
  let planMode = false
  let lastEdit = -1
  let lastAssistant = ''
  let review: { at: number; verdict: string; gaps: string } | undefined
  let progress = 0
  const reviewerCalls = new Map<string, number>()
  for (let i = approved + 1; i < entries.length; i++) {
    const e = entries[i]
    if (e.type === 'custom' && e.customType === 'plan-gate') lastRecord = e.data as GateRecord
    if (e.type === 'custom' && e.customType === 'plan-mode') planMode = e.data?.enabled === true
    if (role(e) === 'assistant') {
      const text = textOf(e)
      if (text.trim()) lastAssistant = text
      for (const b of blocks(e)) {
        if (b?.type !== 'toolCall') continue
        progress++
        if (b.name === 'edit' || b.name === 'write') lastEdit = i
        if (b.name === 'subagent' && callsReviewer(b.arguments)) reviewerCalls.set(String(b.id), i)
      }
    }
    if (role(e) === 'toolResult' && e.message?.toolName === 'subagent' && reviewerCalls.has(String(e.message?.toolCallId))) {
      const text = textOf(e)
      const matches = [...text.matchAll(VERDICT)]
      const last = matches.at(-1)
      review = last
        ? { at: reviewerCalls.get(String(e.message.toolCallId)) ?? i, verdict: last[1].toLowerCase(), gaps: gapsOf(text.slice(0, last.index)) }
        : { at: reviewerCalls.get(String(e.message.toolCallId)) ?? i, verdict: 'incomplete', gaps: 'reviewer returned no PLAN_REVIEW line' }
    }
  }
  if (lastRecord && ['completed', 'cancelled', 'gave_up'].includes(lastRecord.state)) return { action: 'none' }

  const prev = { blocks: lastRecord?.blocks ?? 0, noProgress: lastRecord?.noProgress ?? 0, sig: lastRecord?.sig ?? '' }
  const keep = (state: GateRecord['state'], why: string, extra: Partial<GateRecord> = {}): GateRecord => ({ state, why, ...prev, ...extra })
  if (planMode) return { action: 'allow', why: 'plan_mode', record: keep('allowed', 'plan_mode') }
  if (CANCELLED.test(lastAssistant)) return { action: 'allow', why: 'marker_cancelled', record: keep('cancelled', 'marker_cancelled') }
  if (BLOCKED.test(lastAssistant)) return { action: 'allow', why: 'marker_blocked', record: keep('allowed', 'marker_blocked', { noProgress: 0 }) }
  if (WAITING.test(lastAssistant)) return { action: 'allow', why: 'marker_waiting', record: keep('allowed', 'marker_waiting') }
  if (review?.verdict === 'complete' && review.at >= lastEdit) {
    return { action: 'allow', why: 'review_complete', record: keep('completed', 'review_complete') }
  }

  const sig = `${progress}:${review?.at ?? '-'}`
  const noProgress = sig === prev.sig ? prev.noProgress + 1 : 0
  if (noProgress >= MAX_NO_PROGRESS || prev.blocks >= MAX_BLOCKS) {
    const message =
      `Plan gate stopped enforcing (${noProgress} stops without progress, ${prev.blocks} blocks). ` +
      'The plan still lacks PLAN_REVIEW: complete; run the plan-reviewer before treating the plan as done.'
    return { action: 'give_up', why: 'gave_up', message, record: { state: 'gave_up', why: 'gave_up', blocks: prev.blocks, noProgress, sig } }
  }
  const why = !review ? 'no_review' : review.verdict !== 'complete' ? 'review_incomplete' : 'edit_after_review'
  let head = `Plan gate: ${STATES[why]}.`
  if (why === 'review_incomplete' && review?.gaps) head += ` Gaps: ${review.gaps}`
  return {
    action: 'block',
    why,
    message: `${head} ${INSTRUCTION}`,
    record: { state: 'blocked', why, blocks: prev.blocks + 1, noProgress, sig },
  }
}

export default function (pi: ExtensionAPI) {
  if (process.env.PI_CODE_SUBAGENT === '1') return // o gate vale para a sessão principal, não para os workers
  pi.on('agent_before_settle', async (event: any, ctx: any) => {
    try {
      const decision = decidePlanGate(ctx.sessionManager.getBranch() as Entry[])
      if (decision.action === 'none' || !decision.record) return
      const entries = [...event.entries, { type: 'custom', customType: 'plan-gate', data: decision.record }]
      if (decision.action === 'give_up') {
        ctx.ui?.notify?.(decision.message, 'warning')
        return { entries }
      }
      if (decision.action !== 'block') return { entries }
      entries.push({ type: 'custom_message', customType: 'plan-gate', content: decision.message, display: true })
      return { entries, continue: true }
    } catch {
      return // falha aberta: nunca prende a sessão
    }
  })
}

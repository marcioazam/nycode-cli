/**
 * Goal Extension
 *
 * Claude Code's /goal: a completion condition the session keeps working toward. After
 * each turn a separate model judges the condition against the conversation and returns
 * met, not yet met (its reason becomes the next turn's guidance), or impossible. Claude
 * implements it as a session-scoped prompt-based Stop hook; pi-code runs the same loop
 * on agent_end next to the hooks extension's Stop path:
 * - `/goal <condition>` sets (or replaces) the goal and starts a turn with Claude's
 *   kickoff directive; `/goal` shows status; `/goal clear` (stop/off/reset/none/cancel)
 *   removes it. The condition is capped at 4,000 characters.
 * - The evaluator is Claude's small fast model: PI_GOAL_MODEL or ANTHROPIC_DEFAULT_HAIKU_MODEL
 *   resolved against the models this user can run, else the newest Haiku of the session's
 *   provider, else the session model. It runs with thinking off (or the model's lowest
 *   level when it cannot be off), reads the branch transcript trimmed to half its context
 *   window plus the harness-measured turn and elapsed time, and cannot run tools, so the
 *   condition must be provable from output. An unreadable or failed verdict is retried
 *   (larger budget when cut off, session model when the evaluator is unreachable, brief
 *   backoff otherwise) before the goal pauses.
 * - A failed turn whose error leaves the goal set is retried automatically up to three
 *   times (15/30/60 s) in an interactive session, then pauses; a rate or usage limit or a
 *   hook pauses at once (Claude 2.1.269 behavior).
 * - The Stop hooks' consecutive-block cap (CLAUDE_CODE_STOP_HOOK_BLOCK_CAP, default 8)
 *   bounds a stalled loop: that many not-met verdicts in a row on turns that used no tool
 *   pause the loop with a warning, goal still set, until the next user prompt.
 * - Evaluation is skipped while a subagent is still running (tracked from the subagent
 *   extension's bus events; pi has no other background work). A check-in turn is
 *   injected once the wait reaches CLAUDE_CODE_GOAL_CHECKIN_MINUTES (30, doubling up to
 *   four times the first interval, at most three idle check-ins between user prompts;
 *   0 turns check-ins off).
 * - A turn ended by the user (Esc) or by an error is not evaluated, and an Esc during
 *   the evaluation cancels it with the goal left set. An unrecoverable
 *   error (authentication, credits, context overflow, model unavailable) clears the goal
 *   with a warning once the run settles; a transient one leaves it set.
 * - The active goal persists as a session entry and is restored on resume or reload with
 *   the turn count, timer, and token baseline reset; an achieved, failed, or cleared goal
 *   is not restored.
 * - Gated as Claude documents: unavailable when hooks are restricted (disableAllHooks or
 *   allowManagedHooksOnly) or the project is not trusted, with the reason shown.
 * - Headless (`pi -p "/goal ..."`), the command holds the process open until the goal
 *   resolves or pauses, and warnings also go to stderr since there is no notify surface.
 *
 * Docs: https://code.claude.com/docs/en/goal.md
 */

import * as os from 'node:os'
import type { ExtensionAPI, ExtensionContext, Theme } from '@earendil-works/pi-coding-agent'
import { Text, truncateToWidth, wrapTextWithAnsi } from '@earendil-works/pi-tui'
import { hookFiles, readSettingsDisableAllHooks, stopHookBlockCap } from './hooks/index.ts'
import {
  checkinIntervalMs,
  checkinText,
  classifyTurnError,
  classifyUnrecoverable,
  EVALUATOR_SYSTEM,
  evaluatorPrompt,
  formatAchievedGoal,
  formatActiveGoal,
  formatDuration,
  formatTokens,
  GOAL_CONDITION_MAX_CHARS,
  type GoalSummary,
  type GoalVerdict,
  isClearAlias,
  kickoffPrompt,
  MAX_IDLE_CHECKINS,
  MAX_TURN_RETRIES,
  NO_GOAL_TEXT,
  parseVerdict,
  type RunningWork,
  VERDICT_TOOL,
  VERDICT_TOOL_NOTE,
  verdictFromArgs,
  renderTranscript,
  summaryText,
  turnRetryDelayMs,
} from './internal/goal-evaluator.ts'
import { type GoalMessageDetails, type GoalStyle, goalMessageLines, goalPanelLines, indicatorText } from './internal/goal-ui.ts'
import { readManagedSettings } from './internal/managed-settings.ts'
import { canForceTool, completeText, completeToolCall } from './internal/model-complete.ts'
import { resolveModelOverride } from './internal/model-lookup.ts'
import { isProjectApprovedSilently } from './internal/project-approval.ts'
import { isSubagentPhaseEvent, SUBAGENT_CHANNEL } from './internal/subagent-events.ts'
import { errorMessage } from './internal/values.ts'

/** Session entry type the goal state persists under, and the custom message type its
 * transcript lines (kickoff, verdicts, check-ins) carry. */
const GOAL_ENTRY = 'goal'
const GOAL_MESSAGE = 'goal'
/** Claude's prompt hooks allow 30 s, but the evaluator reads up to half a 1M-token window;
 * a slow evaluator is still an error, not a stall. */
const EVALUATOR_TIMEOUT_MS = 90_000
/** A verdict is one JSON object; the cap stops a runaway reply. Thinking the model cannot
 * turn off shares this budget (model-complete keeps it at the lowest level). */
const EVALUATOR_MAX_TOKENS = 1024
/** One retry with this cap when a reply was cut off before its verdict. */
const EVALUATOR_RETRY_MAX_TOKENS = 4096
/** Evaluator calls per turn before the goal pauses on an evaluator error. */
const EVALUATOR_ATTEMPTS = 3
const EVALUATOR_BACKOFF_MS = 2_000
/** Claude trims the transcript to half the evaluator's context window. */
const TRANSCRIPT_WINDOW_SHARE = 0.5
const CHARS_PER_TOKEN = 4
const DEFAULT_CONTEXT_WINDOW = 200_000
/** The `◎ goal <elapsed>` indicator re-renders on this cadence while a goal is active. */
const INDICATOR_REFRESH_MS = 60_000

const HOOKS_GATE = "/goal can't run while hooks are restricted (disableAllHooks or allowManagedHooksOnly is set in settings or by policy)."
const TRUST_GATE = '/goal is only available in trusted workspaces. Restart, accept the trust dialog, and try again.'

/** The evaluator's reply hit its token cap before a verdict could be read. */
class TruncatedVerdict extends Error {
  constructor(text: string) {
    super(text ? `verdict cut off at the token cap: ${text.slice(0, 200)}` : 'verdict cut off at the token cap before any text')
  }
}

type GoalState = 'active' | 'cleared' | 'achieved' | 'failed'

interface GoalEntry {
  state: GoalState
  condition: string
}

interface ActiveGoal {
  condition: string
  setAt: number
  iterations: number
  lastReason?: string
  /** Session token total when the goal was set; spend is measured from here. */
  tokensAtStart: number
  /** Evaluator calls are not on the session total; they count toward the goal's spend. */
  evaluatorTokens: number
  /** provider/id of the model that gave the latest verdict. */
  evaluator?: string
}

interface TurnMessage {
  role?: string
  stopReason?: string
  errorMessage?: string
}

interface TokenUsage {
  totalTokens?: number
  input?: number
  output?: number
  cacheRead?: number
  cacheWrite?: number
}

function usageTokens(usage: TokenUsage | undefined): number {
  if (!usage) return 0
  return usage.totalTokens ?? (usage.input ?? 0) + (usage.output ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0)
}

function lastAssistant(messages: readonly unknown[]): TurnMessage | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i] as TurnMessage
    if (message?.role === 'assistant') return message
  }
  return undefined
}

type SessionReader = Pick<ExtensionContext, 'sessionManager'>

/** The branch as the evaluator reads it: messages plus the goal's own transcript lines,
 * which live in custom_message entries. */
function branchMessages(ctx: SessionReader): unknown[] {
  const messages: unknown[] = []
  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type === 'message') messages.push(entry.message)
    else if (entry.type === 'custom_message') messages.push({ role: 'custom', customType: entry.customType, content: entry.content })
  }
  return messages
}

/** Cumulative assistant usage on the branch: the session's token spend so far. */
function sessionTokens(ctx: SessionReader): number {
  let total = 0
  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type === 'message' && entry.message.role === 'assistant') total += usageTokens(entry.message.usage as TokenUsage | undefined)
  }
  return total
}

/** The newest goal entry on the branch, which is the goal's persisted state. */
function lastGoalEntry(ctx: SessionReader): GoalEntry | undefined {
  const branch = ctx.sessionManager.getBranch()
  for (let i = branch.length - 1; i >= 0; i--) {
    const entry = branch[i]
    if (entry.type !== 'custom' || entry.customType !== GOAL_ENTRY) continue
    const data = entry.data as Partial<GoalEntry> | undefined
    return typeof data?.condition === 'string' && typeof data.state === 'string' ? { state: data.state, condition: data.condition } : undefined
  }
  return undefined
}

/** Claude's availability rule: /goal rides the hooks system, so a hooks restriction or an
 * untrusted workspace refuses it with the reason. Checked in Claude's order. */
function goalUnavailable(ctx: Pick<ExtensionContext, 'cwd' | 'isProjectTrusted' | 'ui'>): string | undefined {
  const managed = readManagedSettings()
  const trusted = isProjectApprovedSilently(ctx)
  const restricted = managed.disableAllHooks === true || managed.allowManagedHooksOnly === true || readSettingsDisableAllHooks(hookFiles(ctx.cwd, os.homedir(), trusted))
  if (restricted) return HOOKS_GATE
  // if (!trusted) return TRUST_GATE  // desligado por ~/.local/bin/pi
  return undefined
}

/** Claude evaluates on its small fast model, ANTHROPIC_DEFAULT_HAIKU_MODEL overriding it;
 * pi has no such tier, so the session model stands in unless the override names one of
 * the models this user can run. */
function evaluatorModel(ctx: ExtensionContext): ExtensionContext['model'] {
  const override = process.env.PI_GOAL_MODEL?.trim() || process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL?.trim()
  if (override) return resolveModelOverride(ctx, override)
  return smallFastModel(ctx) ?? ctx.model
}

/** Claude's small fast model, found the way Claude names it: the newest Haiku of the
 * session's provider that this user can run (dated snapshots skipped). Undefined when
 * the provider has none, and the session model judges instead. */
function smallFastModel(ctx: ExtensionContext): ExtensionContext['model'] {
  const session = ctx.model
  if (!session) return undefined
  const available = (ctx.modelRegistry?.getAvailable?.() ?? []) as NonNullable<ExtensionContext['model']>[]
  const version = (id: string): number[] => (/(\d+)-(\d+)/.exec(id)?.slice(1) ?? ['0', '0']).map(Number)
  const candidates = available.filter((m) => m.provider === session.provider && /haiku/i.test(m.id) && !/\d{8}$/.test(m.id))
  candidates.sort((a, b) => {
    const [aMajor, aMinor] = version(a.id)
    const [bMajor, bMinor] = version(b.id)
    return bMajor - aMajor || bMinor - aMinor
  })
  return candidates[0]
}

function modelLabel(model: ExtensionContext['model']): string | undefined {
  return model ? `${model.provider}/${model.id}` : undefined
}

/** Resolves after `ms`, or rejects at once when the signal fires. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason)
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(signal.reason)
    }, { once: true })
  })
}

function transcriptBudget(model: { contextWindow?: number }): number {
  return Math.floor((model.contextWindow || DEFAULT_CONTEXT_WINDOW) * TRANSCRIPT_WINDOW_SHARE * CHARS_PER_TOKEN)
}

export default function goalExtension(pi: ExtensionAPI) {
  let goal: ActiveGoal | undefined
  /** The last goal achieved this session, for the status view after it clears. */
  let achieved: GoalSummary | undefined
  /** The live context, for timer callbacks that fire outside any pi event. */
  let sessionCtx: ExtensionContext | undefined
  /** Bumped whenever the goal is set, cleared, or the session changes, so an evaluation
   * that resolves after any of those is dropped instead of steering the wrong goal. */
  let generation = 0
  /** Whether the run now ending executed a tool: Claude's "progress" for the block cap. */
  let turnUsedTools = false
  /** Not-met verdicts in a row on turns that used no tool. */
  let noProgressStreak = 0
  /** The error the last run ended on, judged once the run settles (past pi's retries). */
  let lastTurnError: string | undefined
  /** Subagents still running, by id, from the subagent extension's bus events. */
  const running = new Map<string, string>()
  let deferredSince: number | undefined
  let checkinsDelivered = 0
  let idleCheckins = 0
  /** A check-in came due while a turn was running: deliver it at the next turn end. */
  let checkinDue = false
  let checkinTimer: ReturnType<typeof setTimeout> | undefined
  /** Automatic retries of failed turns since the last good turn or user prompt. */
  let turnRetries = 0
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  let indicatorTimer: ReturnType<typeof setInterval> | undefined

  /** A goal line in the transcript, which the model also reads. A timer can outlive the
   * session that armed it, and sendMessage throws on a disposed one. */
  function send(content: string, details: GoalMessageDetails, options: { triggerTurn: boolean; deliverAs?: 'followUp' }): void {
    try {
      pi.sendMessage({ customType: GOAL_MESSAGE, content, display: true, details }, options)
    } catch {
      // Disposed session: nothing left to tell.
    }
  }

  /** A line for the user. Headless runs have no notify surface, and a refusal or a
   * loop that stops there without a word would look like a hang, so it also goes to
   * stderr (where Claude's -p mode prints its goal messages). */
  function tell(ctx: ExtensionContext, text: string, level: 'info' | 'warning' | 'error'): void {
    ctx.ui.notify(text, level)
    if (!ctx.hasUI) process.stderr.write(`${text}\n`)
  }

  function currentSummary(ctx: SessionReader): GoalSummary | undefined {
    if (!goal) return undefined
    const evaluator = goal.evaluator ?? (sessionCtx ? modelLabel(evaluatorModel(sessionCtx)) : undefined)
    return { condition: goal.condition, durationMs: Date.now() - goal.setAt, iterations: goal.iterations, tokens: sessionTokens(ctx) - goal.tokensAtStart + goal.evaluatorTokens, lastReason: goal.lastReason, evaluator }
  }

  function showIndicator(ctx: ExtensionContext): void {
    if (!goal) return
    ctx.ui.setStatus('goal', ctx.ui.theme.fg('accent', indicatorText(Date.now() - goal.setAt, goal.iterations)))
    if (!indicatorTimer) {
      indicatorTimer = setInterval(() => {
        if (sessionCtx) showIndicator(sessionCtx)
      }, INDICATOR_REFRESH_MS)
      indicatorTimer.unref?.()
    }
  }

  function stopIndicator(ctx: ExtensionContext): void {
    clearInterval(indicatorTimer)
    indicatorTimer = undefined
    ctx.ui.setStatus('goal', undefined)
  }

  function stopCheckin(): void {
    clearTimeout(checkinTimer)
    checkinTimer = undefined
  }

  function endDeferral(): void {
    deferredSince = undefined
    checkinDue = false
    stopCheckin()
  }

  function stopRetry(): void {
    clearTimeout(retryTimer)
    retryTimer = undefined
    turnRetries = 0
  }

  /** Make `condition` the active goal with fresh counters; the entry is the caller's. */
  function activate(ctx: ExtensionContext, condition: string): void {
    goal = { condition, setAt: Date.now(), iterations: 0, tokensAtStart: sessionTokens(ctx), evaluatorTokens: 0 }
    generation += 1
    noProgressStreak = 0
    checkinsDelivered = 0
    idleCheckins = 0
    endDeferral()
    stopRetry()
    showIndicator(ctx)
  }

  /** Drop the active goal, recording how it ended; returns its condition. */
  function endGoal(ctx: ExtensionContext, state: Exclude<GoalState, 'active'>): string | undefined {
    const ended = goal
    if (!ended) return undefined
    goal = undefined
    generation += 1
    endDeferral()
    stopRetry()
    stopIndicator(ctx)
    pi.appendEntry(GOAL_ENTRY, { state, condition: ended.condition } satisfies GoalEntry)
    return ended.condition
  }

  function finish(ctx: ExtensionContext, state: 'achieved' | 'failed', reason: string): void {
    const summary = currentSummary(ctx)
    if (!summary) return
    if (state === 'achieved') achieved = summary
    endGoal(ctx, state)
    const head = state === 'achieved' ? `Goal achieved (${summaryText(summary)}): ${summary.condition}` : `Goal could not be achieved (${summaryText(summary)}): ${summary.condition}`
    const judge = summary.evaluator ? `Evaluator (${summary.evaluator})` : 'Evaluator'
    send(reason ? `${head}\n${judge}: ${reason}` : head, { kind: state, condition: summary.condition, reason, summary }, { triggerTurn: false })
  }

  /** Claude feeds a not-met reason back as the next turn, under the Stop hooks' cap. */
  function continueGoal(ctx: ExtensionContext, active: ActiveGoal, reason: string): void {
    noProgressStreak = turnUsedTools ? 0 : noProgressStreak + 1
    const cap = stopHookBlockCap()
    showIndicator(ctx)
    if (noProgressStreak >= cap) {
      noProgressStreak = 0
      tell(ctx, `Objetivo pausado após ${cap} turnos seguidos sem uso de ferramenta; continua definido e a checagem volta após o seu próximo prompt.`, 'warning')
      return
    }
    const summary = currentSummary(ctx)
    const spent = summary ? ` · ${formatDuration(summary.durationMs)} · ${formatTokens(summary.tokens)} tokens` : ''
    send(`Goal not yet met (turn ${active.iterations}${spent}): ${reason}\nGoal: ${active.condition}`, { kind: 'not_met', condition: active.condition, reason, turn: active.iterations }, { triggerTurn: true })
  }

  async function askEvaluator(ctx: ExtensionContext, active: ActiveGoal, model: NonNullable<ExtensionContext['model']>, maxTokens: number, structured: boolean): Promise<GoalVerdict> {
    const transcript = renderTranscript(branchMessages(ctx), transcriptBudget(model))
    // Esc during the evaluation aborts the run's signal; the call must die with it, or
    // a late verdict would queue the next goal turn into a run the user just stopped.
    const deadline = AbortSignal.timeout(EVALUATOR_TIMEOUT_MS)
    const signal = ctx.signal ? AbortSignal.any([ctx.signal, deadline]) : deadline
    // Claude runs its evaluator with thinking disabled: the verdict is mechanical.
    // completeText asks for no thinking, or the lowest level a model that cannot turn it
    // off accepts.
    const progress = { turn: active.iterations + 1, elapsedMs: Date.now() - active.setAt }
    const prompt = evaluatorPrompt(transcript, active.condition, progress)
    // Where the model allows it, the verdict is a forced tool call held to a schema (Claude
    // pins its evaluator reply with a JSON schema); otherwise it is JSON text.
    const { text, usage, stopReason, args } = structured
      ? await completeToolCall(model, prompt, VERDICT_TOOL, { system: `${EVALUATOR_SYSTEM}\n${VERDICT_TOOL_NOTE}`, maxTokens, signal, registry: ctx.modelRegistry })
      : { ...(await completeText(model, prompt, { system: EVALUATOR_SYSTEM, maxTokens, signal, registry: ctx.modelRegistry })), args: undefined }
    active.evaluatorTokens += usageTokens(usage as TokenUsage | undefined)
    const verdict = verdictFromArgs(args) ?? parseVerdict(text)
    if (verdict) return verdict
    if (stopReason === 'length') throw new TruncatedVerdict(text)
    throw new Error(text ? `unreadable verdict: ${text.slice(0, 200)}` : `empty verdict (stop reason ${stopReason})`)
  }

  /** Up to EVALUATOR_ATTEMPTS calls: a cut-off reply gets a larger budget, a model the
   * user cannot reach (an unavailable Haiku) falls back to the session model, and other
   * failures back off briefly. Throws the last error once attempts run out. */
  async function judge(ctx: ExtensionContext, active: ActiveGoal, first: NonNullable<ExtensionContext['model']>, startedGeneration: number): Promise<GoalVerdict> {
    let model = first
    let maxTokens = EVALUATOR_MAX_TOKENS
    /** Off once a forced-tool call fails, so a provider that rejects it still gets a verdict as text. */
    let toolAllowed = true
    let lastError: unknown
    for (let attempt = 1; attempt <= EVALUATOR_ATTEMPTS; attempt++) {
      try {
        const verdict = await askEvaluator(ctx, active, model, maxTokens, toolAllowed && canForceTool(model))
        active.evaluator = modelLabel(model)
        return verdict
      } catch (error) {
        lastError = error
        if (ctx.signal?.aborted || generation !== startedGeneration) throw error
        if (error instanceof TruncatedVerdict) {
          maxTokens = EVALUATOR_RETRY_MAX_TOKENS
          continue
        }
        const unrecoverable = classifyUnrecoverable(errorMessage(error))
        if (unrecoverable && ctx.model && model !== ctx.model) {
          tell(ctx, `O avaliador ${modelLabel(model)} falhou (${unrecoverable}); avaliando com o modelo da sessão ${modelLabel(ctx.model)}.`, 'warning')
          model = ctx.model
          continue
        }
        if (unrecoverable) throw error
        if (toolAllowed && canForceTool(model)) {
          toolAllowed = false
          continue
        }
        if (attempt < EVALUATOR_ATTEMPTS) await sleep(EVALUATOR_BACKOFF_MS * attempt, ctx.signal)
      }
    }
    throw lastError
  }

  async function evaluate(ctx: ExtensionContext): Promise<void> {
    const active = goal
    if (!active) return
    const startedGeneration = generation
    const model = evaluatorModel(ctx)
    if (!model) {
      tell(ctx, 'O avaliador não tem modelo para rodar; o objetivo continua definido.', 'warning')
      return
    }
    let verdict: GoalVerdict
    try {
      verdict = await judge(ctx, active, model, startedGeneration)
    } catch (error) {
      // A user interrupt is not an evaluator failure: the goal stays, nothing to say.
      if (ctx.signal?.aborted) return
      // No verdict is a hook error in Claude's terms: the turn ends and the goal stays,
      // paused until the user's next prompt (Claude's "Goal paused" for a hook).
      if (generation === startedGeneration) tell(ctx, `Objetivo pausado: o avaliador falhou ${EVALUATOR_ATTEMPTS} vezes (${errorMessage(error)}). O objetivo continua definido; envie uma mensagem para seguir e o próximo turno é avaliado de novo.`, 'warning')
      return
    }
    // Interrupted, cleared, or replaced during the await: this verdict must not act.
    if (ctx.signal?.aborted || generation !== startedGeneration) return
    applyVerdict(ctx, active, verdict)
  }

  function applyVerdict(ctx: ExtensionContext, active: ActiveGoal, verdict: GoalVerdict): void {
    // A turn that reached a verdict is a good turn: the retry allowance starts over.
    turnRetries = 0
    active.iterations += 1
    active.lastReason = verdict.reason
    if (verdict.ok) finish(ctx, 'achieved', verdict.reason)
    else if (verdict.impossible) finish(ctx, 'failed', verdict.reason)
    else continueGoal(ctx, active, verdict.reason)
  }

  function deliverCheckin(paused: boolean): void {
    if (!goal) return
    checkinDue = false
    checkinsDelivered += 1
    const work: RunningWork[] = [...running].map(([id, agentType]) => ({ id, agentType }))
    send(checkinText(goal.condition, Date.now() - (deferredSince ?? Date.now()), work, paused), { kind: 'checkin', condition: goal.condition }, { triggerTurn: true })
  }

  function onCheckinDue(): void {
    checkinTimer = undefined
    if (!goal || !sessionCtx) return
    // Claude delivers a due check-in at the next turn end when a turn is running, and
    // only starts idle turns for it up to the per-prompt cap.
    if (!sessionCtx.isIdle() || idleCheckins >= MAX_IDLE_CHECKINS) {
      checkinDue = true
      return
    }
    idleCheckins += 1
    deliverCheckin(idleCheckins >= MAX_IDLE_CHECKINS)
  }

  function armCheckin(): void {
    if (checkinTimer) return
    const ms = checkinIntervalMs(process.env, checkinsDelivered)
    if (ms <= 0) return
    checkinTimer = setTimeout(onCheckinDue, ms)
    checkinTimer.unref?.()
  }

  /** Background work keeps the goal waiting: no verdict this turn, a check-in later. */
  function deferEvaluation(): void {
    deferredSince ??= Date.now()
    if (checkinDue) {
      deliverCheckin(false)
      return
    }
    armCheckin()
  }

  /** Claude's handling of a failed turn whose error leaves the goal set: an interactive
   * session retries a transient failure up to MAX_TURN_RETRIES times with a growing
   * wait, then pauses; a failure a retry would only repeat (rate or usage limit, a hook)
   * pauses at once. CLAUDE_CODE_GOAL_CHECKIN_MINUTES=0 turns retries off, and headless
   * runs only pause, as Claude's do. */
  function handleTurnError(ctx: ExtensionContext, message: string): void {
    const { action, cause } = classifyTurnError(message)
    const brief = message.length > 200 ? `${message.slice(0, 200)}...` : message
    const retriesOff = checkinIntervalMs(process.env, 0) <= 0
    if (action === 'pause' || retriesOff || !ctx.hasUI || turnRetries >= MAX_TURN_RETRIES) {
      const why = action === 'retry' && turnRetries >= MAX_TURN_RETRIES ? `${cause}, após ${MAX_TURN_RETRIES} tentativas automáticas` : cause
      clearTimeout(retryTimer)
      retryTimer = undefined
      tell(ctx, `Objetivo pausado (${why}): "${brief}". O objetivo continua definido; envie uma mensagem para seguir.`, 'warning')
      return
    }
    turnRetries += 1
    const attempt = turnRetries
    const delay = turnRetryDelayMs(attempt)
    const startedGeneration = generation
    tell(ctx, `Objetivo ainda ativo após um turno com falha (${cause}); nova tentativa em ${Math.round(delay / 1000)}s (${attempt}/${MAX_TURN_RETRIES}).`, 'info')
    clearTimeout(retryTimer)
    retryTimer = setTimeout(() => {
      retryTimer = undefined
      if (!goal || generation !== startedGeneration || !sessionCtx?.isIdle()) return
      send(`Goal retry ${attempt}/${MAX_TURN_RETRIES} after a failed turn (${cause}: ${brief}). Continue toward the goal.\nGoal: ${goal.condition}`, { kind: 'retry', condition: goal.condition }, { triggerTurn: true })
    }, delay)
    retryTimer.unref?.()
  }

  function statusText(ctx: SessionReader): string {
    const summary = currentSummary(ctx)
    if (summary) return formatActiveGoal(summary)
    if (achieved) return formatAchievedGoal(achieved)
    return NO_GOAL_TEXT
  }

  function styleOf(theme: Theme): GoalStyle {
    return { accent: (s) => theme.fg('accent', s), success: (s) => theme.fg('success', s), error: (s) => theme.fg('error', s), warning: (s) => theme.fg('warning', s), dim: (s) => theme.fg('dim', s), bold: (s) => theme.bold(s) }
  }

  async function showPanel(ctx: ExtensionContext): Promise<void> {
    const state = { active: currentSummary(ctx), achieved }
    await ctx.ui.custom<void>((tui, theme, keybindings, done) => ({
      render(width: number): string[] {
        const rule = theme.fg('borderMuted', '─'.repeat(width))
        const body = goalPanelLines(state, styleOf(theme)).flatMap((line) => (line === '' ? [''] : wrapTextWithAnsi(line, Math.max(1, width - 2)))).map((line) => truncateToWidth(` ${line}`, width))
        return [rule, ...body, rule]
      },
      handleInput(data: string): void {
        if (keybindings.matches(data, 'tui.select.cancel') || keybindings.matches(data, 'tui.select.confirm')) done()
      },
      invalidate(): void {},
    }))
  }

  pi.registerMessageRenderer<GoalMessageDetails>(GOAL_MESSAGE, (message, options, theme) => {
    const content = typeof message.content === 'string' ? message.content : message.content.map((c) => (c.type === 'text' ? c.text : '')).join('')
    const lines = goalMessageLines(content, message.details, options.expanded, styleOf(theme), options.keyHint('app.tools.expand', 'expandir'))
    return new Text(lines.join('\n'), options.outputPad, 0)
  })

  pi.registerCommand('goal', {
    description: 'Set a goal the session keeps working toward until a separate check confirms it is met; /goal shows status, /goal clear stops',
    handler: async (args, ctx) => {
      sessionCtx = ctx
      const condition = args.trim()
      if (condition === '') {
        if (ctx.mode !== 'tui') {
          tell(ctx, statusText(ctx), 'info')
          return
        }
        await showPanel(ctx)
        return
      }
      if (isClearAlias(condition)) {
        const cleared = endGoal(ctx, 'cleared')
        if (cleared === undefined) tell(ctx, 'Nenhum objetivo definido', 'info')
        else send(`Goal cleared: ${cleared}`, { kind: 'cleared', condition: cleared }, { triggerTurn: false })
        return
      }
      if (condition.length > GOAL_CONDITION_MAX_CHARS) {
        tell(ctx, `A condição do objetivo é limitada a ${GOAL_CONDITION_MAX_CHARS} caracteres (recebi ${condition.length})`, 'error')
        return
      }
      const blocked = goalUnavailable(ctx)
      if (blocked) {
        tell(ctx, blocked, 'error')
        return
      }
      // A new goal replaces the current one, as Claude documents; the entry written here
      // is the state a resume restores.
      activate(ctx, condition)
      pi.appendEntry(GOAL_ENTRY, { state: 'active', condition } satisfies GoalEntry)
      if (!ctx.hasUI) tell(ctx, `Objetivo definido: ${condition}`, 'info')
      // Setting a goal starts a turn immediately with the condition as the directive; a
      // send during streaming queues it as a follow-up turn.
      send(kickoffPrompt(condition), { kind: 'set', condition }, ctx.isIdle() ? { triggerTurn: true } : { triggerTurn: true, deliverAs: 'followUp' })
      // A headless run (`pi -p "/goal ..."`) exits as soon as the command returns, before
      // the kickoff turn runs. pi marks the run active synchronously on the send, and the
      // continuations queued at agent_end extend that run, so waiting here holds the
      // process open until the goal resolves, as Claude's -p mode does. The TUI's main
      // loop returns to the editor on its own, so it must not block on the loop.
      if (!ctx.hasUI) await ctx.waitForIdle()
    },
  })

  pi.events.on(SUBAGENT_CHANNEL, (data) => {
    if (!isSubagentPhaseEvent(data)) return
    if (data.phase === 'start') running.set(data.agentId, data.agentType)
    else running.delete(data.agentId)
  })

  pi.on('session_start', (_event, ctx) => {
    // pi's CLI builds a fresh extension instance per session replacement; RPC mode can reuse
    // one across sessions, so drop the previous session's goal and
    // timers before reading this session's persisted state.
    sessionCtx = ctx
    goal = undefined
    achieved = undefined
    generation += 1
    turnUsedTools = false
    noProgressStreak = 0
    lastTurnError = undefined
    checkinsDelivered = 0
    idleCheckins = 0
    endDeferral()
    stopIndicator(ctx)
    const entry = lastGoalEntry(ctx)
    if (entry?.state !== 'active') return
    // Claude restores a still-active goal on resume with its counters reset.
    activate(ctx, entry.condition)
    tell(ctx, `Objetivo restaurado: ${entry.condition}`, 'info')
  })

  pi.on('session_shutdown', () => {
    stopCheckin()
    stopRetry()
    clearInterval(indicatorTimer)
    indicatorTimer = undefined
  })

  pi.on('agent_start', () => {
    turnUsedTools = false
  })

  pi.on('tool_execution_start', () => {
    turnUsedTools = true
  })

  pi.on('input', (event) => {
    // Only genuine user input is progress: a goal continuation or a subagent prompt
    // arrives with source 'extension'. Claude resets the block cap and the idle
    // check-in allowance on the user's next prompt.
    if (event.source === 'extension') return
    noProgressStreak = 0
    idleCheckins = 0
    // The user's prompt starts the next turn itself; a pending automatic retry would
    // only stack another one behind it.
    stopRetry()
  })

  // On agent_end rather than agent_settled, for the reason hooks.ts gives: a peer
  // extension can hold its agent_end handler on a dialog, which would starve a settle-
  // based evaluation; and a continuation sent here is picked up as the run's own
  // continuation rather than a fresh prompt.
  pi.on('agent_end', async (event, ctx) => {
    sessionCtx = ctx
    const last = lastAssistant(event.messages)
    lastTurnError = last?.stopReason === 'error' ? (last.errorMessage ?? 'unknown error') : undefined
    // Claude runs no Stop evaluation after a user interrupt; a failed turn is judged once
    // the run settles, so neither is evaluated here and the goal stays set.
    if (!goal || last?.stopReason === 'aborted' || lastTurnError !== undefined) return
    if (running.size > 0) {
      deferEvaluation()
      return
    }
    endDeferral()
    await evaluate(ctx)
  })

  pi.on('agent_settled', (_event, ctx) => {
    const message = lastTurnError
    lastTurnError = undefined
    if (!goal || message === undefined) return
    const kind = classifyUnrecoverable(message)
    if (!kind) {
      handleTurnError(ctx, message)
      return
    }
    endGoal(ctx, 'cleared')
    const text = `Goal cleared after an unrecoverable error (${kind}): "${message}". Run /goal again to continue.`
    send(text, { kind: 'error', condition: undefined }, { triggerTurn: false })
    tell(ctx, `Objetivo encerrado após um erro sem recuperação (${kind}): "${message}". Rode /goal de novo para continuar.`, 'warning')
  })
}

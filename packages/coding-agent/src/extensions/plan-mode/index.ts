/**
 * Plan Mode Extension
 *
 * Read-only exploration mode for safe code analysis.
 * When enabled, only read-only tools are available.
 *
 * Features:
 * - /plan [description] to enter (and start a task), Ctrl+Shift+P to toggle
 * - Bash restricted to allowlisted read-only commands
 * - Extracts numbered plan steps from "Plan:" sections
 * - [DONE:n] markers to complete steps during execution
 * - Progress tracking widget during execution
 */

import { openPlanFile, planMarkdown } from './manage.ts'
import { PlanModal, planTitle } from './modal.ts'
import { PlanSection, setPlanPath } from './section.ts'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { getAgentDir } from '../../config.ts'

import type { AgentMessage } from '@nycode/agent-core'
import type { AssistantMessage, TextContent } from '@nycode/ai'
import type { ExtensionAPI, ExtensionContext } from '../../core/extensions/types.ts'
import type { SessionEntry } from '../../core/session-manager.ts'
import { Key } from '@nycode/tui'
import { Type } from 'typebox'

import { PLAN_MODE_CHANNEL } from '../_shared/events/plan-mode-state.ts'

/** Plan progress for other extensions (agents correlate their runs with the open step): {executing, step?, done, total}, `step` = first open step; published only when it changes. */
const PLAN_STATE_CHANNEL = 'pi-code:plan-state'
import { hudTheme } from '../subagent/fleet-ui/style/palette.ts'
import type { UiTheme } from '../subagent/fleet-ui/panel.ts'
import { isPlanModeToolAllowed, isSafeCommand, lintPlan, plansDir, markCompletedSteps, planToTodos, restoredPlanState, type TodoItem } from './utils.ts'
import { CANCELLED, HOLD, plainPaint, renderDoneTags, type DonePaint } from './done-view.ts'

// Tools
const PLAN_MODE_TOOLS = [
  'read', 'bash', 'grep', 'find', 'ls', 'question', 'plan_mode_complete',
  'tool_search', 'web_fetch', 'mcp__keenable__search_web_pages', 'lsp_diagnostics', 'lsp_hover', 'lsp_definition', 'lsp_references', 'lsp_symbols',
  'todo', 'subagent', 'write', 'edit', // subagent, write and edit are narrowed by isPlanModeToolAllowed
]

/** The tracker reads only this literal tag from the reply text; prose or ☑ checkboxes do not count. */
const DONE_RULE = 'When you finish step n, write the literal tag [DONE:n] in the final reply of the turn (the message without a tool call); the tracker reads only this tag, not prose or checkboxes. If the step ended mid-work, repeat the tag in the final reply. In that reply tick box n under `## Progresso` of the task\'s /docs record.'

/** Only the end of the plan or an explicit user request ends plan mode (owner contract 2026-11-15): nothing else, no event, no command. */
const CANCEL_RULE = 'Only when the user explicitly asks to leave plan mode or cancel the plan, end your reply with the line PLAN CANCELLED on its own; never on your own initiative.'

// Type guard for assistant messages
function isAssistantMessage(m: AgentMessage): m is AssistantMessage {
  return m.role === 'assistant' && Array.isArray(m.content)
}

// Extract text content from an assistant message
function getTextContent(message: AssistantMessage): string {
  return message.content
    .filter((block): block is TextContent => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
}

// PLAN CANCELLED (or PLANO CANCELADO) alone on a line of the reply
// PLAN WAITING / PLAN BLOCKED (or the pt-BR forms) alone on a line: the plan is on hold, shown in the Plan section
const holdOf = (text: string): 'waiting' | 'blocked' | undefined => {
  for (const line of text.split('\n')) {
    const m = HOLD.exec(line)
    if (m) return /^(?:WAITING|AGUARDANDO)$/i.test(m[1] ?? m[2] ?? '') ? 'waiting' : 'blocked'
  }
  return undefined
}

const isCancelled = (message: AssistantMessage | undefined): boolean => !!message && getTextContent(message).split('\n').some((line) => CANCELLED.test(line))

/** Said once when plan mode is left. The earlier [PLAN MODE ACTIVE] notes stay in the transcript:
 * removing them changed the cached prefix and made pi replay the prompt and tools as a new head,
 * a full prompt-cache miss on every exit (measured 2026-11-14: 0 of 35.7k tokens read). */
const PLAN_ENDED_NOTE = '[PLAN MODE ENDED] Full tool access is restored; earlier [PLAN MODE ACTIVE] notes no longer apply.'

// Last element matching the predicate (the lib target predates Array.prototype.findLast)
function findLast<T>(items: T[], match: (item: T) => boolean): T | undefined {
  for (let i = items.length - 1; i >= 0; i--) {
    if (match(items[i])) return items[i]
  }
  return undefined
}

// Index of the last plan-mode-execute entry, or -1 when the current run never started one
function findLastExecuteIndex(entries: SessionEntry[]): number {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i] as { customType?: string }
    if (entry.customType === 'plan-mode-execute') return i
  }
  return -1
}

export default function planModeExtension(nycode: ExtensionAPI): void {
  let planModeEnabled = false
  const planSection = new PlanSection()
  // Management keys of the Plan section (skip, pause, open) reach the agent and the desktop through here.
  planSection.host = {
    notify: (text, trigger) => {
      // Idle: the note rides with the user's next prompt (a resume starts the turn); running: it steers the current run.
      if (trigger || lastCtx?.isIdle() === false) nycode.sendUserMessage(text, { deliverAs: 'steer' })
      else nycode.sendMessage({ customType: 'plan-note', content: text, display: false }, { deliverAs: 'nextTurn' })
    },
    abort: () => lastCtx?.abort(),
    persist: () => persistState(),
    ask: async (title) => (await lastCtx?.ui.input(title, '')) ?? undefined,
    open: async (markdown) => {
      const file = planFile && existsSync(planFile) ? planFile : join(tmpdir(), `pi-plan-${process.pid}.md`)
      if (file !== planFile) writeFileSync(file, markdown)
      return (await openPlanFile(file)) ? undefined : `não consegui abrir: ${file}`
    },
    // `o` and the footer button: the plan in an overlay. Terminal only: print/RPC modes have nothing to show it on.
    show: (items) => {
      const ctx = lastCtx
      try {
        if (!ctx?.hasUI || typeof ctx.ui.custom !== 'function') return // RPC: custom() resolves at once, showing nothing
        let title = 'Plan'
        const file = executionMode && planFile ? planFile : undefined
        try {
          if (file) title = planTitle(readFileSync(file, 'utf8'))
        } catch {
          // no plan file yet: the default title
        }
        const open = (): void => void planSection.host?.open(planMarkdown(items)).then((msg) => msg && ctx.ui.notify(msg, 'warning'))
        void ctx.ui
          .custom<void>((tui, theme, _kb, done) => new PlanModal(items, { title, file }, hudTheme(theme as unknown as UiTheme), { done: () => done(), open, rows: () => Math.max(6, Math.floor(((tui as { terminal?: { rows?: number } }).terminal?.rows ?? 24) * 0.8)) }), {
            overlay: true,
            overlayOptions: { anchor: 'center', width: '80%', maxHeight: '80%' },
          })
          .catch(() => {})
      } catch {
        // stale session context: nothing to open
      }
    },
  }
  let executionMode = false
  let todoItems: TodoItem[] = []
  // Set by a PLAN WAITING / PLAN BLOCKED line of the last reply; cleared when the next prompt starts (D3).
  let hold: 'waiting' | 'blocked' | undefined
  // JSON of the last plan-mode entry written or restored: an identical state is not appended again (D1).
  let lastPersisted = ''
  let lastProgress = ''
  // Títulos da execução mais recente: endExecution zera todoItems, e as tags já mostradas são redesenhadas depois.
  let finishedTodos: TodoItem[] = []
  // Data/hora do envio das mensagens do assistente (mensagens em streaming não trazem timestamp na 1ª chamada: cacheia a hora real).
  const sentTimes = new Map<string, number>()
  const parseRgb = (ansi: string | undefined): [number, number, number] | undefined => {
    const m = /[34]8;2;(\d+);(\d+);(\d+)/.exec(ansi ?? '')
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : undefined
  }
  const relLum = (c: readonly number[]): number =>
    0.2126 * (c[0]! / 255) ** 2.2 + 0.7152 * (c[1]! / 255) ** 2.2 + 0.0722 * (c[2]! / 255) ** 2.2
  const tintBox = (base: readonly number[], fg: readonly number[], ratio: number): [number, number, number] => {
    const mix = base.map((b, k) => b * (1 - ratio) + fg[k]! * ratio)
    const f = (relLum(base) / Math.max(relLum(mix), 1e-6)) ** (1 / 2.2)
    return mix.map((v) => Math.max(0, Math.min(255, Math.round(v * f)))) as [number, number, number]
  }
  const pillFrom = (s: string, boxRgb: readonly number[] | undefined): string => {
    if (!boxRgb) return s
    const dark = relLum(boxRgb) < 0.25
    const c = boxRgb.map((v, i) => Math.round(v * (dark ? 0.64 : 0.92) + (dark ? [10, 11, 18][i]! * 0.36 : 0)))
    const open = `\x1b[48;2;${c.join(';')}m`
    return `${open} ${s.replace(/\x1b\[(?:0|49)?m/g, (m) => m + open)} \x1b[49m`
  }
  const fmtSent = (ms: number): string => {
    const d = new Date(ms)
    const pad2 = (n: number) => String(n).padStart(2, '0')
    return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
  }
  // Só a exibição: a sessão, o modelo e markCompletedSteps seguem com a tag [DONE:n] literal.
  nycode.registerMarkdownTransformer?.(
    (markdown, context) => {
      let paint: DonePaint = plainPaint
      try {
        const theme = lastCtx?.ui.theme as unknown as {
          fg: (c: string, s: string) => string
          bg: (c: string, s: string) => string
          bold: (s: string) => string
          getFgAnsi?: (c: string) => string
          getBgAnsi?: (c: string) => string
        } | undefined
        if (theme) {
          const baseRgb = parseRgb(theme.getBgAnsi?.('customMessageBg'))
          const waitRgb = parseRgb(theme.getFgAnsi?.('mdCode'))
          const warnRgb = parseRgb(theme.getFgAnsi?.('warning'))
          const dimRgb = parseRgb(theme.getFgAnsi?.('dim'))
          const cyanRgb = parseRgb(theme.getFgAnsi?.('syntaxType'))
          const waitBgRgb = baseRgb && waitRgb ? tintBox(baseRgb, waitRgb, 0.16) : undefined
          const warnBgRgb = baseRgb && warnRgb ? tintBox(baseRgb, warnRgb, 0.20) : undefined
          const liveComet = Boolean(context.isStreaming && dimRgb && (cyanRgb ?? waitRgb) && !process.env.NYCODE_REDUCED_MOTION && process.env.NO_COLOR === undefined)
          paint = {
            ok: (s) => theme.fg('success', s),
            muted: (s) => theme.fg('muted', s),
            dim: (s) => theme.fg('dim', s),
            text: (s) => theme.fg('text', s),
            run: (s) => theme.fg('syntaxType', s),
            wait: (s) => theme.fg('mdCode', s),
            warn: (s) => theme.fg('warning', s),
            accent: (s) => theme.fg('accent', s),
            bold: (s) => theme.bold(s),
            box: (s) => theme.bg('customMessageBg', s),
            waitBox: waitBgRgb ? (s) => `\x1b[48;2;${waitBgRgb.join(';')}m${s}\x1b[49m` : undefined,
            warnBox: warnBgRgb ? (s) => `\x1b[48;2;${warnBgRgb.join(';')}m${s}\x1b[49m` : undefined,
            pill: (s, kind) => pillFrom(s, kind === 'wait' ? (waitBgRgb ?? baseRgb) : kind === 'warn' ? (warnBgRgb ?? baseRgb) : baseRgb),
            bar: liveComet
              ? (filled, cells) => {
                  const donePart = filled > 0 ? theme.fg('success', '━'.repeat(filled)) : ''
                  const rem = Math.max(0, cells - filled)
                  if (rem === 0) return donePart
                  const target = (cyanRgb ?? waitRgb)!
                  const pos = rem === 1 ? 0 : ((Math.sin(performance.now() * 0.0048) + 1) / 2) * (rem - 1)
                  let tail = ''
                  for (let i = 0; i < rem; i++) {
                    const g = Math.exp(-((i - pos) ** 2) / 1.15)
                    const c = dimRgb!.map((v, idx) => Math.round(v + (target[idx]! - v) * g))
                    tail += `\x1b[38;2;${c.join(';')}m${g > 0.62 ? '━' : '╌'}`
                  }
                  return `${donePart}${tail}\x1b[39m`
                }
              : undefined,
          }
        }
      } catch {
        // contexto de sessão antiga: sem cor
      }
      let ts = typeof context.timestamp === 'number' ? context.timestamp : context.timestamp ? Date.parse(String(context.timestamp)) : Number.NaN
      if (!Number.isFinite(ts)) {
        const key = String(context.messageId ?? markdown.slice(0, 120))
        ts = sentTimes.get(key) ?? Number.NaN
        if (!Number.isFinite(ts) && (/PLAN/i.test(markdown) || /PLANO/i.test(markdown))) {
          if (sentTimes.size >= 200) sentTimes.clear()
          ts = Date.now()
          sentTimes.set(key, ts)
        }
      }
      const sentAt = Number.isFinite(ts) && ts > 0 ? fmtSent(ts) : ''
      const activeSteps = todoItems.length > 0 ? todoItems : finishedTodos.length > 0 ? finishedTodos : externalTodos
      return renderDoneTags(markdown, activeSteps, paint, context.isStreaming, context.availableWidth, true, sentAt)
    },
    { messageTypes: ['assistant'] },
  )
  let planFromTool = false
  let savedTools: string[] = []
  /** Every tool pi had registered when the set was saved, active or not: a tool outside it
   * was registered later, and pi activated it on top of whatever set was in force. */
  let toolsAtSave = new Set<string>()
  /** Plan file of this session, fixed when plan mode is entered. */
  let planFile = ''
  /** Lint rejections since the last accepted plan or the last entry into plan mode. */
  let lintRejections = 0

  function ensurePlanFile(ctx: ExtensionContext): void {
    if (planFile) return
    const sid = (ctx.sessionManager as { getSessionId?: () => string }).getSessionId?.()
    const id = sid ? sid.slice(0, 8) : `plan-${Date.now()}`
    planFile = join(plansDir(), `${new Date().toISOString().slice(0, 10)}-${id}.md`)
    setPlanPath(planFile)
  }

  const registeredTools = (): Set<string> => new Set((nycode.getAllTools?.() ?? []).map((tool) => tool.name))

  function enterPlanTools(): void {
    savedTools = nycode.getActiveTools()
    toolsAtSave = registeredTools()
    nycode.setActiveTools(PLAN_MODE_TOOLS.filter((t) => savedTools.includes(t)))
  }

  /** Put back the saved set, plus any tool registered since: pi activates a late one (an MCP
   * server past its connect window) on top of the restricted set, and overwriting with the
   * snapshot dropped it for the rest of the session. A tool that was registered but not
   * active at entry is not late, and stays out. */
  function restoreTools(): void {
    if (savedTools.length === 0) return
    const late = nycode.getActiveTools().filter((name) => !toolsAtSave.has(name) && !savedTools.includes(name))
    nycode.setActiveTools([...savedTools, ...late])
  }

  /** Hooks report Claude's permission_mode from this bus state. */
  function publishPlanState(): void {
    nycode.events.emit(PLAN_MODE_CHANNEL, { active: planModeEnabled })
  }

  nycode.registerFlag('plan', {
    description: 'Start in plan mode (read-only exploration)',
    type: 'boolean',
    default: false,
  })

  function updateStatus(ctx: ExtensionContext): void {
    // Footer status
    // No plan step counter in the status line while executing (user request 2026-11-13).
    if (planModeEnabled && !executionMode) {
      ctx.ui.setStatus('plan-mode', ctx.ui.theme.fg('warning', '⏸ plan'))
    } else {
      ctx.ui.setStatus('plan-mode', undefined)
    }

    // Checklist: the Plan section below the status line (title, done/total, bounded scrolling body, rule).
    lastCtx = ctx
    // The todo tool keeps its own list during execution: a `todo d/t` summary on the footer shows it (D4).
    const todo = executionMode && externalTodos.length > 0 ? { done: externalTodos.filter((t) => t.completed).length, total: externalTodos.length, doing: externalTodos.find((t) => t.doing && !t.completed)?.text } : undefined
    planSection.update(ctx, executionMode ? todoItems : externalTodos, executionMode ? 'plan' : 'todo', { hold: executionMode ? hold : undefined, todo })
    publishProgress()
  }

  // Todos from the todo tool (todo.ts) share this list when no plan is executing: always in the Plan section, never in the chat.
  let externalTodos: TodoItem[] = []
  let lastCtx: ExtensionContext | undefined
  nycode.events.on('pi-code:todos', (data) => {
    externalTodos = (data as Array<{ id: number; text: string; status: string }>).map((t) => ({ step: t.id, text: t.text, completed: t.status === 'completed', doing: t.status === 'in_progress' }))
    if (!lastCtx) return
    try {
      if (executionMode) updateStatus(lastCtx)
      else planSection.update(lastCtx, externalTodos, 'todo')
    } catch {
      lastCtx = undefined // stale session context
    }
  })

  function togglePlanMode(ctx: ExtensionContext): void {
    planModeEnabled = !planModeEnabled
    executionMode = false
    todoItems = []
    planFromTool = false
    lintRejections = 0

    if (planModeEnabled) {
      ensurePlanFile(ctx)
      enterPlanTools()
      ctx.ui.notify(`Plan mode enabled. Tools: ${nycode.getActiveTools().join(', ')}`)
    } else {
      restoreTools()
      nycode.sendMessage({ customType: 'plan-mode-ended', content: PLAN_ENDED_NOTE, display: false }, { deliverAs: 'nextTurn' })
      ctx.ui.notify('Plan mode disabled. Full access restored.')
    }
    // Persist the toggle so a resume does not restore a state the user left.
    persistState()
    publishPlanState()
    updateStatus(ctx)
  }

  function planPayload(): Record<string, unknown> {
    return {
      enabled: planModeEnabled,
      todos: todoItems,
      executing: executionMode,
      // The pre-plan tool set has to survive with the state that caused it to shrink.
      // /reload rebuilds this extension with an empty snapshot while pi carries the
      // restricted tools into the new runtime, so a restore has no way to work out
      // what was active before plan mode unless it was written down here.
      savedTools,
      // Skip marks and the user's pause survive /reload and resume (D7); the step clocks do not.
      marks: executionMode ? planSection.exportMarks() : [],
      paused: executionMode && planSection.paused,
    }
  }

  /** Appends the plan state only when it differs from the last one written or restored (D1: a turn_end used to append it unchanged). */
  function persistState(): void {
    publishProgress()
    const data = planPayload()
    const json = JSON.stringify(data)
    if (json === lastPersisted) return
    lastPersisted = json
    nycode.appendEntry('plan-mode', data)
  }

  function publishProgress(): void {
    const open = todoItems.find((t) => !t.completed)
    const progress = { executing: executionMode, ...(executionMode && open ? { step: open.step } : {}), done: todoItems.filter((t) => t.completed).length, total: todoItems.length }
    const json = JSON.stringify(progress)
    if (json === lastProgress) return
    lastProgress = json
    nycode.events.emit(PLAN_STATE_CHANNEL, progress)
  }

  function endExecution(ctx: ExtensionContext, content: string, customType = 'plan-complete'): void {
    nycode.sendMessage({ customType, content, display: true }, { triggerTurn: false })
    executionMode = false
    finishedTodos = todoItems
    todoItems = []
    restoreTools()
    updateStatus(ctx)
    persistState() // Save cleared state so resume doesn't restore old execution mode
  }

  // Announce completion and reset once every step is done
  function finalizeCompletedExecution(ctx: ExtensionContext): void {
    if (!todoItems.every((t) => t.completed)) return
    const completedList = todoItems.map((t) => `~~${t.text}~~`).join('\n')
    endExecution(ctx, `**Plan Complete!**\n\n${completedList}`)
  }

  // Leave plan mode and start a turn that executes the plan
  function startExecution(ctx: ExtensionContext): void {
    planModeEnabled = false
    executionMode = todoItems.length > 0
    planFromTool = false
    restoreTools()
    publishPlanState()
    updateStatus(ctx)

    // Persist before the turn: a crash before the first turn_end must resume into
    // execution, not back into plan mode.
    persistState()
    const execMessage = todoItems.length > 0 ? `Execute the plan. Start with: ${todoItems[0].text}\n${DONE_RULE}\n${CANCEL_RULE}\nFirst materialize the plan file ${planFile} into the repository's /docs record (or the task's existing record) before changing code.\n${PLAN_ENDED_NOTE}` : `Execute the plan you just created.\n${PLAN_ENDED_NOTE}`
    nycode.sendMessage({ customType: 'plan-mode-execute', content: execMessage, display: true }, { triggerTurn: true })
  }

  // Ask the user how to proceed after a plan is ready
  async function promptPlanNextAction(ctx: ExtensionContext): Promise<void> {
    const choice = await ctx.ui.select('Plan mode - what next?', [todoItems.length > 0 ? 'Execute the plan (track progress)' : 'Execute the plan', 'Stay in plan mode', 'Refine the plan'])

    if (choice?.startsWith('Execute')) {
      startExecution(ctx)
    } else if (choice === 'Refine the plan') {
      planFromTool = false
      const refinement = await ctx.ui.editor('Refine the plan:', '')
      if (refinement?.trim()) {
        // A bare send throws (and is silently swallowed) while the agent is
        // streaming, so mid-stream invocations queue as a follow-up turn.
        nycode.sendUserMessage(refinement.trim(), ctx.isIdle() ? {} : { deliverAs: 'followUp' })
      }
    }
  }

  // Rebuild completion state from assistant messages after the last execute marker
  function rescanCompletion(entries: SessionEntry[]): void {
    const executeIndex = findLastExecuteIndex(entries)
    const messages: AssistantMessage[] = []
    for (let i = executeIndex + 1; i < entries.length; i++) {
      const entry = entries[i]
      if (entry.type === 'message' && 'message' in entry && isAssistantMessage(entry.message as AgentMessage)) {
        messages.push(entry.message as AssistantMessage)
      }
    }
    markCompletedSteps(messages.map(getTextContent).join('\n'), todoItems)
  }

  nycode.registerCommand('plan', {
    description: 'Enter plan mode; an optional description starts that task (leave with Ctrl+Shift+P or by executing the plan)',
    handler: async (args, ctx) => /* NOSONAR typescript:S7503 - pi types a command handler as returning Promise<void> */ {
      const task = args.trim()
      if (!planModeEnabled) togglePlanMode(ctx)
      // Claude's wording with no plan yet; with one, only the first sentence applies.
      else if (!task) ctx.ui.notify(todoItems.length > 0 ? 'Already in plan mode.' : 'Already in plan mode. No plan written yet.', 'info')
      // A bare send throws (and is silently swallowed) while the agent is streaming.
      if (task) nycode.sendUserMessage(task, ctx.isIdle() ? {} : { deliverAs: 'followUp' })
    },
  })

  nycode.registerTool({
    name: 'plan_mode_complete',
    label: 'Plan complete',
    description: 'Submit the finished plan for user review while in plan mode. Pass the full plan as numbered steps (1. ... 2. ...). Call this exactly once, when the plan is ready. The first line states the tier ("Tier: Tn (signals)"); the plan is linted and saved to the plan file. Pass "@file" to submit the plan file as it is.',
    parameters: Type.Object({ plan: Type.String({ description: 'The complete numbered plan' }) }),
    async execute(_id, params, _signal, _onUpdate, ctx) /* NOSONAR typescript:S7503 - pi types a tool execute as returning a Promise */ {
      if (!planModeEnabled) {
        return { content: [{ type: 'text', text: 'Not in plan mode; tool ignored.' }], details: {} }
      }
      if (!planFile) ensurePlanFile(ctx)
      const fromFile = params.plan.trim() === '@file'
      let plan = params.plan
      if (fromFile) {
        try { plan = readFileSync(planFile, 'utf8') } catch { plan = '' }
        if (plan.trim() === '') {
          return { content: [{ type: 'text', text: 'No plan file to submit; pass the plan text.' }], details: {} }
        }
      }
      const problems = lintPlan(plan)
      const save = (): void => {
        try {
          mkdirSync(dirname(planFile), { recursive: true })
          writeFileSync(planFile, plan)
        } catch { /* a failed save must not fail the tool */ }
      }
      if (problems.length > 0 && lintRejections < 2) {
        lintRejections++
        if (!fromFile) save()
        const list = problems.map((p) => `- ${p}`).join('\n')
        return { content: [{ type: 'text', text: `Plan not accepted. It was saved to ${planFile}. Fix these there with the edit tool, then call plan_mode_complete with plan "@file" (do not resend the plan):\n${list}` }], details: {} }
      }
      if (!fromFile) save()
      lintRejections = 0
      todoItems = planToTodos(plan)
      planFromTool = true
      persistState()
      const unresolved = problems.length > 0 ? ` Unresolved lint: ${problems.join('; ')}` : ''
      return { content: [{ type: 'text', text: `Plan submitted and saved to ${planFile}. The user will now review it.${unresolved}` }], details: {}, terminate: true }
    },
  })

  nycode.registerCommand('plan-todos', {
    description: 'Show current plan todo list',
    handler: async (_args, ctx) => /* NOSONAR typescript:S7503 - pi types a command handler as returning Promise<void> */ {
      if (todoItems.length === 0) {
        ctx.ui.notify('No todos. Create a plan first with /plan', 'info')
        return
      }
      const list = todoItems.map((item, i) => `${i + 1}. ${item.text}${item.completed ? ' · concluída' : ''}`).join('\n')
      ctx.ui.notify(`Plan Progress:\n${list}`, 'info')
    },
  })

  nycode.registerShortcut(Key.ctrlShift('p'), {
    description: 'Toggle plan mode',
    handler: async (ctx) => togglePlanMode(ctx), // NOSONAR typescript:S7503 - pi catches only a rejected promise from a shortcut handler (Promise.resolve(handler()).catch)
  })

  // Enforce plan mode at call time, not only through the active-tool set: pi
  // activates tools registered after the restriction was applied (an MCP server
  // connecting during session_start, or a mid-session list_changed refresh), so the
  // set alone leaks write-capable tools into plan mode.
  nycode.on('tool_call', (event, _ctx) => {
    if (!planModeEnabled) return
    if (!PLAN_MODE_TOOLS.includes(event.toolName) && !event.toolName.startsWith('mcp__')) {
      return {
        block: true,
        reason: `Plan mode: tool blocked (read-only mode). Press Ctrl+Shift+P to leave plan mode first.\nTool: ${event.toolName}`,
      }
    }
    const verdict = isPlanModeToolAllowed(event.toolName, event.input)
    if (!verdict.ok) {
      return { block: true, reason: `Plan mode: ${event.toolName} blocked (${verdict.reason}). Plan file: ${planFile}` }
    }
    // Only the user's agent files: a project agent with an allowlisted name could carry write tools.
    if (event.toolName === 'subagent' && !event.input.status && event.input.cancel === undefined) event.input.agentScope = 'user'
    if (event.toolName !== 'bash') return

    const command = event.input.command as string
    if (!isSafeCommand(command)) {
      return {
        block: true,
        reason: `Plan mode: command blocked (not allowlisted). Press Ctrl+Shift+P to leave plan mode first.\nCommand: ${command}`,
      }
    }
  })

  // Inject plan/execution context before agent starts
  nycode.on('before_agent_start', (_event, ctx) => {
    if (hold) {
      hold = undefined
      updateStatus(ctx)
    }
    if (planModeEnabled) {
      ensurePlanFile(ctx)
      return {
        message: {
          customType: 'plan-mode-context',
          content: `[PLAN MODE ACTIVE]
Read-only planning mode. Allowed: read, bash (allowlisted), lsp_*, tool_search with read-only MCP (search, docs, codegraph), web_fetch, subagent with read-only agents only, question, todo. Use write/edit (bash cannot write) ONLY on the plan file ${planFile}, and only for draft notes in a long session.
Triage first. T0 = a mechanical edit with no behavior change (typo, rename, comment) and nothing ambiguous: skip the skill, verify with one lookup, submit 1-3 tasks. Anything else: read ${join(getAgentDir(), 'skills', 'plan-workflow', 'SKILL.md')} and follow it (tier, questions, decomposition, checklists).
Submit the full plan once with plan_mode_complete, which lints it and saves it to the plan file. Lint: first line "Tier: Tn (signals)"; task titles ≤50 chars; every task has ≥1 '-' bullet under it (shown as its description); every A# line has a %; T1+ has "AC1: WHEN … THE SYSTEM SHALL …" lines, each AC cited by a task, and a "check:" per task; T2+ a risks line; T3 a rollback line.
Only tracked tasks are numbered (1., 2., … globally); phases are headings, steps and checklists are '-' bullets, never numbered.
Never settle these yourself, ask with the question tool: a contradiction in the request; a choice of data format, public contract, security or deletion.
Make no other changes.
${CANCEL_RULE}`,
          display: false,
        },
      }
    }

    if (executionMode && todoItems.length > 0) {
      const remaining = todoItems.filter((t) => !t.completed)
      const todoList = remaining.map((t) => `${t.step}. ${t.text}`).join('\n')
      return {
        message: {
          customType: 'plan-execution-context',
          content: `[EXECUTING PLAN - Full tool access enabled]

Remaining steps:
${todoList}

Execute each step in order.
${DONE_RULE}
${CANCEL_RULE}`,
          display: false,
        },
      }
    }
  })

  // Track progress after each turn
  nycode.on('turn_end', (event, ctx) => {
    if (!executionMode || todoItems.length === 0) return
    if (!isAssistantMessage(event.message)) return

    const text = getTextContent(event.message)
    const nextHold = holdOf(text)
    const holdChanged = nextHold !== hold
    hold = nextHold
    if (markCompletedSteps(text, todoItems) > 0 || holdChanged) {
      updateStatus(ctx)
    }
    persistState()
  })

  // Only the end of the plan or an explicit PLAN CANCELLED ends it: Esc, send-now, chat or a run that
  // stops without progress leave plan mode and execution as they are (owner contract 2026-11-15).
  nycode.on('agent_end', async (event, ctx) => {
    const last = [...event.messages].reverse().find(isAssistantMessage)
    if (executionMode && todoItems.length > 0) {
      if (isCancelled(last)) {
        const remaining = todoItems.filter((t) => !t.completed).map((t) => `${t.step}. ${t.text}`).join('\n')
        endExecution(ctx, `**Plan cancelled** at the user's request. Unfinished steps:\n\n${remaining}`, 'plan-cancelled')
      } else finalizeCompletedExecution(ctx)
      return
    }

    if (!planModeEnabled) return
    if (isCancelled(last)) {
      togglePlanMode(ctx)
      return
    }
    // The menu only follows a plan accepted by plan_mode_complete in a run the user did not interrupt.
    if (!ctx.hasUI || !planFromTool || last?.stopReason === 'aborted') return
    planFromTool = false
    await promptPlanNextAction(ctx)
  })

  // Rebuilds the plan from the current branch: session start/resume (`fromFlag`: the --plan flag applies) and /tree or rewind (D6).
  function restoreFromBranch(ctx: ExtensionContext, fromFlag: boolean): void {
    // pi's CLI builds a fresh extension instance per session replacement; RPC mode can reuse
    // one across sessions, so clear prior state first there too: a fresh
    // session (/new, no plan entry) must not inherit the last session's plan or execution.
    planModeEnabled = false
    lintRejections = 0
    executionMode = false
    todoItems = []
    finishedTodos = []
    planFromTool = false
    planFile = ''

    hold = undefined
    if (fromFlag && nycode.getFlag('plan') === true) {
      planModeEnabled = true
    }

    // The current branch only: getEntries() lists every branch in the file, so after a
    // rewind past a plan it would resurrect the abandoned plan and its tool restriction.
    const entries = ctx.sessionManager.getBranch()

    // Restore persisted state. The entry is JSON on disk, so every field is checked
    // before it is used: savedTools reaches nycode.setActiveTools.
    const planModeEntry = findLast(entries, (e: { type: string; customType?: string }) => e.type === 'custom' && e.customType === 'plan-mode') as { data?: unknown } | undefined
    const restored = restoredPlanState(planModeEntry?.data)

    planModeEnabled = restored.enabled ?? planModeEnabled
    todoItems = restored.todos ?? todoItems
    // Títulos das tags [DONE:n] já mostradas: o fim do plano grava a lista vazia, então vale o último plano gravado com etapas.
    if (todoItems.length === 0) {
      const withTodos = findLast(entries, (e: { type: string; customType?: string; data?: unknown }) => e.type === 'custom' && e.customType === 'plan-mode' && (restoredPlanState(e.data).todos?.length ?? 0) > 0) as { data?: unknown } | undefined
      finishedTodos = restoredPlanState(withTodos?.data).todos ?? []
    }
    executionMode = restored.executing ?? executionMode
    const savedMarks = (planModeEntry?.data ?? {}) as { marks?: unknown; paused?: unknown }
    planSection.restore(executionMode ? savedMarks : undefined, executionMode && planModeEntry !== undefined)
    publishPlanState()

    // On resume: re-scan messages after the last "plan-mode-execute" to rebuild
    // completion state without picking up [DONE:n] from previous plans
    const isResume = planModeEntry !== undefined
    if (isResume && executionMode && todoItems.length > 0) {
      rescanCompletion(entries)
      // On hold when the branch ends on a PLAN WAITING / PLAN BLOCKED reply (D3).
      const lastMessage = findLast(entries, (e) => e.type === 'message') as { message?: AgentMessage } | undefined
      if (lastMessage?.message && isAssistantMessage(lastMessage.message)) hold = holdOf(getTextContent(lastMessage.message))
    }

    if (planModeEnabled) {
      ensurePlanFile(ctx)
      // Restoring into plan mode is the only case the recorded snapshot is for.
      // Re-reading the active set here would capture the restriction pi carried
      // across /reload and cost the session edit and write for good; applying the
      // snapshot when plan mode is off would instead push a stale set over whatever
      // pi has registered since, so it stays scoped to this branch.
      savedTools = restored.savedTools ?? nycode.getActiveTools()
      toolsAtSave = registeredTools()
      nycode.setActiveTools(PLAN_MODE_TOOLS.filter((t) => savedTools.includes(t)))
      // --plan enters plan mode without ever toggling, so nothing has persisted yet
      // and a /reload would find no snapshot to restore from. Record it now, while
      // the active set still says what was there before the restriction.
      //
      // Only with no entry at all: an entry written before this field existed means
      // the active set has already been through a restore and may be the restriction
      // itself. Those tools are lost for this process either way, but persisting a
      // guess would write the loss into the session file, where a later resume would
      // inherit it instead of starting over.
      if (!planModeEntry) persistState()
    } else {
      // A prior session in this instance may have shrunk the tool set; undo that when
      // the restored/fresh state is not plan mode.
      restoreTools()
    }
    lastPersisted = planModeEntry ? JSON.stringify(planPayload()) : ''
    updateStatus(ctx)
  }
  nycode.on('session_start', (_event, ctx) => restoreFromBranch(ctx, true))
  nycode.on('session_tree', (_event, ctx) => restoreFromBranch(ctx, false))

  // pi-harness permission-control BEGIN
  // Controle semântico para Shift+Tab e /permissions plan (claude-compat). Fonte: claude-home/patches/pi-code/permission-control.
  const PLAN_CONTROLLER_SLOT = Symbol.for('pi-code.plan-controller')
  let permissionCtx: ExtensionContext | undefined
  const planController = {
    active: (): boolean => planModeEnabled === true,
    set: (enabled: boolean): boolean => {
      if (typeof enabled !== 'boolean') return false
      if (planModeEnabled === enabled) return true
      if (!permissionCtx) return false
      try {
        togglePlanMode(permissionCtx)
      } catch {
        return false
      }
      return planModeEnabled === enabled
    },
  }
  nycode.on('session_start', (_event, ctx) => {
    permissionCtx = ctx
    ;(globalThis as Record<symbol, unknown>)[PLAN_CONTROLLER_SLOT] = planController
  })
  nycode.on('session_shutdown', () => {
    permissionCtx = undefined
    const g = globalThis as Record<symbol, unknown>
    if (g[PLAN_CONTROLLER_SLOT] === planController) delete g[PLAN_CONTROLLER_SLOT]
  })
  // pi-harness permission-control END

  nycode.on('session_shutdown', (_event, ctx) => planSection.shutdown(ctx))
}

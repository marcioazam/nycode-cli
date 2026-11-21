/**
 * Question Tool - a question with options, single- or multi-select.
 * Full custom UI: options list + inline editor for "Type something..." (single-select
 * only), or space-toggled checkboxes when `multiSelect` is set. An optional `header`
 * labels the question. Escape in the editor returns to options (the draft is kept); Escape in options dismisses.
 * Several questions per call are a batch: tabs, back/forward, a final review (internal/question-nav.ts).
 * On the TUI each question is also offered to a remote responder over pi.events
 * (REMOTE_QUESTION_CHANNEL); the first answer, local or remote, wins.
 */

import { randomUUID } from 'node:crypto'
import * as os from 'node:os'
import type { ExtensionAPI, ExtensionContext, Theme } from '@earendil-works/pi-coding-agent'
import { Editor, type EditorTheme, Key, matchesKey, Text, truncateToWidth, visibleWidth, wrapTextWithAnsi } from '@earendil-works/pi-tui'
import { Type } from 'typebox'
import { readManagedSettings } from './internal/managed-settings.ts'
import { readUserSetting } from './internal/settings-chain.ts'
import { type Answer, askReview, type Batch, batchHeader, DISMISSED_TEXT, delegatedText, type EditKind, exitLines, helpLines, isRecommended, navFooter, runBatch, selectedLabels, type SelectState, selectKey, SKIPPED_TEXT, tabsLine, type Tab } from './internal/question-nav.ts'

interface OptionWithDesc {
  label: string
  description?: string
}

type DisplayOption = OptionWithDesc & { isOther?: boolean }

interface QuestionDetails {
  question: string
  header?: string
  options: string[]
  answer: string | null
  wasCustom?: boolean
  multiSelect?: boolean
  /** Auto-continued on askUserQuestionTimeout rather than answered or cancelled. */
  timedOut?: boolean
  /** Nav patch: skipped (↷), delegated to the agent, a note on the choice, left unasked, dismissed by Esc/discard. */
  skipped?: boolean
  delegated?: boolean
  note?: string
  pending?: boolean
  dismissed?: boolean
}

// Options with labels and optional descriptions
const OptionSchema = Type.Object({
  label: Type.String({ description: 'Display label for the option' }),
  description: Type.Optional(Type.String({ description: 'Optional description shown below label' })),
})

const SingleQuestion = Type.Object({
  question: Type.String({ description: 'The question to ask the user' }),
  header: Type.Optional(Type.String({ description: 'Short label for the question, shown above it, kept to 12 characters' })),
  options: Type.Array(OptionSchema, { description: 'Options for the user to choose from (2-4)', minItems: 2, maxItems: 4 }),
  multiSelect: Type.Optional(Type.Boolean({ description: 'Allow selecting several options (space toggles, enter confirms)' })),
})

/** One question in the flat form, plus an optional batch for Claude's 1-4 questions.
 * The flat fields stay the documented path: a schema offering two equally optional
 * shapes gave smaller models nothing to follow, and they produced neither. */
export const QuestionParams = Type.Object({
  question: Type.Optional(Type.String({ description: 'The question to ask. Required, unless asking several via questions.' })),
  options: Type.Optional(Type.Array(OptionSchema, { description: 'The 2-4 choices for this question, each {label, description?}. Required with question.', minItems: 2, maxItems: 4 })),
  header: Type.Optional(Type.String({ description: 'Optional short label shown above the question, kept to 12 characters' })),
  multiSelect: Type.Optional(Type.Boolean({ description: 'Optional: allow selecting several options (space toggles, enter confirms)' })),
  questions: Type.Optional(Type.Array(SingleQuestion, { description: 'Only to ask 2-4 questions in one call: each entry takes the same fields as above. Leave unset for a single question.', minItems: 1, maxItems: 4 })),
})

export interface QuestionSpec {
  question: string
  header?: string
  options: DisplayOption[]
  multiSelect?: boolean
}

/** In-process, question-owned offer; arbitrary custom TUI components are not sent. */
export const REMOTE_QUESTION_CHANNEL = 'pi-code:question:v1'
export type RemoteQuestionOutcome = { action: 'answer'; indices: number[] } | { action: 'text'; text: string } | { action: 'cancel' } | { action: 'pass' }

export interface RemoteQuestionOffer {
  version: 1
  requestId: string
  sessionId: string
  question: string
  header?: string
  options: OptionWithDesc[]
  multiSelect: boolean
  allowFreeText: boolean
  signal: AbortSignal
  /** Must be called during event emission; only one listener receives a settle handle. */
  claim: () => ((outcome: RemoteQuestionOutcome) => boolean) | undefined
  /** The claimed responder reports input activity to reset a configured idle timer. */
  touch: () => boolean
}

/** Normalize either accepted shape into the list of questions to ask. */
function questionList(params: Partial<QuestionSpec> & { questions?: QuestionSpec[] }): QuestionSpec[] {
  if (params.questions && params.questions.length > 0) return params.questions
  if (typeof params.question === 'string') return [{ question: params.question, header: shortHeader(params.header), options: params.options ?? [], multiSelect: params.multiSelect }]
  return []
}

/** Claude keeps a header short for the label slot. Truncating is the forgiving read:
 * rejecting the call costs a turn while the model recovers from a validation error,
 * which is a poor trade for a display detail. */
const HEADER_MAX = 12
export const shortHeader = (header: string | undefined): string | undefined => (header === undefined ? undefined : header.slice(0, HEADER_MAX))

/** Claude's three accepted askUserQuestionTimeout spellings (`60s`, `5m`, `10m`), as
 * milliseconds. Anything else, including unset, means no auto-continue. */
export function parseAskUserQuestionTimeout(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined
  const match = /^(\d+)([sm])$/.exec(value.trim())
  if (!match) return undefined
  const amount = Number(match[1])
  return match[2] === 's' ? amount * 1000 : amount * 60 * 1000
}

/** Claude scopes askUserQuestionTimeout to "User or managed": a project's own
 * settings.json cannot set it, so a checked-out repository can never make the
 * user's own dialogs auto-answer themselves. Managed wins over the user's file, as
 * every managed setting does. `home` defaults to the real one and is a parameter
 * only so a test can point it at a fixture without mocking node:os. */
export function askUserQuestionTimeoutMs(home: string = os.homedir()): number | undefined {
  const managed = readManagedSettings() as { askUserQuestionTimeout?: unknown }
  const fromManaged = parseAskUserQuestionTimeout(managed.askUserQuestionTimeout)
  if (fromManaged !== undefined) return fromManaged
  return parseAskUserQuestionTimeout(readUserSetting(home, 'askUserQuestionTimeout'))
}

function checkbox(checked: boolean | undefined): string {
  if (checked === undefined) return ''
  return checked ? '[x] ' : '[ ] '
}

/** Shown in the overlay in place of the free-text option's label; the label itself
 * stays the logic value (`isOther` is what the code keys on). */
const OTHER_LABEL = 'Outra resposta…'

/** A trailing "(…)" in a label (e.g. "(Recomendado · ~80%)") is shown as a dim tag after it, not as part of the label. */
const LABEL_TAG = /^(.*\S)\s*\(([^()]*)\)\s*$/
const tagOf = (text: string): string => text.toLowerCase().replaceAll('recomendado', 'recomendada')

/** Question icon: two speech bubbles where a Nerd Font is known to render (kitty or PI_NERD_FONT=1; ASCII request wins), else `?`. */
export const questionGlyph = (env: Record<string, string | undefined> = process.env): string => {
  const ascii = Boolean(env.PI_ASCII_ICONS) || env.TERM === 'dumb' || env.TERM === 'linux'
  return !ascii && (env.PI_NERD_FONT === '1' || env.TERM === 'xterm-kitty' || Boolean(env.KITTY_WINDOW_ID)) ? '\ueac7' : '?'
}
/** Space after the glyph: kitty draws a Nerd Font icon over the following cell, so there it takes two to keep a gap. */
const glyphGap = (env: Record<string, string | undefined>): string => {
  const ascii = Boolean(env.PI_ASCII_ICONS) || env.TERM === 'dumb' || env.TERM === 'linux'
  return !ascii && (env.TERM === 'xterm-kitty' || Boolean(env.KITTY_WINDOW_ID)) ? '  ' : ' '
}

interface QuestionView {
  width: number
  question: string
  header?: string
  options: DisplayOption[]
  optionIndex: number
  editMode: boolean
  multiSelect: boolean
  checked: boolean[]
  editor: Editor
  theme: Theme
  /** Claude: "You see a countdown for the last 20 seconds." Undefined the rest of
   * the idle window, and always when there is no configured timeout at all. */
  countdownSeconds?: number
  /** Batch of questions: tabs in the header and the ←→ footer hint. */
  batch?: { tabs: Tab[]; current: number }
  /** `e` toggle: every option's description instead of the focused one's. */
  expanded?: boolean
  /** What the editor is for; free text when unset. */
  editKind?: EditKind
}

export function buildQuestionLines(view: QuestionView): string[] {
  const { width, question, header, options, optionIndex, editMode, multiSelect, checked, editor, theme, countdownSeconds, batch, expanded, editKind = 'free' } = view
  const lines: string[] = []
  const add = (s: string) => lines.push(truncateToWidth(s, width))

  // Variant B: a short numbered list (title only, owner 2026-11-15), the recommended option marked with a star at the
  // right, and a detail panel with the full description of the focused option only. The panel keeps the height of
  // the tallest description so the dialog does not jump while moving. Nothing is cut with "...".
  const wrapped = (text: string, indent: string): string[] => wrapTextWithAnsi(text, Math.max(1, width - indent.length)).map((row) => indent + row)
  const kind = theme.fg('dim', multiSelect ? 'escolha um ou mais' : 'escolha uma')
  const title = ` ${theme.fg('accent', questionGlyph())}${glyphGap(process.env)}${theme.bold('pergunta')}${header && !batch ? theme.fg('dim', ` · ${header}`) : ''}`
  add(theme.fg('accent', '─'.repeat(width)))
  if (batch) for (const row of batchHeader(title, tabsLine(batch.tabs, batch.current, theme), theme.fg('dim', `${batch.current + 1}/${batch.tabs.length} · ${multiSelect ? 'escolha um ou mais' : 'escolha uma'}`), width)) add(row)
  else add(`${title}${' '.repeat(Math.max(2, width - visibleWidth(title) - visibleWidth(kind) - 1))}${kind}`)
  for (const row of wrapped(question, ' ')) lines.push(theme.fg('text', row))
  lines.push('')

  const parts = options.map((opt) => {
    const m = opt.isOther === true ? null : LABEL_TAG.exec(opt.label)
    return { label: opt.isOther === true ? OTHER_LABEL : m ? m[1] : opt.label, tag: m ? tagOf(m[2]) : '' }
  })
  const anyDescription = options.some((o) => o.description)
  for (let i = 0; i < options.length; i++) {
    const opt = options[i]
    const focus = i === optionIndex
    const box = multiSelect && opt.isOther !== true ? checkbox(checked[i]) : ''
    const edit = opt.isOther === true && editMode && editKind === 'free' ? ' ✎' : ''
    const tag = parts[i].tag ? (parts[i].tag.startsWith('recomendada') ? theme.fg('syntaxType', `★ ${parts[i].tag}`) : theme.fg('dim', parts[i].tag)) : ''
    const label = `${box}${parts[i].label}${edit}`
    const head = ` ${focus ? theme.fg('accent', theme.bold(`❯ ${i + 1}`)) : `  ${theme.fg('dim', String(i + 1))}`}  ${focus ? theme.fg('accent', theme.bold(label)) : theme.fg('text', label)}`
    const left = head
    const row = truncateToWidth(tag ? `${left}${' '.repeat(Math.max(2, width - visibleWidth(left) - visibleWidth(tag) - 1))}${tag}` : left, width)
    // Recommended option: system-palette cyan (theme token syntaxType = vars.cyan, owner 2026-11-15) on the bluish toolPendingBg across the whole row, focused or not. A reset inside the
    // row (truncation closes colors) would drop it, so it is reopened.
    const paint = parts[i].tag.startsWith('recomendada') && typeof theme.bg === 'function' ? (x: string) => theme.bg('toolPendingBg', x) : undefined
    if (!paint) lines.push(row)
    else {
      const open = paint('\u0000').split('\u0000')[0] ?? ''
      lines.push(paint(row.replace(/\x1b\[(?:0|49)?m/g, (m) => m + open) + ' '.repeat(Math.max(0, width - visibleWidth(row)))))
    }
  }

  if (anyDescription && expanded) {
    for (let i = 0; i < options.length; i++) {
      if (!options[i].description) continue
      lines.push('')
      add(` ${theme.fg('accent', parts[i].label)}`)
      for (const row of wrapped(options[i].description as string, ' ')) lines.push(theme.fg('text', row))
    }
  } else if (anyDescription) {
    const panels = options.map((o) => (o.description ? wrapped(o.description, ' ') : []))
    const height = Math.max(...panels.map((p) => p.length))
    const name = parts[optionIndex]?.label ?? ''
    lines.push('')
    add(` ${theme.fg('dim', '─── ')}${theme.fg('accent', name)} ${theme.fg('dim', '─'.repeat(Math.max(0, width - visibleWidth(name) - 7)))}`)
    const rows = panels[optionIndex] ?? []
    for (let r = 0; r < height; r++) lines.push(r < rows.length ? theme.fg('text', rows[r]) : '')
  }

  if (editMode) {
    lines.push('')
    add(theme.fg('muted', editKind === 'free' ? ' Sua resposta:' : editKind === 'note' ? ' Nota (opcional):' : ' Motivo (opcional):'))
    for (const line of editor.render(width - 2)) {
      add(` ${line}`)
    }
  }

  lines.push('')
  add(theme.fg('dim', editMode ? ' ⏎ envia · esc volta' : navFooter({ multi: multiSelect, count: options.length, batch: batch !== undefined, rec: options.some(isRecommended), width })))
  if (countdownSeconds !== undefined) {
    add(theme.fg('warning', ` Auto-continuing in ${countdownSeconds}s if idle · press any key to stay`))
  }
  add(theme.fg('accent', '─'.repeat(width)))

  return lines
}

/** One option row: a trailing "(…)" in the label moves after it, dim, lowercase, no parentheses. */
function optionRow(label: string, mark: 'on' | 'off' | 'pending', theme: Theme): string {
  const m = LABEL_TAG.exec(label)
  const text = m ? m[1] : label
  const suffix = m ? `  ${theme.fg('dim', tagOf(m[2]))}` : ''
  if (mark === 'on') return `  ${theme.fg('success', '●')} ${theme.fg('text', text)}${suffix}`
  const tone = mark === 'pending' ? 'muted' : 'dim'
  return `  ${theme.fg(tone, '○')} ${theme.fg(tone, text)}${suffix}`
}

interface QuestionView1 {
  question: string
  header?: string
  labels: string[]
  multiSelect?: boolean
  /** Undefined while awaiting the answer; null when cancelled. */
  answer?: string | null
  wasCustom?: boolean
  timedOut?: boolean
  skipped?: boolean
  delegated?: boolean
  note?: string
  pending?: boolean
}

/** Result block of one question (variant A): state + icon + title + ANSWER on the header, the question below behind a
 * rail; the option list only when expanded. `hint` is the expand key text. */
function questionBlock(v: QuestionView1, theme: Theme, expanded: boolean, hint: string): string[] {
  // Fixed title; the model's short label (header) follows, dimmed: alone it reads as a stray word.
  const title = theme.fg('toolTitle', theme.bold('pergunta')) + (v.header ? ` ${theme.fg('dim', `· ${v.header}`)}` : '')
  const answer = v.answer ?? ''
  const cancelled = v.answer === null
  const failed = cancelled || (v.timedOut === true && answer === '')
  const shown = v.wasCustom || v.multiSelect ? answer : (LABEL_TAG.exec(answer)?.[1] ?? answer)
  const outcome = v.skipped
    ? `${theme.fg('dim', '↷ pulada')} ${theme.fg('dim', '· o agente decide')}`
    : v.delegated
      ? `${theme.fg('accent', 'decide você')}${v.note ? theme.fg('dim', ` · ${v.note}`) : ''}`
      : v.pending
        ? `${theme.fg('dim', 'não respondida')}`
        : cancelled
          ? `${theme.fg('warning', 'cancelada')} ${theme.fg('dim', '· sem resposta')}`
          : failed
            ? `${theme.fg('warning', 'tempo esgotado')} ${theme.fg('dim', '· seguiu sem resposta')}`
            : theme.fg('success', shown) + (v.note ? theme.fg('dim', ` · nota: ${v.note}`) : '')
  // Sem ícone de estado no chat (dono, 2026-11-15): a resposta já diz o estado na cor dele; os 2 espaços mantêm o ícone na coluna das tools.
  const state = v.answer === undefined ? '' : '  '
  const rail = theme.fg('dim', '│')
  const asked = v.question.split('\n').map((row) => `${rail} ${theme.fg('muted', row)}`)
  asked[asked.length - 1] += theme.fg('dim', ` · ${hint} ${expanded ? 'fecha' : 'abre'}`)
  const lines = [`${state}${theme.fg('accent', questionGlyph())}${glyphGap(process.env)}${title}  ${outcome}`, ...asked]
  if (!expanded) return lines
  for (const label of v.labels) {
    const hit = failed || v.wasCustom ? false : v.multiSelect ? `, ${answer}, `.includes(`, ${label}, `) : answer === label
    lines.push(`${rail} ${optionRow(label, hit ? 'on' : 'off', theme).trimStart()}`)
  }
  if (v.wasCustom && !failed) lines.push(`${rail} ${theme.fg('success', '●')} ${theme.fg('text', answer)}`)
  return lines
}

const blocks = (views: QuestionView1[], theme: Theme, expanded: boolean, hint: string): Text =>
  new Text(views.map((v) => questionBlock(v, theme, expanded, hint).join('\n')).join('\n\n'), 0, 0)


export default function question(pi: ExtensionAPI) {
  pi.registerTool({
    name: 'question',
    label: 'Question',
    description:
      'Ask the user a question and let them pick from options. Use when you need user input to proceed. Pass question and options, for example {"question": "Which one?", "options": [{"label": "alpha"}, {"label": "beta"}]}. To ask 2-4 questions at once, pass questions instead, with the same fields per entry.',
    parameters: QuestionParams,
    // The host shows a custom dialog in one editor slot, so two questions running in
    // parallel leave the first unanswerable and the run unable to finish.
    executionMode: 'sequential',

    async execute(_toolCallId, rawParams, signal, _onUpdate, ctx) {
      const specs = questionList(rawParams as Partial<QuestionSpec> & { questions?: QuestionSpec[] })
      if (specs.length === 0) {
        return { content: [{ type: 'text', text: 'Error: No question provided' }], details: { question: '', options: [], answer: null } as QuestionDetails }
      }
      if (specs.length === 1) {
        const { content, details } = await askOne(specs[0], ctx, pi.events, signal)
        return { content, details }
      }

      // Several questions: tabs with back/forward, a final review; every way out (skip, Esc, discard) is told to the model.
      const batch = await runBatch(specs, {
        ask: async (i, b) => {
          const r = await askOne(specs[i], ctx, pi.events, signal, b)
          return { text: r.content[0].text, raw: r.raw, details: r.details as unknown as Record<string, unknown> }
        },
        review: (rows, tabs) => askReview(ctx, rows, tabs, questionGlyph()),
        blank: (i) => ({ question: specs[i].question, options: specs[i].options.map((o) => o.label), answer: null, pending: true, ...(specs[i].header ? { header: shortHeader(specs[i].header) } : {}), ...(specs[i].multiSelect ? { multiSelect: true } : {}) }),
        aborted: () => signal?.aborted === true,
      })
      return { content: [{ type: 'text', text: batch.text }], details: { ...batch.details[0], questions: batch.details } as unknown as QuestionDetails }
    },

    // The overlay already shows the question while it waits, so the call draws nothing (drawing it too
    // duplicated the question on screen); the block enters the chat once, with the answer, from the result.
    renderCall() {
      return new Text('', 0, 0)
    },
    renderResult(result, options, theme, context) {
      const details = result.details as (QuestionDetails & { questions?: QuestionDetails[] }) | undefined
      if (!details) {
        const text = result.content[0]
        return new Text(text?.type === 'text' ? text.text : '', 0, 0)
      }
      const list = details.questions && details.questions.length > 0 ? details.questions : [details]
      return blocks(list.map((d) => ({ question: d.question, header: d.header, labels: d.options, multiSelect: d.multiSelect, answer: d.answer, wasCustom: d.wasCustom, timedOut: d.timedOut, skipped: d.skipped, delegated: d.delegated, note: d.note, pending: d.pending })), theme, options?.expanded === true, (context as { keyText?: (id: string) => string } | undefined)?.keyText?.('app.tools.expand') || 'ctrl+o')
    },
  })
}

type QuestionAnswer = Answer

/** A claimed offer raced against the open overlay: whichever answers first wins. */
interface RemoteQuestion {
  /** Routes remote answers into the overlay and remote activity into its idle timer. */
  attach: (answer: (value: QuestionAnswer) => void, touch: () => void) => void
  /** Ends the offer; the responder's settle handle and touch are rejected from then on. */
  close: () => void
}
type RemoteOffer = { kind: 'settled'; value: QuestionAnswer } | { kind: 'claimed'; remote: RemoteQuestion }

function validIndices(indices: unknown, count: number, multiSelect: boolean): indices is number[] {
  if (!Array.isArray(indices) || (!multiSelect && indices.length !== 1)) return false
  return new Set(indices).size === indices.length && indices.every((index) => Number.isInteger(index) && index >= 1 && index <= count)
}

/** A remote outcome as the answer it stands for: null is a cancel, undefined is a
 * pass or anything this question cannot accept, which must never become an answer. */
function remoteAnswer(outcome: RemoteQuestionOutcome, options: DisplayOption[], multiSelect: boolean): QuestionAnswer | undefined {
  if (outcome === null || typeof outcome !== 'object') return undefined
  if (outcome.action === 'cancel') return null
  if (outcome.action === 'text') {
    const text = typeof outcome.text === 'string' ? outcome.text.trim() : ''
    return !multiSelect && text ? { answer: text, wasCustom: true } : undefined
  }
  if (outcome.action !== 'answer') return undefined
  // Read once and copied, so a getter or Proxy cannot answer with other indices
  // than the ones that passed validation.
  const raw: unknown = outcome.indices
  const indices: unknown = Array.isArray(raw) ? [...raw] : undefined
  if (!validIndices(indices, options.length, multiSelect)) return undefined
  const checked = options.map((_, index) => indices.includes(index + 1))
  return { answer: selectedLabels(options, checked), wasCustom: false, ...(multiSelect ? {} : { index: indices[0] }) }
}

/** Undefined when nobody claims synchronously, so the overlay opens with no async gap. */
function offerRemoteQuestion(params: QuestionSpec, allOptions: DisplayOption[], ctx: ExtensionContext, events: ExtensionAPI['events'] | undefined, signal: AbortSignal | undefined): RemoteOffer | undefined {
  if (!events) return undefined
  if (signal?.aborted) return { kind: 'settled', value: null }

  const multiSelect = params.multiSelect === true
  const controller = new AbortController()
  let claimed = false
  let early: { value: QuestionAnswer } | undefined
  let deliver: ((value: QuestionAnswer) => void) | undefined
  let touchOverlay: (() => void) | undefined
  const close = (): void => {
    controller.abort()
    signal?.removeEventListener('abort', abort)
  }
  const settle = (value: QuestionAnswer): void => {
    close()
    if (deliver) deliver(value)
    else early = { value }
  }
  // Pi aborts the turn before a session replacement invalidates ctx, so this is
  // also the session-replacement path; ctx is never read after emission.
  const abort = (): void => settle(null)
  signal?.addEventListener('abort', abort, { once: true })

  const offer: RemoteQuestionOffer = {
    version: 1,
    requestId: randomUUID(),
    sessionId: ctx.sessionManager.getSessionId(),
    question: params.question,
    header: shortHeader(params.header),
    options: params.options.map(({ label, description }) => ({ label, ...(description === undefined ? {} : { description }) })),
    multiSelect,
    allowFreeText: allOptions.some((option) => option.isOther === true),
    signal: controller.signal,
    claim: () => {
      if (claimed || controller.signal.aborted) return undefined
      claimed = true
      return (outcome) => {
        if (controller.signal.aborted) return false
        const value = remoteAnswer(outcome, params.options, multiSelect)
        if (value !== undefined) {
          settle(value)
          return true
        }
        // A pass or invalid reply only withdraws the remote side; the overlay stays
        // open, and a turn abort must still cancel it.
        controller.abort()
        return outcome?.action === 'pass'
      }
    },
    touch: () => {
      if (!claimed || controller.signal.aborted) return false
      touchOverlay?.()
      return true
    },
  }

  events.emit(REMOTE_QUESTION_CHANNEL, offer)
  if (early) return { kind: 'settled', value: early.value }
  if (!claimed || controller.signal.aborted) {
    close()
    return undefined
  }
  return {
    kind: 'claimed',
    remote: {
      attach: (answer, touch) => {
        deliver = answer
        touchOverlay = touch
      },
      close,
    },
  }
}

/** ui.custom() is terminal-only: with a UI but no terminal (RPC mode) it resolves
 * undefined immediately, which would read as a cancel without ever asking. Ask
 * through the dialog primitives there instead. askUserQuestionTimeout is a TUI
 * concept (a countdown, a keypress resetting it): the dialog-primitive fallback
 * has no keyboard or visible countdown to drive it, so it is not applied there. */
async function collectAnswer(params: QuestionSpec, ctx: ExtensionContext, allOptions: DisplayOption[], multiSelect: boolean, events?: ExtensionAPI['events'], signal?: AbortSignal, batch?: Batch): Promise<QuestionAnswer> {
  if (ctx.mode !== 'tui') return askViaDialogs(params, ctx, allOptions, multiSelect)
  const offer = offerRemoteQuestion(params, allOptions, ctx, events, signal)
  if (offer?.kind === 'settled') return offer.value
  const remote = offer?.remote
  try {
    return await askViaOverlay(params, ctx, allOptions, multiSelect, askUserQuestionTimeoutMs(), remote, batch)
  } finally {
    remote?.close()
  }
}

type Asked = { content: Array<{ type: 'text'; text: string }>; details: QuestionDetails; raw: QuestionAnswer }

async function askOne(params: QuestionSpec, ctx: ExtensionContext, events?: ExtensionAPI['events'], signal?: AbortSignal, batch?: Batch): Promise<Asked> {
  if (!ctx.hasUI) {
    return {
      content: [{ type: 'text', text: 'Error: UI not available (running in non-interactive mode)' }],
      details: {
        question: params.question,
        options: params.options.map((o) => o.label),
        answer: null,
      } as QuestionDetails,
      raw: null,
    }
  }

  if (params.options.length === 0) {
    return {
      content: [{ type: 'text', text: 'Error: No options provided' }],
      details: { question: params.question, options: [], answer: null } as QuestionDetails,
      raw: null,
    }
  }

  const multiSelect = params.multiSelect === true
  // The free-text option does not compose with checkbox selection, so it is single-select only.
  const allOptions: DisplayOption[] = multiSelect ? [...params.options] : [...params.options, { label: 'Type something.', isOther: true }]

  const result = await collectAnswer(params, ctx, allOptions, multiSelect, events, signal, batch)

  // Build simple options list for details; header/multiSelect appear only when set,
  // so single-select details are unchanged.
  const simpleOptions = params.options.map((o) => o.label)
  const base = { question: params.question, options: simpleOptions, ...(params.header ? { header: shortHeader(params.header) } : {}), ...(multiSelect ? { multiSelect: true } : {}) }
  const out = (text: string, details: Partial<QuestionDetails>): Asked => ({ content: [{ type: 'text', text }], details: { ...base, ...details } as QuestionDetails, raw: result })

  // Esc, a remote cancel or an abort: told to the model, which decides whether to ask again.
  if (!result) return out(DISMISSED_TEXT, { answer: null })
  // Batch navigation and the exit menu are consumed by runBatch, never shown to the model.
  if (result.nav || result.exit) return out('', { answer: null })
  if (result.skipped) return out(SKIPPED_TEXT, { answer: '', skipped: true })
  if (result.delegated) return out(delegatedText(result.note), { answer: '', delegated: true, ...(result.note ? { note: result.note } : {}) })

  if (result.timedOut) {
    // Claude: "tells Claude you may be away from your keyboard, so Claude proceeds
    // on its own judgment and can re-ask later." Not framed as a cancel: `answer` is
    // '' rather than null, so renderResult and a batch's own null-check both read it
    // as "answered nothing, but not declined" rather than the user having said no.
    const already = multiSelect && result.answer ? ` Already selected: ${result.answer}.` : ''
    return out(`No response after the configured idle timeout; the user may be away from the keyboard.${already} Proceed on your own judgment; you can ask again later if needed.`, { answer: result.answer, timedOut: true })
  }

  if (result.wasCustom) return out(`User wrote: ${result.answer}`, { answer: result.answer, wasCustom: true })
  const note = result.note ? { note: result.note } : {}
  const noteText = result.note ? ` — note: ${result.note}` : ''
  const selectionText = multiSelect ? `User selected: ${result.answer || '(none)'}` : `User selected: ${result.index}. ${result.answer}`
  return out(selectionText + noteText, { answer: result.answer, wasCustom: false, ...note })
}

/** Claude: "You see a countdown for the last 20 seconds." */
const COUNTDOWN_WINDOW_MS = 20_000
/** Granularity of the idle-timer tick: fine enough that the countdown's displayed
 * second changes on time, coarse enough not to re-render needlessly often. */
const IDLE_TICK_MS = 250

/** Terminal path: the full custom overlay (options list, checkboxes, inline editor).
 *
 * `timeoutMs`, when set, is Claude's askUserQuestionTimeout: "After a question sits
 * that long with no input, the dialog closes on its own: it submits any options
 * you'd already selected and tells Claude you may be away from your keyboard, so
 * Claude proceeds on its own judgment and can re-ask later. You see a countdown for
 * the last 20 seconds. Press any key to restart the timer." Terminal focus-in
 * restarting the timer, the other documented reset trigger, is not implemented:
 * pi's TUI input stream is not confirmed to carry the terminal's own focus-report
 * escape sequences, and guessing at that risks misreading ordinary input as a
 * focus event on a terminal that reports it differently. Exported so the timer
 * mechanics are testable directly, independent of where timeoutMs itself is read
 * from (askUserQuestionTimeoutMs, tested separately).
 */
export function askViaOverlay(params: QuestionSpec, ctx: ExtensionContext, allOptions: DisplayOption[], multiSelect: boolean, timeoutMs?: number, remote?: RemoteQuestion, batch?: Batch): Promise<Answer> {
  return ctx.ui.custom<Answer>((tui: Parameters<Parameters<ExtensionContext['ui']['custom']>[0]>[0], theme: Theme, _kb: unknown, done: (value: Answer) => void) => {
    const st: SelectState = { index: 0, checked: allOptions.map(() => false), expanded: false, mode: 'select', exit: 0 }
    let draftKind: EditKind | undefined
    let cachedLines: string[] | undefined
    let cachedWidth: number | undefined

    // deadline stays undefined for the whole overlay life when no timeout is
    // configured, so every idle-timer branch below is a no-op in that case.
    let deadline: number | undefined = timeoutMs !== undefined ? Date.now() + timeoutMs : undefined
    let idleTimer: ReturnType<typeof setInterval> | undefined
    let lastCountdown: number | undefined

    function stopIdleTimer(): void {
      if (idleTimer !== undefined) clearInterval(idleTimer)
      idleTimer = undefined
    }

    /** Every exit path (an answer, a cancel, or the timeout itself) goes through
     * here, so the interval can never outlive the overlay it belongs to. */
    function finish(value: Answer): void {
      stopIdleTimer()
      // Closed before done, so a remote reply racing a local answer is rejected.
      remote?.close()
      done(value)
    }

    function resetIdleTimer(): void {
      if (timeoutMs === undefined) return
      deadline = Date.now() + timeoutMs
    }

    remote?.attach(finish, resetIdleTimer)

    function fireTimeout(): void {
      // Claude: "submits any options you'd already selected". Single-select has
      // nothing pre-committed (a selection only exists once Enter confirms it), so
      // its timeout answer is empty rather than whatever option merely had focus.
      const answer = multiSelect ? selectedLabels(allOptions, st.checked) : ''
      finish({ answer, wasCustom: false, timedOut: true })
    }

    function idleTick(): void {
      if (deadline === undefined) return
      const remainingMs = deadline - Date.now()
      if (remainingMs <= 0) {
        fireTimeout()
        return
      }
      const remainingSeconds = Math.ceil(remainingMs / 1000)
      const nextCountdown = remainingMs <= COUNTDOWN_WINDOW_MS ? remainingSeconds : undefined
      if (nextCountdown !== lastCountdown) {
        lastCountdown = nextCountdown
        refresh()
      }
    }

    if (timeoutMs !== undefined) {
      idleTimer = setInterval(idleTick, IDLE_TICK_MS)
    }

    const editorTheme: EditorTheme = {
      borderColor: (s) => theme.fg('accent', s),
      selectList: {
        selectedPrefix: (t) => theme.fg('accent', t),
        selectedText: (t) => theme.fg('accent', t),
        description: (t) => theme.fg('muted', t),
        scrollInfo: (t) => theme.fg('dim', t),
        noMatch: (t) => theme.fg('warning', t),
      },
    }
    const editor = new Editor(tui, editorTheme)

    // Revisiting an answered question restores the focus, the checks or the typed text.
    const init = batch?.initial
    if (init && !init.skipped && !init.delegated) {
      if (init.wasCustom) {
        st.index = Math.max(0, allOptions.findIndex((o) => o.isOther))
        editor.setText(init.answer)
        draftKind = 'free'
      } else if (multiSelect) {
        const picked = init.answer ? init.answer.split(', ') : []
        st.checked = allOptions.map((o) => picked.includes(o.label))
      } else if (init.index) st.index = init.index - 1
    }

    editor.onSubmit = (value) => {
      const text = value.trim()
      const note = text ? { note: text } : {}
      if (st.edit === 'delegate') finish({ answer: '', wasCustom: false, delegated: true, ...note })
      else if (st.edit === 'note') finish(multiSelect ? { answer: selectedLabels(allOptions, st.checked), wasCustom: false, ...note } : { answer: allOptions[st.index].label, wasCustom: false, index: st.index + 1, ...note })
      else if (text) finish({ answer: text, wasCustom: true })
      else {
        st.edit = undefined
        editor.setText('')
        refresh()
      }
    }

    function refresh() {
      cachedLines = undefined
      tui.requestRender()
    }

    /** Esc leaves the editor for the list and keeps the draft; it is cleared only when the editor opens for another purpose. */
    function handleEditInput(data: string): void {
      if (matchesKey(data, Key.escape)) st.edit = undefined
      else editor.handleInput(data)
      refresh()
    }

    function handleInput(data: string) {
      // Claude: "Press any key to restart the timer." Every branch below returns
      // through this function, so resetting unconditionally on entry covers all of
      // them, including the ones (arrow keys, space) that never reach `finish`.
      resetIdleTimer()

      if (st.edit) return handleEditInput(data)
      const effect = selectKey(data, st, allOptions, multiSelect, batch)
      if (effect === undefined) return
      if (effect === 'redraw') return refresh()
      if ('done' in effect) return finish(effect.done)
      if (draftKind !== effect.edit) editor.setText('')
      draftKind = effect.edit
      st.edit = effect.edit
      refresh()
    }

    function render(width: number): string[] {
      if (cachedLines && cachedWidth === width) return cachedLines
      cachedWidth = width
      cachedLines =
        st.mode === 'help'
          ? helpLines(width, theme)
          : st.mode === 'exit'
            ? exitLines(width, theme, batch?.answered ?? 0, batch?.tabs.length ?? 0, st.exit)
            : buildQuestionLines({ width, question: params.question, header: shortHeader(params.header), options: allOptions, optionIndex: st.index, editMode: st.edit !== undefined, multiSelect, checked: st.checked, editor, theme, countdownSeconds: lastCountdown, batch, expanded: st.expanded, editKind: st.edit })
      return cachedLines
    }

    return {
      render,
      invalidate: () => {
        cachedWidth = undefined
        cachedLines = undefined
      },
      handleInput,
      // Belt and suspenders alongside finish()'s own stopIdleTimer: if the host ever
      // tears the overlay down through a path that does not go through `done`
      // (finish's only caller), the interval still gets cleared here.
      dispose: stopIdleTimer,
    }
  })
}

/** Dialog-primitive fallback for UI without a terminal (RPC mode supports
 * select/input/notify but not custom components). Mirrors the overlay's result
 * shape; a dismissed dialog reads as a cancel, same as Escape in the overlay. */
async function askViaDialogs(params: QuestionSpec, ctx: ExtensionContext, allOptions: DisplayOption[], multiSelect: boolean): Promise<{ answer: string; wasCustom: boolean; index?: number; timedOut?: boolean } | null> {
  const header = shortHeader(params.header)
  const title = header ? `[${header}] ${params.question}` : params.question
  // Number the labels: ctx.ui.select returns the chosen label string, so duplicate
  // labels (or a model-supplied option named like the free-text entry) would be
  // ambiguous by text alone; the number is the unambiguous way back to the option.
  const labels = allOptions.map((option, i) => `${i + 1}. ${option.label}`)
  const choice = await ctx.ui.select(title, labels)
  if (choice === undefined) return null
  const index = labels.indexOf(choice)
  const chosen = allOptions[index]
  if (!multiSelect && chosen?.isOther === true) {
    const typed = await ctx.ui.input(params.question, 'Your answer')
    // A dismissed dialog cancels; a submitted empty answer is an (empty) answer, not a
    // cancel, so one accidental blank Enter does not abort the rest of a question batch.
    if (typed === undefined) return null
    return { answer: typed.trim(), wasCustom: true }
  }
  const answer = chosen?.label ?? choice
  return multiSelect ? { answer, wasCustom: false } : { answer, wasCustom: false, index: index + 1 }
}

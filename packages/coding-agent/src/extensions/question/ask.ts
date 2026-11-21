/** Asking one question: the answer sources (overlay, remote responder, dialogs) and the text the model gets back. */

import * as os from 'node:os'
import type { ExtensionAPI, ExtensionContext } from '../../core/extensions/types.ts'
import { readManagedSettings } from '../_shared/settings/managed-settings.ts'
import { readUserSetting } from '../_shared/settings/settings-chain.ts'
import { type Batch, DISMISSED_TEXT, delegatedText, SKIPPED_TEXT } from '../_shared/ui/question-nav.ts'
import { askViaDialogs, askViaOverlay } from './overlay.ts'
import { offerRemoteQuestion } from './remote.ts'
import { type DisplayOption, type QuestionAnswer, type QuestionDetails, type QuestionSpec, shortHeader } from './types.ts'

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

export type Asked = { content: Array<{ type: 'text'; text: string }>; details: QuestionDetails; raw: QuestionAnswer }

export async function askOne(params: QuestionSpec, ctx: ExtensionContext, events?: ExtensionAPI['events'], signal?: AbortSignal, batch?: Batch): Promise<Asked> {
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

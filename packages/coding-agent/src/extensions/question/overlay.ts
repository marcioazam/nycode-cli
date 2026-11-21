/** Interactive paths of the question tool: the terminal overlay (with the idle timeout) and the dialog fallback. */

import { Editor, type EditorTheme, Key, matchesKey } from '@nycode/tui'
import type { ExtensionContext } from '../../core/extensions/types.ts'
import type { Theme } from '../../modes/interactive/theme/theme.ts'
import { type Answer, type Batch, type EditKind, exitLines, helpLines, type SelectState, selectedLabels, selectKey } from '../_shared/ui/question-nav.ts'
import type { DisplayOption, QuestionSpec, RemoteQuestion } from './types.ts'
import { shortHeader } from './types.ts'
import { buildQuestionLines } from './view.ts'

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
 * nycode's TUI input stream is not confirmed to carry the terminal's own focus-report
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
export async function askViaDialogs(params: QuestionSpec, ctx: ExtensionContext, allOptions: DisplayOption[], multiSelect: boolean): Promise<{ answer: string; wasCustom: boolean; index?: number; timedOut?: boolean } | null> {
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

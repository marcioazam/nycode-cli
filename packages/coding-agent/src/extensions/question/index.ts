/**
 * Question Tool - a question with options, single- or multi-select.
 * Full custom UI: options list + inline editor for "Type something..." (single-select
 * only), or space-toggled checkboxes when `multiSelect` is set. An optional `header`
 * labels the question. Escape in the editor returns to options (the draft is kept); Escape in options dismisses.
 * Several questions per call are a batch: tabs, back/forward, a final review (_shared/ui/question-nav.ts).
 * On the TUI each question is also offered to a remote responder over nycode.events
 * (REMOTE_QUESTION_CHANNEL); the first answer, local or remote, wins.
 */

import { Text } from '@nycode/tui'
import type { ExtensionAPI } from '../../core/extensions/types.ts'
import { askReview, runBatch } from '../_shared/ui/question-nav.ts'
import { askOne, type Asked } from './ask.ts'
import { type QuestionDetails, type QuestionSpec, QuestionParams, questionList, shortHeader } from './types.ts'
import { blocks, questionGlyph } from './view.ts'

export default function questionExtension(nycode: ExtensionAPI) {
  nycode.registerTool({
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
        const { content, details } = await askOne(specs[0], ctx, nycode.events, signal)
        return { content, details }
      }

      // Several questions: tabs with back/forward, a final review; every way out (skip, Esc, discard) is told to the model.
      const batch = await runBatch(specs, {
        ask: async (i, b) => {
          const r = await askOne(specs[i], ctx, nycode.events, signal, b)
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

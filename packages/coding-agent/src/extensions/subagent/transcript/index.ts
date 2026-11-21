/**
 * Entry points of the subagent transcript rendering, called from the tool definition in ../index.ts:
 * the call box (no state) and the result (state, placeholders while the run starts, partial updates).
 */

import { getMarkdownTheme, type Theme } from '../../../modes/interactive/theme/theme.ts'
import { Text } from '@nycode/tui'

import { noColor } from '../fleet-ui/style/palette.ts'
import { getFinalOutput } from '../render/render.ts'
import type { SingleResult, SubagentDetails } from '../core/types.ts'
import { type CallArgs, type CallItem, renderSubagentCall } from './call.ts'
import { taskTitle, TITLE_MAX } from './format.ts'
import { type Entry, renderSingle, renderTree, stateOf } from './result.ts'

export { renderSubagentCall }

interface ResultLike {
  content: Array<{ type: string; text?: string }>
  details?: unknown
}

/** A child that has not reported yet, drawn from the call args so the block is never empty. */
function placeholder(item: CallItem, step?: number): SingleResult {
  return { agent: item.agent, agentSource: 'unknown', task: item.task, exitCode: -1, messages: [], stderr: '', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 }, ...(step === undefined ? {} : { step }) }
}

/**
 * The results to draw. A partial update is live: single and the last chain step are still running
 * whatever exitCode says; a parallel child is running until it has output. Mid-run, children that have
 * not reported yet come from the call args (chain steps use the template task, not the substituted text).
 */
function entriesOf(details: SubagentDetails, args: CallArgs, isPartial: boolean): Entry[] {
  const { mode, results } = details
  const templates = mode === 'chain' ? args.chain : mode === 'parallel' ? args.tasks : undefined
  const live = (r: SingleResult, i: number): boolean => isPartial && (mode === 'single' || (mode === 'chain' ? i === results.length - 1 : !getFinalOutput(r.messages)))
  const entries: Entry[] = results.map((r, i) => ({
    r,
    state: stateOf(r, live(r, i)),
    title: taskTitle(mode === 'chain' ? (templates?.[(r.step ?? i + 1) - 1]?.task ?? r.task) : r.task, r.agent, TITLE_MAX),
    step: r.step,
  }))
  if (!isPartial) return entries
  const pending = mode === 'single' ? (results.length === 0 && args.agent ? [{ agent: args.agent, task: args.task ?? '' }] : []) : (templates ?? []).slice(results.length)
  pending.forEach((item, i) => {
    const step = mode === 'chain' ? results.length + i + 1 : undefined
    entries.push({ r: placeholder(item, step), state: 'running', title: taskTitle(item.task, item.agent, TITLE_MAX), step })
  })
  return entries
}

/** NO_COLOR: every markdown style is the identity and code is not highlighted, so no escape reaches the output. */
const plainMarkdown = (md: ReturnType<typeof getMarkdownTheme>): ReturnType<typeof getMarkdownTheme> => {
  const id = (t: string): string => t
  return { heading: id, link: id, linkUrl: id, code: id, codeBlock: id, codeBlockBorder: id, quote: id, quoteBorder: id, hr: id, listBullet: id, bold: id, italic: id, strikethrough: id, underline: id, codeBlockIndent: md.codeBlockIndent }
}

export function renderSubagentResult(result: ResultLike, options: { expanded: boolean; isPartial: boolean }, theme: Theme, args: CallArgs | undefined, mdTheme = getMarkdownTheme()) {
  const text = result.content[0]
  const fallback = new Text(text?.type === 'text' ? (text.text ?? '(no output)') : '(no output)', 0, 0)
  const details = result.details as SubagentDetails | undefined
  if (!details) return fallback
  const entries = entriesOf(details, args ?? {}, options.isPartial)
  if (noColor()) mdTheme = plainMarkdown(mdTheme)
  if (details.mode === 'single' && entries.length === 1) return renderSingle(entries[0], options.expanded, theme, mdTheme)
  if ((details.mode === 'chain' || details.mode === 'parallel') && entries.length > 0) return renderTree(details.mode, entries, options.expanded, theme, mdTheme)
  return fallback
}

/**
 * The call box of a subagent tool call. It is drawn once, before anything runs, so it cannot know
 * the state and carries no state glyph: the result below it shows ●, ✓, ✗ or ◐.
 */

import type { Theme } from '@earendil-works/pi-coding-agent'
import { Text } from '@earendil-works/pi-tui'

import type { AgentScope } from '../agents.ts'
import { TITLE_MAX, taskTitle } from './format.ts'
import { plural, type T, themed } from './layout.ts'

export interface CallItem {
  agent: string
  task: string
}

export interface CallArgs {
  agent?: string
  task?: string
  tasks?: CallItem[]
  chain?: CallItem[]
  agentScope?: AgentScope
}

const scopeTag = (scope: AgentScope | undefined, t: T): string => (scope ? t.fg('muted', ` [${scope}]`) : '')

const header = (mode: string, count: string, scope: AgentScope | undefined, t: T): Text =>
  new Text(`${t.fg('toolTitle', t.bold(mode))}${t.fg('dim', ` · ${count}`)}${scopeTag(scope, t)}`, 0, 0)

export function renderSubagentCall(args: CallArgs, theme: Theme): Text {
  const t = themed(theme)
  const scope = args.agentScope
  if (args.chain && args.chain.length > 0) return header('chain', plural(args.chain.length, 'step'), scope, t)
  if (args.tasks && args.tasks.length > 0) return header('parallel', plural(args.tasks.length, 'agent'), scope, t)
  const title = args.task ? taskTitle(args.task, '', TITLE_MAX) : ''
  return new Text(`${t.fg('toolTitle', t.bold(args.agent || '…'))}${title ? `  ${title}` : ''}${scopeTag(scope, t)}`, 0, 0)
}

/**
 * The subagent tool schema and the result types derived from it. Kept apart from the
 * dispatch so the mode runners can name their own parameters without importing the
 * extension entry point back.
 */

import type { AgentToolResult } from '@nycode/agent-core'
import { type Static, Type } from 'typebox'

import { stringEnum } from '../../_shared/model/string-enum.ts'
import { sendEnabled } from '../fleet/source.ts'
import type { SpawnRequest } from '../routing/apply.ts'
import type { SingleResult, SubagentDetails } from './types.ts'

export const TaskItem = Type.Object({
  agent: Type.String({ description: 'Name of the agent to invoke' }),
  task: Type.String({ description: 'Task to delegate to the agent' }),
  cwd: Type.Optional(Type.String({ description: 'Working directory for the agent process' })),
})

export const ChainItem = Type.Object({
  agent: Type.String({ description: 'Name of the agent to invoke' }),
  task: Type.String({ description: 'Task with optional {previous} placeholder for prior output' }),
  cwd: Type.Optional(Type.String({ description: 'Working directory for the agent process' })),
})

const AgentScopeSchema = stringEnum(['user', 'project', 'both'] as const, {
  description: 'Which agent directories to use. Omitted, an approved project resolves to "both" and an unapproved one to "user"; "both" includes project-local agents.',
})

export const SubagentParams = Type.Object({
  agent: Type.Optional(Type.String({ description: 'Name of the agent to invoke (for single mode)' })),
  task: Type.Optional(Type.String({ description: 'Task to delegate (for single mode)' })),
  tasks: Type.Optional(Type.Array(TaskItem, { description: 'Array of {agent, task} for parallel execution' })),
  chain: Type.Optional(Type.Array(ChainItem, { description: 'Array of {agent, task} for sequential execution' })),
  agentScope: Type.Optional(AgentScopeSchema),
  confirmProjectAgents: Type.Optional(Type.Boolean({ description: 'Prompt before running project-local agents. Default: true.', default: true })),
  cwd: Type.Optional(Type.String({ description: 'Working directory for the agent process (single mode)' })),
  background: Type.Optional(Type.Boolean({ description: 'Run in the background: returns at once and the result arrives as a message when it finishes (single mode: a run id). In the interactive root session this is the default for single, parallel and chain, so the user keeps using the main prompt; pass false to wait for the result in the foreground (Ctrl+B still detaches). Nested and non-interactive sessions default to foreground; batches there refuse true.' })),
  status: Type.Optional(Type.Boolean({ description: 'Set true (alone, no other params) to list background runs instead of running anything.' })),
  cancel: Type.Optional(Type.String({ description: 'Background run id to cancel (from the id returned when it started, or from status).' })),
  resume: Type.Optional(Type.String({ description: 'Finished background run id to continue with a follow-up task; the child keeps everything it already saw. Pass task with it.' })),
  send: Type.Optional(Type.String({ description: 'Live background run id to redirect: the message goes in task. It reaches the run at its next turn boundary, labelled as yours (not the user). Background runs only.' })),
})

/** Per-spawn routing fields (docs/subagent-routing-2026-11-13.md): in the schema only while a routing policy is saved. */
const routingProps = () => ({
  model: Type.Optional(Type.String({ description: 'Model key (provider/id) from the allowed list; optional, the router picks when omitted.' })),
  effort: Type.Optional(Type.String({ description: 'Thinking effort allowed for that model; optional.' })),
  tools: Type.Optional(Type.Array(Type.String(), { description: "Narrow the agent's own tools to this subset; optional." })),
  skills: Type.Optional(Type.Array(Type.String(), { description: "Narrow the agent's own preloaded skills to this subset; optional." })),
})

const withRouting = (base: typeof SubagentParams): typeof SubagentParams =>
  Type.Object({
    ...base.properties,
    tasks: Type.Optional(Type.Array(Type.Object({ ...TaskItem.properties, ...routingProps() }), { description: 'Array of {agent, task} for parallel execution' })),
    chain: Type.Optional(Type.Array(Type.Object({ ...ChainItem.properties, ...routingProps() }), { description: 'Array of {agent, task} for sequential execution' })),
    ...routingProps(),
  }) as typeof SubagentParams

/** The schema the tool registers: `send` is part of it only while NYCODE_SUBAGENT_SEND is on; the routing fields only with a routing policy. */
export const subagentParams = (routing = false): typeof SubagentParams => {
  const base = sendEnabled() ? SubagentParams : (Type.Omit(SubagentParams, ['send']) as typeof SubagentParams)
  return routing ? withRouting(base) : base
}

/**
 * nycode only sets a tool result's error flag when execute() throws; a returned isError is
 * ignored (docs/extensions.md, "Signaling errors"). Throwing here would be worse: the
 * agent loop replaces the result with createErrorToolResult(message), discarding the
 * details renderResult needs to show the failed agent's transcript. The failure is
 * carried in the content text instead, which is what reaches the model.
 */
export type ToolResult = AgentToolResult<SubagentDetails>
export type SubagentMode = 'single' | 'parallel' | 'chain'
export type MakeDetails = (mode: SubagentMode) => (results: SingleResult[]) => SubagentDetails
export type SubagentParamsStatic = Static<typeof SubagentParams> & SpawnRequest
export type ChainStepParam = Static<typeof ChainItem> & SpawnRequest
export type TaskItemParam = Static<typeof TaskItem> & SpawnRequest

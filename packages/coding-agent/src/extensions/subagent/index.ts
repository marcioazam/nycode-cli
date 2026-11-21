/**
 * Subagent tool: delegate a task to a named agent running in its own `nycode` process,
 * so it gets an isolated context window.
 *
 * This file is the entry point only: the tool schema, the dispatch between single,
 * parallel, chain and background, and the session hooks. The work lives beside it,
 * one concern per module:
 *   agents.ts        discovery and frontmatter
 *   child.ts         how a child is configured before it is spawned
 *   run.ts           spawning one child and parsing its JSON event stream
 *   modes.ts         the four ways a request runs, and the project-agent gate
 *   background.ts    detached runs, /tasks state, resume and cancel
 *   params.ts        the tool schema and the types derived from it
 *   registry-text.ts the text /tasks, /agents and completion notices read out
 *   render.ts        transcript formatting shared with the parent
 *   transcript/      how a call and its results are drawn (call box, state, tree)
 *
 * Names the tests reach for are re-exported below, so the public surface is this file
 * regardless of which module owns them.
 */
import * as os from 'node:os'
import type { AgentToolResult } from '@nycode/agent-core'
import { CONFIG_DIR_NAME } from '../../config.ts'
import type { ExtensionAPI } from '../../core/extensions/types.ts'
import { setAgentRunner } from '../_shared/seams/agent-run.ts'
import { setBackgroundAgentCounter } from '../_shared/seams/background-agents.ts'
import { isMcpToolAliases, MCP_TOOLS_CHANNEL } from '../_shared/events/mcp-alias.ts'
import { isProjectApprovedSilently } from '../_shared/project/project-approval.ts'
import { addPromptSection } from '../_shared/commands/prompt-options.ts'
import { sessionHasTurns, sessionMailbox } from '../_shared/events/session-mailbox.ts'
import { errorMessage } from '../_shared/util/values.ts'
import { PLAN_STATE_CHANNEL, SUBAGENT_CHANNEL } from '../_shared/events/subagent-events.ts'
import { skillDirs } from '../skills-compat/index.ts'
import { type AgentConfig, type AgentScope, discoverAgents } from './registry/agents.ts'
import { activeBackgroundRuns, allBackgroundRuns, MAX_BACKGROUND_RUNS, cancelAllBackgroundRuns, resumeBackgroundRun } from './fleet/background.ts'
import { buildHookAgent, forkAgent, setKnownMcpAliases } from './core/child.ts'
import { raceDetach, reserveAutoBatchSlot } from './fleet/detach.ts'
import { startInboxWatcher, stopInboxWatcher } from './fleet/inbox.ts'
import { laneCorrelation, laneOutcome, setPlanStep, toolCallScope } from './fleet/tracker.ts'
import { fleetSourceForUi, getFleetSource, runningLaneCount, sendEnabled, sendFromLead, stopOwnForegroundRuns } from './fleet/source.ts'
import { registerFleetUi } from './fleet-ui/index.ts'
import { registerTeam } from './team/index.ts'
import { setRoutingSession } from './routing/apply.ts'
import { filterAllowed } from './routing/capabilities.ts'
import { registerRoutingCommand } from './routing/command.ts'
import { loadPolicy } from './routing/policy.ts'
import { routingDescription } from './routing/text.ts'
import { teamEnabled, withTeamTool } from './team/types.ts'
import { ensureFleetDir, removeFleetDir, sweepOrphanFleetDirs } from './fleet/store.ts'
import { canSpawnSubagents, claimSpawns, maxSubagentDepth, subagentDepth } from './nesting/index.ts'
import { checkProjectAgentGate, type ModeContext, runBackgroundMode, runChainMode, runParallelMode, runSingleMode, wantsBackground } from './core/modes.ts'
import { type MakeDetails, type SubagentMode, type SubagentParamsStatic, subagentParams, type ToolResult } from './core/params.ts'
import { agentsListText, backgroundCompletionText, cancelResultText, resumeResultText, sendResultText, statusWithFleet, tasksStatusText } from './registry/registry-text.ts'
import { getFinalOutput } from './render/render.ts'
import { runSingleAgent } from './core/run.ts'
import { renderSubagentCall, renderSubagentResult } from './transcript/index.ts'
import type { SingleResult, SubagentDetails } from './core/types.ts'

export { AGENT_HOOK_SYSTEM, agentMemoryDir, agentMemorySection, buildHookAgent, setKnownMcpAliases, withMemoryTools } from './core/child.ts'
export { mapWithConcurrencyLimit } from './core/concurrency.ts'
export { projectAgentGate } from './core/modes.ts'
export { agentsListText, backgroundCompletionText, cancelResultText, resumeResultText, tasksStatusText } from './registry/registry-text.ts'
// Re-exported so the render formatters stay importable from the subagent entry point,
// where the tests and the tool itself have always reached for them.
export { formatTokens, formatToolCall, formatUsageStats, getDisplayItems, getFinalOutput } from './render/render.ts'
export { getPiInvocation } from './core/run.ts'

const DETACHED_TEXT = 'The user moved this subagent call to the background (Ctrl+B). It keeps running; its result arrives as a message when it finishes. Do not wait or poll for it: continue with other work or end your turn.'

const AUTO_DETACHED_TEXT = 'This subagent call runs in the background so the user can keep using the main prompt. Its result arrives as a message when it finishes. Do not wait or poll for it: continue with other work or end your turn. Pass background: false to wait in the foreground.'

const FLEET_SWEPT = Symbol.for('pi-code.fleet.swept')

type CompletionSink = Parameters<typeof resumeResultText>[2]

/** The answer to a resume, cancel or status request, which manage background runs
 * instead of starting one; undefined for a request that runs an agent. */
function backgroundRegistryResult(params: SubagentParamsStatic, nycode: ExtensionAPI, notifyBackgroundCompletion: CompletionSink, makeDetails: MakeDetails): ToolResult | undefined {
  if (params.send) {
    return { content: [{ type: 'text', text: sendResultText(params.send, sendFromLead(params.send, params.task ?? '')) }], details: makeDetails('single')([]) }
  }

  if (params.resume) {
    const onResumed = (run: { id: string; agent: string }): void => {
      nycode.events.emit(SUBAGENT_CHANNEL, { phase: 'start', agentType: run.agent, agentId: run.id, ...laneCorrelation() })
    }
    return { content: [{ type: 'text', text: resumeResultText(params.resume, params.task, notifyBackgroundCompletion, onResumed) }], details: makeDetails('single')([]) }
  }

  if (params.cancel) {
    return { content: [{ type: 'text', text: cancelResultText(params.cancel) }], details: makeDetails('single')([]) }
  }

  if (params.status) {
    return { content: [{ type: 'text', text: statusWithFleet() }], details: makeDetails('single')([]) }
  }
  return undefined
}

function invalidModeResult(agents: AgentConfig[], makeDetails: MakeDetails): ToolResult {
  const available = agents.map((a) => `${a.name} (${a.source})`).join(', ') || 'none'
  return {
    content: [
      {
        type: 'text',
        text: `Invalid parameters. Provide exactly one mode.\nAvailable agents: ${available}`,
      },
    ],
    details: makeDetails('single')([]),
  }
}

function requestedModes(params: SubagentParamsStatic): { hasChain: boolean; hasTasks: boolean; modeCount: number } {
  const hasChain = (params.chain?.length ?? 0) > 0
  const hasTasks = (params.tasks?.length ?? 0) > 0
  const hasSingle = Boolean(params.agent && params.task)
  const modeCount = Number(hasChain) + Number(hasTasks) + Number(hasSingle)
  return { hasChain, hasTasks, modeCount }
}

function gateModeOf(hasChain: boolean, hasTasks: boolean): SubagentMode {
  if (hasChain) return 'chain'
  if (hasTasks) return 'parallel'
  return 'single'
}

function runForegroundMode(params: SubagentParamsStatic, mode: ModeContext): Promise<ToolResult> {
  if (params.chain?.length) return runChainMode(params.chain, mode)
  if (params.tasks?.length) return runParallelMode(params.tasks, mode)
  if (params.agent && params.task) return runSingleMode(params.agent, params.task, params.cwd, mode, params)

  // Unreachable: execute()'s modeCount guard returns unless exactly one of these three
  // is set, and nothing between it and here touches params. It was a second copy of
  // that guard's message, which no input could ever produce, so a reader had to work
  // out for themselves that it was dead. Stated as the invariant it actually is, so a
  // future edit that breaks it says so instead of printing a confusing refusal.
  throw new Error('subagent: exactly one mode must be set here; the mode guard should have returned')
}

/** Main session only: the call can be moved to the background (Ctrl+B) while it runs. On detach the
 * tool returns at once and the finished result reaches the model as one completion message. */
async function runDetachableForeground(params: SubagentParamsStatic, mode: ModeContext, deliver: (text: string) => void, detachedDetails: SubagentDetails, autoDetach = false): Promise<ToolResult> {
  // Automatic batches hold a slot (shared cap with background singles) from before any child
  // starts until their result settles; a refusal is explicit, never a silent foreground run.
  const releaseSlot = autoDetach ? reserveAutoBatchSlot(activeBackgroundRuns()) : undefined
  if (autoDetach && !releaseSlot) {
    return { content: [{ type: 'text', text: `Too many background runs (max ${MAX_BACKGROUND_RUNS} running, singles and batches together). Wait for one to finish, check {status: true}, or pass background: false to wait for this call in the foreground.` }], details: detachedDetails }
  }
  let handedOff = false
  try {
    const out = await raceDetach(mode.signal, (signal, c) =>
      runForegroundMode(params, {
        ...mode,
        signal,
        onUpdate: mode.onUpdate && ((partial) => { if (!c.isDetached) mode.onUpdate?.(partial) }),
      }),
      autoDetach,
    )
    if ('done' in out) return out.done
    const deliverResult = (r: ToolResult): void => {
      const first = r.content.find((part) => part.type === 'text')
      deliver(`Background subagent call finished (${autoDetach ? 'started in the background' : 'moved to the background by the user with Ctrl+B'}):\n\n${first?.type === 'text' ? first.text : '(no output)'}`)
    }
    handedOff = true // the slot is freed when the result settles, not when the turn ends
    void out.detached.then(deliverResult, (e) => deliverResult({ content: [{ type: 'text', text: `Subagent call failed: ${errorMessage(e)}` }], details: detachedDetails })).finally(() => releaseSlot?.())
    return { content: [{ type: 'text', text: autoDetach ? AUTO_DETACHED_TEXT : DETACHED_TEXT }], details: detachedDetails }
  } finally {
    if (!handedOff) releaseSlot?.()
  }
}

export default function subagentExtension(nycode: ExtensionAPI) {
  // Agent panel below the editor, transcript viewer and /tasks browser (main session only).
  const fleetUi = registerFleetUi(nycode, () => {
    try {
      return fleetSourceForUi()
    } catch {
      return undefined
    }
  })
  // Opt-in agent team (NYCODE_TEAMS=1 or /team on): inert and silent otherwise.
  registerTeam(nycode)
  // Claude's mcp__<server> tool patterns translate against the parent's MCP roster,
  // published by the mcp extension on the shared bus. Optional-chained so a minimal
  // test stub without an event bus can still register the extension.
  // Channel `pi-code:plan-state` ({executing, step?, done, total}, published by plan-mode): optional, absent = no planStep on the lanes.
  nycode.events?.on(PLAN_STATE_CHANNEL, (data) => {
    const state = data as { executing?: boolean; step?: unknown } | undefined
    setPlanStep(state?.executing && typeof state.step === 'number' ? state.step : undefined)
  })
  nycode.events?.on(MCP_TOOLS_CHANNEL, (data) => {
    if (isMcpToolAliases(data)) setKnownMcpAliases(data)
  })

  // The hooks extension holds Claude's idle_prompt while a background run is live.
  setBackgroundAgentCounter(() => activeBackgroundRuns())
  // A background run outlives a session switch, and this instance's nycode throws once its
  // session is replaced; completions go to whichever instance's session is current.
  const results = sessionMailbox('subagent-results')

  const notifyBackgroundCompletion = (run: { id: string; agent: string; state: string; turns: number; output?: string; stderr?: string }, userResume?: string): void => {
    // Runs through driveRun's guard, same as the background-mode callback above.
    // The stop event fires here too, so SubagentStop hooks see resumed runs end, and it
    // carries the run's final assistant text: docs/subagents.md states SubagentStop
    // receives last_assistant_message unconditionally, and a resumed run is no exception.
    results.deliver((current, startsTurn) => {
      current.events.emit(SUBAGENT_CHANNEL, { phase: 'stop', agentType: run.agent, agentId: run.id, lastAssistantMessage: run.output })
      current.sendMessage({ customType: 'subagent-background', content: backgroundCompletionText(run, userResume), display: true }, { triggerTurn: startsTurn })
    })
  }

  // Claude's experimental `type: "agent"` hooks spawn a read-only subagent to verify a
  // condition. The hooks extension reaches it through the agent-run seam; register a
  // runner that reuses the same single-run machinery as the subagent tool. cwd and the
  // available model list are captured per session so a hook run lands in the right repo.
  let hookCwd = process.cwd()
  let hookModels: ReadonlyArray<{ id: string }> = []
  // Captured per session like cwd: a named agent resolved for a fork skill or an agent
  // hook must respect project trust the way the tool path does, or an unapproved repo's
  // .claude/agents entry (which wins a name clash) would run on its own say-so.
  let hookAgentScope: AgentScope = 'user'
  // The same session values the tool path computes per call: a named agent's skills: list
  // resolves against these roots, and its project or local memory needs the approval.
  let hookApproved = false
  let hookSkillRoots: string[] = []

  // Discovery walks the plugin cache, the builtin dir, and every agent dir, parsing
  // each file: dozens of fs ops per call. The roster injection below runs every turn
  // for a list that almost never changes mid-session, so it reuses one discovery per
  // (cwd, scope), dropped on session_start. The tool's execute() keeps rediscovering
  // per invocation, so a just-added agent is still runnable without a restart.
  let rosterCache: { key: string; agents: AgentConfig[] } | null = null

  nycode.on('session_start', (_event, ctx) => {
    rosterCache = null
    hookCwd = ctx.cwd
    hookApproved = isProjectApprovedSilently(ctx)
    hookAgentScope = hookApproved ? 'both' : 'user'
    hookSkillRoots = skillDirs(ctx.cwd, os.homedir(), hookApproved)
    try {
      hookModels = ctx.modelRegistry?.getAvailable?.() ?? []
    } catch {
      hookModels = []
    }
    setAgentRunner(async (request) => {
      // Agent hooks inside a subagent are skipped (the seam rejection is non-blocking in
      // runAgentHook); nesting is for the subagent tool, under its depth cap and budget.
      if (process.env.NYCODE_SUBAGENT) throw new Error('agent hooks do not run inside a subagent')
      // A context: fork skill names its agent, or runs with the full toolset;
      // agent hooks keep the read-only hook shape.
      const named = request.agent ? discoverAgents(hookCwd, hookAgentScope).agents.find((a) => a.name === request.agent) : undefined
      const agent = named ?? (request.fullTools ? forkAgent(request) : buildHookAgent(request))
      const result = await runSingleAgent({
        defaultCwd: hookCwd,
        agents: [agent],
        agentName: agent.name,
        task: request.prompt,
        signal: request.signal,
        makeDetails: (results): SubagentDetails => ({ mode: 'single', agentScope: 'user', projectAgentsDir: null, results }),
        availableModels: hookModels,
        skillRoots: hookSkillRoots,
        projectApproved: hookApproved,
      })
      return getFinalOutput(result.messages)
    })
    results.attach(nycode, sessionHasTurns(ctx))
    // The fleet (panel data) exists only for an interactive main session: a headless `nycode -p` at
    // depth 0 (scripts, hooks) has nobody to show it to, so it writes nothing, unless team mode
    // (NYCODE_TEAMS=1) needs the dir for the roster, the peer messages and the lead inbox.
    if (subagentDepth() === 0 && (ctx.hasUI || teamEnabled() || sendEnabled())) {
      ensureFleetDir() // undefined (unsafe root) disables the fleet: currentFleetDir stays unset
      const holder = globalThis as Record<symbol, boolean>
      if (!holder[FLEET_SWEPT]) {
        holder[FLEET_SWEPT] = true
        sweepOrphanFleetDirs()
      }
      getFleetSource({ resume: (id, text, fromUser = true) => resumeBackgroundRun(id, text, (run) => notifyBackgroundCompletion(run, fromUser ? text : undefined)) === 'resumed' })
    } else if (subagentDepth() > 0) {
      startInboxWatcher(nycode)
    }
  })

  nycode.on('agent_start', () => results.markPrompted(nycode))

  nycode.on('session_shutdown', (event, ctx) => {
    results.detach(nycode)
    stopInboxWatcher()
    // On quit nycode is exiting, so a detached background child would keep running (and
    // spending tokens) with its completion swallowed: SIGTERM every live run, killing the
    // process group the way a cancel does. On a same-process session switch
    // (new/resume/fork) the children keep running under the new session, so leave them be
    // and warn once that they are still spending; /tasks inspects them. reload keeps the
    // registry (held on globalThis, see background.ts), so its runs stay listed and
    // cancellable and it neither kills nor warns.
    if (event.reason === 'quit') {
      cancelAllBackgroundRuns()
      if (subagentDepth() === 0) {
        stopOwnForegroundRuns()
        removeFleetDir()
      }
      return
    }
    if (event.reason === 'new' || event.reason === 'resume' || event.reason === 'fork') {
      const active = activeBackgroundRuns() + runningLaneCount()
      if (active > 0) ctx.ui?.notify(`${active} background run${active === 1 ? '' : 's'} still active; /tasks to inspect`, 'warning')
    }
  })

  // Claude surfaces each agent's description so the model can pick one autonomously.
  // Served from the session-level cache above (keyed on cwd and scope, so an approval
  // granted mid-session still widens it); project agents are included only when the
  // project is already approved, read without prompting, since a trust dialog must
  // not appear mid-turn and their descriptions are project text.
  nycode.on('before_agent_start', (event, ctx) => {
    // A session at the depth cap cannot nest (the tool refuses there), and a session with the
    // tool excluded cannot call it: a roster telling either to delegate only misleads.
    if (!canSpawnSubagents() || !nycode.getActiveTools().includes('subagent')) return
    const scope: AgentScope = isProjectApprovedSilently(ctx) ? 'both' : 'user'
    const key = `${scope}\n${ctx.cwd}`
    if (rosterCache?.key !== key) rosterCache = { key, agents: discoverAgents(ctx.cwd, scope).agents }
    // An `agents:` allowlist from the parent narrows what this session may spawn (and advertise).
    const agents = filterAllowed(rosterCache.agents)
    if (agents.length === 0) return
    const line = (text: string): string => text.replace(/\s+/g, ' ').trim().slice(0, 200)
    const roster = agents.map((agent) => `- ${agent.name} (${agent.source}): ${line(agent.description)}`).join('\n')
    const text = `Delegate isolated tasks with the subagent tool ({agent, task}). Available agents:\n${roster}`
    if (addPromptSection(event, 'subagents', text)) return
    return { systemPrompt: `${event.systemPrompt}\n\n## Subagents\n\n${text}` }
  })

  let routingPolicy = loadPolicy()
  // A function so /subagents-setup can re-register it: the description and schema carry the routing policy.
  const registerSubagentTool = (): void => nycode.registerTool({
    name: 'subagent',
    label: 'Subagent',
    description: [
      'Delegate tasks to specialized subagents with isolated context.',
      'Modes: single (agent + task), parallel (tasks array), chain (sequential with {previous} placeholder).',
      'In the interactive root session every delegation (single, parallel, chain) runs in the background by default so the user keeps the main prompt: it returns at once and the result arrives as a message when it finishes (do not poll); pass background: false to wait for the result. Elsewhere (nested, non-interactive) calls run in the foreground and background: true is single mode only. {status: true} lists runs.',
      `Agents come from ~/.claude/agents and ~/${CONFIG_DIR_NAME}/agent/agents, plus project .claude/agents and ${CONFIG_DIR_NAME}/agents once the project is trusted.`,
      'agentScope: "user" or "project" narrows to one source.',
      ...(sendEnabled() ? ['{send: <run id>, task: <message>} redirects a live background run (background runs only); the message is delivered at its next turn boundary, not mid tool call, labelled as yours and never as the user\'s.'] : []),
      ...(routingPolicy ? [routingDescription(routingPolicy)] : []),
    ].join(' '),
    parameters: subagentParams(routingPolicy !== undefined),

    // The call id rides an AsyncLocalStorage: every lane the call starts (any mode, fg or bg) records it in its fleet record.
    execute: (toolCallId, params, signal, onUpdate, ctx) => toolCallScope.run(toolCallId, async (): Promise<AgentToolResult<SubagentDetails>> => {
      // Claude merges project agents into the default roster (project wins on a name
      // clash), and the roster above advertises them under the same approval check,
      // so a default call can reach every agent it lists. An explicit agentScope
      // still narrows or widens; the invocation gate below applies either way.
      const agentScope: AgentScope = params.agentScope ?? (isProjectApprovedSilently(ctx) ? 'both' : 'user')
      // Children carry their depth; without this check they could nest without limit.
      if (!canSpawnSubagents()) {
        return {
          content: [{ type: 'text', text: `Nested subagent runs are not allowed: this session is at depth ${subagentDepth()}, the cap is ${maxSubagentDepth()} (NYCODE_SUBAGENT_MAX_DEPTH). Do the work here or report back to your parent.` }],
          details: { mode: 'single', agentScope, projectAgentsDir: null, results: [] },
        }
      }
      const discovery = discoverAgents(ctx.cwd, agentScope)
      const agents = filterAllowed(discovery.agents)

      const { hasChain, hasTasks, modeCount } = requestedModes(params)

      const makeDetails =
        (mode: 'single' | 'parallel' | 'chain') =>
        (results: SingleResult[]): SubagentDetails => ({
          mode,
          agentScope,
          projectAgentsDir: discovery.projectAgentsDir,
          results,
        })

      const registryResult = backgroundRegistryResult(params, nycode, notifyBackgroundCompletion, makeDetails)
      if (registryResult) return registryResult

      if (modeCount !== 1) return invalidModeResult(agents, makeDetails)

      // Gate repo-controlled project agents before any run (background included).
      const gateResult = await checkProjectAgentGate(params, agents, ctx, discovery.projectAgentsDir, gateModeOf(hasChain, hasTasks), makeDetails)
      if (gateResult) return gateResult

      const budgetError = claimSpawns(hasChain ? (params.chain?.length ?? 1) : hasTasks ? (params.tasks?.length ?? 1) : 1)
      if (budgetError) return { content: [{ type: 'text', text: budgetError }], details: makeDetails(gateModeOf(hasChain, hasTasks))([]) }

      // Project skills only preload and project/local agent memory stores only load
      // once the project is approved, matching the gate the skills extension applies
      // to discovery itself. Read after the project-agent gate above so an approval
      // the user just granted there counts.
      const projectApproved = isProjectApprovedSilently(ctx)
      const skillRoots = skillDirs(ctx.cwd, os.homedir(), projectApproved)
      // Tier aliases resolve against what this user is authenticated for; an
      // unavailable tier still falls back to the session model.
      const availableModels = ctx.modelRegistry?.getAvailable?.() ?? []
      setRoutingSession({
        catalog: availableModels.map((m) => ({ key: `${m.provider}/${m.id}`, cost: m.cost?.output })),
        model: ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined,
        effort: nycode.getThinkingLevel?.(),
      })

      // Root interactive TUI: single, parallel and chain run in the background unless background: false.
      const interactive = ctx.mode === 'tui' && subagentDepth() === 0
      const batch = hasChain || hasTasks
      if (!(interactive && batch) && wantsBackground(params, agents, interactive)) return runBackgroundMode(params, { agents: agents.map(withTeamTool), defaultCwd: ctx.cwd, nycode, deliver: results.deliver, makeDetails, skillRoots, availableModels, projectApproved })

      const mode: ModeContext = {
        agents,
        defaultCwd: ctx.cwd,
        signal,
        onUpdate,
        makeDetails,
        skillRoots,
        availableModels,
        projectApproved,
        // D15: a lane ends after /reload, when this instance's `nycode` throws; the event goes through the mailbox (the current instance) and can never fail the lane.
        onPhase: (phase, agentType, agentId, lastAssistantMessage) => {
          try {
            const payload = { phase, agentType, agentId, ...(lastAssistantMessage === undefined ? {} : { lastAssistantMessage }), ...laneCorrelation(), ...(phase === 'stop' ? laneOutcome(agentId) : {}) }
            results.deliver((current) => current.events.emit(SUBAGENT_CHANNEL, payload))
          } catch {
            // The current session refused it; the lane's result must not depend on the event.
          }
        },
      }

      if (subagentDepth() === 0 && ctx.hasUI) {
        const deliver = (text: string): void => {
          try {
            results.deliver((current) => current.sendMessage({ customType: 'subagent-background', content: text, display: true }, { triggerTurn: true }))
          } catch {
            // The current session refused it; nothing else can take it.
          }
        }
        return runDetachableForeground(params, mode, deliver, makeDetails(gateModeOf(hasChain, hasTasks))([]), interactive && batch && params.background !== false)
      }
      return runForegroundMode(params, mode)
    }),

    renderCall: (args, theme) => renderSubagentCall(args, theme),

    renderResult: (result, { expanded, isPartial }, theme, context) => renderSubagentResult(result, { expanded, isPartial }, theme, context.args),
  })
  registerSubagentTool()
  // /subagents-setup: which models and efforts spawned subagents may use (docs/subagent-routing-2026-11-13.md).
  registerRoutingCommand(nycode, () => {
    routingPolicy = loadPolicy()
    registerSubagentTool()
  })

  // Claude's /tasks: background-run status at a glance, returning immediately without
  // interrupting the agent; the only other way to see these is to ask the model.
  nycode.registerCommand('tasks', {
    description: 'Show background subagent runs',
    handler: async (_args, ctx) => /* NOSONAR typescript:S7503 - the host types a command handler as returning Promise<void> */ {
      // Interactive main session: the browser of every run in the tree (any depth, any state).
      if (ctx.hasUI && subagentDepth() === 0) return fleetUi.openTasks(ctx)
      ctx.ui.notify(tasksStatusText(allBackgroundRuns()), 'info')
    },
  })

  // Claude's /agents: the discovered roster with sources and paths. Approval is read
  // silently, like the roster above: project agents list only once the project is trusted.
  nycode.registerCommand('agents', {
    description: 'List discovered subagents and where they come from',
    handler: async (_args, ctx) => /* NOSONAR typescript:S7503 - the host types a command handler as returning Promise<void> */ {
      const { agents } = discoverAgents(ctx.cwd, isProjectApprovedSilently(ctx) ? 'both' : 'user')
      ctx.ui.notify(agentsListText(agents), 'info')
    },
  })
}

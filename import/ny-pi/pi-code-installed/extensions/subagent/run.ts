/**
 * Running one child agent: spawn a `pi` process, parse its JSON event stream back
 * into messages and usage, and tear the child down on abort or a maxTurns cap.
 *
 * The only place in the subagent extension that owns a process, a temp file or a
 * worktree; everything about how the child was configured lives in child.ts.
 */

import { type ChildProcessByStdio, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type { Readable } from 'node:stream'
import { StringDecoder } from 'node:string_decoder'

import type { AgentToolResult } from '@earendil-works/pi-agent-core'
import type { Message } from '@earendil-works/pi-ai'
import { withFileMutationQueue } from '@earendil-works/pi-coding-agent'
import { cliSettings } from '../internal/cli-settings.ts'
import { killProcessTree } from '../internal/process-tree.ts'
import { currentFleetDir, fleetChildEnv, stopOrigin } from './fleet/store.ts'
import { configuredRuntime, finishExitCode, startTracking, stopNote } from './fleet/tracker.ts'
import { runSubagentStartHooks } from '../internal/subagent-hooks.ts'
import { type AgentConfig, resolveModelAlias } from './agents.ts'
import { agentHooksEnv, agentInvocationArgs, agentMemoryPromptSection, childPromptBody, taskWithStartContext, unresolvedToolsError, withMemoryTools } from './child.ts'
import { getFinalOutput } from './render.ts'
import type { SingleResult, SubagentDetails } from './types.ts'
import { childNestingEnv, claimSpawns, recordSpawnCost } from './nesting/index.ts'
import { makeSessionDir, respawnDelayMs, respawnTask, shouldRespawn, sleepAbortable, useSessionArgs } from './respawn/index.ts'
import { withTeamTool } from './team/types.ts'
import { resolveSpawn, type SpawnRequest } from './routing/apply.ts'
import { type AgentWorktree, cleanupAgentWorktree, createAgentWorktree } from './worktree.ts'
export async function writePromptToTempFile(agentName: string, prompt: string): Promise<{ dir: string; filePath: string }> {
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'pi-subagent-'))
  const safeName = agentName.replace(/[^\w.-]+/g, '_')
  const filePath = path.join(tmpDir, `prompt-${safeName}.md`)
  await withFileMutationQueue(filePath, async () => {
    await fs.promises.writeFile(filePath, prompt, { encoding: 'utf-8', mode: 0o600 })
  })
  return { dir: tmpDir, filePath }
}

/** Exported as a test seam: the fallbacks only fire in packaged distributions
 * (bun single-file, compiled binary), which no CI run reaches naturally. */
export function getPiInvocation(args: string[]): { command: string; args: string[] } {
  const currentScript = process.argv[1]
  const isBunVirtualScript = currentScript?.startsWith('/$bunfs/root/')
  if (currentScript && !isBunVirtualScript && fs.existsSync(currentScript)) {
    return { command: process.execPath, args: [currentScript, ...args] }
  }

  const execName = path.basename(process.execPath).toLowerCase()
  const isGenericRuntime = /^(node|bun)(\.exe)?$/.test(execName)
  if (!isGenericRuntime) {
    return { command: process.execPath, args }
  }

  return { command: 'pi', args }
}

export type OnUpdateCallback = (partial: AgentToolResult<SubagentDetails>) => void

type AssistantMessage = Extract<Message, { role: 'assistant' }>

function accumulateAssistantMessage(result: SingleResult, msg: AssistantMessage): void {
  result.usage.turns++
  const usage = msg.usage
  if (usage) {
    result.usage.input += usage.input || 0
    result.usage.output += usage.output || 0
    result.usage.cacheRead += usage.cacheRead || 0
    result.usage.cacheWrite += usage.cacheWrite || 0
    result.usage.cost += usage.cost?.total || 0
    result.usage.contextTokens = usage.totalTokens || 0
  }
  if (!result.model && msg.model) result.model = msg.model
  if (msg.stopReason) result.stopReason = msg.stopReason
  if (msg.errorMessage) result.errorMessage = msg.errorMessage
}

export interface RunAgentOptions {
  defaultCwd: string
  agents: AgentConfig[]
  agentName: string
  task: string
  cwd?: string
  step?: number
  signal?: AbortSignal
  onUpdate?: OnUpdateCallback
  makeDetails: (results: SingleResult[]) => SubagentDetails
  onPhase?: SubagentPhaseSink
  /** The child's run id, set by the wrapper so the spawn env can carry it. */
  agentId?: string
  /** SubagentStart hook context, injected ahead of the child's first prompt. */
  startContexts?: string[]
  /** Skill directories to preload from, resolved where project trust is known. */
  skillRoots?: string[]
  /** Models this user can actually run, for resolving a tier alias. */
  availableModels?: ReadonlyArray<{ id: string }>
  /** Whether repo-controlled config (a project/local agent memory store) may be read. */
  projectApproved?: boolean
  /** The orchestrator's per-spawn model/effort/tools/skills request (routing policy only). */
  request?: SpawnRequest
}

/** Publishes a child run's start/stop for the hooks extension's SubagentStart/Stop.
 * The stop carries the run's final assistant text, which Claude's SubagentStop
 * delivers as last_assistant_message. */
export type SubagentPhaseSink = (phase: 'start' | 'stop', agentType: string, agentId: string, lastAssistantMessage?: string) => void

/** Append a note to the last assistant message that has text, the one getFinalOutput
 * returns, so the note rides the run's output instead of replacing it: a capped run
 * usually ends on a turn that only calls a tool. With no text anywhere, the last
 * assistant message carries it; with no assistant message, stderr. */
function appendResultNote(result: SingleResult, note: string): void {
  const assistants = result.messages.filter((msg): msg is AssistantMessage => msg.role === 'assistant').reverse()
  const target = assistants.find((msg) => msg.content.some((part) => part.type === 'text')) ?? assistants[0]
  if (target) {
    target.content.push({ type: 'text', text: note })
    return
  }
  result.stderr = result.stderr ? `${result.stderr}\n${note}` : note
}

/** Tell the parent where a kept worktree lives. */
function appendWorktreeNote(result: SingleResult, worktree: AgentWorktree): void {
  appendResultNote(result, `[isolation: worktree kept at ${worktree.dir} (branch ${worktree.branch}); the agent's changes live there]`)
}

/** Claude marks a maxTurns-capped run's output as partial; the note rides the
 * final assistant message like the worktree note, so the parent model sees it
 * with the output. A no-op for uncapped runs. */
function appendPartialNote(result: SingleResult): void {
  if (result.partial) appendResultNote(result, '[Output is partial: the subagent stopped at its maxTurns limit.]')
}

/** A decoder for one child stream. A pipe delivers whatever bytes are ready, so a read can
 * end inside a multi-byte character: decoded on its own, each half became U+FFFD. This one
 * holds the incomplete bytes until the rest arrive. One per stream, never shared. */
export function utf8Chunks(): (chunk: Buffer | string) => string {
  const decoder = new StringDecoder('utf8')
  return (chunk) => (typeof chunk === 'string' ? chunk : decoder.write(chunk))
}

/** The pi child, or the error spawning it threw synchronously. Node normally
 * reports a spawn failure through the child's async 'error' event, but some
 * failures (confirmed on Linux: posix_spawn detects E2BIG immediately) throw at
 * the spawn() call site instead; catching it here, in one place with an explicit
 * return type, keeps the caller's non-null stdout/stderr narrowing that a bare
 * try/catch around an inline spawn() call loses. */
export function spawnChild(command: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv }, platform: NodeJS.Platform = process.platform): { proc: ChildProcessByStdio<null, Readable, Readable> } | { error: Error } {
  try {
    const proc = spawn(command, args, {
      ...options,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      // Its own group, so an abort reaches grandchildren too: killing only the
      // direct child orphans a build or dev server the agent started. On Windows
      // `detached` means DETACHED_PROCESS: the child has no console, so every console
      // program it runs (each checkpoint git call) opens a visible window. There
      // taskkill /T ends the tree instead, and the child keeps the parent's console.
      detached: platform !== 'win32',
      windowsHide: true,
    })
    // A third failure shape: at the descriptor limit (EMFILE, ENFILE) node returns a child
    // with no stdio and emits 'error' on the next tick. The callers wire stdout first, so
    // the deferred event would find no listener, and an unhandled 'error' exits pi.
    if (!proc.stdout) {
      proc.on('error', () => {})
      return { error: new Error('spawn returned no stdio: the file descriptor limit is likely exhausted (EMFILE)') }
    }
    return { proc }
  } catch (error) {
    return { error: error as Error }
  }
}

/** One line of the child's JSON event stream, or undefined for a blank line, a line
 * that is not JSON, or an event that carries no message. */
function parseEventLine(line: string): { type?: string; message?: unknown } | undefined {
  if (!line.trim()) return undefined
  let event: { type?: string; message?: unknown }
  try {
    event = JSON.parse(line)
  } catch {
    return undefined
  }

  if (!event.message) return undefined
  return event
}

export function removeTmpPrompt(tmpPrompt: { dir: string; filePath: string } | undefined): void {
  if (!tmpPrompt) return
  try {
    fs.unlinkSync(tmpPrompt.filePath)
  } catch {
    /* ignore */
  }
  try {
    fs.rmdirSync(tmpPrompt.dir)
  } catch {
    /* ignore */
  }
}

export async function runSingleAgent(options: RunAgentOptions): Promise<SingleResult> {
  const agent = options.agents.find((a) => a.name === options.agentName)
  if (!agent) return runSingleAgentInner(options)
  // A refused launch (Claude's zero-tools error) never starts, so no
  // SubagentStart/Stop pair fires for it.
  const toolsError = unresolvedToolsError(agent)
  if (toolsError) {
    return {
      agent: agent.name,
      agentSource: agent.source,
      task: options.task,
      exitCode: 1,
      messages: [],
      stderr: toolsError,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
      step: options.step,
    }
  }
  const agentId = `fg-${randomUUID().slice(0, 8)}`
  // SubagentStart hooks run pre-spawn through the seam so their additionalContext
  // reaches the child before its first prompt.
  const startContexts = await runSubagentStartHooks(agent.name, agentId)
  phase(options, 'start', agent.name, agentId)
  let result: SingleResult | undefined
  try {
    result = await runSingleAgentInner({ ...options, agentId, startContexts })
    return result
  } finally {
    phase(options, 'stop', agent.name, agentId, result ? getFinalOutput(result.messages) || undefined : undefined)
  }
}

/** D15: a sink that throws (a captured `pi` gone stale after /reload) must neither replace this lane's result nor reject its siblings. */
function phase(options: Pick<RunAgentOptions, 'onPhase'>, ...args: Parameters<NonNullable<RunAgentOptions['onPhase']>>): void {
  try {
    options.onPhase?.(...args)
  } catch {
    // Observers only: the lane's outcome is already decided.
  }
}

function unknownAgentResult(agents: AgentConfig[], agentName: string, task: string, step: number | undefined): SingleResult {
  const available = agents.map((a) => `"${a.name}"`).join(', ') || 'none'
  return {
    agent: agentName,
    agentSource: 'unknown',
    task,
    exitCode: 1,
    messages: [],
    stderr: `Unknown agent: "${agentName}". Available agents: ${available}.`,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
    step,
  }
}

async function runSingleAgentInner(options: RunAgentOptions): Promise<SingleResult> {
  const { defaultCwd, agents, agentName, task, cwd, step, signal, onUpdate, makeDetails } = options
  const agent = agents.find((a) => a.name === agentName)

  if (!agent) return unknownAgentResult(agents, agentName, task, step)

  const runCwd = cwd ?? defaultCwd
  // Claude's isolation: worktree gives the child an isolated copy of the repository.
  // A boundary that cannot be created fails the run: running against the real
  // checkout would silently drop the isolation the agent declared.
  let worktree: AgentWorktree | undefined
  if (agent.isolation === 'worktree') {
    const created = await createAgentWorktree(runCwd, agent.name)
    if ('error' in created) {
      return {
        agent: agentName,
        agentSource: agent.source,
        task,
        exitCode: 1,
        messages: [],
        stderr: `isolation: worktree could not be created: ${created.error}`,
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
        step,
      }
    }
    worktree = created
  }
  // Project/local memory is anchored at the SESSION project (defaultCwd), not the
  // model-supplied runCwd: projectApproved gates the session's repo, so anchoring the
  // store on a different (possibly unapproved) cwd would inject that repo's memory as
  // trusted. User-scope memory ignores cwd, so this is safe for it too.
  const memorySection = agentMemoryPromptSection(agent, defaultCwd, options.projectApproved ?? false)
  // A memory-enabled child must be able to manage its store files even when the
  // agent pins a tools allowlist.
  // The routing policy (docs/subagent-routing-2026-11-13.md) picks model/effort and narrows tools/skills; without one `routed.agent` is `agent`.
  const routed = resolveSpawn(agent, options.request, task)
  const invocationAgent = withTeamTool(memorySection ? { ...routed.agent, tools: withMemoryTools(routed.agent.tools) } : routed.agent)
  const args = agentInvocationArgs(invocationAgent, resolveModelAlias(routed.agent.modelAlias, options.availableModels ?? []))
  args.push(...routed.args)
  // Claude's subagents run in-process and see the parent's --settings and
  // --setting-sources; a child pi process has to be handed them.
  args.push(...cliSettings().forwardArgs)

  let tmpPrompt: { dir: string; filePath: string } | undefined
  // Sessão persistida (zz-subagent-respawn): permite reiniciar o filho com a conversa inteira; removida no finally.
  let sessionDir: string | undefined
  let keepSession = false
  // Lane visible from the start (status, panels), before the prompt files and the spawn.
  // Closed by the finish calls below and, on a throw before them, in the finally (finish is idempotent).
  let tracker: ReturnType<typeof startTracking> = startTracking({ id: options.agentId ?? '', agent: agentName, task, ...configuredRuntime(args), background: false, activity: 'starting' })

  const currentResult: SingleResult = {
    agent: agentName,
    agentSource: agent.source,
    task,
    exitCode: 0,
    messages: [],
    stderr: '',
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
    model: agent.model,
    step,
  }

  const emitUpdate = () => {
    if (onUpdate) {
      onUpdate({
        content: [{ type: 'text', text: getFinalOutput(currentResult.messages) || '(running...)' }],
        details: makeDetails([currentResult]),
      })
    }
  }

  try {
    sessionDir = makeSessionDir()
    if (sessionDir) useSessionArgs(args, sessionDir)
    const promptBody = childPromptBody(routed.agent, options.skillRoots ?? [], memorySection)
    if (promptBody.trim()) {
      tmpPrompt = await writePromptToTempFile(agent.name, promptBody)
      // Claude: the agent body IS the subagent's system prompt, replacing the
      // default, not an addition to it (--system-prompt reads a file path too).
      args.push('--system-prompt', tmpPrompt.filePath)
    }

    args.push(taskWithStartContext(task, options.startContexts ?? []))
    let wasAborted = false
    let respawnWhy: string | undefined
    let attemptFrom = 0
    const respawns: string[] = []

    const runAttempt = (): Promise<number> => new Promise<number>((resolve) => {
      const invocation = getPiInvocation(args)
      const spawned = spawnChild(invocation.command, invocation.args, {
        cwd: worktree?.dir ?? runCwd,
        // The marker and depth let the child's subagent tool enforce the nesting cap.
        env: { ...process.env, ...childNestingEnv(), ...agentHooksEnv(agent, options.agentId ?? ''), ...routed.env, ...fleetChildEnv(options.agentId ?? '') },
      })
      if ('error' in spawned) {
        if (!currentResult.stderr) currentResult.stderr = spawned.error.message
        resolve(1)
        return
      }
      const proc = spawned.proc
      // Um tracker por execução (criado acima), reaproveitado nos respawns: a linha do painel não fica em 'failed' durante a espera.
      tracker?.setPid(proc.pid)
      let buffer = ''
      let assistantTurns = 0

      const onAssistantTurn = (msg: AssistantMessage) => {
        accumulateAssistantMessage(currentResult, msg)
        assistantTurns++
        // Claude's maxTurns cap: end the child at the turn boundary once it has
        // produced its Nth turn, so the collected output is kept and no turn is
        // cut; the returned output is marked partial, as Claude documents.
        if (agent.maxTurns && assistantTurns >= agent.maxTurns) {
          currentResult.partial = true
          killGroup('SIGTERM')
        }
      }

      const processLine = (line: string) => {
        const event = parseEventLine(line)
        if (!event) return

        if (event.type === 'message_end') {
          const msg = event.message as Message
          currentResult.messages.push(msg)
          if (msg.role === 'assistant') onAssistantTurn(msg)
          emitUpdate()
        } else if (event.type === 'tool_result_end') {
          currentResult.messages.push(event.message as Message)
          emitUpdate()
        }
      }

      let killTimer: ReturnType<typeof setTimeout> | undefined
      let onAbort: (() => void) | undefined
      const cleanup = () => {
        if (killTimer) clearTimeout(killTimer)
        if (onAbort && signal) signal.removeEventListener('abort', onAbort)
      }

      const decodeStdout = utf8Chunks()
      const decodeStderr = utf8Chunks()
      proc.stdout.on('data', (data) => {
        buffer += decodeStdout(data)
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''
        for (const line of lines) {
          tracker?.onLine(line)
          processLine(line)
        }
      })
      proc.stdout.on('error', () => {})

      proc.stderr.on('data', (data) => {
        currentResult.stderr += decodeStderr(data)
      })
      proc.stderr.on('error', () => {})

      proc.on('close', (code) => {
        cleanup()
        if (buffer.trim()) {
          tracker?.onLine(buffer)
          processLine(buffer)
        }
        // The fleet's stop marker (panel or {cancel}) tells a stop from a crash; callers report the note.
        const stopBy = stopOrigin(currentFleetDir(), options.agentId ?? '')
        if (stopBy) {
          currentResult.stopReason = 'aborted'
          currentResult.errorMessage = stopNote(stopBy)
        }
        respawnWhy = sessionDir
          ? shouldRespawn({ wasAborted, stopBy, partial: currentResult.partial, attempts: respawns.length, exitCode: code, messages: currentResult.messages.slice(attemptFrom), stderr: currentResult.stderr, claimBudget: () => claimSpawns(1) })
          : undefined
        if (!respawnWhy) tracker?.finish({ exitCode: finishExitCode(Boolean(currentResult.partial), code), aborted: wasAborted, partial: Boolean(currentResult.partial), error: currentResult.errorMessage })
        // A capped run was stopped by this module's own SIGTERM, which pi's print mode
        // answers with exit 143: that is not the agent failing, as background.ts also holds.
        resolve(currentResult.partial ? 0 : (code ?? 1)) // morto por sinal sem ser o nosso SIGTERM = falha
      })

      proc.on('error', (error: Error) => {
        cleanup()
        // A child that never started leaves no stdout and no stderr, so this message is the
        // only diagnostic; without it the failure reads as "(no output)".
        if (!currentResult.stderr) currentResult.stderr = error.message
        resolve(1)
      })

      const killGroup = (sig: NodeJS.Signals): void => killProcessTree(proc, sig)
      if (signal) {
        onAbort = () => {
          wasAborted = true
          killGroup('SIGTERM')
          // proc.killed only reports that the signal was sent, not that the child died. Escalate
          // on a timer that the 'close' handler clears once the child has actually exited.
          killTimer = setTimeout(() => killGroup('SIGKILL'), 5000)
        }
        if (signal.aborted) onAbort()
        else signal.addEventListener('abort', onAbort, { once: true })
      }
    })

    let exitCode = await runAttempt()
    // Respawn limitado (2x): o filho morreu ou terminou em erro; recarrega a sessão e continua de onde parou.
    while (respawnWhy && !wasAborted) {
      const reason = respawnWhy
      const waitMs = respawnDelayMs(respawns.length)
      if (onUpdate) onUpdate({ content: [{ type: 'text', text: `(respawning after failure, attempt ${respawns.length + 1}/2 in ${Math.round(waitMs / 1000)}s: ${reason})` }], details: makeDetails([currentResult]) })
      if (await sleepAbortable(waitMs, signal)) {
        wasAborted = true
        tracker?.finish({ aborted: true })
        break
      }
      respawns.push(reason)
      attemptFrom = currentResult.messages.length
      currentResult.stopReason = undefined
      currentResult.errorMessage = undefined
      currentResult.stderr = ''
      args[args.length - 1] = respawnTask(reason)
      exitCode = await runAttempt()
    }
    // Se um respawn nem chegou a subir o processo, o tracker ainda está aberto (finish é idempotente).
    tracker?.finish({ exitCode, error: currentResult.errorMessage ?? currentResult.stderr })

    currentResult.exitCode = exitCode
    if (wasAborted) throw new Error('Subagent was aborted')
    appendPartialNote(currentResult)
    if (routed.note) appendResultNote(currentResult, routed.note)
    if (respawns.length) appendResultNote(currentResult, `[respawned ${respawns.length} time(s): ${respawns.join(' | ')}]`)
    if (sessionDir && (exitCode !== 0 || currentResult.stopReason === 'error')) {
      keepSession = true
      appendResultNote(currentResult, `[the child failed; its session is kept at ${sessionDir}]`)
    }
    return currentResult
  } finally {
    tracker?.finish({ exitCode: 1, error: currentResult.errorMessage ?? 'ended before the child finished' })
    recordSpawnCost(currentResult.usage.cost)
    // Cleanup runs on abort too: it only removes a pristine worktree, so an
    // interrupted agent's changes always survive.
    if (worktree && (await cleanupAgentWorktree(runCwd, worktree)) === 'kept') {
      appendWorktreeNote(currentResult, worktree)
    }
    removeTmpPrompt(tmpPrompt)
    if (sessionDir && !keepSession) fs.rmSync(sessionDir, { recursive: true, force: true })
  }
}

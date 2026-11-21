/**
 * One-off, in-process model completions for extensions.
 *
 * pi exposes ModelRuntime.completeSimple(model, context, options), so an extension
 * can run a single tool-less prompt through a model without spawning a subprocess
 * (the way the subagent does) or standing up its own HTTP client. A caller with a
 * session passes its ctx.modelRegistry, which completes on the session's own runtime;
 * without one, a standalone runtime reading the same credential store is created once
 * and cached. This is the shared foundation for model-backed features that
 * Claude has and pi otherwise cannot express: WebFetch's prompt-over-page answer,
 * a hook's `type: prompt` evaluation, and similar.
 *
 * Every consumer must treat a completion as best-effort: it costs a model call and
 * can fail (no credentials, headless with no model, a provider error), so failures
 * throw and the caller falls back to its non-model behavior.
 */

import type { Api, AssistantMessage, Context, Model, ModelsSimpleStreamOptions, StopReason, ThinkingLevel, Usage } from '@earendil-works/pi-ai'
import { ModelRuntime } from '@earendil-works/pi-coding-agent'

/** The completion backend: model + context -> assistant message. Overridable for tests. */
export type CompleteFn = (model: Model<Api>, context: Context, options: ModelsSimpleStreamOptions) => Promise<AssistantMessage>

let backend: Promise<CompleteFn> | null = null
/** A test backend wins over a passed registry, so tests keep intercepting every call. */
let backendOverridden = false

async function realBackend(): Promise<CompleteFn> {
  // allowModelNetwork stays false (the default): a completion must not stall on a
  // catalog refresh. The runtime reads the same auth/models files as the session.
  const runtime = await ModelRuntime.create()
  return (model, context, options) => runtime.completeSimple(model, context, options)
}

/** Replace the completion backend, or reset to the real runtime with null. Tests only. */
export function setCompleteBackend(fn: CompleteFn | null): void {
  backend = fn ? Promise.resolve(fn) : null
  backendOverridden = fn !== null
}

/** The text of an assistant message, thinking and tool calls dropped. */
export function assistantText(message: AssistantMessage): string {
  return message.content
    .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
    .map((part) => part.text)
    .join('')
    .trim()
}

/** The session's model registry (ctx.modelRegistry), narrowed to the one call used here. */
export interface CompletionRegistry {
  streamSimple(model: Model<Api>, context: Context, options?: ModelsSimpleStreamOptions): { result(): Promise<AssistantMessage> }
}

export interface CompleteOptions {
  /** System prompt for the one-off turn. */
  system?: string
  /** The session's registry. Only the session's runtime holds extension-registered
   * providers, virtual models and a `--api-key` key; a fresh ModelRuntime.create()
   * fails with `Unknown provider` for the first and lacks the others. Without it, a
   * standalone runtime is the fallback. */
  registry?: CompletionRegistry
  /** Output cap; a summary/decision does not need the model's full budget. */
  maxTokens?: number
  signal?: AbortSignal
  /** Thinking level. Omitted means the least the model allows: off where it can be
   * turned off, else its lowest level (see minimalReasoning). */
  reasoning?: ThinkingLevel
}

/** Levels from cheapest to dearest, as a one-off completion wants them. */
const ASCENDING_LEVELS: readonly ThinkingLevel[] = ['minimal', 'low', 'medium', 'high']

/**
 * The cheapest thinking level a model accepts, or undefined when thinking can be off.
 * Without a level, pi-ai asks for thinking off; a model whose thinkingLevelMap marks
 * `off: null` (Opus/Sonnet 5.5, Fable 5) cannot honor that and falls back to adaptive
 * thinking at effort "high", which shares maxTokens with the reply. With a small cap
 * the thinking used the whole budget and the call returned no text (stopReason
 * "length"): /goal's "unreadable verdict: " with an empty verdict.
 */
export function minimalReasoning(model: Pick<Model<Api>, 'reasoning'> & { thinkingLevelMap?: Partial<Record<string, string | null>> }): ThinkingLevel | undefined {
  const map = model.thinkingLevelMap
  if (!model.reasoning || map?.off !== null) return undefined
  return ASCENDING_LEVELS.find((level) => map[level] !== null)
}

function standaloneBackend(): Promise<CompleteFn> {
  // A rejected creation must not stay cached: ModelRuntime.create can fail on a
  // transient (a credential store read), and caching that promise made every later
  // call rethrow the same stale error for the life of the process.
  backend ??= realBackend().catch((error: unknown) => {
    backend = null
    throw error
  })
  return backend
}

/** A tool whose arguments are the answer: a JSON Schema the reply is held to. */
export interface AnswerTool {
  name: string
  description: string
  parameters: Record<string, unknown>
}

/** Whether `model` can be forced to answer through one tool: Anthropic's tool_choice
 * `{type: "tool"}` is rejected while thinking is on, so only a model whose thinking
 * can be off qualifies. */
export function canForceTool(model: Pick<Model<Api>, 'api' | 'reasoning'> & { thinkingLevelMap?: Partial<Record<string, string | null>> }): boolean {
  return model.api === 'anthropic-messages' && minimalReasoning(model) === undefined
}

/**
 * Run `prompt` through `model` forced to call `tool` once, its arguments held to the
 * tool's schema (strict sampling where the provider has it). Returns the arguments, or
 * undefined when the reply carried no such call, plus any text, usage and stop reason.
 * Callers check canForceTool first. Throws like completeText.
 */
export async function completeToolCall(model: Model<Api>, prompt: string, tool: AnswerTool, options: CompleteOptions = {}): Promise<{ args: Record<string, unknown> | undefined; text: string; usage: Usage; stopReason: StopReason }> {
  const context: Context = {
    systemPrompt: options.system,
    messages: [{ role: 'user', content: prompt, timestamp: Date.now() }],
    tools: [{ ...tool, constrainedSampling: { type: 'json_schema', strict: 'prefer' } }],
  }
  // pi-ai types toolChoice as "auto" | "none", but the Anthropic adapter passes an object
  // through as tool_choice, which is how a single tool is forced.
  const toolChoice = { type: 'tool', name: tool.name } as unknown as ModelsSimpleStreamOptions['toolChoice']
  const streamOptions = { maxTokens: options.maxTokens ?? 1024, signal: options.signal, reasoning: options.reasoning ?? minimalReasoning(model), toolChoice }
  const message = options.registry && !backendOverridden ? await options.registry.streamSimple(model, context, streamOptions).result() : await (await standaloneBackend())(model, context, streamOptions)
  if (message.stopReason === 'error' || message.stopReason === 'aborted') throw new Error(message.errorMessage ?? `completion ${message.stopReason}`)
  const call = message.content.find((part) => part.type === 'toolCall' && part.name === tool.name) as { arguments?: Record<string, unknown> } | undefined
  return { args: call?.arguments, text: assistantText(message), usage: message.usage, stopReason: message.stopReason }
}

/**
 * Run `prompt` through `model` as a single user turn and return the reply text plus
 * the call's usage. A tool that makes a nested LLM call must return that usage on
 * its tool result, or the call's tokens and cost vanish from pi's session totals.
 * Throws on any failure so the caller can fall back; never returns a partial or a
 * tool call, only assistant text.
 */
export async function completeText(model: Model<Api>, prompt: string, options: CompleteOptions = {}): Promise<{ text: string; usage: Usage; stopReason: StopReason }> {
  const context: Context = {
    systemPrompt: options.system,
    messages: [{ role: 'user', content: prompt, timestamp: Date.now() }],
  }
  const streamOptions = { maxTokens: options.maxTokens ?? 1024, signal: options.signal, reasoning: options.reasoning ?? minimalReasoning(model) }
  const message = options.registry && !backendOverridden ? await options.registry.streamSimple(model, context, streamOptions).result() : await (await standaloneBackend())(model, context, streamOptions)
  // pi-ai reports a provider failure or a fired signal by resolving, never rejecting: the
  // message then has no text, and returned as an answer it is indistinguishable from one.
  if (message.stopReason === 'error' || message.stopReason === 'aborted') throw new Error(message.errorMessage ?? `completion ${message.stopReason}`)
  return { text: assistantText(message), usage: message.usage, stopReason: message.stopReason }
}

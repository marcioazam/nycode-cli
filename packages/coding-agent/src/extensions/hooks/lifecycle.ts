/** Pure lifecycle helpers of the hooks bridge: payload vocabularies, Stop verdicts, notices. */
import type { ExtensionContext, ToolResultEvent, UserBashEventResult } from "../../core/extensions/types.ts";
import { SettingsManager } from "../../core/settings-manager.ts";
import { createLocalBashOperations } from "../../core/tools/bash.ts";
import { contentText, parseNumericEnv } from "../_shared/util/values.ts";
import { piToolOutput } from "./claude-tools.ts";
import type { HookCommand } from "./config.ts";
import { jsonBlockVerdict, tryParseJson } from "./decisions.ts";
import { passesIfFilter } from "./matcher.ts";
import { type HookRunner, type HookRunResult, timeoutMs } from "./runners.ts";

/** The text of the last assistant message in a turn, for Claude's Stop-hook
 * `last_assistant_message`. Thinking and tool calls are dropped; a plain-string
 * content is returned as-is. */
export function lastAssistantText(messages: ReadonlyArray<{ role: string; content: unknown }>): string {
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i];
		if (message.role !== "assistant") continue;
		return contentText(message.content);
	}
	return "";
}

/** Claude overrides a Stop hook after it blocks this many times in a row with no user
 * progress, ending the turn with a warning rather than looping forever. */
export const DEFAULT_STOP_HOOK_BLOCK_CAP = 8;

/** The consecutive-block cap for the Stop hook: CLAUDE_CODE_STOP_HOOK_BLOCK_CAP when it
 * is a positive integer, the documented "disable the cap" for 0 (unbounded, not a
 * zero-cap that would suppress the very first block), else the default for a negative
 * or malformed value. */
export function stopHookBlockCap(env: Record<string, string | undefined> = process.env): number {
	const override = parseNumericEnv(env.CLAUDE_CODE_STOP_HOOK_BLOCK_CAP);
	if (override === 0) return Number.POSITIVE_INFINITY;
	return override !== undefined && Number.isInteger(override) && override > 0 ? override : DEFAULT_STOP_HOOK_BLOCK_CAP;
}

export async function runNotifyHooks(
	commands: HookCommand[],
	payload: unknown,
	runner: HookRunner,
): Promise<HookRunResult[]> {
	// Non-tool events: a hook carrying `if` never runs, as Claude documents.
	const runnable = commands.filter((command) => passesIfFilter(command, undefined));
	return await Promise.all(runnable.map((command) => runner(command, payload, timeoutMs(command))));
}

/** pi's lifecycle vocabularies differ from Claude's documented ones. The matcher is
 * offered both spellings so existing configs keep firing either way, and the payload
 * reports the Claude value, which is what a Claude-written hook script parses. */
export const SESSION_START_SOURCE: Record<string, string> = {
	startup: "startup",
	new: "clear",
	resume: "resume",
	fork: "fork",
};
export const PRECOMPACT_TRIGGER: Record<string, string> = { manual: "manual", threshold: "auto", overflow: "auto" };
export const SESSION_END_REASON: Record<string, string> = {
	quit: "prompt_input_exit",
	new: "clear",
	resume: "resume",
	reload: "other",
	fork: "other",
};

/** The raw pi value plus its Claude spelling, deduplicated, for matcher candidates. */
export function claudeSpelling(map: Record<string, string>, raw: string): { names: string[]; value: string } {
	const value = map[raw] ?? raw;
	return { names: value === raw ? [raw] : [raw, value], value };
}

/** Claude: idle_prompt fires when "Claude finished responding about 60 seconds ago
 * and you haven't typed since". */
export const IDLE_PROMPT_DELAY_MS = 60_000;

/** pi's model_select sources in Claude's PostModelSwitch vocabulary: an explicit
 * set is a command-style request, cycling is the picker, and restore is the model
 * Claude Code restores on resume. */
export const MODEL_SELECT_SOURCE: Record<string, string> = { set: "command", cycle: "picker", restore: "resume" };

/** One Stop hook result read as a verdict. Claude: `continue` "takes precedence over any
 * event-specific decision fields", and stopReason is the message shown when it is false,
 * so a hook asking to stop wins over its own block, and over any other hook's, whatever exit code carried it. Any
 * blocking spelling counts, including the prompt and agent hook reply schemas, and a
 * non-error additionalContext feeds back the same way so the block cap still bounds it. */
export function stopVerdict(
	result: HookRunResult,
	stopMessages: string[],
): { block: boolean; reason: string; stop: boolean } {
	const parsed = tryParseJson(result.stdout);
	if (parsed?.continue === false) {
		if (parsed.stopReason) stopMessages.push(String(parsed.stopReason));
		return { block: false, reason: "", stop: true };
	}
	if (result.code === 2)
		return {
			block: true,
			reason:
				jsonBlockVerdict(parsed, "Stop blocked by hook")?.reason ??
				(result.stderr.trim() || "Stop blocked by hook"),
			stop: false,
		};
	const verdict = jsonBlockVerdict(parsed, "Stop blocked by hook");
	if (verdict) return { block: true, reason: verdict.reason, stop: false };
	const context = parsed?.hookSpecificOutput?.additionalContext;
	if (typeof context === "string" && context.length > 0) return { block: true, reason: context, stop: false };
	return { block: false, reason: "", stop: false };
}

/** Whether the turn ended in a user interrupt: pi marks the aborted turn's final
 * assistant message stopReason "aborted". */
export function endedByInterrupt(event: { messages?: Array<{ role: string; stopReason?: string }> }): boolean {
	const turnMessages = event.messages ?? [];
	const lastAssistant = [...turnMessages].reverse().find((message) => message.role === "assistant");
	return lastAssistant?.stopReason === "aborted";
}

/** The stop reason of the first PostToolUse result that set continue false, if any. */
export function continueFalseReason(results: HookRunResult[]): string | undefined {
	const postToolStop = results
		.map((result) => tryParseJson(result.stdout))
		.find((parsed) => parsed?.continue === false);
	return postToolStop ? (postToolStop.stopReason ?? "Stopped by hook") : undefined;
}

/** The first completed result's updatedToolOutput, as the pi output text. An MCP tool
 * also reads updatedMCPToolOutput. */
export function updatedToolOutput(results: HookRunResult[], toolName: string, isMcp: boolean): string | undefined {
	return results
		.filter((result) => !result.timedOut)
		.map((result) => {
			const parsed = tryParseJson(result.stdout);
			const value = isMcp ? (parsed?.updatedMCPToolOutput ?? parsed?.updatedToolOutput) : parsed?.updatedToolOutput;
			return value === undefined ? undefined : piToolOutput(toolName, value, isMcp);
		})
		.find((text) => text !== undefined);
}

/** The tool result content with any replacement output and the hook feedback lines
 * appended; undefined when the hooks changed nothing. */
export function postToolContent(
	content: ToolResultEvent["content"],
	replacement: string | undefined,
	feedback: string[],
): { content: ToolResultEvent["content"] } | undefined {
	if (replacement === undefined && feedback.length === 0) return;
	const base = replacement !== undefined ? [{ type: "text" as const, text: replacement }] : content;
	return { content: [...base, ...feedback.map((text) => ({ type: "text" as const, text }))] };
}

/**
 * A PreToolUse `updatedInput` on a direct `!` command. pi runs the event's own command
 * unless the handler returns operations, so a rewrite that only changed the payload ran the
 * typed command. The rewrite is honoured by running pi's local executor on the rewritten
 * command, with the shell pi itself would use (its settings, the project's only when pi
 * trusts the project) and the command prefix pi prepends kept. pi shows the typed command,
 * so the user is told what actually runs.
 */
export function rewrittenUserBash(
	typed: string,
	rewritten: unknown,
	ctx: ExtensionContext,
): UserBashEventResult | undefined {
	if (typeof rewritten !== "string" || rewritten === typed) return undefined;
	ctx.ui.notify(hookAttention("PreToolUse reescreveu o comando", `rodando: ${rewritten}`), "warning");
	let shellPath: string | undefined;
	try {
		shellPath = SettingsManager.create(ctx.cwd, undefined, {
			projectTrusted: ctx.isProjectTrusted?.() === true,
		}).getShellPath();
	} catch {
		shellPath = undefined;
	}
	const local = createLocalBashOperations({ shellPath });
	return {
		operations: {
			exec: (command, cwd, options) =>
				local.exec(
					command.endsWith(typed) ? `${command.slice(0, command.length - typed.length)}${rewritten}` : rewritten,
					cwd,
					options,
				),
		},
	};
}

/** User-visible tiers (display only, never sent to the model): info ◇, needs attention ▲ (warning), failure ✗ (error).
 * `mayFail` sinks also carry the runners' failure notices ("Hook failed to run", "<hook> hook error"). */
export function hookNotice(event: string, message: string, mayFail = false): { text: string; level: "info" | "error" } {
	if (mayFail && /^Hook failed to run: | hook error: /.test(message))
		return { text: `✗ Hook ${event} falhou · ${message}`, level: "error" };
	return { text: `◇ hook ${event} · ${message}`, level: "info" };
}
export const hookAttention = (what: string, detail: string): string => `▲ Hook ${what} · ${detail}`;
export const hookSink =
	(ctx: ExtensionContext, event: string, mayFail = false) =>
	(message: string): void => {
		const notice = hookNotice(event, message, mayFail);
		ctx.ui.notify(notice.text, notice.level);
	};

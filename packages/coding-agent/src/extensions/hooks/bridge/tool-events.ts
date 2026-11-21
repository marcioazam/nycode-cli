/** PreToolUse / PostToolUse / PostToolUseFailure and the direct `!` command bridge. */
import * as os from "node:os";
import type { ExtensionAPI, ExtensionContext, ToolResultEvent } from "../../../core/extensions/types.ts";
import { contentText } from "../../_shared/util/values.ts";
import { claudeToolInput, claudeToolName, claudeToolResponse } from "../claude-tools.ts";
import type { HookCommand, HooksConfig } from "../config.ts";
import {
	blockedToolCall,
	type HookDecision,
	postToolFeedback,
	runPreToolUse,
	surfaceSystemMessages,
} from "../decisions.ts";
import {
	continueFalseReason,
	hookAttention,
	hookSink,
	postToolContent,
	rewrittenUserBash,
	updatedToolOutput,
} from "../lifecycle.ts";
import { matchingCommands, passesIfFilter } from "../matcher.ts";
import type { HookRunner } from "../runners.ts";
import { timeoutMs } from "../runners.ts";

export interface ToolEventDeps {
	getConfig: () => HooksConfig;
	getProjectDir: () => string;
	boundRunner: (ctx: ExtensionContext, extra?: Record<string, unknown>) => HookRunner;
	mcpAliases: ReadonlyMap<string, string>;
}

export function registerToolEvents(nycode: ExtensionAPI, deps: ToolEventDeps): { clearPendingContext: () => void } {
	const { getConfig, getProjectDir, boundRunner, mcpAliases } = deps;
	/** Tool start times per call id, for Claude's duration_ms on PostToolUse: the
	 * clock starts after PreToolUse hooks and any confirm dialog resolve. */
	const toolStartTimes = new Map<string, number>();
	/** PreToolUse additionalContext per tool call, delivered alongside its result. */
	const pendingToolContext = new Map<string, string[]>();
	/** A PreToolUse continue false on a call that still runs: Claude stops the run once the
	 * call's result is in, so the stop waits for this call's tool_result. */
	const pendingStops = new Map<string, string>();
	const stopRun = (ctx: ExtensionContext, reason: string | undefined): void => {
		if (reason === undefined) return;
		ctx.ui.notify(hookAttention("interrompeu a execução", reason), "warning");
		ctx.abort();
	};
	/** Holds a PreToolUse continue false until this call's result is in (see pendingStops). */
	const deferToolStop = (toolCallId: string, decision: HookDecision): void => {
		if (decision.stop) pendingStops.set(toolCallId, decision.stopReason ?? "Stopped by hook");
	};

	nycode.on("tool_call", async (event, ctx) => {
		const anchors = { cwd: ctx.cwd, projectRoot: getProjectDir() || ctx.cwd, home: os.homedir() };
		const decision = await runPreToolUse(
			getConfig(),
			event.toolName,
			event.input,
			boundRunner(ctx, { tool_use_id: event.toolCallId }),
			mcpAliases.get(event.toolName),
			hookSink(ctx, "PreToolUse", true),
			anchors,
		);
		if (!decision.block) {
			// additionalContext is delivered alongside the tool result, so stash it for
			// this call's tool_result to append.
			if (decision.context && decision.context.length > 0)
				pendingToolContext.set(event.toolCallId, decision.context);
			// Claude's duration_ms excludes PreToolUse hook time, so the clock starts here.
			toolStartTimes.set(event.toolCallId, Date.now());
			deferToolStop(event.toolCallId, decision);
			return undefined;
		}
		// Claude's "ask": prompt the user and let the call through if they approve.
		// With no UI (headless) the block stands, which is the safe default.
		if (
			decision.ask &&
			ctx.hasUI &&
			(await ctx.ui.confirm(
				`Allow ${event.toolName}?`,
				decision.reason ?? "A hook asks you to confirm this tool call.",
			))
		) {
			// Claude's duration_ms also excludes time in permission prompts.
			toolStartTimes.set(event.toolCallId, Date.now());
			deferToolStop(event.toolCallId, decision);
			return undefined;
		}
		// Stopping here would abort before pi records the block, and pi then reports
		// "Operation aborted" in place of the reason; tool_execution_end stops the run once
		// the blocked result is in.
		deferToolStop(event.toolCallId, decision);
		// A continue false stop also terminates, or pi starts the next model request before
		// the abort lands. A declined prompt keeps ending the run, with the user there to say
		// what next.
		return blockedToolCall(
			decision.reason,
			decision.stop === true || decision.defer === true || (decision.ask === true && ctx.hasUI),
		);
	});

	// A call these hooks allowed can still be blocked by a later extension (the first block
	// wins), and a blocked call never reaches tool_result. pi emits tool_execution_end for
	// every call, after tool_result for one that ran, so a stop still pending here belongs
	// to a call that never ran.
	nycode.on("tool_execution_end", (event, ctx) => {
		const reason = pendingStops.get(event.toolCallId);
		if (reason === undefined) return;
		pendingStops.delete(event.toolCallId);
		stopRun(ctx, reason);
	});

	/** The PostToolUse or PostToolUseFailure hooks that match this tool result, under
	 * the pi name and its Claude spelling. */
	const postToolCommands = (
		event: ToolResultEvent,
		ctx: ExtensionContext,
		translatedName: string | undefined,
	): HookCommand[] => {
		const names = translatedName ? [event.toolName, translatedName] : [event.toolName];
		const anchors = { cwd: ctx.cwd, projectRoot: getProjectDir() || ctx.cwd, home: os.homedir() };
		const target = { piName: event.toolName, claudeName: translatedName, input: event.input, anchors };
		return matchingCommands(event.isError ? getConfig().PostToolUseFailure : getConfig().PostToolUse, names).filter(
			(command) => passesIfFilter(command, target),
		);
	};
	/** The PostToolUse/PostToolUseFailure payload for one tool result. Reading it consumes
	 * the call's start time. */
	const postToolPayload = (
		event: ToolResultEvent,
		ctx: ExtensionContext,
		eventName: string,
		alias: string | undefined,
		translatedName: string | undefined,
	): Record<string, unknown> => {
		const translatedInput = alias === undefined ? claudeToolInput(event.toolName, event.input, ctx.cwd) : undefined;
		const response = (alias === undefined && !event.isError
			? claudeToolResponse(event.toolName, event.input, contentText(event.content, "\n"), event.isError, ctx.cwd)
			: undefined) ?? { content: event.content, details: event.details, isError: event.isError };
		const startedAt = toolStartTimes.get(event.toolCallId);
		toolStartTimes.delete(event.toolCallId);
		// Claude delivers a failure as top-level fields rather than a tool_response: "error
		// information as top-level fields ... error ... is_interrupt". is_interrupt is false
		// here because pi reports a cancelled tool through the result, not this event.
		const failure = event.isError
			? { error: contentText(event.content, "\n"), is_interrupt: false }
			: { tool_response: response };
		return {
			hook_event_name: eventName,
			tool_name: translatedName ?? event.toolName,
			tool_input: translatedInput ?? event.input,
			...failure,
			...(startedAt === undefined ? {} : { duration_ms: Date.now() - startedAt }),
		};
	};

	// Claude's PostToolUse (success) and PostToolUseFailure (error) both feed their
	// hook's output back next to the tool result: a decision:block reason (or exit-2
	// stderr) and additionalContext are appended, which is where Claude documents they
	// land. The failure branch shows the hook's stderr to the model too ("Shows stderr
	// to Claude; the tool already failed"), it just cannot block a call that failed.
	// Payloads report the Claude vocabulary (names, input shapes, and the documented
	// Bash/Write response shapes; see claude-tools), and a schema-valid
	// updatedToolOutput replaces the output the model sees.
	nycode.on("tool_result", async (event, ctx) => {
		const alias = mcpAliases.get(event.toolName);
		const translatedName = alias ?? claudeToolName(event.toolName);
		const eventName = event.isError ? "PostToolUseFailure" : "PostToolUse";
		// Contexts stashed by this call's PreToolUse hooks land next to the result even
		// when no PostToolUse hook is configured.
		const pending = pendingToolContext.get(event.toolCallId) ?? [];
		pendingToolContext.delete(event.toolCallId);
		const preToolStop = pendingStops.get(event.toolCallId);
		pendingStops.delete(event.toolCallId);
		const commands = postToolCommands(event, ctx, translatedName);
		if (commands.length === 0 && pending.length === 0) {
			stopRun(ctx, preToolStop);
			return;
		}
		const payload = postToolPayload(event, ctx, eventName, alias, translatedName);
		const run = boundRunner(ctx, { tool_use_id: event.toolCallId });
		const results = await Promise.all(commands.map((command) => run(command, payload, timeoutMs(command))));
		surfaceSystemMessages(results, hookSink(ctx, eventName));
		// Claude: continue false applies to PostToolUse too, stopping the run after the call.
		stopRun(ctx, preToolStop ?? continueFalseReason(results));
		// Claude's updatedToolOutput replaces the output the model sees; a value that
		// doesn't match the tool's output schema is ignored, MCP output passes through
		// unvalidated, and a failed call keeps its error output.
		const replacement = event.isError ? undefined : updatedToolOutput(results, event.toolName, alias !== undefined);
		const feedback = [...pending, ...results.flatMap((result) => postToolFeedback(result, eventName, event.isError))];
		return postToolContent(event.content, replacement, feedback);
	});

	// Claude's PreToolUse for Bash, extended to a command the user runs directly with the
	// `!`/`!!` prefix. pi fires user_bash before executing it, and the model never sees it,
	// so without this a guard that blocks `git push -f` from the model would not stop the
	// same command typed by hand. There is no pi tool call, so the matcher sees both pi's
	// "bash" and the Claude name "Bash" (exactly as an MCP alias is bridged) and the payload
	// reports "Bash", the tool_name a Claude-written PreToolUse Bash hook expects. The
	// payload carries no tool_use_id (no model tool call produced it). UserBashEventResult
	// exposes no block flag: a deny is enforced through `result` ("extension handled
	// execution, use this result"), a synthetic failed BashResult that stands in for the
	// command so it never runs and its deny reason shows as the output. The event delivers
	// no execution result and fires only before the command runs, so there is deliberately
	// no PostToolUse for it.
	nycode.on("user_bash", async (event, ctx) => {
		const input: { command?: unknown } = { command: event.command };
		const decision = await runPreToolUse(
			getConfig(),
			"bash",
			input,
			boundRunner(ctx),
			"Bash",
			hookSink(ctx, "PreToolUse", true),
			{ cwd: ctx.cwd, projectRoot: getProjectDir() || ctx.cwd, home: os.homedir() },
		);
		// Claude's "ask": prompt before running and let the command through on approval; with
		// no UI (headless) the block stands, the same safe default as the tool_call path.
		const approved =
			decision.block &&
			decision.ask &&
			ctx.hasUI &&
			(await ctx.ui.confirm("Allow this command?", decision.reason ?? "A hook asks you to confirm this command."));
		if (decision.block && !approved) {
			const reason = decision.reason ?? "Command blocked by hook";
			return { result: { output: `Blocked by hook: ${reason}`, exitCode: 1, cancelled: false, truncated: false } };
		}
		return rewrittenUserBash(event.command, input.command, ctx);
	});

	return { clearPendingContext: () => pendingToolContext.clear() };
}

/** PreCompact / PostCompact (plus SessionStart "compact") and PostModelSwitch. */
import type { ExtensionAPI, ExtensionContext } from "../../../core/extensions/types.ts";
import type { HooksConfig } from "../config.ts";
import { jsonBlockVerdict, promptContext, surfaceSystemMessages, tryParseJson } from "../decisions.ts";
import {
	claudeSpelling,
	hookAttention,
	hookSink,
	MODEL_SELECT_SOURCE,
	PRECOMPACT_TRIGGER,
	runNotifyHooks,
} from "../lifecycle.ts";
import { matchingCommands, passesIfFilter } from "../matcher.ts";
import type { HookRunner } from "../runners.ts";

export interface CompactionEventDeps {
	getConfig: () => HooksConfig;
	boundRunner: (ctx: ExtensionContext) => HookRunner;
	/** Context for the next agent start. */
	queueSessionContext: (items: string[]) => void;
}

export function registerCompactionEvents(nycode: ExtensionAPI, deps: CompactionEventDeps): void {
	const { getConfig, boundRunner, queueSessionContext } = deps;
	nycode.on("session_before_compact", async (event, ctx) => {
		const trigger = claudeSpelling(PRECOMPACT_TRIGGER, event.reason);
		// Claude's custom_instructions: the /compact arguments on a manual run, empty
		// on an automatic one; pi carries them on the event directly.
		const payload = {
			hook_event_name: "PreCompact",
			trigger: trigger.value,
			custom_instructions: event.customInstructions ?? "",
		};
		// Filtered here the way runNotifyHooks filters, so `results[index]` and
		// `commands[index]` name the same hook: indexing the unfiltered list named the
		// wrong command in the notice whenever an `if`-carrying hook preceded the blocker.
		const commands = matchingCommands(getConfig().PreCompact, trigger.names).filter((command) =>
			passesIfFilter(command, undefined),
		);
		const results = await runNotifyHooks(commands, payload, boundRunner(ctx));
		surfaceSystemMessages(results, hookSink(ctx, "PreCompact"));
		// Claude: "Exit with code 2 to block compaction. For a manual /compact, the stderr
		// message is shown to the user. You can also block by returning JSON with
		// `decision: block`." pi cancels through the result, and a blocked automatic
		// compaction is worth a notice too: the context stays full either way.
		for (const [_index, result] of results.entries()) {
			const parsed = tryParseJson(result.stdout);
			const blocked =
				result.code === 2 && !result.timedOut
					? { reason: result.stderr.trim() || "Compaction blocked by hook" }
					: jsonBlockVerdict(parsed, "Compaction blocked by hook");
			if (!blocked) continue;
			ctx.ui.notify(hookAttention("bloqueou a compactação", blocked.reason), "warning");
			return { cancel: true };
		}
	});

	nycode.on("session_compact", async (event, ctx) => {
		const trigger = claudeSpelling(PRECOMPACT_TRIGGER, event.reason);
		// Claude's compact_summary: the summary that replaced the compacted history.
		const summary = (event as { compactionEntry?: { summary?: unknown } }).compactionEntry?.summary;
		const payload = {
			hook_event_name: "PostCompact",
			trigger: trigger.value,
			...(typeof summary === "string" ? { compact_summary: summary } : {}),
		};
		const results = await runNotifyHooks(
			matchingCommands(getConfig().PostCompact, trigger.names),
			payload,
			boundRunner(ctx),
		);
		surfaceSystemMessages(results, hookSink(ctx, "PostCompact"));
		// Claude also fires SessionStart with source "compact" when the session
		// continues after compaction; its stdout context rides the next agent start,
		// the same as any other SessionStart context.
		const sessionStart = matchingCommands(getConfig().SessionStart, "compact");
		if (sessionStart.length > 0) {
			const startResults = await runNotifyHooks(
				sessionStart,
				{ hook_event_name: "SessionStart", source: "compact" },
				boundRunner(ctx),
			);
			surfaceSystemMessages(startResults, hookSink(ctx, "SessionStart"));
			queueSessionContext(startResults.map((result) => promptContext(result.stdout)).filter(Boolean));
		}
	});

	nycode.on("model_select", async (event, ctx) => {
		// Claude's PostModelSwitch: runs after the session's model changes, matched
		// against the model switched to; it can't block. PreModelSwitch stays
		// unbridged: pi's model_select has no veto seam, and a "Pre" hook whose block
		// decision is silently ignored would be worse than an absent event.
		const { model, previousModel, source } = event as {
			model: { id: string };
			previousModel?: { id: string };
			source: string;
		};
		if (!previousModel || previousModel.id === model.id) return;
		const commands = matchingCommands(getConfig().PostModelSwitch, model.id);
		if (commands.length === 0) return;
		// requested_model is null: pi does not carry the alias the request named.
		const payload = {
			hook_event_name: "PostModelSwitch",
			from_model: previousModel.id,
			to_model: model.id,
			requested_model: null,
			source: MODEL_SELECT_SOURCE[source] ?? "command",
		};
		const results = await runNotifyHooks(commands, payload, boundRunner(ctx));
		surfaceSystemMessages(results, hookSink(ctx, "PostModelSwitch"));
		// Claude delivers the hook's stdout (or additionalContext) to Claude with the
		// next request after the switch; pi's seam for that is the next agent start.
		queueSessionContext(results.map((result) => promptContext(result.stdout)).filter(Boolean));
	});
}

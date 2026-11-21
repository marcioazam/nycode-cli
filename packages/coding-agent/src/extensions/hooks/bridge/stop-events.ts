/** Stop / SubagentStop / Notification (idle_prompt) bridge on agent_end. */
import type { ExtensionAPI, ExtensionContext } from "../../../core/extensions/types.ts";
import { runningBackgroundAgents } from "../../_shared/seams/background-agents.ts";
import type { HooksConfig } from "../config.ts";
import { surfaceSystemMessages } from "../decisions.ts";
import {
	endedByInterrupt,
	hookAttention,
	hookSink,
	IDLE_PROMPT_DELAY_MS,
	lastAssistantText,
	runNotifyHooks,
	stopHookBlockCap,
	stopVerdict,
} from "../lifecycle.ts";
import { allCommands, matchingCommands, passesIfFilter } from "../matcher.ts";
import { type HookRunner, timeoutMs } from "../runners.ts";

export interface StopEventDeps {
	getConfig: () => HooksConfig;
	boundRunner: (ctx: ExtensionContext) => HookRunner;
	getAgentIdentity: () => { agent: string; id?: string } | undefined;
	inSubagentChild: () => boolean;
}

export interface StopBridge {
	cancelIdlePrompt: () => void;
	/** Genuine user input breaks a Stop-hook continuation streak. */
	resetBlockCount: () => void;
	/** A new session starts clean. */
	reset: () => void;
}

export function registerStopEvents(nycode: ExtensionAPI, deps: StopEventDeps): StopBridge {
	const { getConfig, boundRunner, getAgentIdentity, inSubagentChild } = deps;
	let stopHookActive = false;
	/** Consecutive Stop-hook blocks with no user progress between them. Reset on user input
	 * and on a non-blocking Stop; at the cap the continuation is suppressed and the turn ends. */
	let stopHookBlockCount = 0;
	/** The pending idle_prompt notification: Claude fires it when the turn ended about
	 * 60 seconds ago and the user hasn't typed since, so it arms on agent_end and is
	 * canceled by input or the next turn. */
	let idlePromptTimer: ReturnType<typeof setTimeout> | undefined;
	const cancelIdlePrompt = (): void => {
		clearTimeout(idlePromptTimer);
		idlePromptTimer = undefined;
	};

	// Claude's Stop hook can prevent stopping: a block feeds its reason back as a new
	// turn, and stop_hook_active in the payload tells the next firing it is already
	// continuing from a stop hook, which is the hook script's documented loop guard.
	// Only exit 2 and decision:"block" continue; continue:false means "stay stopped".
	//
	// On agent_end rather than agent_settled: agent_settled is only emitted after every
	// agent_end handler returns, and a peer extension (plan mode) blocks its agent_end
	// handler on a UI dialog, which would starve the Stop hook and idle notification
	// until the user answers it. agent_end can fire slightly early before a rare
	// automatic retry or compaction; that is the better tradeoff.
	/** Claude's Notification event, for the one type pi can honestly source: the agent
	 * finished and is waiting for input. idle_prompt fires when the turn ended about 60
	 * seconds ago and the user has not typed since, so it arms here and input or the next
	 * turn cancels it. Observational only; exit codes and JSON output are ignored. */
	const armIdlePrompt = (ctx: ExtensionContext): void => {
		cancelIdlePrompt();
		if (inSubagentChild()) return;
		const notifyCommands = matchingCommands(getConfig().Notification, ["idle_prompt"]);
		if (notifyCommands.length > 0) {
			const runner = boundRunner(ctx);
			idlePromptTimer = setTimeout(() => {
				// Claude also holds it while a background agent still runs; that run's completion
				// starts a new turn, whose end arms the notification again.
				if (runningBackgroundAgents() > 0) return;
				void runNotifyHooks(
					notifyCommands,
					{
						hook_event_name: "Notification",
						notification_type: "idle_prompt",
						message: "nycode is waiting for your input",
					},
					runner,
				).catch(() => {});
			}, IDLE_PROMPT_DELAY_MS);
			idlePromptTimer.unref?.();
		}
	};
	/** In a subagent child, the agent-frontmatter Stop hooks were converted to SubagentStop
	 * and fire at the child's own end, notify-style, before the Stop early-returns, which do
	 * not apply to them. Only the agent's own frontmatter hooks (stamped agent:<name>): the
	 * settings-level SubagentStop is fired by the parent when the child completes, so the
	 * child firing it too ran it twice. */
	const fireChildSubagentStop = async (
		event: { messages?: Array<{ role: string; content: unknown }> },
		ctx: ExtensionContext,
	): Promise<void> => {
		const agentIdentity = getAgentIdentity();
		if (!agentIdentity) return;
		const subStop = matchingCommands(getConfig().SubagentStop, agentIdentity.agent).filter((command) =>
			command.origin?.startsWith("agent:"),
		);
		if (subStop.length === 0) return;
		const subText = lastAssistantText(event.messages ?? []);
		const subPayload = {
			hook_event_name: "SubagentStop",
			agent_type: agentIdentity.agent,
			...(agentIdentity.id ? { agent_id: agentIdentity.id } : {}),
			stop_hook_active: false,
			...(subText ? { last_assistant_message: subText } : {}),
		};
		await runNotifyHooks(subStop, subPayload, boundRunner(ctx)).catch(() => {});
	};

	/** Feed a Stop hook's block reason back as a new turn, unless the block cap is reached. */
	const continueFromStopBlock = (ctx: ExtensionContext, reason: string): void => {
		stopHookBlockCount += 1;
		const cap = stopHookBlockCap();
		if (stopHookBlockCount >= cap) {
			// Claude overrides a Stop hook that has blocked cap times in a row with no user
			// progress: suppress the continuation, warn, and let the turn end so the loop cannot
			// run forever. Reset the count so a later run (or user turn) starts clean.
			stopHookActive = false;
			stopHookBlockCount = 0;
			ctx.ui.notify(hookAttention(`Stop bloqueou ${cap} vezes seguidas`, "encerrando o turno"), "warning");
			return;
		}
		stopHookActive = true;
		nycode.sendMessage({ customType: "claude-stop-hook", content: reason, display: true }, { triggerTurn: true });
	};

	nycode.on("agent_end", async (event, ctx) => {
		armIdlePrompt(ctx);
		await fireChildSubagentStop(event as { messages?: Array<{ role: string; content: unknown }> }, ctx);

		// Stop is the main agent's event; the child's completion was handled above.
		if (inSubagentChild()) return;
		// Stop has no matcher support (a stray matcher is ignored, as Claude documents)
		// and an `if`-carrying hook never runs on a non-tool event.
		const commands = allCommands(getConfig().Stop).filter((command) => passesIfFilter(command, undefined));
		if (commands.length === 0) {
			stopHookActive = false;
			return;
		}
		// Claude: Stop does not run when the stoppage was a user interrupt.
		if (endedByInterrupt(event as { messages?: Array<{ role: string; stopReason?: string }> })) {
			stopHookActive = false;
			return;
		}
		// Claude's Stop payload carries the turn's final assistant text so a hook need
		// not re-read the transcript; included only when there is one.
		const lastText = lastAssistantText(
			(event as { messages?: Array<{ role: string; content: unknown }> }).messages ?? [],
		);
		const payload = {
			hook_event_name: "Stop",
			stop_hook_active: stopHookActive,
			...(lastText ? { last_assistant_message: lastText } : {}),
		};
		const run = boundRunner(ctx);
		const results = await Promise.all(commands.map((command) => run(command, payload, timeoutMs(command))));
		surfaceSystemMessages(results, hookSink(ctx, "Stop"));
		const stopMessages: string[] = [];
		const verdicts = results.filter((result) => !result.timedOut).map((result) => stopVerdict(result, stopMessages));
		const block = verdicts.some((verdict) => verdict.stop) ? undefined : verdicts.find((verdict) => verdict.block);
		for (const message of stopMessages) ctx.ui.notify(hookAttention("Stop interrompeu o turno", message), "warning");
		if (!block) {
			// A non-blocking Stop breaks the streak: the next block starts a fresh count.
			stopHookActive = false;
			stopHookBlockCount = 0;
			return;
		}
		continueFromStopBlock(ctx, block.reason);
	});

	return {
		cancelIdlePrompt,
		resetBlockCount: () => {
			stopHookBlockCount = 0;
		},
		reset: () => {
			stopHookActive = false;
			stopHookBlockCount = 0;
		},
	};
}

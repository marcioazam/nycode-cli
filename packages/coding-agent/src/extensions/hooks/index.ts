/**
 * Claude Hooks Extension
 *
 * Runs Claude Code's `.claude/settings.json` hooks on pi's lifecycle events, so
 * a project's existing hooks work under pi:
 * - PreToolUse      -> pi `tool_call` (can block the tool or rewrite its input), plus
 *                      pi `user_bash` for a `!`/`!!` command the user runs directly (the
 *                      model never issues these, so a deny-list guard would otherwise miss
 *                      them). No pi tool call exists there, so the payload reports the
 *                      Claude name "Bash"; a deny hands pi a synthetic failed result so
 *                      the command never runs. UserBashEvent carries no execution result
 *                      and fires only before the command runs, so it has no PostToolUse
 *                      counterpart (pi never delivers the output to observe).
 * - PostToolUse     -> pi `tool_result` (block reasons and additionalContext are
 *                      appended next to the tool result, as Claude documents)
 * - SessionStart    -> pi `session_start` (stdout/additionalContext is injected as
 *                      context before the first prompt via `before_agent_start`)
 * - UserPromptSubmit-> pi `input` (can block the prompt via `handled`, or inject
 *                      additional context by transforming the submitted text)
 * - Stop            -> pi `agent_end` (a block feeds its reason back as a new turn,
 *                      with stop_hook_active as the loop guard)
 * - PreCompact      -> pi `session_before_compact` (fire-and-forget)
 * - PostCompact     -> pi `session_compact` (fire-and-forget); the same event also
 *                      fires SessionStart with source "compact", as Claude does
 *                      when a session continues after compaction
 * - PostModelSwitch -> pi `model_select` (after the change, matched against the new
 *                      model id; stdout context rides the next agent start;
 *                      PreModelSwitch stays unbridged, pi has no veto seam)
 * - PostToolUseFailure -> pi `tool_result` error branch (stderr/additionalContext
 *                      appended to the failed result; it cannot block, the tool failed)
 * - SessionEnd      -> pi `session_shutdown` (fire-and-forget)
 * - InstructionsLoaded -> bridged from the shared instruction-events bus:
 *                      context-imports publishes session_start for the context
 *                      files that survived claudeMdExcludes (it owns exclusion,
 *                      so a file it removed from the prompt never announces)
 *                      and include for resolved @imports; claude-rules publishes
 *                      path_glob_match. Strictly observational: exit codes and
 *                      JSON output, systemMessage included, are ignored.
 *
 * Every payload carries session_id, transcript_path (pi's session file), cwd,
 * permission_mode (plan-mode state off the shared bus) and effort; tool events add
 * tool_use_id. The universal `systemMessage` output (a user-facing warning) is
 * honored on the decision-bearing events; the observational paths (Notification,
 * InstructionsLoaded) ignore it, as Claude documents for them.
 * `suppressOutput` is accepted and inert: pi never echoes hook stdout to the
 * transcript in the first place.
 * Payloads speak Claude's vocabulary for pi's built-in tools: tool_name Bash/Edit/
 * Write/Read/Grep/Glob, the documented tool_input shapes with absolute file_path,
 * and the documented Bash/Write tool_response shapes, with `updatedInput`
 * translated back to pi's shape (see claude-tools; an incomplete rewrite keeps
 * the original input). PreToolUse `additionalContext` lands next to the tool
 * result; `updatedToolOutput` replaces the output the model sees (schema-checked
 * for built-ins, unvalidated for MCP); `permissionDecision: "defer"` blocks the
 * call, since pi cannot resume a deferred one. The `if` permission-rule filter is
 * honored on tool events, and a hook carrying it never runs elsewhere; Stop and
 * UserPromptSubmit ignore a stray matcher, and a Stop hook's `additionalContext`
 * continues the conversation under the same block cap.
 * `async`/`asyncRewake` (command hooks only, as Claude documents) run in the
 * background on every event: they never block or delay the event that fired them
 * and render no decision. An asyncRewake hook exiting 2 wakes the model with its
 * stderr (stdout when stderr is empty) as a new turn; any other background
 * completion delivers the JSON response's systemMessage/additionalContext to the
 * model on the next turn, shown to nobody else. No timeout is enforced on `async`
 * (asyncRewake keeps its own), and hooks still running when a headless run ends are
 * killed, as Claude does with -p; an interactive session leaves them to finish.
 *
 * SubagentStart runs through the pre-spawn seam (internal/subagent-hooks) so its
 * additionalContext reaches the child before its first prompt; it cannot block a
 * spawn, as Claude documents. SubagentStop rides the subagent extension's bus stop
 * event (notify-style: the child has already exited, so exit-2 block semantics
 * cannot be honored) and carries last_assistant_message. Inside a subagent child,
 * agent-frontmatter hooks arrive via NYCODE_AGENT_HOOKS (Stop pre-converted to
 * SubagentStop, fired at the child's own agent end) and die with the process.
 *
 * Hook commands run through the platform shell (`sh -c`; on Windows Git Bash, or
 * PowerShell when Git Bash is absent, see internal/shell-resolve) with the event JSON
 * on stdin. A PreToolUse
 * hook blocks the tool by exiting 2 (stderr becomes the reason) or by printing
 * `{"hookSpecificOutput": {"permissionDecision": "deny", ...}}` (or the older
 * `{"decision": "block"}`).
 *
 * Config is merged from managed policy settings, ~/.claude/settings.json (always),
 * the project's .claude/settings.json and settings.local.json (only when the
 * project is trusted, since hooks execute arbitrary shell), plugins, and invoked
 * skills' frontmatter. Claude's `disableAllHooks` is tiered: at the managed level
 * it turns everything off; in any honored settings file it disables the
 * non-managed hooks while managed policy hooks keep running. /hooks prints the
 * resolved chain per event with each entry's source. Matchers follow Claude's rule:
 * `*`/empty match all, plain names are exact (with `|`/`,` list separators), and
 * anything with other regex characters is an unanchored regex. Claude matchers
 * are PascalCase (`Bash`); pi tool names are lowercase (`bash`), so comparison
 * is case-insensitive and folds `-` to `_`.
 *
 * Docs: https://code.claude.com/docs/en/hooks.md
 */

import * as os from "node:os";
import type { ExtensionAPI, ExtensionContext } from "../../core/extensions/types.ts";
import { INSTRUCTIONS_CHANNEL, isInstructionLoadEvent } from "../_shared/events/instruction-events.ts";
import { isMcpToolAliases, MCP_TOOLS_CHANNEL } from "../_shared/events/mcp-alias.ts";
import { isPlanModeState, PLAN_MODE_CHANNEL } from "../_shared/events/plan-mode-state.ts";
import { isSkillHooksEvent, SKILL_HOOKS_CHANNEL } from "../_shared/events/skill-hooks.ts";
import { isSubagentPhaseEvent, SUBAGENT_CHANNEL } from "../_shared/events/subagent-events.ts";
import { setSubagentStartHookRunner } from "../_shared/events/subagent-hooks.ts";
import { claudeEffortLevel } from "../_shared/model/effort.ts";
import { resolveModelOverride } from "../_shared/model/model-lookup.ts";
import { approvalRecheck, isProjectApproved } from "../_shared/project/project-approval.ts";
import { checkoutRoot } from "../_shared/project/project-root.ts";
import { readManagedSettings } from "../_shared/settings/managed-settings.ts";
import { installedPlugins, managedForceEnabled } from "../_shared/settings/plugins.ts";
import { watchSettingsFiles } from "../_shared/settings/settings-watch.ts";
import { registerCompactionEvents } from "./bridge/compaction-events.ts";
import { registerStopEvents } from "./bridge/stop-events.ts";
import { registerToolEvents } from "./bridge/tool-events.ts";
import {
	formatHooksSummary,
	type HookCommand,
	type HookMatcher,
	type HooksConfig,
	hookFiles,
	isBackgroundHook,
	loadHooks,
	loadManagedHooks,
	loadPluginHooks,
	mergeAgentEnvHooks,
	mergeSkillHooks,
	readAllowedHttpHookUrls,
	readDisableAllHooks,
	readSettingsDisableAllHooks,
} from "./config.ts";
import { promptContext, runUserPromptSubmit, surfaceSystemMessages, tryParseJson } from "./decisions.ts";
import {
	claudeSpelling,
	hookAttention,
	hookSink,
	runNotifyHooks,
	SESSION_END_REASON,
	SESSION_START_SOURCE,
} from "./lifecycle.ts";
import { matchingCommands, passesIfFilter } from "./matcher.ts";
import {
	type HookRunner,
	type HookRunResult,
	runAgentHook,
	runHookCommand,
	runHttpHook,
	runMcpToolHook,
	runPromptHook,
	sessionEndTimeoutMs,
	timeoutMs,
} from "./runners.ts";

export * from "./config.ts";
export * from "./decisions.ts";
export { hookAttention, hookNotice, lastAssistantText, stopHookBlockCap } from "./lifecycle.ts";
export * from "./matcher.ts";
export * from "./runners.ts";

export default function hooksExtension(nycode: ExtensionAPI) {
	let config: HooksConfig = {};
	let projectDir = "";
	/** Claude's allowedHttpHookUrls allowlist, resolved from the settings chain. */
	let allowedHttpHookUrls: string[] | undefined;
	let pendingSessionContext: string[] = [];
	let sessionCtx: ExtensionContext | undefined;
	/** Set inside a subagent child that carries agent-frontmatter hooks: the child's
	 * own agent end fires their SubagentStop, per Claude's Stop conversion. */
	let agentIdentity: { agent: string; id?: string } | undefined;
	/** Claude's allowManagedHooksOnly: only the managed hook set runs. */
	let managedHooksOnly = false;
	/** Skill hooks registered this session, re-applied when a settings edit reloads. */
	const registeredSkillHooks: Array<{ skillName: string; hooks: Record<string, unknown> }> = [];
	/** Skill once-hooks spent this session, by origin and command. A settings reload rebuilds
	 * the config and re-merges the skill hooks from their declarations, so the spent mark on
	 * the parsed hook does not survive it; this does. */
	const spentOnce = new Set<string>();
	const onceKey = (hook: HookCommand): string => hook.declarationKey ?? `${hook.origin ?? ""}\0${hook.command ?? ""}`;
	/** Whether this process is a subagent's child. Claude runs settings hooks inside a
	 * subagent for tool events, but Stop is the main agent's, a subagent completes with
	 * SubagentStop, and a subagent run is neither a session (SessionStart, SessionEnd) nor
	 * a prompt the user submitted (UserPromptSubmit). The child is a full pi process loading
	 * the same settings, so without this every one of them fired in it. */
	const inSubagentChild = (): boolean => process.env.NYCODE_SUBAGENT === "1";
	/** Stops the settings watcher of the previous session. */
	let disposeSettingsWatch: () => void = () => {};
	/** Claude's disableAllHooks escape hatch was set somewhere in the honored chain. */
	let hooksDisabled = false;
	/** Which settings file each resolved entry came from, for the /hooks viewer. */
	const hookSources = new Map<HookMatcher, string>();
	/** Claude sends session_id, transcript_path, cwd and effort on every payload. */
	const commonPayload = (ctx: ExtensionContext): Record<string, unknown> => {
		const common: Record<string, unknown> = {
			session_id: ctx.sessionManager.getSessionId(),
			cwd: ctx.cwd,
			permission_mode: permissionMode,
		};
		const transcript = ctx.sessionManager.getSessionFile();
		if (transcript) common.transcript_path = transcript;
		// Claude vocabulary only: pi's minimal maps to low and off carries no effort.
		const effort = claudeEffortLevel(ctx.thinkingLevel);
		if (effort) common.effort = { level: effort };
		return common;
	};
	/** Claude's prompt-hook `model` override, resolved against the models this user
	 * can run (exact id first, then a substring match); the session model otherwise. */
	const resolveHookModel = (ctx: ExtensionContext, override: string | undefined): ExtensionContext["model"] =>
		resolveModelOverride(ctx, override);

	/** Kills for background hooks still running; Claude kills async hooks at teardown,
	 * so session_shutdown reaps anything left rather than let a hung hook pin the
	 * event loop past a one-shot run's end. */
	const backgroundKills = new Set<() => void>();
	/** Claude's background delivery: an asyncRewake exit 2 wakes the model with the
	 * hook's stderr (stdout when stderr is empty) as a new turn; any other completion
	 * feeds the JSON response's systemMessage/additionalContext to the model on the
	 * next turn, shown to nobody else. A timeout kill discards the output, like a
	 * canceled synchronous hook; it resolves with code 124, so it never reads as a wake. */
	const deliverBackgroundResult = (hook: HookCommand, result: HookRunResult): void => {
		if (result.timedOut) return;
		if (hook.asyncRewake === true && result.code === 2) {
			const detail = result.stderr.trim() || result.stdout.trim();
			const content = detail
				? `Async hook requested attention (exit 2):\n${detail}`
				: "Async hook requested attention (exit 2)";
			nycode.sendMessage({ customType: "claude-async-hook", content, display: true }, { triggerTurn: true });
			return;
		}
		const parsed = tryParseJson(result.stdout);
		// The typeof guard doubles as Claude's schema validation: a wrong-typed field is
		// dropped rather than delivered.
		const parts = [parsed?.systemMessage, parsed?.hookSpecificOutput?.additionalContext].filter(
			(part): part is string => typeof part === "string" && part.length > 0,
		);
		if (parts.length === 0) return;
		nycode.sendMessage(
			{ customType: "claude-async-hook", content: parts.join("\n"), display: false },
			{ deliverAs: "nextTurn" },
		);
	};
	/** Run one hook entry with its merged payload, by the entry's type. */
	const dispatchHook = (
		ctx: ExtensionContext,
		hook: HookCommand,
		merged: Record<string, unknown>,
		ms: number,
		onChild?: (kill: () => void) => void,
	): Promise<HookRunResult> => {
		if (hook.type === "http") return runHttpHook(hook, merged, ms, allowedHttpHookUrls);
		if (hook.type === "prompt")
			return runPromptHook(hook, merged, resolveHookModel(ctx, hook.model), ms, ctx.modelRegistry);
		if (hook.type === "agent") return runAgentHook(hook, merged, ms, (ctx.model as { id?: string } | undefined)?.id);
		if (hook.type === "mcp_tool") return runMcpToolHook(hook, merged, ms);
		return runHookCommand(hook.command, merged, ms, {
			projectDir,
			args: hook.args,
			onChild,
			shell: hook.shell,
			plugin:
				hook.pluginRoot !== undefined && hook.pluginDataDir !== undefined
					? { root: hook.pluginRoot, dataDir: hook.pluginDataDir }
					: undefined,
			sessionId: merged.session_id as string | undefined,
		});
	};
	/** A runner bound to the firing context, filling the common fields into each
	 * payload and dispatching on the entry's type. A background hook (see
	 * isBackgroundHook) is fired and the caller immediately gets a no-verdict result,
	 * so it can neither block nor delay the event that fired it; its completion is
	 * delivered by deliverBackgroundResult whenever it lands. */
	const boundRunner =
		(ctx: ExtensionContext, extra?: Record<string, unknown>): HookRunner =>
		(hook, payload, ms) => {
			const merged = { ...commonPayload(ctx), ...extra, ...(payload as Record<string, unknown>) };
			const dispatch = (onChild?: (kill: () => void) => void): Promise<HookRunResult> =>
				dispatchHook(ctx, hook, merged, ms, onChild);
			// Claude's `once` (skill-frontmatter hooks only): removed after the first
			// successful run; a failure, block, or timeout leaves it in place.
			const markOnce = async (run: Promise<HookRunResult>): Promise<HookRunResult> => {
				const result = await run;
				if (
					hook.once === true &&
					hook.origin?.startsWith("skill:") === true &&
					result.code === 0 &&
					!result.timedOut
				) {
					hook.spent = true;
					spentOnce.add(onceKey(hook));
				}
				return result;
			};
			if (!isBackgroundHook(hook)) return markOnce(dispatch());
			let kill: (() => void) | undefined;
			void dispatch((registered) => {
				kill = registered;
				backgroundKills.add(registered);
			})
				.then((result) => deliverBackgroundResult(hook, result))
				.catch(() => {
					// The hook may outlive the session (/new, shutdown): sendMessage asserts
					// liveness, and nothing awaits this chain, so a throw would otherwise
					// escape as an unhandled rejection.
				})
				.finally(() => {
					if (kill) backgroundKills.delete(kill);
				});
			return Promise.resolve({ code: 0, stdout: "", stderr: "", timedOut: false });
		};
	// Hooks a skill's frontmatter declares arrive over the shared bus when the skill
	// is invoked (see skills.ts) and stay registered for the rest of the session, as
	// Claude documents; a session restart reloads config and drops them.
	nycode.events.on(SKILL_HOOKS_CHANNEL, (data) => {
		if (!isSkillHooksEvent(data)) return;
		// Blocked under the escape hatch and under allowManagedHooksOnly, which
		// covers every non-managed hook source.
		if (hooksDisabled || managedHooksOnly) return;
		registeredSkillHooks.push({ skillName: data.skillName, hooks: data.hooks });
		mergeSkillHooks(config, data.skillName, data.hooks, hookSources);
	});

	// Claude matchers name MCP tools mcp__<server>__<tool>; nycode registers them as
	// <server>_<tool>. The mcp extension publishes the mapping on pi's shared bus.
	const mcpAliases = new Map<string, string>();
	nycode.events.on(MCP_TOOLS_CHANNEL, (data) => {
		if (!isMcpToolAliases(data)) return;
		mcpAliases.clear();
		for (const entry of data) mcpAliases.set(entry.pi, entry.claude);
	});

	const toolEvents = registerToolEvents(nycode, {
		getConfig: () => config,
		getProjectDir: () => projectDir,
		boundRunner,
		mcpAliases,
	});
	const stopEvents = registerStopEvents(nycode, {
		getConfig: () => config,
		boundRunner,
		getAgentIdentity: () => agentIdentity,
		inSubagentChild,
	});
	const { cancelIdlePrompt } = stopEvents;
	registerCompactionEvents(nycode, {
		getConfig: () => config,
		boundRunner,
		queueSessionContext: (items) => {
			pendingSessionContext.push(...items);
		},
	});
	// Claude's permission_mode: pi has no permission system, but nycode's plan mode is
	// the documented "plan" mode; its extension publishes the state on the shared bus.
	let permissionMode = "default";
	nycode.events.on(PLAN_MODE_CHANNEL, (data) => {
		if (isPlanModeState(data)) permissionMode = data.active ? "plan" : "default";
	});
	// Claude's InstructionsLoaded hook has NO decision control: exit codes are
	// ignored and every JSON output field (systemMessage included) is discarded, so
	// dispatch is fire-and-forget on all paths. `nested_traversal` arrives from
	// context-imports when a CLAUDE.md below cwd is attached on a file touch. The
	// `compact` reason can never fire honestly and is a deliberate gap, not an
	// approximation: pi does not re-load instruction files after compaction.
	const fireInstructionsLoaded = (payload: Record<string, unknown>): void => {
		if (!sessionCtx) return;
		const commands = matchingCommands(config.InstructionsLoaded, String(payload.load_reason));
		if (commands.length === 0) return;
		void runNotifyHooks(
			commands,
			{ hook_event_name: "InstructionsLoaded", ...payload },
			boundRunner(sessionCtx),
		).catch(() => {});
	};
	// Every load rides the shared bus: context-imports publishes session_start for
	// the context files that survived claudeMdExcludes and include for resolved
	// @imports (deduped there, once per file per session); claude-rules publishes
	// path_glob_match when a scoped rule attaches. Consuming the bus rather than
	// iterating raw contextFiles keeps this extension from announcing a file the
	// exclusion removed from the prompt; bus emit is synchronous, so the events
	// arrive regardless of extension load order.
	nycode.events.on(INSTRUCTIONS_CHANNEL, (data) => {
		if (!isInstructionLoadEvent(data)) return;
		fireInstructionsLoaded({ ...data });
	});

	// Subagent lifecycle arrives over the bus without a pi context; the session context
	// captured at session_start supplies the common payload fields.
	nycode.events.on(SUBAGENT_CHANNEL, async (data) => {
		// SubagentStart runs through the pre-spawn seam below (so its context can
		// reach the child before its first prompt); the bus start event would
		// double-run it, so only the stop phase is handled here.
		if (!isSubagentPhaseEvent(data) || data.phase !== "stop" || !sessionCtx) return;
		const ctx = sessionCtx;
		// Claude's SubagentStop carries the subagent's final text; agent_transcript_path
		// stays absent (a --no-session child writes no transcript, see docs/hooks.md).
		const payload = {
			hook_event_name: "SubagentStop",
			agent_type: data.agentType,
			agent_id: data.agentId,
			...(data.lastAssistantMessage !== undefined ? { last_assistant_message: data.lastAssistantMessage } : {}),
		};
		try {
			const results = await runNotifyHooks(
				matchingCommands(config.SubagentStop, data.agentType),
				payload,
				boundRunner(ctx),
			);
			surfaceSystemMessages(results, hookSink(ctx, "SubagentStop"));
			// The child has finished, so a continue false has nothing left to stop; its
			// stopReason is still the message Claude shows the user.
			for (const result of results) {
				const parsed = tryParseJson(result.stdout);
				if (parsed?.continue === false && parsed.stopReason)
					ctx.ui.notify(hookAttention("SubagentStop interrompeu", String(parsed.stopReason)), "warning");
			}
		} catch {
			// The bus outlives the session: an event landing between /new disposing this
			// ctx and the next session_start hits disposed getters, and nothing awaits a
			// bus listener, so a throw here would escape as an unhandled rejection.
		}
	});

	// Claude's SubagentStart hooks inject additionalContext into the subagent before
	// its first prompt, so they must run before the spawn: the subagent extension
	// calls this seam pre-spawn and prepends the returned context to the child's task.
	setSubagentStartHookRunner(async (agentType, agentId) => {
		if (!sessionCtx) return [];
		const ctx = sessionCtx;
		const commands = matchingCommands(config.SubagentStart, agentType);
		if (commands.length === 0) return [];
		const results = await runNotifyHooks(
			commands,
			{ hook_event_name: "SubagentStart", agent_type: agentType, agent_id: agentId },
			boundRunner(ctx),
		);
		surfaceSystemMessages(results, hookSink(ctx, "SubagentStart"));
		return results.map((result) => promptContext(result.stdout)).filter(Boolean);
	});

	/** Resolve the whole hook configuration from disk. Runs at session start and
	 * again when the settings watcher sees an edit, so mid-session changes to
	 * hooks, disableAllHooks, or allowedHttpHookUrls apply without a restart. */
	function resolveConfig(cwd: string, trusted: boolean): void {
		const files = hookFiles(cwd, os.homedir(), trusted);
		hookSources.clear();
		allowedHttpHookUrls = readAllowedHttpHookUrls(files);
		// The disableAllHooks escape hatch, checked before any config loads. The tiers
		// differ, as Claude documents: managed-level disableAllHooks turns everything
		// off, while a settings-level one cannot disable the hooks an administrator
		// configured through managed policy settings.
		const managedSettings = readManagedSettings();
		hooksDisabled = readDisableAllHooks(files, managedSettings);
		if (managedSettings.disableAllHooks === true) {
			config = {};
			return;
		}
		config = loadManagedHooks(hookSources, managedSettings);
		// Claude's allowManagedHooksOnly: user, project, local, plugin, and skill
		// hooks are blocked; only the managed set runs.
		managedHooksOnly = managedSettings.allowManagedHooksOnly === true;
		// The escape hatch is checked FIRST, and deliberately: a settings-level
		// disableAllHooks turns off every non-managed hook, and a plugin's hooks are
		// non-managed however the plugin came to be enabled. Only the managed policy hooks
		// loaded above survive it. Putting the force-enable exemption ahead of this let an
		// administrator's enabledPlugins entry defeat the user's own escape hatch.
		if (readSettingsDisableAllHooks(files)) return;
		if (managedHooksOnly) {
			// Claude: "Hooks from plugins force-enabled in managed settings `enabledPlugins`
			// are exempt." That exemption is from allowManagedHooksOnly, not from the hatch.
			loadPluginHooks(config, managedForceEnabled(installedPlugins(os.homedir())), hookSources);
			return;
		}
		mergeNonManagedHooks(files);
	}

	/** Merge the non-managed hook sources into the managed config resolveConfig loaded:
	 * settings files, plugins, a subagent child's agent hooks, and this session's skill hooks. */
	function mergeNonManagedHooks(files: string[]): void {
		for (const [eventName, matchers] of Object.entries(loadHooks(files, hookSources)))
			config[eventName] = [...(config[eventName] ?? []), ...matchers];
		// Plugins are user-installed and enabled by user settings (see installedPlugins),
		// so a checked-out repo cannot toggle which code-bearing plugin hooks run.
		loadPluginHooks(config, installedPlugins(os.homedir()), hookSources);
		// Inside a subagent child, the parent passes the agent's frontmatter hooks via
		// env (Stop already converted to SubagentStop, per Claude); they run only for
		// this child process.
		agentIdentity = mergeAgentEnvHooks(config, hookSources);
		// A reload must not drop the skill hooks the session already registered, nor revive
		// the once-hooks among them that already ran.
		for (const skill of registeredSkillHooks) mergeSkillHooks(config, skill.skillName, skill.hooks, hookSources);
		for (const hook of Object.values(config).flatMap((matchers) =>
			matchers.flatMap((matcher) => matcher.hooks ?? []),
		)) {
			if (hook.once === true && spentOnce.has(onceKey(hook))) hook.spent = true;
		}
	}

	nycode.on("session_start", async (event, ctx) => {
		sessionCtx = ctx;
		// pi's CLI builds a fresh extension instance per session replacement; only RPC mode can
		// reuse one across sessions. A mid-turn /new there fires session_start on
		// the same instance while a Stop-hook continuation streak is in flight; it must not
		// carry into the next session, so reset before any early return (disableAllHooks below).
		stopEvents.reset();
		toolEvents.clearPendingContext();
		registeredSkillHooks.length = 0;
		spentOnce.clear();
		const trusted = await isProjectApproved(ctx);
		// Claude's CLAUDE_PROJECT_DIR is the project root, not the session cwd; a hook
		// referencing $CLAUDE_PROJECT_DIR/.claude/hooks/helper.sh must resolve from a
		// subdirectory session too.
		projectDir = checkoutRoot(ctx.cwd);
		resolveConfig(ctx.cwd, trusted);
		// Claude picks up direct settings edits mid-session via a file watcher. The reload
		// closes over the cwd value, never ctx: the poll has no awaiter, and every getter of
		// a replaced session's ctx throws, which would exit pi as an uncaughtException.
		const watchCwd = ctx.cwd;
		// The reload asks again rather than reusing `trusted`: see approvalRecheck.
		const stillApproved = approvalRecheck(ctx);
		disposeSettingsWatch();
		disposeSettingsWatch = watchSettingsFiles(hookFiles(watchCwd, os.homedir(), trusted), () =>
			resolveConfig(watchCwd, trusted && stillApproved()),
		);
		// A disabled or managed-only resolution leaves config empty (or managed-only),
		// so the SessionStart run below fires exactly what remains active.
		pendingSessionContext = [];
		// "reload" re-fires in-process with the same conversation and would double-run hooks;
		// a fork is a genuine session begin, which Claude reports as source "fork".
		if (event.reason === "reload" || inSubagentChild()) return;
		const source = claudeSpelling(SESSION_START_SOURCE, event.reason);
		const commands = matchingCommands(config.SessionStart, source.names);
		const payload = { hook_event_name: "SessionStart", source: source.value };
		const run = boundRunner(ctx);
		const results = await Promise.all(commands.map((command) => run(command, payload, timeoutMs(command))));
		surfaceSystemMessages(results, hookSink(ctx, "SessionStart"));
		pendingSessionContext = results.map((result) => promptContext(result.stdout)).filter(Boolean);
	});

	// Claude adds a SessionStart hook's additionalContext (or plain stdout) to the
	// conversation before the first prompt; pi's seam for that is a message injected
	// on the next agent start. The session_start InstructionsLoaded events arrive
	// over the bus from context-imports, which owns claudeMdExcludes; announcing
	// the raw contextFiles here would fire for a file the exclusion removed.
	nycode.on("before_agent_start", () => {
		// A new turn is beginning, so the session is no longer idle.
		cancelIdlePrompt();
		if (pendingSessionContext.length === 0) return;
		const content = pendingSessionContext.join("\n");
		pendingSessionContext = [];
		return { message: { customType: "claude-hook-context", content, display: false } };
	});

	nycode.on("input", async (event, ctx) => {
		// Only genuine user input; extension-injected messages (plan-mode, subagent) are not
		// prompts the user submitted.
		if (event.source === "extension" || inSubagentChild()) return { action: "continue" };
		// The user typed, so the pending idle_prompt no longer applies.
		cancelIdlePrompt();
		// Genuine user input is progress, so it breaks a Stop-hook continuation streak: the
		// block cap counts only consecutive blocks with nothing from the user in between.
		stopEvents.resetBlockCount();
		const decision = await runUserPromptSubmit(
			config,
			event.text,
			boundRunner(ctx),
			hookSink(ctx, "UserPromptSubmit", true),
		);
		if (decision.block) {
			// pi's input result has no reason channel, so surface why before consuming it.
			ctx.ui.notify(
				hookAttention("UserPromptSubmit bloqueou", decision.reason ?? "Prompt blocked by hook"),
				"warning",
			);
			return { action: "handled" };
		}
		// "UserPromptSubmit: can't replace the prompt; it only injects additionalContext
		// alongside it", as a system reminder with no visible transcript entry. So the context
		// is a hidden message next to the prompt and the prompt text is left alone: prepended,
		// it moved a `/skill:` or `/template` invocation off position 0 and pi stopped
		// expanding it. pi appends a "nextTurn" message to this very prompt (after this handler
		// runs); one typed mid-stream never reaches before_agent_start, so it is queued in the
		// prompt's own mode. suppressOriginalPrompt scopes to the block message, which never
		// carries the prompt here, so it needs nothing of its own.
		if (decision.context)
			nycode.sendMessage(
				{ customType: "claude-hook-context", content: decision.context, display: false },
				{ deliverAs: event.streamingBehavior ?? "nextTurn" },
			);
		return { action: "continue" };
	});

	nycode.on("session_shutdown", async (event, ctx) => {
		// pi's CLI loads a fresh extension instance for every session replacement, so no later
		// session_start reaches this watcher: left armed, it polls for the life of the process.
		disposeSettingsWatch();
		disposeSettingsWatch = () => {};
		// /new, /resume and /fork emit no input event, so the ending session's pending
		// idle_prompt would otherwise fire against a disposed context.
		cancelIdlePrompt();
		const reason = claudeSpelling(SESSION_END_REASON, event.reason);
		// SessionEnd rides Claude's short shared budget (see sessionEndTimeoutMs) so a
		// slow hook cannot stall session exit, /new or /resume.
		const sessionEndCommands = inSubagentChild()
			? []
			: matchingCommands(config.SessionEnd, reason.names).filter((command) => passesIfFilter(command, undefined));
		const runner = boundRunner(ctx);
		const results = await Promise.all(
			sessionEndCommands.map((command) =>
				runner(command, { hook_event_name: "SessionEnd", reason: reason.value }, sessionEndTimeoutMs(command)),
			),
		);
		surfaceSystemMessages(results, hookSink(ctx, "SessionEnd"));
		// Claude: "In non-interactive mode with the -p flag, Claude Code kills any async hook
		// still running at teardown". Only there: an interactive session leaves them running, so
		// an async SessionEnd hook, started by this very shutdown, can finish instead of being
		// killed a microtask after it spawned. Their delivery targets a disposed context and is
		// caught (see deliverBackgroundResult).
		if (ctx.hasUI !== true) for (const kill of backgroundKills) kill();
		backgroundKills.clear();
	});

	// Claude's /hooks manages hook configuration; nycode's is a viewer: hook failures
	// are otherwise opaque, so showing the resolved chain per event, with the settings
	// file each entry came from, is the debugging surface.
	nycode.registerCommand("hooks", {
		description: "Show the hook configuration resolved from settings",
		handler: async (
			_args,
			ctx,
		) => /* NOSONAR typescript:S7503 - pi types a command handler as returning Promise<void> */ {
			// With a settings-level disable, managed policy hooks stay active and the
			// viewer still shows them; only a fully empty config reports disabled.
			if (hooksDisabled && Object.keys(config).length === 0) {
				ctx.ui.notify("All hooks are disabled by the disableAllHooks setting.", "info");
				return;
			}
			ctx.ui.notify(formatHooksSummary(config, hookSources), "info");
		},
	});
}

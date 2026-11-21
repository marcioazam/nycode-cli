/**
 * Claude Commands Extension
 *
 * Registers Claude Code's custom slash commands with pi directly, rather than
 * handing `.claude/commands` to pi's prompt-template loader. Owning registration
 * is what makes the rest of Claude's command contract reachable: `$ARGUMENTS` and
 * positional substitution, `` !`cmd` `` bash output, `@file` inlining, subdirectory
 * commands (named by file name alone, as Claude documents; subdirectories only
 * organize the files), and the
 * `allowed-tools`, `argument-hint` and `model` frontmatter (`model` switches the
 * session model for the command's run via `pi.setModel`, restored on agent_end).
 * `shell: powershell` runs a command's injected spans through PowerShell when a
 * pwsh binary is installed, falling back to the default shell path so the command
 * still works without one: /bin/sh on POSIX, Git Bash on Windows.
 *
 * Commands are also exposed to the model through a `slash_command` tool
 * (Claude's SlashCommand tool), listing every discovered command whose file
 * does not set `disable-model-invocation: true`. Only the command files this
 * extension discovers are listed: pi built-ins and pi-code's own UI commands
 * are user surfaces, not model surfaces. The model path is expansion only: the
 * expanded body comes back as the tool result (sendUserMessage would spawn a
 * second turn), `allowed-tools`/`disallowed-tools`/`model:` are not applied
 * (applying them from inside a tool call would narrow the running batch and
 * scope unrelated parallel tool calls, and the agent_end restore would lift
 * the grant before the next model step could rely on it), and `!` spans are
 * never executed on the model's demand: pi has no permission engine to gate
 * repo-authored shell, so each span is replaced with Claude's
 * "[shell command execution disabled by policy]" placeholder. The same
 * placeholder is applied on every path when the `disableSkillShellExecution`
 * settings key is set (user settings always, project settings when trusted,
 * managed-settings.json as policy).
 *
 * A project command body is repository-controlled text that can run shell
 * commands and read files, so project commands load only once the project is
 * approved. That closes the "skills / commands are not trust-gated" limitation
 * for commands; skills.ts gates project skills on the same approval.
 *
 * Docs: https://code.claude.com/docs/en/slash-commands.md
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Type } from "typebox";
import type { ExtensionAPI, ExtensionCommandContext } from "../../core/extensions/types.ts";
import {
	type DiscoveredCommand,
	type ParsedCommand,
	type PathRuleTool,
	parseCommandFile,
	substituteVars,
} from "../_shared/commands/command-file.ts";
import { createTurnOverride } from "../_shared/commands/turn-override.ts";
import { isPlanModeState, PLAN_MODE_CHANNEL } from "../_shared/events/plan-mode-state.ts";
import { isProjectApproved } from "../_shared/project/project-approval.ts";
import { checkoutRoot } from "../_shared/project/project-root.ts";
import { matchesBashRules } from "../_shared/rules/bash-rules.ts";
import { matchesPathRules } from "../_shared/rules/path-rules.ts";
import {
	agentNamesIn,
	matchesAgentRules,
	matchesDomainRules,
	matchesSkillRules,
} from "../_shared/rules/scope-rules.ts";
import { fileToolTarget } from "../_shared/rules/tool-target.ts";
import { installedPlugins } from "../_shared/settings/plugins.ts";
import { errorMessage, parseNumericEnv } from "../_shared/util/values.ts";
import { capForContext } from "../_shared/web/output-guard.ts";
import {
	type CommandPlugin,
	collectCommands,
	commandDirs,
	commandVars,
	expandCommand,
	pluginCommands,
	shellExecutionDisabled,
	type VarContext,
} from "./expand.ts";
import { type ModelLike, resolveCommandModel, scopedPathRules, scopeVerdict } from "./scope.ts";

export interface SlashCommandEntry {
	name: string;
	description: string;
	argumentHint?: string;
	/** `when_to_use:` trigger text, appended to this entry's line in the tool listing. */
	whenToUse?: string;
}

/** One listed command's cap inside the tool description, as Claude cuts an
 * oversized description rather than dropping the command. */
const ENTRY_CHAR_CAP = 1536;

/** Claude's default character budget for the SlashCommand tool description. */
const DEFAULT_TOOL_CHAR_BUDGET = 15_000;

/** The description budget: SLASH_COMMAND_TOOL_CHAR_BUDGET when set, else about
 * 1% of the model's context window (1% of the tokens at ~4 characters per token
 * is window / 25), else Claude's documented default. */
export function slashCommandBudget(
	contextWindow: number | undefined,
	env: Record<string, string | undefined> = process.env,
): number {
	const override = parseNumericEnv(env.SLASH_COMMAND_TOOL_CHAR_BUDGET);
	if (override !== undefined && Number.isInteger(override) && override > 0) return override;
	if (contextWindow && contextWindow > 0) return Math.floor(contextWindow / 25);
	return DEFAULT_TOOL_CHAR_BUDGET;
}

/** The slash_command tool description: usage framing plus the budgeted command
 * list, each entry `/name - description (argument-hint)`. */
export function slashCommandToolDescription(commands: SlashCommandEntry[], budget: number): string {
	// Claude: "The listing always contains every skill name"; the budget shortens
	// descriptions (later entries lose theirs first), never drops a name, so an
	// omitted-but-invocable command can no longer contradict the listing.
	const lines = commands.map((command) => `/${command.name}`);
	let used = lines.reduce((total, line) => total + line.length + 1, 0);
	for (const [index, command] of commands.entries()) {
		const hintSuffix = command.argumentHint ? ` (${command.argumentHint})` : "";
		// when_to_use is model-facing trigger text, appended after the description and before
		// the argument hint; it shares the per-entry cap and never reaches the user surface.
		const whenSuffix = command.whenToUse ? ` ${command.whenToUse}` : "";
		const entry = `/${command.name} - ${command.description}${whenSuffix}${hintSuffix}`.slice(0, ENTRY_CHAR_CAP);
		const growth = entry.length - lines[index].length;
		if (used + growth > budget) continue;
		used += growth;
		lines[index] = entry;
	}
	return [
		"Execute a custom slash command on the user's behalf. The command expands to instructions for you to follow in this conversation.",
		"",
		"Available commands:",
		...lines,
	].join("\n");
}

/** A slash_command tool input split into the command name and its arguments, with the
 * leading slash optional. */
function splitCommandLine(input: string): { name: string; args: string } {
	const line = input.trim().replace(/^\//, "");
	const space = line.search(/\s/);
	const name = space === -1 ? line : line.slice(0, space);
	const args = space === -1 ? "" : line.slice(space + 1).trim();
	return { name, args };
}

export default function commandsExtension(nycode: ExtensionAPI) {
	const registered = new Set<string>();
	/** Patch local (commands-print.patch): quem espera o próximo agent_settled (pi -p / --mode json). */
	const settledWaiters: Array<() => void> = [];
	/** Every command file discovered for the current session, by name, for the
	 * slash_command tool to resolve against. Rebuilt on each session_start (a resume,
	 * fork, or new session can land on a different project) so the model never resolves
	 * a command left over from a previous project's session. Kept fresh even for names
	 * already registered. */
	const discovered = new Map<string, DiscoveredCommand>();
	/** pi has no unregister, so the slash_command tool registers once per process. */
	let toolRegistered = false;
	/** The session_start approval decision, reused for per-invocation settings reads. */
	let projectApproved = false;
	/** Tool set to put back once the run a restricted command drove has ended. */
	let pendingRestore: string[] | undefined;
	/** The tools this run's restriction took out of the set. Put back as a delta on whatever is
	 * active by then: overwriting with the snapshot undid every change made meanwhile. */
	let tookAway = new Set<string>();
	/** `Bash(...)` scopes enforced while that run lasts; lifted with the restriction. */
	let pendingBashRules: string[] | undefined;
	/** `WebFetch(domain:...)` scopes enforced the same way. */
	let pendingDomainRules: string[] | undefined;
	/** `Agent(...)`/`Task(...)` agent-name scopes enforced the same way. */
	let pendingAgentRules: string[] | undefined;
	/** `Skill(...)` name-pattern scopes enforced the same way. */
	let pendingSkillRules: string[] | undefined;
	/** Read/Edit path scopes enforced the same way, per pi file tool. */
	let pendingPathRules: Partial<Record<PathRuleTool, string[]>> | undefined;
	/** The session model to restore after a command's `model:` override drove its run,
	 * captured once per turn so a second command restores the original session model. */
	const modelOverride = createTurnOverride<ModelLike>({
		// setModel can reject (e.g. auth resolution fails), and a floated rejection would
		// escape as unhandled; surface it as a no-op instead of leaving the session silently
		// on the command's override model.
		set: async (model) => {
			// A refused switch leaves the turn on the session model rather than the one the
			// command named, and the reply gives no sign of it, so the refusal is reported. The
			// promise never rejects, so a caller that does not await it (agent_settled) cannot
			// float a rejection; the shutdown handler awaits it so the exit cannot outrun it.
			try {
				await nycode.setModel(model as Parameters<typeof nycode.setModel>[0]);
			} catch (error) {
				console.warn(
					`nycode-commands: could not switch to ${typeof model === "object" && model !== null && "id" in model ? String((model as { id: unknown }).id) : String(model)}: ${errorMessage(error)}`,
				);
			}
		},
	});
	/** The thinking level to restore after a command's `effort:` override drove its run,
	 * captured once per turn the same way. */
	const effortOverride = createTurnOverride<string>({
		set: (level) => nycode.setThinkingLevel(level as Parameters<typeof nycode.setThinkingLevel>[0]),
	});

	// Claude's contract is "the grant clears when you send your next message", and
	// pi's turn_end fires after every assistant step: restoring there stripped a
	// multi-step command's tool and model scoping as soon as its first tool batch
	// came back. agent_end is not the end either: it fires once per agent loop, ahead
	// of an automatic retry, an auto-compaction-and-retry, or a Stop-hook continuation,
	// so restoring there lifts the scoping before that continued run executes.
	// agent_settled fires exactly once, after the run has fully settled and no such
	// continuation remains, which is the grant's true clearing point.
	nycode.on("agent_settled", () => {
		for (const resolve of settledWaiters.splice(0)) resolve();
		void modelOverride.settle();
		void effortOverride.settle();
		liftToolScope();
	});

	// "Execute the plan" continues the very run a scoped command started, so the scope it set
	// for planning would judge every call of the execution and the tools it narrowed away
	// would stay gone. Leaving plan mode is the point the user approved more than the command
	// asked for; the model and effort overrides still last until the run settles.
	nycode.events?.on(PLAN_MODE_CHANNEL, (data) => {
		if (isPlanModeState(data) && !data.active) liftToolScope();
	});

	// agent_settled never fires when pi is quit mid-run (double Ctrl+C, Ctrl+D, a closed
	// terminal, SIGTERM), and the switch is already in the transcript: `pi -c` resumed on the
	// command's override model at its raised level. A run that settled has nothing armed, so
	// this restores nothing twice.
	nycode.on("session_shutdown", async () => {
		await modelOverride.settle();
		await effortOverride.settle();
	});

	// The active-tool set has no argument dimension, so a scoped grant hands the turn
	// the whole tool; the scope is enforced here instead, when the call arrives. Same
	// steering-not-sandbox caveat as plan mode's guard.
	//
	// PAIRED WITH hooks/matcher.ts's matchesToolPattern, which dispatches the same tools
	// to the same matchers for hook `if` filters. Deliberately not merged: bash differs
	// (here every segment of a compound command must match a rule; there the filter is
	// best effort and errs toward running the hook). A new scoped tool must be added in
	// both; the shared roster is ARG_RULE_TOOLS in internal/command-file.ts.
	nycode.on("tool_call", (event, ctx) => {
		const input = event.input as Record<string, unknown>;
		const text = (value: unknown): string => (typeof value === "string" ? value : "");
		// The four scalar-scope tools share one shape: rules in force, the part of the call
		// they judge, and the sentence naming both when it blocks. One helper keeps the arms
		// from drifting; only the subject and the matcher differ.
		if (event.toolName === "bash")
			return scopeVerdict(pendingBashRules, "bash", "Command", text(input.command), (rules) =>
				matchesBashRules(text(input.command), rules),
			);
		if (event.toolName === "web_fetch")
			return scopeVerdict(pendingDomainRules, "web_fetch", "Url", text(input.url), (rules) =>
				matchesDomainRules(text(input.url), rules),
			);
		if (event.toolName === "subagent") {
			const names = agentNamesIn(input);
			return scopeVerdict(pendingAgentRules, "subagent", "Agents", names.join(", "), (rules) =>
				matchesAgentRules(names, rules),
			);
		}
		if (event.toolName === "slash_command")
			return scopeVerdict(pendingSkillRules, "slash_command", "Command", text(input.command), (rules) =>
				matchesSkillRules(text(input.command), rules),
			);
		const rules = pendingPathRules?.[event.toolName as PathRuleTool];
		if (!rules) return;
		// The shared reader takes pi's `path` (or Claude's `file_path`) and normalises the
		// value as pi resolves it. The paired guard in
		// hooks/matcher.ts judges the same paths against the same rules, so it normalises
		// through the same helper rather than only aliasing the two keys.
		const filePath = fileToolTarget(event) ?? "";
		const anchors = { cwd: ctx.cwd, projectRoot: checkoutRoot(ctx.cwd), home: os.homedir() };
		if (filePath && matchesPathRules(filePath, rules, anchors)) return;
		return {
			block: true,
			reason: `allowed-tools: ${event.toolName} is scoped for this command.\nAllowed: ${rules.join(", ")}\nPath: ${filePath}`,
		};
	});

	/** Take the tool set to restore when this run ends, captured once per turn so a
	 * second restricted command narrows against the original unrestricted set. */
	function captureRestorePoint(): string[] {
		const original = pendingRestore ?? nycode.getActiveTools();
		pendingRestore = original;
		return original;
	}

	/** Record what the restriction just applied took out, against the set captured before it. */
	function noteTakenAway(): void {
		if (!pendingRestore) return;
		const active = new Set(nycode.getActiveTools());
		tookAway = new Set(pendingRestore.filter((tool) => !active.has(tool)));
	}

	/** End the run's tool restriction: drop its scopes and put back what it took away, as a
	 * delta on the set in force. A snapshot overwrite undid whatever else changed the set
	 * meanwhile: plan mode's Execute (the session finished read-only, plan mode off, with edit
	 * and write gone) and a tool registered during the run (dropped until a /reload). */
	function liftToolScope(): void {
		pendingBashRules = undefined;
		pendingDomainRules = undefined;
		pendingAgentRules = undefined;
		pendingSkillRules = undefined;
		pendingPathRules = undefined;
		const original = pendingRestore;
		if (!original) return;
		const active = nycode.getActiveTools();
		const keep = new Set([...active, ...tookAway]);
		nycode.setActiveTools([
			...original.filter((tool) => keep.has(tool)),
			...active.filter((tool) => !original.includes(tool)),
		]);
		pendingRestore = undefined;
		tookAway = new Set();
	}

	/** Apply a command's allowed-tools to the run it drives: intersect with the tools
	 * pi actually has, keep the bash and path scopes for the tool_call guard, and let
	 * agent_settled restore the previous set. */
	function applyAllowedTools(parsed: ParsedCommand, vars: Record<string, string | undefined>): void {
		const allowed = parsed.allowedTools;
		if (!allowed) return;
		// Only the first restriction in a turn sees the unrestricted set; a second
		// command must grant and restore against that original set, or its own tools
		// are intersected away by the first command's narrowing.
		const original = captureRestorePoint();
		const granted = allowed.filter((tool) => original.includes(tool));
		// `allowed-tools: []` says no tools, and is honored. A non-empty list that
		// intersects to nothing named only tools pi has none of: that restriction cannot
		// be expressed, and applying it as "no tools" is not what the command asked for.
		if (granted.length > 0 || allowed.length === 0) nycode.setActiveTools(granted);
		noteTakenAway();
		// The latest restricted command speaks for the turn: a later unscoped grant
		// lifts an earlier command's scopes rather than stacking under them. Rules get
		// the same ${CLAUDE_*} substitution as the body, so a rule can name a bundled
		// script by its real path, as the skills docs show.
		pendingBashRules = granted.includes("bash")
			? parsed.bashRules?.map((rule) => substituteVars(rule, vars))
			: undefined;
		pendingDomainRules = granted.includes("web_fetch") ? parsed.domainRules : undefined;
		pendingAgentRules = granted.includes("subagent") ? parsed.agentRules : undefined;
		pendingSkillRules = granted.includes("slash_command") ? parsed.skillRules : undefined;
		pendingPathRules = parsed.pathRules ? scopedPathRules(parsed.pathRules, granted, vars) : undefined;
	}

	/** Claude removes disallowed-tools from the pool while the command is active; with
	 * both fields present the removal wins, as in subagent tool lists. */
	function applyDisallowedTools(parsed: ParsedCommand): void {
		const disallowed = parsed.disallowedTools;
		if (!disallowed || disallowed.length === 0) return;
		captureRestorePoint();
		nycode.setActiveTools(nycode.getActiveTools().filter((tool) => !disallowed.includes(tool)));
		noteTakenAway();
	}

	/** Claude's `model:` frontmatter overrides the model for this run only, then the
	 * session model resumes; restore happens on agent_settled like the tool-set restore.
	 * Applied before sendUserMessage so the run it drives happens on the new model. */
	async function applyModelOverride(parsed: ParsedCommand, varCtx: VarContext): Promise<void> {
		const target = resolveCommandModel(parsed.model, varCtx.modelRegistry?.getAvailable() ?? []);
		if (target && varCtx.model && target.id !== varCtx.model.id) {
			modelOverride.arm(varCtx.model);
			await nycode.setModel(target as Parameters<typeof nycode.setModel>[0]);
		}
	}

	/** Claude's `effort:` frontmatter overrides the thinking level for this run only, then
	 * the session level resumes; restore happens on agent_settled like the model restore.
	 * Applied before sendUserMessage so the run it drives happens at the new level. Only the
	 * first override in a turn records the restore target, so a second command restores to
	 * the original session level rather than the first command's override (as the model override). */
	function applyEffortOverride(parsed: ParsedCommand, varCtx: VarContext): void {
		const target = parsed.effort;
		if (target && varCtx.thinkingLevel && target !== varCtx.thinkingLevel) {
			effortOverride.arm(varCtx.thinkingLevel);
			nycode.setThinkingLevel(target as Parameters<typeof nycode.setThinkingLevel>[0]);
		}
	}

	async function runCommand(
		parsed: ParsedCommand,
		args: string,
		ctx: ExtensionCommandContext,
		filePath: string,
		plugin?: CommandPlugin,
	): Promise<void> {
		const varCtx = ctx as unknown as VarContext;
		const vars = commandVars(ctx, filePath, plugin);

		let expanded: string;
		try {
			expanded = await expandCommand(nycode, parsed, args, ctx, filePath, plugin, {
				allowShell: !shellExecutionDisabled(ctx.cwd, os.homedir(), projectApproved),
			});
		} catch (error) {
			// A failed injected command aborts the invocation; the model never sees a
			// half-expanded body. The notify carries Claude's failure message format.
			ctx.ui.notify(errorMessage(error), "error");
			// Patch local (commands-print.patch): sem UI o notify some e o `pi -p` saía 0 sem dizer nada.
			if (!ctx.hasUI) {
				process.stderr.write(`${path.basename(filePath, ".md")}: ${errorMessage(error)}\n`);
				process.exitCode = 1;
			}
			return;
		}

		// allowed-tools restricts the run the command drives, and the previous set is
		// restored when that run ends. Restoring inline does not work: sendUserMessage is
		// fire-and-forget, so the restore would land before the agent ever read the tool
		// list, leaving the command running with everything enabled.
		// A command invoked while the agent is streaming must not narrow the in-flight run's
		// tools or switch its model (that would corrupt a run it does not own), and a bare
		// sendUserMessage throws mid-stream and would be silently dropped. Queue it as a
		// follow-up through pi's own queue, which is abort-aware and shown to the user; its
		// frontmatter scoping is not applied in that case, since it cannot land on a run that
		// has not started yet.
		if (!ctx.isIdle()) {
			nycode.sendUserMessage(expanded, { deliverAs: "followUp" });
			return;
		}
		applyAllowedTools(parsed, vars);
		applyDisallowedTools(parsed);
		await applyModelOverride(parsed, varCtx);
		applyEffortOverride(parsed, varCtx);
		if (ctx.hasUI) {
			nycode.sendUserMessage(expanded);
			return;
		}
		// Patch local (claude-home/patches/pi-code/commands-print.patch): no `pi -p` e no `--mode json` o
		// session.prompt() volta quando este handler volta, e o print mode descartava o runtime antes de a execução
		// iniciada pelo sendUserMessage começar ("turn_end could not resolve...", ctx stale). Sem UI, o handler
		// espera essa execução assentar; se ela não começar em 60 s (o prompt falhou antes), segue.
		const settled = new Promise<void>((resolve) => settledWaiters.push(resolve));
		nycode.sendUserMessage(expanded);
		const started = (async () => {
			for (let waited = 0; waited < 60_000; waited += 50) {
				if (!ctx.isIdle()) return true;
				await new Promise((resolve) => setTimeout(resolve, 50));
			}
			return false;
		})();
		if (await Promise.race([settled.then(() => false), started])) await settled;
	}

	function registerUserCommand(command: DiscoveredCommand, parsed: ParsedCommand): void {
		// pi has no unregister, so a command already registered this process keeps its
		// original file binding; re-registering would only add a numbered duplicate.
		if (registered.has(command.name)) return;
		registered.add(command.name);
		nycode.registerCommand(command.name, {
			description: parsed.argumentHint ? `${parsed.description} ${parsed.argumentHint}` : parsed.description,
			handler: async (args, commandCtx) => {
				// Re-read on invocation so an edited command file takes effect without a reload.
				let current = parsed;
				try {
					current = parseCommandFile(fs.readFileSync(command.filePath, "utf-8"));
				} catch {
					// fall back to what was parsed at registration
				}
				await runCommand(current, args, commandCtx, command.filePath, command.plugin);
			},
		});
	}

	nycode.on("session_start", async (_event, ctx) => {
		// pi's CLI builds a fresh extension instance per session replacement; only RPC mode can
		// reuse one across sessions. A mid-turn /new there fires session_start on
		// the same instance while a command's per-run scoping is still pending (its agent_settled
		// never came). Carrying that into the next session would restore an unrelated tool set,
		// bash/path scope, model, or effort onto it, so drop the pending state here. Drop only:
		// no setActiveTools/setModel/setThinkingLevel, since the new session owns its own state.
		pendingRestore = undefined;
		pendingBashRules = undefined;
		pendingDomainRules = undefined;
		pendingAgentRules = undefined;
		pendingSkillRules = undefined;
		pendingPathRules = undefined;
		modelOverride.reset();
		effortOverride.reset();
		const trusted = await isProjectApproved(ctx);
		projectApproved = trusted;
		// A resume/fork/new session can switch projects in-process. pi cannot unregister a
		// command or re-describe the slash_command tool, so a name registered in an earlier
		// project keeps its user-path binding and the tool description stays frozen at the
		// first session's list; that is a pi limitation. What must not persist is the map
		// the model resolves against, so it is rebuilt from scratch here: a stale command
		// from a previous project resolves to "unknown" rather than being expanded.
		discovered.clear();
		// Plugins are user-installed and enabled by user settings; a checked-out repo
		// must not silently flip which code-bearing plugins run, so enablement is
		// user-scoped and never reads the project settings chain (see installedPlugins).
		const plugins = pluginCommands(installedPlugins(os.homedir()));
		const invocable: SlashCommandEntry[] = [];
		for (const command of [...collectCommands(commandDirs(ctx.cwd, os.homedir(), trusted)), ...plugins]) {
			let parsed: ParsedCommand;
			try {
				parsed = parseCommandFile(fs.readFileSync(command.filePath, "utf-8"));
			} catch (error) {
				// An unreadable file must not take down session start, but the command is then
				// absent from /help and unresolvable by the model, which looks like one that was
				// never written.
				console.warn(`nycode-commands: ignoring ${command.filePath}: ${errorMessage(error)}`);
				continue;
			}
			discovered.set(command.name, command);
			// A user-only command stays off the tool description; it is still in the
			// map so a model attempt gets the explicit refusal, not "unknown command".
			if (!parsed.disableModelInvocation)
				invocable.push({
					name: command.name,
					description: parsed.description,
					argumentHint: parsed.argumentHint,
					whenToUse: parsed.whenToUse,
				});
			// user-invocable:false is the inverse of disable-model-invocation: the command is
			// hidden from the user slash-command surface but stays in `discovered` and the tool
			// description above, so the model can still run it through the slash_command tool.
			if (!parsed.userInvocable) continue;
			registerUserCommand(command, parsed);
		}

		// Claude's SlashCommand tool, registered only when there is something for the
		// model to call: an empty tool would spend context saying "nothing available".
		if (toolRegistered || invocable.length === 0) return;
		toolRegistered = true;
		nycode.registerTool({
			name: "slash_command",
			label: "SlashCommand",
			description: slashCommandToolDescription(
				invocable,
				slashCommandBudget((ctx as unknown as VarContext).model?.contextWindow),
			),
			parameters: Type.Object({
				command: Type.String({ description: 'The command to run with args, e.g. "/deploy staging"' }),
			}),
			async execute(_toolCallId, params, _signal, _onUpdate, execCtx) {
				const { name, args } = splitCommandLine(params.command);
				// pi marks a tool result as an error only when execute() throws, so the
				// failure paths below throw rather than return.
				const command = discovered.get(name);
				if (!name || !command)
					throw new Error(
						`Unknown command: /${name || params.command}. Only the custom commands listed in the slash_command tool description can be run.`,
					);
				// Live-edit parity with the user path: re-read on every invocation, so a
				// just-added disable-model-invocation takes effect immediately too.
				let current: ParsedCommand;
				try {
					current = parseCommandFile(fs.readFileSync(command.filePath, "utf-8"));
				} catch {
					throw new Error(`/${name}: the command file could not be read (${command.filePath}).`);
				}
				if (current.disableModelInvocation) {
					throw new Error(
						`/${name} is user-only (disable-model-invocation: true) and was not run. Do not reproduce this command's steps or try to achieve its effect another way; only the user can invoke it.`,
					);
				}
				// Expansion only, never sendUserMessage (that would spawn a second turn):
				// the tool result is the channel, and frontmatter scoping stays user-path
				// territory (see the header).
				const expanded = await expandCommand(nycode, current, args, execCtx, command.filePath, command.plugin, {
					allowShell: false,
				});
				// Cap the tool result: a command body can inline an arbitrarily large @file, and
				// an uncapped tool result overflows the model's context (every other pi-code tool
				// routes its output through capForContext). The user-invoked path stays uncapped.
				return {
					content: [
						{ type: "text" as const, text: capForContext(`Contents of /${name} (expanded):\n\n${expanded}`) },
					],
					details: {},
				};
			},
		});
	});
}

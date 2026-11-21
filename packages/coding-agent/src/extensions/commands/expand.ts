import * as fs from "node:fs";
import * as path from "node:path";
import {
	type DiscoveredCommand,
	discoverCommandFiles,
	type ParsedCommand,
	substituteArgsDetailed,
	substituteVars,
} from "../_shared/commands/command-file.ts";
import { claudeEffortLevel } from "../_shared/model/effort.ts";
import { ancestorDirs, checkoutRoot } from "../_shared/project/project-root.ts";
import { claudeConfigDir } from "../_shared/settings/config-dir.ts";
import { managedSettingsFile, readManagedSettings } from "../_shared/settings/managed-settings.ts";
import { type InstalledPlugin, pluginComponentPath } from "../_shared/settings/plugins.ts";
import { claudeSettingsChain } from "../_shared/settings/settings-chain.ts";
import {
	type CommandExec,
	expandDynamicContent,
	resolvePowershellBinary,
	spanExec,
} from "../_shared/shell/command-spans.ts";
import { isDirectory } from "../_shared/util/values.ts";
import type { ModelLike } from "./scope.ts";

/** Wall-clock budget for one injected span: the Bash tool's documented 2-minute
 * default, which is what Claude runs these commands under. */
const BASH_TIMEOUT_MS = 120_000;

/** Context fields pi provides that Claude's ${CLAUDE_*} variables read from. */
export interface VarContext {
	sessionManager?: { getSessionId?: () => string };
	thinkingLevel?: string;
	model?: ModelLike;
	modelRegistry?: { getAvailable(): ReadonlyArray<ModelLike> };
}

/** Existing `.claude/commands` directories in Claude's precedence order (later
 * directories win in collectCommands): project first, then personal, then the
 * enterprise directory beside the managed settings file, per "enterprise
 * overrides personal, and personal overrides project". The project directories
 * are included only for approved projects. */
export function commandDirs(cwd: string, home: string, trusted: boolean): string[] {
	const candidates: string[] = [];
	// Claude scans every .claude/commands between cwd and the repository root, the
	// nearest winning an intra-project name clash: root-first with the nearest last.
	if (trusted) candidates.push(...ancestorDirs(cwd, path.join(".claude", "commands")).reverse());
	candidates.push(
		path.join(claudeConfigDir(home), "commands"),
		path.join(path.dirname(managedSettingsFile()), ".claude", "commands"),
	);
	const dirs: string[] = [];
	for (const dir of candidates) {
		if (!dirs.includes(dir) && isDirectory(dir)) dirs.push(dir);
	}
	return dirs;
}

/** All commands across the given directories, later directories winning by name. */
export function collectCommands(dirs: string[]): DiscoveredCommand[] {
	const byName = new Map<string, DiscoveredCommand>();
	for (const dir of dirs) {
		for (const found of discoverCommandFiles(dir)) byName.set(found.name, found);
	}
	return [...byName.values()];
}

/** A plugin's command files, namespaced `plugin:name` as Claude registers them.
 * The manifest may point `commands` somewhere else; the default is `commands/`. */
export function pluginCommands(plugins: InstalledPlugin[]): DiscoveredCommand[] {
	const found: DiscoveredCommand[] = [];
	for (const plugin of plugins) {
		const declared = plugin.manifest.commands;
		const dirs = (Array.isArray(declared) ? declared : [typeof declared === "string" ? declared : "commands"])
			.map((entry) => pluginComponentPath(plugin, String(entry)))
			.filter((dir): dir is string => dir !== undefined);
		for (const dir of dirs) {
			for (const command of discoverCommandFiles(dir)) {
				found.push({
					name: `${plugin.name}:${command.name}`,
					filePath: command.filePath,
					plugin: {
						root: plugin.root,
						dataDir: plugin.dataDir,
						...(plugin.userConfig ? { userConfig: plugin.userConfig } : {}),
					},
				});
			}
		}
	}
	return found;
}

/** Claude's replacement text for a `!` span it refuses to execute. */
export const SHELL_DISABLED_PLACEHOLDER = "[shell command execution disabled by policy]";

export type CommandPlugin = NonNullable<DiscoveredCommand["plugin"]>;

/**
 * Whether `disableSkillShellExecution` is set: the Claude settings key that
 * replaces every `` !`cmd` `` and ```` ```! ```` span in skills and custom
 * commands with SHELL_DISABLED_PLACEHOLDER instead of executing it. Read from
 * user settings always, the project's settings.json/settings.local.json only
 * when the project is trusted, and managed-settings.json as policy. Any layer
 * setting it true wins: a repository's `false` must not lift the user's or the
 * organization's policy, so this fails closed rather than last-file-wins.
 */
export function shellExecutionDisabled(cwd: string, home: string, trusted: boolean): boolean {
	if (readManagedSettings().disableSkillShellExecution === true) return true;
	const files = claudeSettingsChain(cwd, home, trusted);
	return files.some((file) => {
		let raw: string;
		try {
			raw = fs.readFileSync(file, "utf-8");
		} catch {
			return false; // no such file: genuinely not a policy statement
		}
		try {
			return (JSON.parse(raw) as Record<string, unknown>).disableSkillShellExecution === true;
		} catch {
			// Present but unreadable: the user may believe this file disables skill shells, so
			// say so rather than silently leaving them enabled.
			console.warn(
				`nycode: ignoring ${file}: not valid JSON; skill shell execution stays as the other settings leave it`,
			);
			return false;
		}
	});
}

/** The ${CLAUDE_*} substitution sources for one command invocation. */
export function commandVars(
	ctx: { cwd: string },
	filePath: string,
	plugin?: CommandPlugin,
): Record<string, string | undefined> {
	const varCtx = ctx as unknown as VarContext;
	return {
		CLAUDE_SESSION_ID: varCtx.sessionManager?.getSessionId?.(),
		// Claude vocabulary only, and unset when thinking is off: the variable promises
		// low|medium|high|xhigh|max, and an unset one stays literal in the body.
		CLAUDE_EFFORT: claudeEffortLevel(varCtx.thinkingLevel),
		CLAUDE_SKILL_DIR: path.dirname(filePath),
		CLAUDE_PROJECT_DIR: checkoutRoot(ctx.cwd),
		CLAUDE_PLUGIN_ROOT: plugin?.root,
		CLAUDE_PLUGIN_DATA: plugin?.dataDir,
	};
}

/** The exec seam expandCommand runs spans through; pi itself satisfies it. */
interface SpanRunner {
	exec(
		command: string,
		args: string[],
		options?: { cwd?: string; timeout?: number },
	): Promise<{ stdout: string; stderr: string; code: number; killed?: boolean }>;
}

/**
 * A command body expanded to the text a turn (or a tool result) carries:
 * argument and named substitution, ${CLAUDE_*} and plugin variables, `!` spans
 * and `@file` inlining, plus Claude's `ARGUMENTS:` append when the body never
 * read what was passed. Throws when an injected span fails, so a caller never
 * sees a half-expanded body. With `allowShell: false` no span executes at all;
 * each is replaced by SHELL_DISABLED_PLACEHOLDER, which is how both the model
 * path and the disableSkillShellExecution setting keep repo-authored shell
 * from running.
 */
export async function expandCommand(
	runner: SpanRunner,
	parsed: ParsedCommand,
	args: string,
	ctx: { cwd: string },
	filePath: string,
	plugin?: CommandPlugin,
	options?: { allowShell?: boolean },
): Promise<string> {
	const projectRoot = checkoutRoot(ctx.cwd);
	const vars = commandVars(ctx, filePath, plugin);
	const { text: withArgs, consumed } = substituteArgsDetailed(parsed.body, args, parsed.argumentNames ?? []);
	// `${user_config.KEY}` is a plugin-command variable only; leave it literal in an
	// ordinary command so a body that happens to contain the syntax is not stripped.
	const substituted = substituteVars(withArgs, vars);
	const withVars = plugin
		? substituted.replace(/\$\{user_config\.(\w+)\}/g, (_, key: string) => plugin.userConfig?.[key] ?? "")
		: substituted;

	const exec: CommandExec =
		(options?.allowShell ?? true)
			? async (script) => {
					// Hooks get CLAUDE_PROJECT_DIR, and a command's shell span is the same kind of
					// project-scoped script. pi.exec takes no env, so it is set in the script.
					// stderr merges into stdout, as the Bash tool runs these for Claude. The
					// resolver is passed by its imported binding so tests can stub the lookup.
					const run = spanExec(parsed.shell, projectRoot, script, resolvePowershellBinary);
					const result = await runner.exec(run.command, run.args, { cwd: ctx.cwd, timeout: BASH_TIMEOUT_MS });
					// pwsh cannot merge a native command's stderr in-script (spanExec sets
					// mergeStreams), so it is appended here; the sh script merges via 2>&1.
					const stdout = run.mergeStreams ? result.stdout + result.stderr : result.stdout;
					return { stdout, stderr: result.stderr, code: result.code, killed: result.killed };
				}
			: () => Promise.resolve({ stdout: SHELL_DISABLED_PLACEHOLDER, stderr: "", code: 0 });
	let expanded = await expandDynamicContent(
		withVars,
		ctx.cwd,
		exec,
		parsed.shell === "powershell" ? "powershell" : "bash",
	);

	// Claude appends the raw arguments when the command never read them, so what
	// the user typed still reaches the model.
	if (args.trim().length > 0 && !consumed) expanded += `\n\nARGUMENTS: ${args.trim()}`;
	return expanded;
}

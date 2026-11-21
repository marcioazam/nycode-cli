/**
 * Context Imports Extension
 *
 * pi loads CLAUDE.md / AGENTS.md context files natively but does not resolve
 * Claude Code's `@path` imports inside them, and skips CLAUDE.local.md
 * entirely. This fills both gaps: on before_agent_start it reads the
 * already-loaded context files from systemPromptOptions, resolves any `@path`
 * imports (recursive, depth-capped, cycle-safe, budget-capped; ~ expands to
 * home, relative paths resolve against the importing file), and appends the
 * imported content plus the approval-gated CLAUDE.local.md body. The base
 * files pi already injected are never re-appended.
 *
 * It also loads the Claude Code memory locations pi's own loader misses, each
 * through the same exclude/strip/announce/import pipeline: the user-scope
 * ~/.claude/CLAUDE.md (the user's own file, no approval gate, @imports at
 * user-config roots), the project-scope alternate ./.claude/CLAUDE.md (nearest at
 * or above cwd, approval-gated, deduped against pi's native blocks, @imports at
 * project roots), and the enterprise managed CLAUDE.md file deployed beside
 * managed-settings.json.
 *
 * It also rewrites the context blocks pi assembled, by exact-substring
 * replacement of the wrapper reconstructed from each file's path+content (a
 * wrapper that is not found is skipped, never guessed at): the managed claudeMd
 * (the managed CLAUDE.md file first, then the managed-settings `claudeMd` key)
 * and the user CLAUDE.md are prepended at the top of <project_context> in Claude's
 * order (managed, user, then pi's native project blocks; managed is managed-source
 * only and never excludable), files matching the merged `claudeMdExcludes` globs
 * are removed along with their imports, and block-level HTML comments are stripped
 * from every surviving body (see internal/strip-comments).
 *
 * Where the runtime builds the prompt from its options (pi 0.86 and later), the same
 * memory is handed over as the options' context files instead, in Claude's order
 * and with each import after its importer, and nothing is returned: the prompt is
 * not forced, and a provider that rebuilds it from the options receives what a
 * rewrite of the rendered text cannot give it. The text rewrite above remains for
 * an older pi and for a prompt an earlier handler forced.
 *
 * Security: context files can come from an untrusted project, so imports are
 * confined (after resolving symlinks) to the working directory plus its
 * repository root, and for user-config importers the user's own ~/.claude and
 * ~/.pi config roots. An import that escapes those roots (absolute paths,
 * ~/.ssh, ../.. traversal, symlinks) is ignored, so a hostile CLAUDE.md, or a
 * home-level context file whose own directory is $HOME, cannot read arbitrary
 * files into the prompt. Imports inside fenced
 * code blocks are also skipped. One byte-and-file budget is shared by the whole
 * run, so a context file cannot flood the prompt by importing breadth-first;
 * what the budget refused is stated in the prompt rather than dropped silently.
 *
 * It also carries Claude's --add-dir memory loading: with the `add-dir` flag set
 * and CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD in the environment, each
 * additional directory's CLAUDE.md, .claude/CLAUDE.md, .claude/rules/*.md and
 * (approval-gated) CLAUDE.local.md are appended as extra project_instructions
 * blocks after the native context, their @imports resolved through the shared
 * budgeted resolver with the additional dir as an allowed root. Known gaps,
 * deliberate: pi's getFlag is single-value, so a repeated `--add-dir a --add-dir b`
 * cannot be expressed; the flag accepts a comma-separated value instead. pi has
 * no `--setting-sources`. The permission half of Claude's --add-dir (widening
 * file access) is moot: pi has no path-based permission system to widen.
 *
 * Loads are also announced on the shared instruction-events bus for the
 * InstructionsLoaded hook: `include` for each resolved @import, `session_start`
 * for the native context files that survived claudeMdExcludes plus CLAUDE.local.md,
 * the user (User) and project ./.claude/CLAUDE.md (Project), the managed file
 * (Managed) and additional-dir files, once per file per session. This extension
 * owns exclusion, so it owns the announcements too: a file the exclusion removed
 * never announces, and the hooks extension only consumes the bus (emit is
 * synchronous, so extension order does not matter). The managed-settings `claudeMd`
 * key is not a file pi loaded, so like today it is inserted but not announced.
 *
 * Docs: https://code.claude.com/docs/en/memory.md (imports)
 */

import { createHash } from "node:crypto";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "../../core/extensions/types.ts";
import {
	type InstructionLoadEvent,
	memoryTypeForPath,
	publishInstructionLoad,
} from "../_shared/events/instruction-events.ts";
import {
	externalImportDecision,
	externalImportKey,
	rememberExternalImportDecision,
} from "../_shared/project/external-imports.ts";
import {
	isGatedFileApproved,
	isProjectApproved,
	isProjectApprovedSilently,
} from "../_shared/project/project-approval.ts";
import { ancestorFiles, checkoutRoot, findNearestFile, sameLocation } from "../_shared/project/project-root.ts";
import { fileToolTarget } from "../_shared/rules/tool-target.ts";
import { ADD_DIR_FLAG, ADD_DIR_FLAG_OPTIONS, setAddDirReader } from "../_shared/seams/add-dir-flag.ts";
import { claudeConfigDir } from "../_shared/settings/config-dir.ts";
import { readManagedSettings } from "../_shared/settings/managed-settings.ts";
import { stripBlockComments } from "../_shared/shell/strip-comments.ts";
import { statToken } from "../_shared/util/stat-token.ts";
import { capForContext } from "../_shared/web/output-guard.ts";
import { claudeMdExcludeFiles, isExcludedPath, readClaudeMdExcludes } from "./excludes.ts";
import {
	askExternalImports,
	createImportBudget,
	expandImports,
	type ImportBudget,
	type ImportedFile,
	realRoots,
} from "./imports.ts";
import { type NestedLoadContext, nestedContextAttachments } from "./nested.ts";
import { deliverThroughOptions, memoryEntries, memoryNotices } from "./options.ts";
import {
	additionalDirsAddition,
	importedAddition,
	localContextAddition,
	prependMemoryBlocks,
	projectContextAddition,
	refusedImportsAddition,
	rewriteNativeBlocks,
	siblingClaudeMdAddition,
} from "./prompt-blocks.ts";
import {
	additionalDirExtras,
	additionalDirsClaudeMdEnabled,
	keptDotClaudeMd,
	keptMemoryFile,
	managedClaudeMdPath,
	parseAdditionalDirs,
	presentFile,
	readContextFile,
	readProjectMemory,
	siblingClaudeMdFiles,
} from "./sources.ts";

/** Everything the import expansion depends on, hashed to a memo key: a turn whose inputs
 * match a prior key and whose recorded mtimes are unchanged reuses the previous expansion
 * outright. The native/local paths, the user/project-.claude additions, and the managed file
 * body seed the "seen" set, so a change in which of them exist (even an excluded one that
 * never reaches contextFiles) changes the key; the managed file is re-read every turn, so a
 * change in its content re-expands and keeps the seed self-consistent. */
function buildImportMemoKey(input: {
	cwd: string;
	home: string;
	projectApproved: boolean;
	externalApproved: boolean;
	addDirsRaw: string;
	excludeGlobs: string[];
	native: Array<{ path: string; content: string }>;
	localContexts: Array<{ path: string; content: string }>;
	userContext: { path: string; content: string } | undefined;
	projectDotClaude: { path: string; content: string } | undefined;
	managedFile: string;
	contextFiles: Array<{ path: string; content: string }>;
}): string {
	const keyHash = createHash("sha256");
	keyHash.update(
		`${input.cwd}\0${input.home}\0${input.projectApproved}\0${input.externalApproved}\0${input.addDirsRaw}\0${input.excludeGlobs.join(",")}\0`,
	);
	for (const file of [...input.native, ...input.localContexts]) keyHash.update(`${file.path}\0`);
	if (input.userContext !== undefined) keyHash.update(`${input.userContext.path}\0`);
	if (input.projectDotClaude !== undefined) keyHash.update(`${input.projectDotClaude.path}\0`);
	keyHash.update(`${input.managedFile}\0`);
	for (const file of input.contextFiles) keyHash.update(`${file.path}\0${file.content}\0`);
	return keyHash.digest("hex");
}

export default function contextImportsExtension(nycode: ExtensionAPI) {
	let localContexts: Array<{ path: string; content: string }> = [];
	// ~/.claude/CLAUDE.md, Claude's user-scope memory (all projects). The user's own
	// file, so it needs no project approval; read once at session start like the
	// locals, so a mid-session body edit applies next session, matching Claude.
	let userContext: { path: string; content: string } | undefined;
	// The project-scope alternate location ./.claude/CLAUDE.md. pi loads ./CLAUDE.md
	// natively but not this one; repo-controlled, so it is approval-gated like the
	// locals and read once at session start.
	let projectDotClaude: { path: string; content: string } | undefined;
	// Whether a file that is itself the thing to gate may be read. Decided at session
	// start like the flag below, from the session context, which is where the trust
	// capability lives; a tool_result context carries no approval state.
	let gatedFilesApproved = false;
	// Whether project settings may contribute claudeMdExcludes; decided at session
	// start with the silent check, so no prompt fires mid-flight.
	let projectApproved = false;
	// Every context file the last turn put in the system prompt, so a nested file's
	// @import cannot pay for a body that is already there.
	let launchLoadedPaths: string[] = [];
	// Nested CLAUDE.md/CLAUDE.local.md files already attached this session, so a second
	// read in the same subtree does not repeat them. Emptied when compaction or /tree takes
	// the tool results that carried them out of context: Claude reloads them "as Claude
	// reads files they apply to".
	const nestedLoaded = new Set<string>();
	const forgetNested = (): void => {
		nestedLoaded.clear();
	};
	nycode.on("session_compact", forgetNested);
	nycode.on("session_tree", forgetNested);
	// Instruction loads already announced on the shared bus, keyed reason:path.
	// before_agent_start fires every turn, so without this a configured
	// InstructionsLoaded hook would fire once per file per turn.
	const announced = new Set<string>();
	const announce = (event: InstructionLoadEvent): void => {
		const key = `${event.load_reason}:${event.file_path}`;
		if (announced.has(key)) return;
		announced.add(key);
		publishInstructionLoad(nycode.events, event);
	};

	// before_agent_start fires every turn, but its inputs almost never change
	// mid-session. The settings-derived environment (managed settings, exclude
	// globs, repo root) is cached per cwd, and the whole import expansion is
	// memoized on its inputs and revalidated by a stat token (mtime and size): a
	// turn where nothing changed costs a handful of stats instead of re-reading and
	// re-recursing every @import. A brand-new file satisfying a previously missing
	// @import is picked up when any recorded stat token moves (or next session),
	// which is already fresher than Claude, which loads context once at session start.
	let envCache:
		| { cwd: string; managed: Record<string, unknown>; excludeGlobs: string[]; projectRoot: string }
		| undefined;
	let importMemo:
		| {
				key: string;
				extras: Array<{ path: string; content: string; dir: string }>;
				imported: ImportedFile[];
				budget: ImportBudget;
				tokens: Array<[string, string]>;
		  }
		| undefined;
	const memoIsFresh = (memo: NonNullable<typeof importMemo>): boolean => {
		try {
			return memo.tokens.every(([file, token]) => statToken(file) === token);
		} catch {
			return false; // a recorded file vanished: re-expand
		}
	};
	// Memo lookup or recompute: a turn whose key matches the previous expansion and
	// whose recorded stat tokens are all unchanged reuses that expansion outright;
	// otherwise the imports are re-expanded and the memo (with a fresh revalidation
	// set) is rebuilt for next turn.
	const resolveImports = (
		memoKey: string,
		files: {
			native: Array<{ path: string; content: string }>;
			context: Array<{ path: string; content: string }>;
			siblings: Array<{ path: string; content: string }>;
		},
		run: { home: string; cwd: string; excluded: (absPath: string) => boolean; externalApproved: boolean },
	): {
		extras: Array<{ path: string; content: string; dir: string }>;
		budget: ImportBudget;
		imported: ImportedFile[];
	} => {
		if (importMemo?.key === memoKey && memoIsFresh(importMemo)) {
			const { extras, budget, imported } = importMemo;
			return { extras, budget, imported };
		}
		// Seed with every loaded context file path, excluded ones included, so pi's own
		// files are never re-imported and an excluded file cannot return as an import.
		// The user, project-.claude and managed-file additions join the seed too, so a
		// context file's @import cannot pull any of them in a second time.
		const ownPaths = [...files.native, ...localContexts, ...files.siblings].map((file) => file.path);
		if (userContext !== undefined) ownPaths.push(userContext.path);
		if (projectDotClaude !== undefined) ownPaths.push(projectDotClaude.path);
		ownPaths.push(managedClaudeMdPath());
		const seenSet = new Set(realRoots(ownPaths));

		// Claude's --add-dir memory loading, env-gated. The files join the seen set
		// before import expansion so an @import cannot pull one in twice, and they get
		// the same exclude and comment-strip treatment as native context files.
		const addDirs = additionalDirsClaudeMdEnabled()
			? parseAdditionalDirs(nycode.getFlag?.("add-dir"), run.home, run.cwd)
			: [];
		const extras = additionalDirExtras(addDirs, seenSet, run.excluded, projectApproved);

		// One budget for the whole run, so N context files cannot each spend a full one.
		// Exclusion applies inside the recursion: an excluded @import is skipped before
		// it is read, so its transitive imports never load and it spends no budget.
		const budget = createImportBudget();
		const imported = expandImports(files.context, extras, { ...run, seen: seenSet, budget });

		// Revalidation set: every file the expansion read, plus each add-dir itself
		// (a directory's mtime moves when a memory file is added or removed there).
		const tokens: Array<[string, string]> = [];
		try {
			for (const file of [...extras.map((extra) => extra.path), ...imported.map((entry) => entry.path)])
				tokens.push([file, statToken(file)]);
			for (const dir of addDirs) tokens.push([dir, statToken(dir)]);
			importMemo = { key: memoKey, extras, budget, imported, tokens };
		} catch {
			importMemo = undefined; // a file moved mid-expansion: just recompute next turn
		}
		return { extras, budget, imported };
	};

	// Claude's --add-dir. Only the memory-loading half is meaningful here: pi has
	// no path-based permission system, so there is no access grant to mirror.
	// Optional-called so the extension still wires under stub hosts without flags.
	nycode.registerFlag?.(ADD_DIR_FLAG, ADD_DIR_FLAG_OPTIONS);
	setAddDirReader(() => {
		// A replaced session's pi throws on every call; the next instance registers its own.
		try {
			return nycode.getFlag?.(ADD_DIR_FLAG);
		} catch {
			return undefined;
		}
	});

	/** The session-scope memory session_start loads: the user's own CLAUDE.md, plus
	 * CLAUDE.local.md and ./.claude/CLAUDE.md from an approved project. Claude:
	 * CLAUDE_CODE_DISABLE_CLAUDE_MDS "prevent[s] loading any CLAUDE.md memory files
	 * into context, including user, project, and auto memory files", so a disabled run
	 * returns empty state and skips isProjectApproved's trust prompt entirely: there is
	 * nothing left for it to gate. Extracted so session_start itself stays a thin
	 * dispatcher; before_agent_start's own excluded() check covers pi's native files,
	 * which this cannot reach since pi loads those itself. */
	async function loadSessionMemory(
		ctx: ExtensionContext,
	): Promise<{
		userContext?: { path: string; content: string };
		localContexts: Array<{ path: string; content: string }>;
		projectDotClaude?: { path: string; content: string };
	}> {
		if (process.env.CLAUDE_CODE_DISABLE_CLAUDE_MDS === "1") return { localContexts: [] };

		// ~/.claude/CLAUDE.md, Claude's user-scope memory. The user's own file, so no
		// project approval is required; a missing file simply leaves it unset.
		const userClaudeMd = path.join(claudeConfigDir(os.homedir()), "CLAUDE.md");
		const userContent = readContextFile(userClaudeMd);
		const memory: {
			userContext?: { path: string; content: string };
			localContexts: Array<{ path: string; content: string }>;
			projectDotClaude?: { path: string; content: string };
		} = {
			userContext: userContent !== undefined ? { path: userClaudeMd, content: userContent } : undefined,
			localContexts: [],
		};

		// CLAUDE.local.md is Claude Code's personal sidecar of CLAUDE.md; pi's own loader
		// skips it. A cloned repo can ship one, so it is gated like other project config.
		// Claude loads local context from the whole hierarchy above the working
		// directory, ordered root down to cwd; the walk is bounded at the repository
		// root like every other project-config search here. The project-scope alternate
		// ./.claude/CLAUDE.md (nearest at or above cwd) is repo-controlled too, so both
		// ride the one approval decision.
		const candidates = ancestorFiles(ctx.cwd, "CLAUDE.local.md");
		const nearestDotClaudeMd = findNearestFile(ctx.cwd, path.join(".claude", "CLAUDE.md"));
		// From $HOME (or under a dotfiles repo rooted there) the nearest one is the user's own
		// ~/.claude/CLAUDE.md, already loaded above as User memory: not a project file, so no
		// second block and nothing to approve.
		const dotClaudeMd =
			nearestDotClaudeMd !== null && sameLocation(nearestDotClaudeMd, userClaudeMd) ? null : nearestDotClaudeMd;
		if ((candidates.length === 0 && dotClaudeMd === null) || !(await isProjectApproved(ctx))) return memory;

		readProjectMemory(memory, candidates, dotClaudeMd);
		return memory;
	}

	nycode.on("session_start", async (_event, ctx) => {
		// pi's ctx.reload() rebuilds extension instances, so this set never survives
		// a reload anyway; a reload simply re-fires InstructionsLoaded once per file,
		// which is fine, since a reload re-loads the instruction files.
		announced.clear();
		envCache = undefined;
		importMemo = undefined;
		const memory = await loadSessionMemory(ctx);
		localContexts = memory.localContexts;
		userContext = memory.userContext;
		projectDotClaude = memory.projectDotClaude;
		// Read after the local-context flow so an approval it just recorded is honored.
		projectApproved = isProjectApprovedSilently(ctx);
		gatedFilesApproved = isGatedFileApproved(ctx);
	});

	/** The launch-time expansion, asking about what it refuses for leaving the project
	 * when this project has not been asked yet.
	 *
	 * Claude asks once per project and remembers the answer either way. The list is what
	 * this very expansion refused, so it names exactly the files the answer governs, and
	 * on approval the expansion is simply redone with the wider roots. */
	const expandAskingAboutExternals = async (
		cwd: string,
		ctx: ExtensionContext | undefined,
		expandWith: (externalApproved: boolean) => {
			extras: Array<{ path: string; content: string; dir: string }>;
			budget: ImportBudget;
			imported: ImportedFile[];
		},
	): Promise<{
		extras: Array<{ path: string; content: string; dir: string }>;
		budget: ImportBudget;
		imported: ImportedFile[];
	}> => {
		const key = externalImportKey(cwd);
		const decided = externalImportDecision(key);
		const result = expandWith(decided === true);
		if (decided !== null || result.budget.refusedPresent.size === 0 || ctx?.hasUI !== true) return result;
		const approved = await askExternalImports(ctx, key, result.budget.refusedPresent);
		rememberExternalImportDecision(key, approved);
		return approved ? expandWith(true) : result;
	};

	const addDirsFlagValue = (): string =>
		additionalDirsClaudeMdEnabled() ? String(nycode.getFlag?.("add-dir") ?? "") : "";

	const environmentFor = (cwd: string, home: string): NonNullable<typeof envCache> => {
		if (envCache?.cwd !== cwd) {
			const managedNow = readManagedSettings();
			envCache = {
				cwd,
				managed: managedNow,
				excludeGlobs: readClaudeMdExcludes(claudeMdExcludeFiles(cwd, home, projectApproved), managedNow),
				projectRoot: checkoutRoot(cwd),
			};
		}
		return envCache;
	};

	nycode.on("before_agent_start", async (event, ctx) => {
		const home = os.homedir();
		const cwd = event.systemPromptOptions?.cwd ?? process.cwd();
		const native: Array<{ path: string; content: string }> = event.systemPromptOptions?.contextFiles ?? [];

		const { managed, excludeGlobs, projectRoot } = environmentFor(cwd, home);
		// CLAUDE_CODE_DISABLE_CLAUDE_MDS also covers pi's own auto-discovered native context
		// files ("including... auto memory files"), which session_start's gate cannot reach
		// since pi loads them itself. Routing through the exclusion path already used for
		// claudeMdExcludes drops the block, strips the InstructionsLoaded event, and skips
		// import expansion for it, exactly as an excluded file already does.
		const excluded = (absPath: string): boolean =>
			process.env.CLAUDE_CODE_DISABLE_CLAUDE_MDS === "1" || isExcludedPath(absPath, excludeGlobs, home);

		// claudeMdExcludes drops an excluded file's block from the assembled prompt and
		// from import expansion; surviving blocks get block-level comments stripped.
		const rewrite = rewriteNativeBlocks(event.systemPrompt, native, excluded);
		let prompt = rewrite.prompt;
		let changed = rewrite.changed;
		// Exclusion is owned here, so the session_start InstructionsLoaded events for
		// pi's native context files are published here too, only for files that
		// survived it: Claude fires no event for a file it never loaded. The hooks
		// extension consumes them off the shared bus.
		for (const file of rewrite.kept) {
			announce({
				file_path: file.path,
				memory_type: memoryTypeForPath(file.path, home, projectRoot),
				load_reason: "session_start",
			});
		}

		// The user CLAUDE.md is the user's own file (no approval gate) but respects
		// claudeMdExcludes and comment-stripping like every other file. It is kept here so it
		// both gets its own block (via prependMemoryBlocks) and joins the import-expansion set
		// below, so its @imports resolve.
		const keptUser = keptMemoryFile(userContext, excluded);

		// Prepend the managed and user memory blocks (managed file, managed key, user), the
		// blocks Claude loads ahead of pi's native project context. managedFile comes back
		// because it also seeds the import memo key below.
		const top = prependMemoryBlocks(prompt, changed, keptUser, managed, announce);
		prompt = top.prompt;
		changed = top.changed;
		const managedFile = top.managedFile;

		const keptLocals = localContexts
			.filter((local) => !excluded(local.path))
			.map((local) => ({ path: local.path, content: stripBlockComments(local.content) }));

		// Repo-controlled text, so gated on the same approval as the locals and the
		// ./.claude/CLAUDE.md; read here rather than at session start because only the
		// turn's contextFiles say which file pi actually chose per directory.
		const keptSiblings = (projectApproved ? siblingClaudeMdFiles(native) : [])
			.filter((sibling) => !excluded(sibling.path))
			.map((sibling) => ({ path: sibling.path, content: stripBlockComments(sibling.content) }));

		// Its @imports resolve at project roots (rootsForImporter).
		const keptProjectDotClaude = keptDotClaudeMd(projectDotClaude, native, keptSiblings, excluded);

		// The user CLAUDE.md and ./.claude/CLAUDE.md join the import-expansion set so their
		// @imports resolve (each at roots scoped to it, via rootsForImporter); their own
		// bodies are placed separately, so expansion only surfaces what they import.
		const contextFiles = [
			...rewrite.kept,
			...presentFile(keptUser),
			...keptSiblings,
			...presentFile(keptProjectDotClaude),
			...keptLocals,
		];

		// Everything the expansion depends on, hashed: a turn whose inputs match the memo
		// and whose recorded mtimes are unchanged reuses the previous expansion outright.
		const addDirsRaw = addDirsFlagValue();
		const expandWith = (externalApproved: boolean) => {
			const memoKey = buildImportMemoKey({
				cwd,
				home,
				projectApproved,
				externalApproved,
				addDirsRaw,
				excludeGlobs,
				native,
				localContexts,
				userContext,
				projectDotClaude,
				managedFile,
				contextFiles,
			});
			return resolveImports(
				memoKey,
				{ native, context: contextFiles, siblings: keptSiblings },
				{ home, cwd, excluded, externalApproved },
			);
		};

		// Claude's external-import dialog. Asked from the refusals the expansion just
		// produced, so the files named are exactly the files the answer governs, and asked
		// here rather than at session start because only this event knows which context
		// files pi actually loaded. Once per project: the answer is remembered either way.
		const { extras, budget, imported } = await expandAskingAboutExternals(cwd, ctx, expandWith);
		launchLoadedPaths = realRoots([...contextFiles.map((file) => file.path), ...imported.map((entry) => entry.path)]);

		// Project memory precedes local memory, so the ./.claude/CLAUDE.md block leads the
		// additions, ahead of the CLAUDE.local.md bodies.
		let addition = siblingClaudeMdAddition(keptSiblings, home, projectRoot, announce);
		addition += projectContextAddition(keptProjectDotClaude, home, projectRoot, announce);
		addition += localContextAddition(keptLocals, announce);
		addition += additionalDirsAddition(extras, announce);
		addition += importedAddition(imported, budget, home, projectRoot, announce);
		const refusedNotice = refusedImportsAddition(budget.refused);
		addition += refusedNotice;

		const entries = memoryEntries(
			{
				managedFile,
				managedKey: managed.claudeMd,
				user: keptUser,
				native: rewrite.kept,
				siblings: keptSiblings,
				alternate: keptProjectDotClaude,
				locals: keptLocals,
				extras,
				imported,
			},
			{ config: claudeConfigDir(home), cwd },
		);
		if (deliverThroughOptions(event, entries, memoryNotices(budget, refusedNotice))) return;
		if (!changed && addition.length === 0) return;

		return { systemPrompt: prompt + addition };
	});

	// Claude's nested traversal: CLAUDE.md and CLAUDE.local.md below the working
	// directory are not loaded at launch but "are included when Claude reads files in
	// those subdirectories" (memory.md). pi's loader stops at cwd, so the whole
	// below-cwd range is missing; this attaches each one to the tool result that
	// touched its directory, which is the same seam claude-rules uses for a scoped
	// rule. Once per file per session, ordered shallowest first so the deepest
	// instructions are read last, matching the launch-time ordering.
	nycode.on("tool_result", (event, ctx) => {
		// A nested file is a CLAUDE.md memory file too, which this variable turns off.
		if (process.env.CLAUDE_CODE_DISABLE_CLAUDE_MDS === "1") return;
		const rel = fileToolTarget(event);
		if (rel === undefined) return;
		// Repo-controlled text, gated like every other project file this extension adds.
		if (!projectApproved) return;
		// Realpath both sides: the walk below is lexical, so a symlinked subdirectory
		// would otherwise carry it straight out of the project.
		const [realCwd = ctx.cwd] = realRoots([ctx.cwd]);
		const touched = path.resolve(ctx.cwd, rel);
		// The directory, not the file: a write creates its target, and a read of a path
		// that has since moved should still contribute what its directory holds.
		const [touchedDir] = realRoots([path.dirname(touched)]);
		if (touchedDir === undefined) return;

		const home = os.homedir();
		const projectRoot = checkoutRoot(ctx.cwd);
		const excludeGlobs = readClaudeMdExcludes(
			claudeMdExcludeFiles(ctx.cwd, home, projectApproved),
			readManagedSettings(),
		);
		const load: NestedLoadContext = {
			home,
			cwd: ctx.cwd,
			realCwd,
			projectRoot,
			excludeGlobs,
			touched,
			launchLoaded: launchLoadedPaths,
		};
		const { bodies, events } = nestedContextAttachments(touchedDir, load, nestedLoaded, gatedFilesApproved);
		for (const loaded of events) announce(loaded);
		if (bodies.length === 0) return;
		// Capped like every other tool output: one read in a deep subtree must not be
		// able to spend the context window on memory files.
		return { content: [...event.content, { type: "text" as const, text: capForContext(bodies.join("\n\n")) }] };
	});
}

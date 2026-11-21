import * as fs from "node:fs";
import * as path from "node:path";
import { CONFIG_DIR_NAME } from "../../config.ts";
import type { ExtensionContext } from "../../core/extensions/types.ts";
import { checkoutRoot, repoRoot } from "../_shared/project/project-root.ts";
import { claudeConfigDir } from "../_shared/settings/config-dir.ts";
import { type Fence, fenceMarker, stepFence, stripBlockComments } from "../_shared/shell/strip-comments.ts";
import { realpathOr } from "../_shared/util/values.ts";
import { sliceBytes } from "../_shared/web/output-guard.ts";

/** Claude documents "a maximum depth of four hops" for recursive imports. */
const MAX_IMPORT_DEPTH = 4;

export const MAX_IMPORT_FILES = 50;
export const MAX_IMPORT_BYTES = 256 * 1024;

export function expandHome(target: string, home: string): string {
	if (target === "~") return home;
	if (target.startsWith("~/")) return path.join(home, target.slice(2));
	return target;
}

/** Stands for "no boundary" in an allowed-roots list: the grant a project gets when
 * its external imports are approved, where a file may import from anywhere as Claude's
 * dialog allows. A real path never equals it, and realRoots never produces it. */
const ANY_ROOT = "*";

export function isUnder(target: string, roots: string[]): boolean {
	return roots.some((root) => root === ANY_ROOT || target === root || target.startsWith(root + path.sep));
}

/** Realpath the roots that exist; used both to seed and to bound the import search. */
export function realRoots(candidates: string[]): string[] {
	const roots: string[] = [];
	for (const candidate of candidates) {
		try {
			roots.push(fs.realpathSync(candidate));
		} catch {
			// a root that does not exist has nothing under it to allow
		}
	}
	return roots;
}

export interface ImportedFile {
	path: string;
	body: string;
	/** The file whose `@path` pulled this one in, for InstructionsLoaded's parent_file_path. */
	parent?: string;
}

/** Appended to the last body the byte budget could only partly pay for. */
export const IMPORT_TRUNCATED_MARKER = "[truncated: import byte budget exhausted]";

/** Remaining import allowance, shared across every context file of one run. */
export interface ImportBudget {
	files: number;
	bytes: number;
	dropped: number;
	/** Every @import target that resolves outside the importer's allowed roots, whether or not
	 * it exists: the notice to the model must not reveal which of a repo's guesses do. */
	refused: Set<string>;
	/** The subset of `refused` that is an existing file, which is what an approval would
	 * load and so what the user's dialog is about. */
	refusedPresent: Set<string>;
}

export const createImportBudget = (): ImportBudget => ({
	files: MAX_IMPORT_FILES,
	bytes: MAX_IMPORT_BYTES,
	dropped: 0,
	refused: new Set(),
	refusedPresent: new Set(),
});

/** The `@path` targets of a context file, in document order. Claude Code evaluates
 * imports neither in fenced code blocks (backtick or tilde) nor in inline spans. */
function importTargets(content: string): string[] {
	const targets: string[] = [];
	// CommonMark fences: closed only by the same character in a run at least as long
	// as the opener, so a backtick example may hold tilde lines or shorter fences.
	let fence: Fence | null = null;
	for (const line of content.split("\n")) {
		const trimmed = line.trimStart();
		const step = stepFence(fence, trimmed, fenceMarker(trimmed));
		fence = step.fence;
		if (step.fenced) continue;
		// Backreference so a multi-backtick span (``literal `@x` backticks``) strips whole.
		const withoutSpans = line.replace(/(`+)[^`]*?\1/g, "");
		for (const match of withoutSpans.matchAll(/(^|\s)@(\S+)/g)) targets.push(match[2]);
	}
	return targets;
}

function isRegularFile(target: string): boolean {
	try {
		return fs.statSync(target).isFile();
	} catch {
		return false;
	}
}

/** Read one `@path` target, or null when it is unresolvable, already seen, outside `allowedRoots`, excluded, or unreadable. */
function readImport(
	target: string,
	fromDir: string,
	home: string,
	allowedRoots: string[],
	seen: Set<string>,
	isExcluded: ((realPath: string) => boolean) | undefined,
	refusals: Pick<ImportBudget, "refused" | "refusedPresent">,
): { real: string; body: string } | null {
	const resolved = path.resolve(fromDir, expandHome(target, home));
	// Always the path the importing file named, never where a symlink pointed: the
	// notice would otherwise hand a repo the real name of whatever the link reaches,
	// which is the disclosure the refusal exists to prevent. An excluded file is not
	// named either, since exclusion removes it from every other surface too.
	const refuse = (isFile: boolean): void => {
		if (isExcluded?.(resolved) === true) return;
		refusals.refused.add(resolved);
		if (isFile) refusals.refusedPresent.add(resolved);
	};
	let real: string;
	try {
		real = fs.realpathSync(resolved);
	} catch {
		// Not on disk. Still refused when it points outside, so that whether a path is
		// reported never depends on whether it exists: a notice that named only the
		// existing ones would enumerate the filesystem for any repo-controlled file
		// willing to write one @line per guess.
		// Compared through its nearest existing ancestor's real path, as the roots are: a
		// session reached through a symlink otherwise reported its own missing files as
		// outside the project.
		if (!isUnder(realpathOr(resolved), allowedRoots)) refuse(false);
		return null;
	}
	if (seen.has(real)) return null;
	if (!isUnder(real, allowedRoots)) {
		refuse(isRegularFile(real));
		return null;
	}
	// Checked before the read so an excluded file contributes nothing: no body, no
	// transitive imports, no budget spend, no announce. A post-collection filter
	// would drop the file itself but keep its children.
	// Both spellings count, as the rules loader does: a glob written against the symlink's
	// own path and one written against its target each exclude it.
	if (isExcluded?.(real) || isExcluded?.(resolved)) return null;
	try {
		// real may be a directory (EISDIR) or vanish after the realpath (ENOENT/EACCES).
		const body = fs.readFileSync(real, "utf-8");
		// Only a consumed file dedupes: marking a blocked or unreadable target seen
		// would let one reader's failure suppress the import for a later, allowed one.
		seen.add(real);
		// A file another importer already refused is in context after all; the notice
		// must not claim otherwise.
		refusals.refused.delete(resolved);
		refusals.refusedPresent.delete(resolved);
		return { real, body };
	} catch {
		return null;
	}
}

/** Optional controls for a collection run: the byte/file budget shared across the
 * whole run, the path of the file this content came from (seeds each top-level
 * import's `parent`), and the exclusion predicate. Recursion depth is internal. */
export interface CollectImportsOptions {
	budget?: ImportBudget;
	importer?: string;
	isExcluded?: (realPath: string) => boolean;
}

/** The parts of a collection run that stay fixed across the recursion: resolution
 * roots, the seen/budget accumulators, and the exclusion predicate. Only content,
 * fromDir, depth and the parent path change from one level to the next. */
interface ImportScan {
	home: string;
	allowedRoots: string[];
	seen: Set<string>;
	budget: ImportBudget;
	isExcluded?: (realPath: string) => boolean;
}

/** One recursion level: read the imports named in `content`, then recurse into each. */
function collectFrom(
	scan: ImportScan,
	content: string,
	fromDir: string,
	depth: number,
	importer?: string,
): ImportedFile[] {
	if (depth >= MAX_IMPORT_DEPTH) return [];
	const out: ImportedFile[] = [];
	for (const target of importTargets(content)) {
		// Checked before the read so an exhausted budget costs no I/O.
		if (scan.budget.files === 0 || scan.budget.bytes === 0) {
			scan.budget.dropped += 1;
			continue;
		}
		const file = readImport(target, fromDir, scan.home, scan.allowedRoots, scan.seen, scan.isExcluded, scan.budget);
		if (!file) continue;
		scan.budget.files -= 1;
		// The budget is bytes: a string slice counts UTF-16 units and lets CJK text through
		// at three times the budget without ever reaching the truncation marker.
		const kept = sliceBytes(file.body, scan.budget.bytes);
		scan.budget.bytes -= Buffer.byteLength(kept);
		const body = kept.length < file.body.length ? `${kept.trim()}\n${IMPORT_TRUNCATED_MARKER}` : kept.trim();
		// Comments are stripped before the scan for further imports, so a
		// commented-out @import stays dead at every depth, matching the top level
		// (whose bodies arrive here already stripped by the caller).
		out.push(
			{ path: file.real, body, parent: importer },
			...collectFrom(scan, stripBlockComments(kept), path.dirname(file.real), depth + 1, file.real),
		);
	}
	return out;
}

/**
 * Collect the contents of every file transitively imported via `@path`, in
 * discovery order. Imports are resolved through symlinks and kept within
 * `allowedRoots` (which must already be realpath'd).
 */
export function collectImports(
	content: string,
	fromDir: string,
	home: string,
	allowedRoots: string[],
	seen: Set<string>,
	options: CollectImportsOptions = {},
): ImportedFile[] {
	const scan: ImportScan = {
		home,
		allowedRoots,
		seen,
		budget: options.budget ?? createImportBudget(),
		isExcluded: options.isExcluded,
	};
	return collectFrom(scan, content, fromDir, 0, options.importer);
}

/**
 * Roots an importing file may pull from.
 *
 * A file under the user's own config may import from anywhere: Claude's user-scope memory
 * files "are files you wrote yourself", and it loads their imports without the dialog and
 * trusts them like the rest of the user's configuration. A project file may not, so a cloned
 * repo's `CLAUDE.md` cannot read `~/.claude` (`.credentials.json`, global settings, every
 * project's transcripts) into the system prompt.
 *
 * "Under the user's config" is judged by the path pi reported as well as its realpath: a
 * dotfiles manager such as GNU stow links `~/.claude/CLAUDE.md` to a repository, so the
 * real path is outside `~/.claude` although the user put the link there.
 */
export function rootsForImporter(importer: string, home: string, cwd: string, externalApproved = false): string[] {
	const userConfig = [claudeConfigDir(home), path.join(home, CONFIG_DIR_NAME)];
	const [real] = realRoots([importer]);
	const fromUserConfig =
		isUnder(path.resolve(importer), userConfig) || (real !== undefined && isUnder(real, realRoots(userConfig)));
	if (fromUserConfig) return [ANY_ROOT];
	// The project was asked about its external imports and allowed them, so a project
	// file may reach outside, as Claude's dialog grants. User-config files returned above
	// already import from anywhere, with no approval involved.
	if (externalApproved) return [ANY_ROOT];
	// A non-config file is bounded at the repository root: that covers an ancestor
	// context file (a repo-root CLAUDE.md or CLAUDE.local.md in a subdirectory
	// session, where cwd alone silently dropped its relative imports) without
	// granting the importer's own directory. pi also loads home-level context
	// files (~/AGENTS.md) that sit outside the config roots; their directory is
	// $HOME, and allowing it would let @.ssh/... read into every session's prompt.
	// The checkout the session runs in, and the main checkout too: in a worktree they are
	// siblings, and the checkout's own files (docs/, a sibling CLAUDE.md) are as much the
	// project as the shared root a CLAUDE.local.md may live at.
	return realRoots([cwd, checkoutRoot(cwd), repoRoot(cwd) ?? cwd]);
}

/** The parts of one launch-time expansion that every file shares: where it runs, what
 * has already been read, the budget they all draw on, and whether this project's
 * external imports were approved. */
interface ExpansionContext {
	home: string;
	cwd: string;
	seen: Set<string>;
	excluded: (absPath: string) => boolean;
	budget: ImportBudget;
	externalApproved: boolean;
}

/** Resolve every context and additional-dir file's @imports through the one shared
 * budget, each with roots scoped to the importing file so a project file never
 * reaches user config unless the project's external imports were approved. */
export function expandImports(
	contextFiles: Array<{ path: string; content: string }>,
	extras: Array<{ path: string; content: string; dir: string }>,
	run: ExpansionContext,
): ImportedFile[] {
	const imported: ImportedFile[] = [];
	const options = { budget: run.budget, isExcluded: run.excluded };
	for (const file of contextFiles) {
		const allowedRoots = rootsForImporter(file.path, run.home, run.cwd, run.externalApproved);
		imported.push(
			...collectImports(file.content, path.dirname(file.path), run.home, allowedRoots, run.seen, {
				...options,
				importer: file.path,
			}),
		);
	}
	// An additional dir's refusals are reported but not asked about: the approval is stored
	// for the project and widens project files only, and --add-dir changes per run, so a
	// yes here would cover whatever directory a later run adds. They stay in `refused` for
	// the notice; only the dialog's list drops them.
	const askable = new Set(run.budget.refusedPresent);
	for (const extra of extras) {
		// The additional dir itself is an allowed root, so its files' relative imports
		// resolve even from .claude/rules two levels down.
		const allowedRoots = [...realRoots([extra.dir]), ...rootsForImporter(extra.path, run.home, run.cwd)];
		imported.push(
			...collectImports(extra.content, path.dirname(extra.path), run.home, allowedRoots, run.seen, {
				...options,
				importer: extra.path,
			}),
		);
	}
	for (const file of run.budget.refusedPresent) {
		if (!askable.has(file)) run.budget.refusedPresent.delete(file);
	}
	return imported;
}

/** The external-import dialog's title. Exported so a test can tell it apart from the
 * project-trust dialog by identity rather than by matching a prefix that a retitle
 * would silently break. */
export const EXTERNAL_IMPORT_PROMPT_TITLE = "Load imports from outside this project?";

/** Ask about the imports the expansion just refused for leaving the project.
 *
 * The list is the refusals the enforcing path produced, not a second enumeration of
 * what it might refuse: same files, same depth, same resolution, same exclusions. That
 * is the only way the dialog can promise it names everything the approval lets in. Only
 * files that exist are listed, as in Claude, which asks about the external files it read:
 * a prose `@/components/ui` names nothing an approval could load.
 */
export async function askExternalImports(
	ctx: ExtensionContext,
	root: string,
	refused: ReadonlySet<string>,
): Promise<boolean> {
	const listed = [...refused]
		.sort((a, b) => a.localeCompare(b, "en"))
		.map((file) => `  ${file}`)
		.join("\n");
	const body = `${root}\n\nIts context files import these files from outside the project:\n\n${listed}\n\nThey will be read into every session's context. Only allow this for repositories you trust.`;
	return await ctx.ui.confirm(EXTERNAL_IMPORT_PROMPT_TITLE, body);
}

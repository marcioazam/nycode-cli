import * as fs from "node:fs";
import * as path from "node:path";
import { AGENTS_FILE_NAMES } from "../_shared/project/context-files.ts";
import { managedSettingsPath } from "../_shared/settings/managed-settings.ts";
import { stripBlockComments } from "../_shared/shell/strip-comments.ts";
import { expandHome, realRoots } from "./imports.ts";

/** Claude loads a context file (CLAUDE.md and friends) of up to 4 MiB in full and
 * skips a larger one. */
const CONTEXT_FILE_MAX_BYTES = 4 * 1024 * 1024;

/** One context file's content, or undefined when it is absent, unreadable, or over
 * the 4 MiB limit Claude documents. */
export function readContextFile(filePath: string): string | undefined {
	try {
		if (fs.statSync(filePath).size > CONTEXT_FILE_MAX_BYTES) return undefined;
		return fs.readFileSync(filePath, "utf-8");
	} catch {
		return undefined;
	}
}

/** Claude's env gate for loading memory files from --add-dir directories. */
const ADDITIONAL_DIRS_ENV = "CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD";

/** Whether the env gate is on. Claude documents `=1`; any value that is not
 * empty/0/false/no counts, so `=true` behaves as a user would expect. */
export function additionalDirsClaudeMdEnabled(env: Record<string, string | undefined> = process.env): boolean {
	const value = env[ADDITIONAL_DIRS_ENV]?.trim().toLowerCase();
	return value !== undefined && value !== "" && value !== "0" && value !== "false" && value !== "no";
}

/** Additional directories from the `add-dir` flag value. pi's getFlag is
 * single-value, so a repeated `--add-dir a --add-dir b` cannot be expressed;
 * a comma-separated value (`--add-dir a,b`) carries multiple dirs instead.
 * `~` expands to home and relative paths resolve against cwd. */
export function parseAdditionalDirs(flagValue: unknown, home: string, cwd: string): string[] {
	if (typeof flagValue !== "string") return [];
	return flagValue
		.split(",")
		.map((entry) => entry.trim())
		.filter(Boolean)
		.map((entry) => path.resolve(cwd, expandHome(entry, home)));
}

/** The memory files Claude loads from one --add-dir directory when the env gate
 * is set: CLAUDE.md, .claude/CLAUDE.md, .claude/rules/*.md and CLAUDE.local.md.
 * The local file is approval-gated like the session's own CLAUDE.local.md, so
 * `includeLocal` reflects that decision. Missing or unreadable files are skipped. */
export function additionalDirContextFiles(
	dir: string,
	includeLocal: boolean,
): Array<{ path: string; content: string }> {
	const candidates = [path.join(dir, "CLAUDE.md"), path.join(dir, ".claude", "CLAUDE.md")];
	const rulesDir = path.join(dir, ".claude", "rules");
	try {
		const names = fs
			.readdirSync(rulesDir)
			.filter((name) => name.endsWith(".md"))
			// Pinned locale: the default collator follows the host locale, which
			// reorders names like ch/ci/h and makes prompt content machine-dependent.
			.sort((a, b) => a.localeCompare(b, "en"));
		candidates.push(...names.map((name) => path.join(rulesDir, name)));
	} catch {
		// no rules directory in this additional dir
	}
	if (includeLocal) candidates.push(path.join(dir, "CLAUDE.local.md"));
	const files: Array<{ path: string; content: string }> = [];
	for (const candidate of candidates) {
		const content = readContextFile(candidate);
		if (content !== undefined) files.push({ path: candidate, content });
	}
	return files;
}

/** Path label given to the managed claudeMd settings-key block; not a file pi loaded. */
export const MANAGED_CLAUDE_MD_PATH = "managed-settings.json (claudeMd)";

let managedClaudeMdPathOverride: string | undefined;

/** Test seam mirroring setManagedSettingsPath: point the managed CLAUDE.md file
 * readers consult at a writable directory. */
export function setManagedClaudeMdPath(file?: string): void {
	managedClaudeMdPathOverride = file;
}

/** The managed CLAUDE.md file path: alongside managed-settings.json, in the same OS
 * directory IT deploys the enterprise policy to (managed-settings.ts owns that
 * directory per platform). Organizations ship a CLAUDE.md there to load before user
 * and project context. Overridable for tests. */
export function managedClaudeMdPath(): string {
	return managedClaudeMdPathOverride ?? path.join(path.dirname(managedSettingsPath()), "CLAUDE.md");
}

/** The managed CLAUDE.md file body, or '' when absent or unreadable. */
export function readManagedClaudeMdFile(): string {
	try {
		return fs.readFileSync(managedClaudeMdPath(), "utf-8");
	} catch {
		return "";
	}
}

/** Claude's --add-dir memory files, minus any pi already loaded natively (added to
 * `seenSet` here so an @import cannot pull one in twice) and any the excludes drop
 * or that strip to nothing. Each survivor is comment-stripped and tagged with its
 * additional dir, so its relative imports can resolve from there. */
export function additionalDirExtras(
	addDirs: string[],
	seenSet: Set<string>,
	excluded: (absPath: string) => boolean,
	includeLocal: boolean,
): Array<{ path: string; content: string; dir: string }> {
	const extras: Array<{ path: string; content: string; dir: string }> = [];
	for (const dir of addDirs) {
		for (const file of additionalDirContextFiles(dir, includeLocal)) {
			const [real] = realRoots([file.path]);
			const key = real ?? file.path;
			if (seenSet.has(key)) continue; // pi already loaded it natively
			seenSet.add(key);
			if (excluded(file.path)) continue;
			const stripped = stripBlockComments(file.content);
			if (stripped.trim().length === 0) continue;
			extras.push({ path: file.path, content: stripped, dir });
		}
	}
	return extras;
}

/** The CLAUDE.md files pi passed over.
 *
 * Claude Code reads CLAUDE.md and never AGENTS.md, and its documented recipe for a
 * repository that already has an AGENTS.md is a CLAUDE.md that imports it and adds
 * Claude-specific instructions below (memory.md, "AGENTS.md"). pi loads one context
 * file per directory and prefers AGENTS.md, so on exactly that layout the
 * Claude-specific half never reaches the prompt. Each one found here is loaded like
 * any other project file: exclude-checked, comment-stripped, imports expanded.
 *
 * The `@AGENTS.md` the recipe opens with costs nothing: pi's own file paths already
 * seed the import seen-set, so the body it names is not injected a second time. */
export function siblingClaudeMdFiles(
	native: Array<{ path: string; content: string }>,
): Array<{ path: string; content: string }> {
	const loaded = new Set(realRoots(native.map((file) => file.path)));
	const found: Array<{ path: string; content: string }> = [];
	for (const file of native) {
		if (!AGENTS_FILE_NAMES.has(path.basename(file.path))) continue;
		// CLAUDE.md only: pi also answers to CLAUDE.MD, but Claude Code reads the one
		// spelling, and on a case-insensitive filesystem looking for both finds the same
		// file twice under two names.
		const candidate = path.join(path.dirname(file.path), "CLAUDE.md");
		const [real] = realRoots([candidate]);
		if (real !== undefined && loaded.has(real)) continue;
		const content = readContextFile(candidate);
		if (content === undefined) continue;
		found.push({ path: candidate, content });
	}
	return found;
}

/** An approved project's CLAUDE.local.md files and ./.claude/CLAUDE.md, read into the
 * session memory. A file that cannot be read is skipped. */
export function readProjectMemory(
	memory: {
		localContexts: Array<{ path: string; content: string }>;
		projectDotClaude?: { path: string; content: string };
	},
	candidates: string[],
	dotClaudeMd: string | null,
): void {
	for (const candidate of candidates) {
		const content = readContextFile(candidate);
		if (content !== undefined) memory.localContexts.push({ path: candidate, content });
	}
	if (dotClaudeMd !== null) {
		const content = readContextFile(dotClaudeMd);
		if (content !== undefined) memory.projectDotClaude = { path: dotClaudeMd, content };
	}
}

/** The file as a list of zero or one entries, for spreading into the expansion set. */
export function presentFile(
	file: { path: string; content: string } | undefined,
): Array<{ path: string; content: string }> {
	return file !== undefined ? [file] : [];
}

/** A memory file that survives claudeMdExcludes, block comments stripped. */
export function keptMemoryFile(
	file: { path: string; content: string } | undefined,
	excluded: (absPath: string) => boolean,
): { path: string; content: string } | undefined {
	return file !== undefined && !excluded(file.path)
		? { path: file.path, content: stripBlockComments(file.content) }
		: undefined;
}

/** ./.claude/CLAUDE.md, deduped against pi's native context so that if pi ever loads it
 * too there is no double block, then exclude-checked and comment-stripped like the rest. */
export function keptDotClaudeMd(
	projectDotClaude: { path: string; content: string } | undefined,
	native: Array<{ path: string; content: string }>,
	keptSiblings: Array<{ path: string; content: string }>,
	excluded: (absPath: string) => boolean,
): { path: string; content: string } | undefined {
	const nativeReal = new Set(realRoots(native.map((file) => file.path)));
	const [dotReal] = projectDotClaude !== undefined ? realRoots([projectDotClaude.path]) : [];
	const siblingReal = new Set(realRoots(keptSiblings.map((sibling) => sibling.path)));
	return projectDotClaude !== undefined &&
		!(dotReal !== undefined && (nativeReal.has(dotReal) || siblingReal.has(dotReal))) &&
		!excluded(projectDotClaude.path)
		? { path: projectDotClaude.path, content: stripBlockComments(projectDotClaude.content) }
		: undefined;
}

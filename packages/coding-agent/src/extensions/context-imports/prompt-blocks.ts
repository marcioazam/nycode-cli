import * as path from "node:path";
import { type InstructionLoadEvent, memoryTypeForPath } from "../_shared/events/instruction-events.ts";
import { stripBlockComments } from "../_shared/shell/strip-comments.ts";
import { type ImportBudget, type ImportedFile, MAX_IMPORT_BYTES, MAX_IMPORT_FILES } from "./imports.ts";
import { MANAGED_CLAUDE_MD_PATH, managedClaudeMdPath, readManagedClaudeMdFile } from "./sources.ts";

/** pi's exact per-file wrapper inside <project_context>, reconstructed from
 * path+content for exact-substring rewriting. tests/context-imports.test.ts pins
 * this format against pi's own source so drift fails loudly instead of silently
 * turning every rewrite into a no-op. */
export function instructionsBlock(filePath: string, content: string): string {
	return `<project_instructions path="${filePath}">\n${content}\n</project_instructions>`;
}

/** pi's <project_context> opener, the anchor the managed block is inserted after. */
const CONTEXT_OPENER = "<project_context>\n\nProject-specific instructions and guidelines:\n\n";

/** The opener as pi 0.86 and later renders it, which is the layout a forced prompt has
 * there: one newline after the tag. */
const SECTION_OPENER = "<project_context>\nProject-specific instructions and guidelines:\n\n";

/** Remove a context block, preferring the shape pi assembles (trailing blank line). */
function removeBlock(prompt: string, wrapper: string): string | null {
	for (const needle of [`${wrapper}\n\n`, wrapper]) {
		const at = prompt.indexOf(needle);
		if (at !== -1) return prompt.slice(0, at) + prompt.slice(at + needle.length);
	}
	return null;
}

/** Replace one context block. String#replace is unsafe here: `$&` and friends in
 * file content are replacement patterns. Splice by index instead. */
function replaceBlock(prompt: string, wrapper: string, replacement: string): string | null {
	const at = prompt.indexOf(wrapper);
	if (at === -1) return null;
	return prompt.slice(0, at) + replacement + prompt.slice(at + wrapper.length);
}

/** Insert a block at the top of <project_context>, before the files pi loaded;
 * when pi assembled no context block, add one in pi's shape. Used for the blocks
 * Claude loads ahead of pi's native project context: managed claudeMd (file then
 * key) and the user CLAUDE.md. Each call prepends, so the last block inserted ends
 * up highest, which is how the managed/user/native order is built (see caller). */
function withTopBlock(prompt: string, block: string): string {
	for (const anchor of [CONTEXT_OPENER, SECTION_OPENER, "<project_context>\n\n"]) {
		const at = prompt.indexOf(anchor);
		if (at === -1) continue;
		const insert = at + anchor.length;
		return `${prompt.slice(0, insert)}${block}\n\n${prompt.slice(insert)}`;
	}
	return `${prompt}\n\n${CONTEXT_OPENER}${block}\n\n</project_context>\n`;
}

/** Apply claudeMdExcludes and comment-stripping to pi's native context blocks,
 * rewriting the assembled prompt by exact substring: an excluded file's block is
 * removed, a surviving file's block is replaced with its comment-stripped body. A
 * wrapper not found in the prompt is skipped rather than risk corrupting it.
 * Returns the rewritten prompt and the files that survived exclusion (stripped). */
export function rewriteNativeBlocks(
	prompt: string,
	native: Array<{ path: string; content: string }>,
	excluded: (absPath: string) => boolean,
): { prompt: string; changed: boolean; kept: Array<{ path: string; content: string }> } {
	let changed = false;
	const kept: Array<{ path: string; content: string }> = [];
	for (const file of native) {
		const wrapper = instructionsBlock(file.path, file.content);
		if (excluded(file.path)) {
			const removed = removeBlock(prompt, wrapper);
			if (removed !== null) {
				prompt = removed;
				changed = true;
			}
			continue;
		}
		const stripped = stripBlockComments(file.content);
		if (stripped !== file.content) {
			const replaced = replaceBlock(prompt, wrapper, instructionsBlock(file.path, stripped));
			if (replaced !== null) {
				prompt = replaced;
				changed = true;
			}
		}
		kept.push({ path: file.path, content: stripped });
	}
	return { prompt, changed, kept };
}

/** The CLAUDE.md files pi passed over, appended as project_instructions blocks in the
 * ./CLAUDE.md slot, ahead of the ./.claude/CLAUDE.md alternate and the locals. */
export function siblingClaudeMdAddition(
	siblings: Array<{ path: string; content: string }>,
	home: string,
	projectRoot: string,
	announce: (event: InstructionLoadEvent) => void,
): string {
	let addition = "";
	for (const sibling of siblings) {
		if (sibling.content.trim().length === 0) continue;
		announce({
			file_path: sibling.path,
			memory_type: memoryTypeForPath(sibling.path, home, projectRoot),
			load_reason: "session_start",
		});
		addition += `\n\n${instructionsBlock(sibling.path, sibling.content.trim())}`;
	}
	return addition;
}

/** The project-scope ./.claude/CLAUDE.md appended as a project_instructions block,
 * announced as it is added (only when non-empty, matching what reaches the prompt).
 * Claude reads project instructions from ./CLAUDE.md OR ./.claude/CLAUDE.md; pi loads
 * the former natively, so this fills the alternate location as an extra project block. */
export function projectContextAddition(
	kept: { path: string; content: string } | undefined,
	home: string,
	projectRoot: string,
	announce: (event: InstructionLoadEvent) => void,
): string {
	if (kept === undefined || kept.content.trim().length === 0) return "";
	announce({
		file_path: kept.path,
		memory_type: memoryTypeForPath(kept.path, home, projectRoot),
		load_reason: "session_start",
	});
	return `\n\n${instructionsBlock(kept.path, kept.content.trim())}`;
}

/** The CLAUDE.local.md bodies appended after the native context, announced as they
 * are added (only the non-empty ones, matching what actually reaches the prompt). */
export function localContextAddition(
	keptLocals: Array<{ path: string; content: string }>,
	announce: (event: InstructionLoadEvent) => void,
): string {
	let addition = "";
	for (const local of keptLocals) {
		if (local.content.trim().length > 0) {
			addition += `\n\n## CLAUDE.local.md (${local.path})\n\n${local.content.trim()}`;
			announce({ file_path: local.path, memory_type: "Local", load_reason: "session_start" });
		}
	}
	return addition;
}

/** The --add-dir memory files appended as extra project_instructions blocks.
 * Additional dirs are extra working directories, so their files are Project-typed
 * regardless of where the dir sits (Local for a CLAUDE.local.md). */
export function additionalDirsAddition(
	extras: Array<{ path: string; content: string; dir: string }>,
	announce: (event: InstructionLoadEvent) => void,
): string {
	let addition = "";
	for (const extra of extras) {
		addition += `\n\n${instructionsBlock(extra.path, extra.content)}`;
		announce({
			file_path: extra.path,
			memory_type: path.basename(extra.path) === "CLAUDE.local.md" ? "Local" : "Project",
			load_reason: "session_start",
		});
	}
	return addition;
}

/** The refusal notice: every existing file an @import named that its importer may not
 * reach. Claude asks about these through an approval dialog and loads the ones you
 * allow; nycode refuses them, and this is what says so. Silence was the real defect:
 * the importing file looks loaded and its instructions are simply not there. */
export function refusedImportsAddition(refused: Set<string>): string {
	if (refused.size === 0) return "";
	const list = [...refused]
		.sort((a, b) => a.localeCompare(b, "en"))
		.map((file) => `- ${file}`)
		.join("\n");
	return `\n\n## Imports not loaded (@)\n\nThese files resolve outside what the file importing them may read, so their contents are not in context:\n\n${list}`;
}

/** What the import budget could not pay for, or nothing when it paid for everything. */
export function budgetNotice(budget: ImportBudget): string {
	return budget.dropped === 0
		? ""
		: `${budget.dropped} further @imports were skipped: the import budget (${MAX_IMPORT_FILES} files, ${MAX_IMPORT_BYTES} bytes) is spent.`;
}

/** The `## Imported context (@)` section for every resolved @import, with the
 * budget-exhaustion notice, announcing each as an `include`. Empty when nothing
 * was imported. */
export function importedAddition(
	imported: ImportedFile[],
	budget: ImportBudget,
	home: string,
	projectRoot: string,
	announce: (event: InstructionLoadEvent) => void,
): string {
	if (imported.length === 0) return "";
	const section = imported.map((entry) => `### ${entry.path}\n\n${stripBlockComments(entry.body)}`).join("\n\n");
	const notice = budget.dropped === 0 ? "" : `\n\n${budgetNotice(budget)}`;
	for (const entry of imported) {
		announce({
			file_path: entry.path,
			memory_type: memoryTypeForPath(entry.path, home, projectRoot),
			load_reason: "include",
			...(entry.parent === undefined ? {} : { parent_file_path: entry.parent }),
		});
	}
	return `\n\n## Imported context (@)\n\n${section}${notice}`;
}

/** Prepend the managed and user memory blocks Claude loads ahead of pi's native project
 * context, top to bottom: managed file, managed key, then the user CLAUDE.md. withTopBlock
 * prepends, so they are inserted bottom-up (user, then managed key, then managed file just
 * below) to land in that order. keptUser was already exclude-checked and comment-stripped by
 * the caller like every other file; the managed claudeMd is never excludable and comes from
 * two managed-only surfaces, the settings key (ignored in user/project settings) and the file
 * IT deploys beside managed-settings.json, re-read every turn so a policy change applies
 * immediately (only its announce is deduped per session). Returns the grown prompt, whether
 * anything was added, and the managed file body (reused for the import memo key). */
export function prependMemoryBlocks(
	prompt: string,
	changed: boolean,
	keptUser: { path: string; content: string } | undefined,
	managed: Record<string, unknown>,
	announce: (event: InstructionLoadEvent) => void,
): { prompt: string; changed: boolean; managedFile: string } {
	if (keptUser !== undefined && keptUser.content.trim().length > 0) {
		prompt = withTopBlock(prompt, instructionsBlock(keptUser.path, keptUser.content.trim()));
		changed = true;
		announce({ file_path: keptUser.path, memory_type: "User", load_reason: "session_start" });
	}
	const managedKey = typeof managed.claudeMd === "string" ? stripBlockComments(managed.claudeMd).trim() : "";
	if (managedKey.length > 0) {
		prompt = withTopBlock(prompt, instructionsBlock(MANAGED_CLAUDE_MD_PATH, managedKey));
		changed = true;
	}
	const managedFile = stripBlockComments(readManagedClaudeMdFile()).trim();
	if (managedFile.length > 0) {
		prompt = withTopBlock(prompt, instructionsBlock(managedClaudeMdPath(), managedFile));
		changed = true;
		announce({ file_path: managedClaudeMdPath(), memory_type: "Managed", load_reason: "session_start" });
	}
	return { prompt, changed, managedFile };
}

/**
 * Built-in instructions (K7): `resources/instructions/{contract,headless,lite}.md`. The contract is a context file of
 * the lowest precedence: it comes before the global and project AGENTS.md. `headless.md` is not chosen here: in print
 * mode the headless-lean extension swaps the contract for it in the provider payload. `lite.md` is only read on demand.
 */

import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { stripBlockComments } from "../extensions/_shared/shell/strip-comments.ts";
import { builtinResourceDir, resolveResourcesMarker } from "./builtin-resources.ts";

export type BuiltinInstruction = "contract" | "headless" | "lite";

interface ContextFile {
	path: string;
	content: string;
}

// The resources never change while the process runs; the mtime keeps a rewritten fixture from being served stale.
const cache = new Map<string, { mtimeMs: number; text: string }>();

/** The text of a built-in instruction (block comments stripped, `${NYCODE_RESOURCES}` resolved), or undefined if absent. */
export function readBuiltinInstruction(name: BuiltinInstruction): string | undefined {
	const dir = builtinResourceDir("instructions");
	if (!dir) return undefined;
	const file = join(dir, `${name}.md`);
	try {
		const { mtimeMs } = statSync(file);
		const cached = cache.get(file);
		if (cached?.mtimeMs === mtimeMs) return cached.text || undefined;
		const text = stripBlockComments(resolveResourcesMarker(readFileSync(file, "utf-8"))).trim();
		cache.set(file, { mtimeMs, text });
		return text || undefined;
	} catch {
		return undefined; // no such instruction: nothing embedded
	}
}

// Off until the claude-rules extension (the owner of the instruction context files) turns it on: a prompt built by the
// core alone stays the upstream one, which the upstream tests that measure the default prompt rely on.
let enabled = false;

/** Turns the built-in contract on or off for the prompts this process builds. */
export function setBuiltinInstructions(on: boolean): void {
	enabled = on;
}

/**
 * `contextFiles` with the built-in contract first. Nothing changes when it is off, when the contract is absent or when
 * the user turned the instruction files off (`--no-context-files` and `omitClaudeMd` agents set
 * CLAUDE_CODE_DISABLE_CLAUDE_MDS).
 */
export function withBuiltinInstructions(contextFiles: ContextFile[]): ContextFile[] {
	if (!enabled || process.env.CLAUDE_CODE_DISABLE_CLAUDE_MDS === "1") return contextFiles;
	const content = readBuiltinInstruction("contract");
	const dir = builtinResourceDir("instructions");
	if (!content || !dir) return contextFiles;
	return [{ path: join(dir, "contract.md"), content }, ...contextFiles];
}

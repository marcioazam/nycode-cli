/**
 * The `docs` section of the system prompt (~1.3 KB of paths and a reading guide) as a one-line pointer.
 *
 * Outside work on nycode itself the full section is noise. Mode `auto` (default) keeps it when the cwd is the
 * home directory, sits under the agent directory, or has a package.json naming nycode (its package or the
 * "nycode-package" keyword); every other cwd gets the pointer. `/docs-pointer on|off|auto` switches per session
 * (`on` = full section). Custom prompts never reach this code.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, sep } from "node:path";
import { getAgentDir, getDocsPath, getExamplesPath, getReadmePath } from "../config.ts";

export type DocsPointerMode = "auto" | "on" | "off";

let mode: DocsPointerMode = "auto";

/** Current session mode. */
export function getDocsPointerMode(): DocsPointerMode {
	return mode;
}

/** Sets the session mode. */
export function setDocsPointerMode(next: DocsPointerMode): void {
	mode = next;
}

/** Whether the full docs section applies to `cwd` under `m`. */
export function wantsFullDocs(m: DocsPointerMode, cwd: string, home: string = homedir()): boolean {
	if (m !== "auto") return m === "on";
	const agentDir = getAgentDir();
	if (cwd === home || cwd === agentDir || cwd.startsWith(agentDir + sep)) return true;
	try {
		const pkg = join(cwd, "package.json");
		if (!existsSync(pkg)) return false;
		const text = readFileSync(pkg, "utf8");
		return text.includes("@nycode/coding-agent") || text.includes('"nycode-package"');
	} catch {
		return false;
	}
}

/** The one-line pointer to the nycode docs. */
export function docsPointerLine(): string {
	return `nycode docs live in ${getDocsPath()} (README at ${getReadmePath()}, examples at ${getExamplesPath()}); read them only when the task is about nycode itself.`;
}

/** The `docs` section for `cwd`: `full` when the mode and cwd ask for it, else the pointer line. */
export function docsSection(cwd: string, full: string): string {
	return wantsFullDocs(mode, cwd) ? full : docsPointerLine();
}

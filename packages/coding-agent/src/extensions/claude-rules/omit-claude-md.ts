/**
 * When the user's CLAUDE.md and rules stay out of the context (parity with Claude Code). Ported from the removed
 * no-context-files-covers-claude-md extension (ex-ny-pi, 02 §3.2). Two cases switch CLAUDE_CODE_DISABLE_CLAUDE_MDS on:
 * `--no-context-files` / `-nc`, and `omitClaudeMd: true` in the frontmatter of the agent a subagent child runs.
 * The child gets `--system-prompt <tmp>/prompt-<safeName>.md` (subagent/core/run.ts) and NYCODE_SUBAGENT=1.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { getAgentDir } from "../../config.ts";
import { claudeConfigDir } from "../_shared/settings/config-dir.ts";

function agentDirs(): string[] {
	return [path.join(claudeConfigDir(os.homedir()), "agents"), path.join(getAgentDir(), "agents")];
}

/** The name (sanitized as the subagent tool does) of the agent this child process runs, or undefined. */
export function childAgentSafeName(argv: string[]): string | undefined {
	if (process.env.NYCODE_SUBAGENT !== "1") return undefined;
	const i = argv.indexOf("--system-prompt");
	const match = i >= 0 ? /^prompt-(.+)\.md$/.exec(path.basename(argv[i + 1] ?? "")) : null;
	return match?.[1];
}

/** Whether the agent file whose sanitized name is `safeName` declares `omitClaudeMd: true`. */
export function agentOmitsClaudeMd(safeName: string, dirs: string[] = agentDirs()): boolean {
	for (const dir of dirs) {
		let files: string[];
		try {
			files = fs.readdirSync(dir).filter((f) => f.endsWith(".md"));
		} catch {
			continue;
		}
		for (const file of files) {
			const text = fs.readFileSync(path.join(dir, file), "utf-8");
			const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1];
			if (fm === undefined) continue;
			const name = /^name:\s*["']?([^"'\r\n]+?)["']?\s*$/m.exec(fm)?.[1] ?? file.slice(0, -3);
			if (name.replace(/[^\w.-]+/g, "_") !== safeName) continue;
			return /^omitClaudeMd:\s*true\s*$/m.test(fm);
		}
	}
	return false;
}

/** Whether this process starts without CLAUDE.md and rules: the flag, or a child whose agent omits them. */
export function shouldOmitClaudeMd(argv: string[]): boolean {
	if (argv.includes("--no-context-files") || argv.includes("-nc")) return true;
	const safeName = childAgentSafeName(argv);
	return safeName !== undefined && agentOmitsClaudeMd(safeName);
}

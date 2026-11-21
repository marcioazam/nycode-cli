/**
 * /puxar <profile> [N|session-id]: imports the newest (or N-th, or by id) Claude Code session of this directory
 * from a Claude Code profile into nycode and opens the imported session. Zero model tokens: the conversion to
 * nycode's session format runs in scripts/harness/puxar/puxar.py (tests in test_puxar.py next to it).
 *
 * profile: 1|claude = ~/.claude, N = ~/.claude-N, name = ~/.claude-name, or an absolute path.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { getPackageDir } from "../../config.ts";
import type { ExtensionAPI } from "../../core/extensions/types.ts";

// The script lives in the repository, not in the published package: it resolves only in a source checkout.
// ponytail: the published package does not carry it yet (F8/F11, embedded resources); /puxar then reports it missing.
const SCRIPT = path.join(getPackageDir(), "..", "..", "scripts", "harness", "puxar", "puxar.py");
const SESSION_FILE_PREFIX = "NYCODE_SESSION_FILE=";
const USAGE =
	"uso: /puxar <perfil> [N|session-id]  (perfil: 1=~/.claude, 2=~/.claude-2, glm=~/.claude-glm ou caminho; N: 1=mais recente, 2=penúltima...)";

/** The Claude Code profiles that exist in ~, in the form the argument accepts. */
function profiles(): string[] {
	let names: string[] = [];
	try {
		names = fs.readdirSync(os.homedir());
	} catch {
		return [];
	}
	const out: string[] = [];
	for (const name of names.sort()) {
		if (name === ".claude") out.push("1");
		else if (name.startsWith(".claude-") && fs.existsSync(path.join(os.homedir(), name, "projects")))
			out.push(name.slice(".claude-".length));
	}
	return out;
}

export default function importClaudeSessionExtension(nycode: ExtensionAPI) {
	nycode.registerCommand("puxar", {
		description:
			"Importa a sessão mais recente (ou a N-ésima) deste diretório de um perfil do Claude Code e abre no nycode <perfil> [N|session-id]",
		getArgumentCompletions: (prefix: string) => {
			if (prefix.includes(" ")) return null;
			const items = profiles()
				.filter((p) => p.startsWith(prefix))
				.map((p) => ({ value: p, label: p, description: p === "1" ? "~/.claude" : `~/.claude-${p}` }));
			return items.length > 0 ? items : null;
		},
		handler: async (args, ctx) => {
			const argLine = args.trim();
			if (!argLine) {
				ctx.ui.notify(USAGE, "warning");
				return;
			}
			if (!fs.existsSync(SCRIPT)) {
				ctx.ui.notify(
					`puxar.py não encontrado (${SCRIPT}); /puxar só funciona em um checkout do código-fonte do nycode.`,
					"error",
				);
				return;
			}
			// The open session's directory honours --session-dir, NYCODE_CODING_AGENT_SESSION_DIR and sessionDir;
			// the script only computes the default when it is missing.
			let sessionDir = "";
			try {
				sessionDir = ctx.sessionManager.getSessionDir();
			} catch {
				// ephemeral session: the script uses the default directory
			}
			const result = await nycode.exec("python3", [SCRIPT, argLine, ctx.cwd, sessionDir], { timeout: 120_000 });
			if (result.code !== 0) {
				ctx.ui.notify((result.stderr || result.stdout || `puxar.py saiu com ${result.code}`).trim(), "error");
				return;
			}
			const lines = result.stdout.trim().split("\n");
			const fileLine = lines.find((line) => line.startsWith(SESSION_FILE_PREFIX));
			const report = lines.filter((line) => !line.startsWith(SESSION_FILE_PREFIX)).join("\n");
			const file = fileLine?.slice(SESSION_FILE_PREFIX.length);
			if (!file || !fs.existsSync(file)) {
				ctx.ui.notify(`${report}\n(puxar.py não informou o arquivo da sessão)`, "error");
				return;
			}
			if (ctx.sessionManager.getSessionFile() === file) {
				ctx.ui.notify(`${report}\nEssa já é a sessão aberta.`, "info");
				return;
			}
			// Switching sessions mid-response would cut the turn; wait for the agent to settle.
			await ctx.waitForIdle();
			const switched = await ctx.switchSession(file, {
				withSession: async (next) => {
					next.ui.notify(`${report}\nSessão importada aberta.`, "info");
				},
			});
			if (switched.cancelled)
				ctx.ui.notify(`${report}\nA troca de sessão foi cancelada; abra pelo /resume.`, "warning");
		},
	});
}

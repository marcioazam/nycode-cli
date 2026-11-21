// Shared fixture for the `migrate from-pi` tests: a throwaway HOME holding a pi agent directory.
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vi } from "vitest";
import { runMigrateCommand } from "../../../src/migrations/from-pi.ts";

/** Env placeholder as written in mcp.json. */
export const ph = (name: string): string => `\${${name}}`;

// Built at runtime so secret scanners do not flag the fixture; any non-empty marker works.
export const SECRET = ["fixture", "marker", "value"].join("-");

export const LOCAL_ENV = [
	"# comment",
	"PI_BYPASS_PERMISSIONS=1",
	"PI_COMPACT_AT=200000",
	"PONYTAIL_QUIET_STARTUP=1",
	"PI_KNOWLEDGE_VAULT='/vault/notes'",
	"PI_GRAPHS_VAULT=/vault/graphs",
	"CODEGRAPH_AUTO_ROOT=/src",
	"PI_SUBAGENT_RESPAWN=0",
	"PI_EFFORT_SANDWICH=1",
	"PI_EFFORT_SANDWICH_TURNS=2",
	"",
].join("\n");

export const PI_SETTINGS = {
	packages: [
		{ source: "npm:pi-code@1.7.0", extensions: ["!extensions/mcp/**"] },
		"./vendor/pi-lsp",
		"./vendor/ponytail",
		"npm:some-other-package@1.0.0",
	],
	theme: "tokyo-night",
	compaction: { enabled: true },
	defaultProjectTrust: "never",
	quietStartup: "header",
};

export const PI_MCP = {
	mcpServers: {
		exa: { url: "https://mcp.exa.ai/mcp", headers: { "x-api-key": SECRET } },
		search: { command: "npx", args: ["-y", "x"], env: { SEARCH_API_KEY: SECRET, KEEP: ph("KEEP"), MODE: "fast" } },
	},
};

export interface Home {
	home: string;
	source: string;
	agentDir: string;
	out: string[];
	err: string[];
	run: (
		args: string[],
		io?: { isInteractive?: boolean; confirm?: (q: string) => Promise<boolean> },
	) => Promise<number>;
}

/** Creates a temp HOME with a populated pi agent directory (settings, local.env 0600, mcp, trust, sessions). */
export function makeHome(): Home {
	const home = mkdtempSync(join(tmpdir(), "from-pi-"));
	vi.stubEnv("HOME", home);
	const source = join(home, ".pi", "agent");
	const agentDir = join(home, ".nycode", "agent");
	mkdirSync(join(source, "sessions", "--proj--"), { recursive: true });
	writeFileSync(join(source, "settings.json"), JSON.stringify(PI_SETTINGS, null, 2));
	writeFileSync(join(source, "local.env"), LOCAL_ENV, { mode: 0o600 });
	chmodSync(join(source, "local.env"), 0o600);
	writeFileSync(join(source, "mcp.json"), JSON.stringify(PI_MCP, null, 2));
	writeFileSync(join(source, "models.json"), '{"providers":{}}\n');
	writeFileSync(join(source, "lsp.json"), '{"version":1,"servers":[]}\n');
	writeFileSync(join(source, "keybindings.json"), "{}\n");
	writeFileSync(join(source, "trust.json"), JSON.stringify({ "/work/proj": true }));
	writeFileSync(join(source, "sessions", "--proj--", "a.jsonl"), '{"type":"session"}\n');
	writeFileSync(join(source, "auth.json"), JSON.stringify({ anthropic: { type: "api_key", key: SECRET } }));
	const out: string[] = [];
	const err: string[] = [];
	const run: Home["run"] = (args, io = {}) =>
		runMigrateCommand(["from-pi", "--from", source, ...args], {
			agentDir,
			io: { log: (m) => out.push(m), error: (m) => err.push(m), isInteractive: false, ...io },
		});
	return { home, source, agentDir, out, err, run };
}

/** Maps every regular file under `dir` to its sha256 (relative paths), for before/after comparisons. */
export function hashTree(dir: string): Record<string, string> {
	const result: Record<string, string> = {};
	const walk = (current: string, rel: string) => {
		for (const name of readdirSync(current)) {
			const full = join(current, name);
			const entryRel = rel ? `${rel}/${name}` : name;
			if (statSync(full).isDirectory()) walk(full, entryRel);
			else result[entryRel] = createHash("sha256").update(readFileSync(full)).digest("hex");
		}
	};
	walk(dir, "");
	return result;
}

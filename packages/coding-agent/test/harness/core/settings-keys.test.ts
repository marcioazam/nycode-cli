// One case set per row of docs/migration/ny-pi-core/02-arquitetura-alvo.md section 5 (C-F4-05) plus the ny-pi
// defaults of K4 (C-F4-04): default, schema validation and environment override (the variable wins over settings.json).
import { join } from "node:path";
import { Compile } from "typebox/compile";
import { describe, expect, it, vi } from "vitest";
import { getAgentDir } from "../../../src/config.ts";
import { SettingsManager } from "../../../src/core/settings-manager.ts";
import { SettingsSchema } from "../../../src/core/settings-schema.ts";

const validator = Compile(SettingsSchema);

/** Builds `{a: {b: value}}` from "a.b". */
function nest(path: string, value: unknown): Record<string, unknown> {
	return path
		.split(".")
		.reverse()
		.reduce<unknown>((inner, key) => ({ [key]: inner }), value) as Record<string, unknown>;
}

function read(manager: SettingsManager, path: string): unknown {
	if (path === "permissions.bypass") return manager.getBypassPermissions();
	return path
		.split(".")
		.reduce<unknown>(
			(node, key) => (node as Record<string, unknown> | undefined)?.[key],
			manager.getNycodeSettings(),
		);
}

interface Row {
	/** Key in settings.json, exactly as in the "Chave" column. */
	key: string;
	env?: string;
	/** Value the getter returns with no settings and no variable. */
	def: unknown;
	/** A valid settings.json value and what the getter returns for it. */
	set: unknown;
	setExpected?: unknown;
	/** A settings.json value the schema rejects. */
	invalid: unknown;
	/** Raw variable text and the value it forces over `set`. */
	envRaw?: string;
	envExpected?: unknown;
}

const agentDir = () => getAgentDir();

const rows: Row[] = [
	{
		key: "permissions.bypass",
		env: "NYCODE_BYPASS_PERMISSIONS",
		def: false,
		set: true,
		invalid: "yes",
		envRaw: "0",
		envExpected: false,
	},
	{
		key: "compaction.maxContextTokens",
		env: "NYCODE_COMPACT_AT",
		def: 250000,
		set: 300000,
		invalid: -1,
		envRaw: "123456",
		envExpected: 123456,
	},
	{
		key: "harness.effortSandwich.enabled",
		env: "NYCODE_EFFORT_SANDWICH",
		def: false,
		set: true,
		invalid: "on",
		envRaw: "0",
		envExpected: false,
	},
	{
		key: "harness.effortSandwich.turns",
		env: "NYCODE_EFFORT_SANDWICH_TURNS",
		def: 1,
		set: 2,
		invalid: 0,
		envRaw: "3",
		envExpected: 3,
	},
	{
		key: "subagent.respawn",
		env: "NYCODE_SUBAGENT_RESPAWN",
		def: true,
		set: false,
		invalid: "no",
		envRaw: "1",
		envExpected: true,
	},
	{
		key: "harness.headless.lean",
		env: "NYCODE_HEADLESS_LEAN",
		def: true,
		set: false,
		invalid: 5,
		envRaw: "1",
		envExpected: true,
	},
	{
		key: "harness.headless.trim",
		env: "NYCODE_HEADLESS_TRIM",
		def: true,
		set: false,
		invalid: 5,
		envRaw: "1",
		envExpected: true,
	},
	{
		key: "harness.headless.tools",
		env: "NYCODE_HEADLESS_TOOLS",
		def: "lean",
		set: "all",
		invalid: "some",
		envRaw: "lean",
		envExpected: "lean",
	},
	{
		key: "harness.headless.floor",
		env: "NYCODE_HEADLESS_FLOOR",
		def: true,
		set: false,
		invalid: 5,
		envRaw: "1",
		envExpected: true,
	},
	{
		key: "tools.bash.backgroundOnTimeout",
		env: "NYCODE_BASH_TIMEOUT_BG",
		def: false,
		set: true,
		invalid: "yes",
		envRaw: "0",
		envExpected: false,
	},
	{
		key: "todo.staleReminder",
		env: "NYCODE_TODO_SYNC",
		def: true,
		set: false,
		invalid: "no",
		envRaw: "1",
		envExpected: true,
	},
	{
		key: "harness.prefixCache1h",
		env: "NYCODE_PREFIX_CACHE_1H",
		def: "auto",
		set: false,
		invalid: "sometimes",
		envRaw: "1",
		envExpected: true,
	},
	{
		key: "harness.autoResume",
		env: "NYCODE_AUTO_RESUME",
		def: true,
		set: false,
		invalid: "no",
		envRaw: "1",
		envExpected: true,
	},
	{ key: "plan.gate", env: "NYCODE_PLAN_GATE", def: true, set: false, invalid: "no", envRaw: "1", envExpected: true },
	{
		key: "harness.completionGate",
		env: "NYCODE_COMPLETION_GATE",
		def: true,
		set: false,
		invalid: "no",
		envRaw: "1",
		envExpected: true,
	},
	{
		key: "notify.sound",
		env: "NYCODE_SOUND_NOTIFY",
		def: true, // ny-pi parity: sound-notify was on unless PI_SOUND_NOTIFY=0
		set: false,
		invalid: "loud",
		envRaw: "0",
		envExpected: false,
	},
	{
		key: "terminal.uiState",
		env: "NYCODE_UI_STATE",
		def: join(agentDir(), "ui-state.json"),
		set: "/tmp/ui.json",
		invalid: 3,
		envRaw: "/tmp/env-ui.json",
		envExpected: "/tmp/env-ui.json",
	},
	{
		key: "terminal.reducedMotion",
		env: "NYCODE_REDUCED_MOTION",
		def: false,
		set: true,
		invalid: "yes",
		envRaw: "0",
		envExpected: false,
	},
	{
		key: "terminal.nerdFont",
		env: "NYCODE_NERD_FONT",
		def: "auto",
		set: true,
		invalid: "maybe",
		envRaw: "0",
		envExpected: false,
	},
	{
		key: "terminal.asciiIcons",
		env: "NYCODE_ASCII_ICONS",
		def: false,
		set: true,
		invalid: "yes",
		envRaw: "0",
		envExpected: false,
	},
	{
		key: "knowledge.vault",
		env: "NYCODE_KNOWLEDGE_VAULT",
		def: undefined,
		set: "/v",
		invalid: 1,
		envRaw: "/env-v",
		envExpected: "/env-v",
	},
	{
		key: "knowledge.graphsVault",
		env: "NYCODE_GRAPHS_VAULT",
		def: undefined,
		set: "/g",
		invalid: 1,
		envRaw: "/env-g",
		envExpected: "/env-g",
	},
	{
		key: "codegraph.autoRoot",
		env: "CODEGRAPH_AUTO_ROOT",
		def: undefined,
		set: "/r",
		invalid: 1,
		envRaw: "/env-r",
		envExpected: "/env-r",
	},
	{
		key: "codegraph.bin",
		env: "CODEGRAPH_BIN",
		def: undefined,
		set: "/b",
		invalid: 1,
		envRaw: "/env-b",
		envExpected: "/env-b",
	},
	{
		key: "codegraph.statusTtl",
		env: "CODEGRAPH_STATUS_TTL",
		def: undefined,
		set: 30,
		invalid: -1,
		envRaw: "0",
		envExpected: 0,
	},
	{
		key: "codegraph.autoState",
		env: "CODEGRAPH_AUTO_STATE",
		def: undefined,
		set: "/s",
		invalid: 1,
		envRaw: "/env-s",
		envExpected: "/env-s",
	},
	{
		key: "mcp.configPath",
		env: "NYCODE_MCP_CONFIG",
		def: join(agentDir(), "mcp.json"),
		set: "/m.json",
		invalid: 1,
		envRaw: "/env-m.json",
		envExpected: "/env-m.json",
	},
];

describe("settings keys of 02 section 5", () => {
	describe.each(rows)("$key", (row) => {
		const envName = row.env;

		it("defaults when neither settings nor variable set it", () => {
			if (envName) vi.stubEnv(envName, undefined);
			expect(read(SettingsManager.inMemory(), row.key)).toEqual(row.def);
		});

		it("is read from settings.json and accepted by the schema", () => {
			if (envName) vi.stubEnv(envName, undefined);
			const settings = nest(row.key, row.set);
			expect(validator.Check(settings)).toBe(true);
			expect(read(SettingsManager.inMemory(settings), row.key)).toEqual(row.setExpected ?? row.set);
		});

		it("is rejected by the schema when malformed and ignored by the getter", () => {
			if (envName) vi.stubEnv(envName, undefined);
			const settings = nest(row.key, row.invalid);
			expect(validator.Check(settings)).toBe(false);
			expect(read(SettingsManager.inMemory(settings), row.key)).toEqual(row.def);
		});

		it("is overridden by its variable", () => {
			if (!envName) return;
			vi.stubEnv(envName, row.envRaw as string);
			expect(read(SettingsManager.inMemory(nest(row.key, row.set)), row.key)).toEqual(row.envExpected);
		});
	});

	it("ignores a variable that does not parse and keeps the settings.json value", () => {
		vi.stubEnv("NYCODE_PLAN_GATE", "maybe");
		vi.stubEnv("NYCODE_COMPACT_AT", "abc");
		const manager = SettingsManager.inMemory({ plan: { gate: false }, compaction: { maxContextTokens: 5 } });
		expect(manager.getNycodeSettings().plan.gate).toBe(false);
		expect(manager.getNycodeSettings().compaction.maxContextTokens).toBe(5);
	});

	it("reads hooks, statusLine and env as typed keys", () => {
		const hooks = {
			PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command" as const, command: "true", timeout: 5 }] }],
		};
		const statusLine = { type: "command" as const, command: "echo hi" };
		const env = { EIO_BACKEND: "posix" };
		const settings = { hooks, statusLine, env };
		expect(validator.Check(settings)).toBe(true);
		const manager = SettingsManager.inMemory(settings);
		expect(manager.getHooks()).toEqual(hooks);
		expect(manager.getStatusLine()).toEqual(statusLine);
		expect(manager.getEnv()).toEqual(env);
		expect(SettingsManager.inMemory().getHooks()).toBeUndefined();
		expect(validator.Check({ hooks: "x" })).toBe(false);
		expect(validator.Check({ statusLine: { type: "command" } })).toBe(false);
		expect(validator.Check({ env: { A: 1 } })).toBe(false);
	});
});

describe("ny-pi defaults (K4, C-F4-04)", () => {
	it("starts untrusted for project files", () => {
		expect(SettingsManager.inMemory().getDefaultProjectTrust()).toBe("never");
	});

	it("keeps the header and hides the loaded-resources lists", () => {
		expect(SettingsManager.inMemory().getQuietStartup()).toBe("header");
	});

	it("retries ten times with the ny-pi backoff", () => {
		expect(SettingsManager.inMemory().getRetrySettings()).toEqual({
			enabled: true,
			maxRetries: 10,
			baseDelayMs: 2000,
			maxAgentDelayMs: 60000,
		});
	});

	it("prefixes bash commands so git and pagers never block on a terminal", () => {
		expect(SettingsManager.inMemory().getShellCommandPrefix()).toBe(
			"export GIT_EDITOR=true GIT_SEQUENCE_EDITOR=true GIT_MERGE_AUTOEDIT=no GIT_PAGER=cat PAGER=cat AWS_PAGER= LESS=FRX",
		);
		expect(SettingsManager.inMemory({ shellCommandPrefix: "echo x" }).getShellCommandPrefix()).toBe("echo x");
	});

	it("keeps explicit settings over the new defaults", () => {
		const manager = SettingsManager.inMemory({
			defaultProjectTrust: "ask",
			quietStartup: false,
			retry: { maxRetries: 1 },
		});
		expect(manager.getDefaultProjectTrust()).toBe("ask");
		expect(manager.getQuietStartup()).toBe(false);
		expect(manager.getRetrySettings().maxRetries).toBe(1);
	});
});

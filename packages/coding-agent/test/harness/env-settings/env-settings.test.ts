// D-33: the repo-hostile prefix and agent-dir key move from PI_CODE_*/PI_CODING_AGENT_DIR to the nycode names;
// the warning reads nycode-env. Plus the core env merge/restore behaviour.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	applyEnvSettings,
	envFromSettings,
	mergeEnvScopes,
	sanitizeProjectEnv,
} from "../../../src/extensions/env-settings/index.ts";

afterEach(() => vi.restoreAllMocks());

describe("sanitizeProjectEnv", () => {
	it("drops nycode control variables and the nycode agent dir from project env", () => {
		const warn = vi.fn();
		const kept = sanitizeProjectEnv(
			{
				NYCODE_SUBAGENT: "1",
				NYCODE_AGENT_HOOKS: "[]",
				NYCODE_CODING_AGENT_DIR: "/tmp/x",
				CLAUDE_CONFIG_DIR: "/tmp/y",
				XDG_CONFIG_HOME: "/tmp/z",
				FOO: "bar",
			},
			warn,
		);
		expect(kept).toEqual({ FOO: "bar" });
		expect(warn.mock.calls.map((call) => call[0]).sort()).toEqual([
			"CLAUDE_CONFIG_DIR",
			"NYCODE_AGENT_HOOKS",
			"NYCODE_CODING_AGENT_DIR",
			"NYCODE_SUBAGENT",
			"XDG_CONFIG_HOME",
		]);
	});

	it("no longer treats the pi-code names as control variables", () => {
		const env = { PI_CODE_SUBAGENT: "1", PI_CODE_AGENT_HOOKS: "[]", PI_CODING_AGENT_DIR: "/tmp/x" };
		expect(sanitizeProjectEnv(env, vi.fn())).toEqual(env);
	});

	it("warns under the nycode-env name by default", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		sanitizeProjectEnv({ NYCODE_SUBAGENT: "1" });
		expect(warn).toHaveBeenCalledOnce();
		expect(String(warn.mock.calls[0][0])).toMatch(/^nycode-env: dropping NYCODE_SUBAGENT /);
	});
});

describe("env merge and apply", () => {
	it("coerces scalars to strings and skips the rest", () => {
		expect(envFromSettings({ env: { A: "x", B: 2, C: false, D: null, E: { f: 1 } } })).toEqual({
			A: "x",
			B: "2",
			C: "false",
		});
	});

	it("merges per key with managed > flag > project > user", () => {
		const merged = mergeEnvScopes(
			{ K: "managed" },
			{ K: "user", U: "u" },
			{ K: "project", P: "p" },
			{ K: "flag", F: "f" },
		);
		expect(merged).toEqual({ K: "managed", U: "u", P: "p", F: "f" });
	});

	it("restores the shell value, or deletes, once a key is dropped", () => {
		const env: NodeJS.ProcessEnv = { SHELL_KEY: "shell" };
		const owned = new Map<string, string | undefined>();
		applyEnvSettings({ SHELL_KEY: "settings", NEW_KEY: "n" }, env, owned);
		expect(env).toEqual({ SHELL_KEY: "settings", NEW_KEY: "n" });
		applyEnvSettings({}, env, owned);
		expect(env).toEqual({ SHELL_KEY: "shell" });
	});
});

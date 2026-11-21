// D-09: the home-scope Claude config directory no longer follows CLAUDE_CONFIG_DIR (the variable is converted once by
// `nycode migrate from-pi`); every consumer of claudeConfigDir sees `<home>/.claude`.
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { claudeConfigDir } from "../../../src/extensions/_shared/settings/config-dir.ts";

afterEach(() => vi.unstubAllEnvs());

describe("claudeConfigDir", () => {
	it("is <home>/.claude", () => {
		vi.stubEnv("CLAUDE_CONFIG_DIR", undefined);
		expect(claudeConfigDir("/home/user")).toBe(path.join("/home/user", ".claude"));
	});

	it.each([["/elsewhere/claude"], ["~/custom"], ["relative/dir"], [""]])("ignores CLAUDE_CONFIG_DIR=%j", (value) => {
		vi.stubEnv("CLAUDE_CONFIG_DIR", value);
		expect(claudeConfigDir("/home/user")).toBe(path.join("/home/user", ".claude"));
	});
});

// The status line nycode runs by default (settings-defaults.ts `statusLine`) and how a user replaces or turns it off.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SETTINGS_DEFAULTS } from "../../../src/core/settings-defaults.ts";
import { activeStatusLine } from "../../../src/extensions/status-line/config.ts";

let dir: string;
beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "slcfg-"));
});
afterEach(() => rmSync(dir, { recursive: true }));

const file = (statusLine: unknown): string => {
	const path = join(dir, "settings.json");
	writeFileSync(path, JSON.stringify({ statusLine }));
	return path;
};
const entry = (command: string) => ({ type: "command", command });

describe("default status line", () => {
	it("runs the embedded claude-hud launcher when nothing else sets a statusLine", () => {
		expect(activeStatusLine([], {})?.command).toBe(SETTINGS_DEFAULTS.statusLine.command);
		expect(SETTINGS_DEFAULTS.statusLine.command).toContain("/statusline/statusline.mjs");
	});

	it("a Claude settings file replaces the default; nycode's own settings.json entry replaces both", () => {
		expect(activeStatusLine([file(entry("from-file"))], {})?.command).toBe("from-file");
		expect(activeStatusLine([file(entry("from-file"))], {}, entry("own"))?.command).toBe("own");
	});

	it("an empty command in settings.json turns the status line off", () => {
		expect(activeStatusLine([file(entry("from-file"))], {}, entry(""))).toBeUndefined();
	});

	it("managed policy still wins, and disableAllHooks leaves only the managed entry", () => {
		const managed = { statusLine: entry("managed") };
		expect(activeStatusLine([], managed, entry("own"))?.command).toBe("managed");
		expect(activeStatusLine([file({ x: 1 })], { disableAllHooks: true })).toBeUndefined();
	});
});

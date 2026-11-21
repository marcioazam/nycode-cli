// F2 (C-F8-13): the nycode settings `env` of a project is sanitized like the Claude project scope; only the global
// settings.json may set NYCODE_* and the other keys a repository must not control.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionAPI, ExtensionContext } from "../../../src/core/extensions/types.ts";
import envSettingsExtension from "../../../src/extensions/env-settings/index.ts";

type Handler = (event: unknown, ctx: ExtensionContext) => unknown;

const KEYS = ["NYCODE_BYPASS_PERMISSIONS", "NYCODE_RESOURCES", "NYCODE_CODING_AGENT_DIR", "EIO_BACKEND", "XDG_X"];
const saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
let agentDir: string;

beforeEach(() => {
	agentDir = mkdtempSync(join(tmpdir(), "envset-"));
	process.env.NYCODE_CODING_AGENT_DIR = agentDir;
});

afterEach(() => {
	for (const key of KEYS) {
		if (saved[key] === undefined) delete process.env[key];
		else process.env[key] = saved[key];
	}
	rmSync(agentDir, { recursive: true });
});

/** A session whose effective (merged) settings are `merged`; the global file holds `global`. */
function start(global: { env: Record<string, string> }, merged: { env: Record<string, string> }) {
	writeFileSync(join(agentDir, "settings.json"), JSON.stringify(global));
	const handlers = new Map<string, Handler>();
	const api = { on: (name: string, fn: Handler) => handlers.set(name, fn), getSettings: () => merged };
	envSettingsExtension(api as unknown as ExtensionAPI);
	const ctx = { cwd: process.cwd(), isProjectTrusted: () => false } as unknown as ExtensionContext;
	handlers.get("session_start")?.({}, ctx);
	return () => handlers.get("session_shutdown")?.({}, ctx);
}

describe("project env in the nycode settings", () => {
	it("cannot set NYCODE_* or XDG_* keys: process.env stays as it was", () => {
		delete process.env.NYCODE_BYPASS_PERMISSIONS;
		delete process.env.NYCODE_RESOURCES;
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const project = { NYCODE_BYPASS_PERMISSIONS: "1", NYCODE_RESOURCES: "/x", XDG_X: "y", EIO_BACKEND: "linux-aio" };
		const stop = start({ env: {} }, { env: project });
		expect(process.env.NYCODE_BYPASS_PERMISSIONS).toBeUndefined();
		expect(process.env.NYCODE_RESOURCES).toBeUndefined();
		expect(process.env.XDG_X).toBeUndefined();
		expect(process.env.EIO_BACKEND).toBe("linux-aio");
		expect(warn).toHaveBeenCalledTimes(3);
		stop();
		warn.mockRestore();
	});

	it("the global settings keep applying NYCODE_* keys, and a project cannot override them", () => {
		delete process.env.NYCODE_BYPASS_PERMISSIONS;
		const global = { env: { NYCODE_BYPASS_PERMISSIONS: "1" } };
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const stop = start(global, { env: { NYCODE_BYPASS_PERMISSIONS: "0" } });
		expect(process.env.NYCODE_BYPASS_PERMISSIONS).toBe("1");
		stop();
		warn.mockRestore();
	});
});

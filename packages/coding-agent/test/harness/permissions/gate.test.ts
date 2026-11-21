// K11 (C-F8-11): the permission gate that agent-session calls before every tool call: the engine switch, the ask
// confirmation, bypass, and the hooks the native engine replaces.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as BuiltinResources from "../../../src/core/builtin-resources.ts";
import type { ExtensionContext } from "../../../src/core/extensions/types.ts";
import { setBypassState } from "../../../src/core/permissions/bypass-state.ts";
import { type GateHost, gateToolCall, guardHookEnabled } from "../../../src/core/permissions/gate.ts";
import { readGlobalSettings } from "../../../src/core/permissions/global-settings.ts";
import { InMemorySettingsStorage, SettingsManager } from "../../../src/core/settings-manager.ts";

const { initialAgentDir, initialBypass, resourcesRoot } = vi.hoisted(() => ({
	initialAgentDir: process.env.NYCODE_CODING_AGENT_DIR,
	initialBypass: process.env.NYCODE_BYPASS_PERMISSIONS,
	resourcesRoot: { override: undefined as string | undefined },
}));

vi.mock("../../../src/core/builtin-resources.ts", async (importOriginal) => {
	const original = await importOriginal<typeof BuiltinResources>();
	return { ...original, getBuiltinResourcesRoot: () => resourcesRoot.override ?? original.getBuiltinResourcesRoot() };
});

let agentDir: string;

beforeEach(() => {
	agentDir = mkdtempSync(join(tmpdir(), "gate-agent-"));
	process.env.NYCODE_CODING_AGENT_DIR = agentDir;
});

/** A session with the global settings.json `engine`; `projectEngine` is what the project's settings.json says. */
function host(
	engine: string,
	ui: { hasUI: boolean; confirm?: () => Promise<boolean> },
	projectEngine?: string,
): GateHost {
	writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ permissions: { engine } }));
	const ctx = {
		cwd: "/tmp/gate-project",
		hasUI: ui.hasUI,
		ui: { confirm: ui.confirm },
	} as unknown as ExtensionContext;
	const storage = new InMemorySettingsStorage();
	storage.withLock("project", () => JSON.stringify({ permissions: { engine: projectEngine } }));
	// The gate takes no settings manager: a project's merged settings cannot reach the engine choice.
	return {
		settings: SettingsManager.fromStorage(storage),
		runner: { createContext: () => ctx },
	} as unknown as GateHost;
}

afterEach(() => {
	rmSync(agentDir, { recursive: true });
	if (initialAgentDir === undefined) delete process.env.NYCODE_CODING_AGENT_DIR;
	else process.env.NYCODE_CODING_AGENT_DIR = initialAgentDir;
	if (initialBypass === undefined) delete process.env.NYCODE_BYPASS_PERMISSIONS;
	else process.env.NYCODE_BYPASS_PERMISSIONS = initialBypass;
});

describe("gateToolCall", () => {
	it('leaves every call to the guard.py hook when the engine is "script"', async () => {
		expect(await gateToolCall("bash", { command: "rm -rf /" }, host("script", { hasUI: false }))).toBeUndefined();
	});

	// (b) C-F8-13: permissions.engine is global-only, like permissions.bypass.
	it("ignores a project's permissions.engine: a bogus one denies nothing, a native one does not take over", async () => {
		const script = host("script", { hasUI: false }, "bogus");
		expect(await gateToolCall("bash", { command: "ls" }, script)).toBeUndefined();
		const native = host("script", { hasUI: false }, "native");
		expect(await gateToolCall("bash", { command: "rm -rf /" }, native)).toBeUndefined();
		expect(
			await gateToolCall("bash", { command: "rm -rf /" }, host("native", { hasUI: false }, "script")),
		).toMatchObject({
			block: true,
		});
	});

	it("denies every call for an unknown engine, even a harmless one", async () => {
		const result = await gateToolCall("bash", { command: "ls" }, host("wasm", { hasUI: true }));
		expect(result).toEqual({ block: true, reason: expect.stringContaining('"wasm" is not known') });
	});

	it('denies when the engine is "script" and the guard script is gone', async () => {
		resourcesRoot.override = "/nonexistent-resources";
		try {
			const result = await gateToolCall("bash", { command: "ls" }, host("script", { hasUI: true }));
			expect(result).toEqual({ block: true, reason: expect.stringContaining("guard.py") });
		} finally {
			resourcesRoot.override = undefined;
		}
	});

	it("blocks what guard.py denies", async () => {
		const result = await gateToolCall("bash", { command: "rm -rf /" }, host("native", { hasUI: true }));
		expect(result).toEqual({ block: true, reason: expect.stringContaining("Bloqueado pelo guard") });
	});

	it("denies reading a secret and keeps denying under bypass", async () => {
		setBypassState(true);
		const result = await gateToolCall("read", { path: "~/.ssh/id_rsa" }, host("native", { hasUI: true }));
		expect(result?.block).toBe(true);
	});

	it("lets safe calls and tools the guard does not judge through", async () => {
		const native = host("native", { hasUI: false });
		expect(await gateToolCall("bash", { command: "ls" }, native)).toBeUndefined();
		expect(await gateToolCall("grep", { pattern: "x" }, native)).toBeUndefined();
	});

	it("asks the user and runs the call on approval", async () => {
		const confirm = vi.fn(async () => true);
		const result = await gateToolCall("bash", { command: "sudo ls" }, host("native", { hasUI: true, confirm }));
		expect(result).toBeUndefined();
		expect(confirm).toHaveBeenCalledWith("Allow bash?", expect.stringContaining("privilégio"));
	});

	it("ends the run when the user declines", async () => {
		const confirm = async () => false;
		const result = await gateToolCall("bash", { command: "sudo ls" }, host("native", { hasUI: true, confirm }));
		expect(result).toMatchObject({ block: true, terminate: true });
	});

	it("blocks an ask when there is no UI to confirm it", async () => {
		const result = await gateToolCall("bash", { command: "sudo ls" }, host("native", { hasUI: false }));
		expect(result).toEqual({ block: true, reason: expect.stringContaining("Confirmação necessária") });
	});

	it("turns an ask into allow under bypass", async () => {
		setBypassState(true);
		expect(await gateToolCall("bash", { command: "sudo ls" }, host("native", { hasUI: false }))).toBeUndefined();
	});

	it("denies the call when the engine itself fails (C-F8-12)", async () => {
		// A NUL byte makes realpath throw, as it does in guard.py.
		const result = await gateToolCall("read", { path: "/tmp/a\0b" }, host("native", { hasUI: true }));
		expect(result).toEqual({ block: true, reason: expect.stringContaining("permission engine failed") });
		const bash = await gateToolCall("bash", { command: 42 }, host("native", { hasUI: true }));
		expect(bash).toEqual({ block: true, reason: expect.stringContaining("permission engine failed") });
	});

	// F1 (C-F8-13): `run start` executes `bash -lc <command>`, so it is judged as Bash.
	it("judges a run start command as Bash", async () => {
		const native = host("native", { hasUI: false });
		const denied = await gateToolCall("run", { action: "start", command: "rm -rf /" }, native);
		expect(denied).toEqual({ block: true, reason: expect.stringContaining("Bloqueado pelo guard") });
		const asked = await gateToolCall("run", { action: "start", command: "sudo ls" }, native);
		expect(asked).toEqual({ block: true, reason: expect.stringContaining("Confirmação necessária") });
	});

	it("lets the run actions that carry no command through", async () => {
		const native = host("native", { hasUI: false });
		for (const input of [{ action: "list" }, { action: "tail", id: "r1" }, { action: "stop", id: "r1" }]) {
			expect(await gateToolCall("run", input, native)).toBeUndefined();
		}
		expect(await gateToolCall("run", { action: "start", command: "ls" }, native)).toBeUndefined();
	});

	it("judges file tools by the Claude shape (absolute file_path)", async () => {
		const result = await gateToolCall("write", { path: "/etc/x", content: "" }, host("native", { hasUI: false }));
		expect(result?.block).toBe(true);
	});
});

describe("guardHookEnabled", () => {
	it("is on for the script engine, off for the native one and for the global opt-out", () => {
		expect(guardHookEnabled({})).toBe(true);
		expect(guardHookEnabled({ permissions: { engine: "script" } })).toBe(true);
		expect(guardHookEnabled({ permissions: { engine: "native" } })).toBe(false);
		expect(guardHookEnabled({ hooks: { PreToolUse: [] } })).toBe(false);
	});

	it("keeps the guard for a global PreToolUse that names hooks of its own", () => {
		expect(guardHookEnabled({ hooks: { PreToolUse: [{ hooks: [] }] } })).toBe(true);
	});

	it("reads the engine as the gate does", async () => {
		const global = { permissions: { engine: "native" } };
		writeFileSync(join(agentDir, "settings.json"), JSON.stringify(global));
		expect(guardHookEnabled(readGlobalSettings())).toBe(false);
		expect(await gateToolCall("bash", { command: "rm -rf /" }, host("native", { hasUI: false }))).toMatchObject({
			block: true,
		});
	});
});

// K11 (C-F8-11): the permission gate that agent-session calls before every tool call: the engine switch, the ask
// confirmation, bypass, and the hooks the native engine replaces.
import { afterEach, describe, expect, it, vi } from "vitest";
import type * as BuiltinResources from "../../../src/core/builtin-resources.ts";
import type { ExtensionContext } from "../../../src/core/extensions/types.ts";
import { setBypassState } from "../../../src/core/permissions/bypass-state.ts";
import { type GateHost, gateToolCall, hooksForEngine } from "../../../src/core/permissions/gate.ts";
import { SettingsManager } from "../../../src/core/settings-manager.ts";

const { initialBypass, resourcesRoot } = vi.hoisted(() => ({
	initialBypass: process.env.NYCODE_BYPASS_PERMISSIONS,
	resourcesRoot: { override: undefined as string | undefined },
}));

vi.mock("../../../src/core/builtin-resources.ts", async (importOriginal) => {
	const original = await importOriginal<typeof BuiltinResources>();
	return { ...original, getBuiltinResourcesRoot: () => resourcesRoot.override ?? original.getBuiltinResourcesRoot() };
});

function host(engine: string, ui: { hasUI: boolean; confirm?: () => Promise<boolean> }): GateHost {
	const ctx = {
		cwd: "/tmp/gate-project",
		hasUI: ui.hasUI,
		ui: { confirm: ui.confirm },
	} as unknown as ExtensionContext;
	return {
		settings: SettingsManager.inMemory({ permissions: { engine } } as never),
		runner: { createContext: () => ctx },
	};
}

afterEach(() => {
	if (initialBypass === undefined) delete process.env.NYCODE_BYPASS_PERMISSIONS;
	else process.env.NYCODE_BYPASS_PERMISSIONS = initialBypass;
});

describe("gateToolCall", () => {
	it('leaves every call to the guard.py hook when the engine is "script"', async () => {
		expect(await gateToolCall("bash", { command: "rm -rf /" }, host("script", { hasUI: false }))).toBeUndefined();
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

describe("hooksForEngine", () => {
	it("drops the guard.py PreToolUse default only for the native engine", () => {
		expect(hooksForEngine({ permissions: { engine: "native" }, hooks: { Stop: [] } })).toEqual({
			Stop: [],
			PreToolUse: [],
		});
		expect(hooksForEngine({ permissions: { engine: "native" } })).toEqual({ PreToolUse: [] });
		expect(hooksForEngine({ hooks: { Stop: [] } })).toEqual({ Stop: [] });
		expect(hooksForEngine({})).toBeUndefined();
	});

	it("keeps a PreToolUse the user wrote", () => {
		const hooks = { PreToolUse: [{ hooks: [] }] };
		expect(hooksForEngine({ permissions: { engine: "native" }, hooks })).toBe(hooks);
	});
});

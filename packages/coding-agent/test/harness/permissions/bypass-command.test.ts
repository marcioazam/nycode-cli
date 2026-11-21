// K11 (C-F8-12): `/bypass`, its shortcut, the status key and the plan-mode hand-off, moved from ny-pi's
// bypass-permissions extension to core/permissions/.
import { afterEach, describe, expect, it, vi } from "vitest";
import bypassExtension from "../../../src/core/permissions/bypass-command.ts";
import { isBypassOn, setBypassState } from "../../../src/core/permissions/bypass-state.ts";
import { PLAN_MODE_CHANNEL } from "../../../src/extensions/_shared/events/plan-mode-state.ts";

const { initialBypass, initialNoColor } = vi.hoisted(() => ({
	initialBypass: process.env.NYCODE_BYPASS_PERMISSIONS,
	initialNoColor: process.env.NO_COLOR,
}));

afterEach(() => {
	for (const [name, value] of [
		["NYCODE_BYPASS_PERMISSIONS", initialBypass],
		["NO_COLOR", initialNoColor],
	] as const) {
		if (value === undefined) delete process.env[name];
		else process.env[name] = value;
	}
});

function load() {
	const handlers = new Map<string, (...args: never[]) => unknown>();
	const bus = new Map<string, (data: unknown) => void>();
	let command: ((args: string, ctx: unknown) => Promise<void>) | undefined;
	let shortcut: ((ctx: unknown) => Promise<void>) | undefined;
	const api = {
		on: (name: string, handler: (...args: never[]) => unknown) => handlers.set(name, handler),
		events: { on: (channel: string, handler: (data: unknown) => void) => bus.set(channel, handler) },
		registerCommand: (name: string, options: { handler: typeof command }) => {
			expect(name).toBe("bypass");
			command = options.handler;
		},
		registerShortcut: (_key: unknown, options: { handler: typeof shortcut }) => {
			shortcut = options.handler;
		},
	};
	bypassExtension(api as never);
	const status = vi.fn();
	const notify = vi.fn();
	const ctx = { hasUI: true, ui: { setStatus: status, notify, theme: { fg: (_c: string, text: string) => text } } };
	return { handlers, bus, command: command!, shortcut: shortcut!, ctx, status, notify };
}

describe("/bypass", () => {
	it("toggles, sets and reports the state the guard reads", async () => {
		setBypassState(false);
		const { command, ctx, notify, status } = load();
		await command("", ctx);
		expect(isBypassOn()).toBe(true);
		expect(process.env.NYCODE_BYPASS_PERMISSIONS).toBe("1");
		expect(status).toHaveBeenLastCalledWith("bypass-permissions", "⚠ BYPASS PERMISSIONS ON");
		await command("off", ctx);
		expect(isBypassOn()).toBe(false);
		expect(status).toHaveBeenLastCalledWith("bypass-permissions", "🔒 permissions: ask");
		await command("on", ctx);
		await command("status", ctx);
		expect(notify).toHaveBeenLastCalledWith("Bypass Permissions: ON", "info");
	});

	it("is toggled by the shortcut and shown at session start", async () => {
		setBypassState(false);
		const { handlers, shortcut, ctx, status } = load();
		await (handlers.get("session_start") as (e: unknown, c: unknown) => Promise<void>)({}, ctx);
		expect(status).toHaveBeenLastCalledWith("bypass-permissions", "🔒 permissions: ask");
		await shortcut(ctx);
		expect(isBypassOn()).toBe(true);
	});

	it("turns bypass on when plan mode ends and ignores other payloads", async () => {
		setBypassState(false);
		const { bus } = load();
		const plan = bus.get(PLAN_MODE_CHANNEL) as (data: unknown) => void;
		plan({ active: "yes" });
		plan({ active: false });
		expect(isBypassOn()).toBe(false);
		plan({ active: true });
		plan({ active: false });
		expect(isBypassOn()).toBe(true);
	});

	it("drops the colour under NO_COLOR", async () => {
		process.env.NO_COLOR = "1";
		setBypassState(true);
		const { handlers, ctx, status } = load();
		ctx.ui.theme.fg = () => "colored";
		await (handlers.get("session_start") as (e: unknown, c: unknown) => Promise<void>)({}, ctx);
		expect(status).toHaveBeenLastCalledWith("bypass-permissions", "⚠ BYPASS PERMISSIONS ON");
	});

	it("reads the same spellings as guard.py", () => {
		for (const [raw, on] of [
			["TRUE", true],
			["yes", true],
			["on", true],
			["0", false],
			["", false],
			["maybe", false],
		] as const) {
			process.env.NYCODE_BYPASS_PERMISSIONS = raw;
			expect(isBypassOn()).toBe(on);
		}
	});
});

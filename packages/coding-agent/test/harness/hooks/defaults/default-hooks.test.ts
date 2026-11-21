// The hooks nycode registers by default (settings-defaults.ts `hooks`): the hooks extension, started on default
// settings, resolves every command to a file under the embedded resources, and the guard blocks a catastrophic command.
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getBuiltinResourcesRoot, resolveResourcesMarker } from "../../../../src/core/builtin-resources.ts";
import type { ExtensionAPI, ExtensionContext } from "../../../../src/core/extensions/types.ts";
import { SETTINGS_DEFAULTS } from "../../../../src/core/settings-defaults.ts";
import hooksExtension from "../../../../src/extensions/hooks/index.ts";

type Handler = (event: unknown, ctx: ExtensionContext) => unknown;
interface Command {
	handler: (args: string, ctx: ExtensionContext) => Promise<void>;
}

let home: string;
let savedHome: string | undefined;

beforeEach(() => {
	savedHome = process.env.HOME;
	home = mkdtempSync(join(tmpdir(), "defhooks-"));
	process.env.HOME = home; // no ~/.claude settings reach the chain
});

afterEach(() => {
	if (savedHome === undefined) delete process.env.HOME;
	else process.env.HOME = savedHome;
	rmSync(home, { recursive: true });
});

/** Starts a session on `settings` and returns the `/hooks` summary and the tool_call handler. */
async function startSession(settings: { hooks?: Record<string, unknown> } = {}) {
	const handlers = new Map<string, Handler>();
	const commands = new Map<string, Command>();
	const api = {
		on: (name: string, fn: Handler) => handlers.set(name, fn),
		events: { on: () => () => {}, emit: () => {} },
		sendMessage: () => {},
		registerCommand: (name: string, command: Command) => commands.set(name, command),
		getSettings: () => settings,
	};
	hooksExtension(api as unknown as ExtensionAPI);
	const notify = vi.fn();
	const ctx = {
		cwd: home,
		hasUI: false,
		isProjectTrusted: () => false,
		ui: { notify },
		sessionManager: { getSessionId: () => "s1", getSessionFile: () => undefined },
		abort: () => {},
	} as unknown as ExtensionContext;
	await handlers.get("session_start")?.({ reason: "startup" }, ctx);
	const summary = async (): Promise<string> => {
		notify.mockClear();
		await commands.get("hooks")?.handler("", ctx);
		return String(notify.mock.calls[0]?.[0]);
	};
	const toolCall = (command: string) =>
		handlers.get("tool_call")?.({ toolName: "bash", toolCallId: "t1", input: { command } }, ctx);
	const runCall = (input: Record<string, unknown>) =>
		handlers.get("tool_call")?.({ toolName: "run", toolCallId: "t2", input }, ctx);
	return { summary, toolCall, runCall };
}

describe("default hooks", () => {
	it("registers the guard, graph context, dispatch and impeccable gate on their events", async () => {
		const text = await (await startSession()).summary();
		expect(text).toContain("PreToolUse:\n  [Bash|Edit|Write|Read] command: python3 ");
		expect(text).toContain("SessionStart:\n  [startup|resume|clear|compact] command: python3 ");
		expect(text).toContain("SubagentStart:\n  [*] command: python3 ");
		expect(text).toMatch(/PostToolUse:\n {2}\[\*\] command: bash .*hook-dispatch\.sh/);
		expect(text).toMatch(/\[Edit\|Write\] command: sh .*impeccable_gate\.sh" hook/);
		expect(text).toMatch(/Stop:\n {2}\[\*\] command: sh .*impeccable_gate\.sh" hook/);
		expect(text).not.toContain("ralph-loop");
	});

	it("every default command names a script that exists under the embedded resources", () => {
		const root = getBuiltinResourcesRoot();
		const commands = Object.values(SETTINGS_DEFAULTS.hooks)
			.flatMap((matchers) => matchers.flatMap((matcher) => matcher.hooks))
			.map((hook) => hook.command);
		expect(commands.length).toBe(8);
		for (const command of commands) {
			const script = /"([^"]+)"/.exec(resolveResourcesMarker(command, root))?.[1] ?? "";
			expect(script.startsWith(root), command).toBe(true);
			expect(existsSync(script), script).toBe(true);
		}
	});

	it("keeps the guard timeout at 30 s so CPU saturation does not block tool calls", () => {
		const [entry] = SETTINGS_DEFAULTS.hooks.PreToolUse;
		expect(entry.hooks.map((hook) => hook.timeout)).toEqual([30]);
	});

	it("runs the guard: a catastrophic command is blocked, a harmless one is not", async () => {
		const { toolCall } = await startSession();
		expect(await toolCall("rm -rf /")).toMatchObject({ block: true });
		expect(await toolCall("echo ok")).toBeUndefined();
	});

	// F1 (C-F8-13): `run start` executes `bash -lc <command>`; the guard judges it as Bash.
	it("runs the guard on a run start command: rm -rf / is denied, sudo asks, harmless and no-command actions pass", async () => {
		const { runCall } = await startSession();
		expect(await runCall({ action: "start", command: "rm -rf /" })).toMatchObject({ block: true });
		expect(await runCall({ action: "start", command: "sudo ls" })).toMatchObject({ block: true });
		expect(await runCall({ action: "start", command: "echo ok" })).toBeUndefined();
		expect(await runCall({ action: "list" })).toBeUndefined();
		expect(await runCall({ action: "stop", id: "r1" })).toBeUndefined();
	});

	it("a settings.json event entry replaces that event's default; an empty list turns it off", async () => {
		const session = await startSession({
			hooks: { PreToolUse: [], Stop: [{ hooks: [{ type: "command", command: "true" }] }] },
		});
		const text = await session.summary();
		expect(text).not.toContain("PreToolUse:");
		expect(text).toContain("Stop:\n  [*] command: true");
		expect(text.split("Stop:")[1]).not.toContain("impeccable_gate");
		expect(text).toContain("SessionStart:");
		expect(await session.toolCall("rm -rf /")).toBeUndefined();
	});
});

// The hooks nycode registers by default (settings-defaults.ts `hooks`): the hooks extension, started on default
// settings, resolves every command to a file under the embedded resources, and the guard blocks a catastrophic command.
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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

interface SessionOptions {
	/** The settings.json of ~/.nycode/agent (the global one); `settings` is the merged view the extension gets. */
	global?: Record<string, unknown>;
	/** A project directory with this `.claude/settings.json`, trusted by the user. */
	projectClaude?: Record<string, unknown>;
	/** `~/.claude/settings.json`. */
	userClaude?: Record<string, unknown>;
}

const writeJson = (file: string, value: unknown) => {
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, JSON.stringify(value));
};

/** Starts a session on `settings` and returns the `/hooks` summary and the tool_call handler. */
async function startSession(settings: { hooks?: Record<string, unknown> } = {}, options: SessionOptions = {}) {
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
	if (options.global) writeJson(join(home, ".nycode", "agent", "settings.json"), options.global);
	if (options.userClaude) writeJson(join(home, ".claude", "settings.json"), options.userClaude);
	const project = join(home, "project");
	if (options.projectClaude) writeJson(join(project, ".claude", "settings.json"), options.projectClaude);
	const trusted = options.projectClaude !== undefined;
	const ctx = {
		cwd: trusted ? project : home,
		hasUI: trusted,
		isProjectTrusted: () => trusted,
		ui: { notify, confirm: async () => true },
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
	return { summary, toolCall, runCall, notify };
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

	// F4 (C-F8-13): D-08, a guard that fails to run denies the call instead of failing open.
	it.each([127, 1])("blocks the call when the guard interpreter exits %i", async (code) => {
		const bin = join(home, "bin");
		mkdirSync(bin);
		writeFileSync(join(bin, "python3"), `#!/bin/sh\nexit ${code}\n`);
		chmodSync(join(bin, "python3"), 0o755);
		const savedPath = process.env.PATH;
		process.env.PATH = `${bin}:${savedPath}`;
		try {
			const { toolCall } = await startSession();
			expect(await toolCall("echo ok")).toMatchObject({ block: true, reason: expect.stringContaining("onFailure") });
		} finally {
			process.env.PATH = savedPath;
		}
	});

	// F3 (C-F8-13): with the script engine the guard is always in the effective PreToolUse.
	it("a PreToolUse of the settings adds to the guard instead of replacing it", async () => {
		const mine = { matcher: "Bash", hooks: [{ type: "command", command: "true" }] };
		const session = await startSession({ hooks: { PreToolUse: [mine] } });
		const text = await session.summary();
		expect(text).toContain("python3 ");
		expect(text).toContain("[Bash] command: true");
		expect(await session.toolCall("rm -rf /")).toMatchObject({ block: true });
	});

	it("other events of the settings still replace their default", async () => {
		const session = await startSession({ hooks: { Stop: [{ hooks: [{ type: "command", command: "true" }] }] } });
		const text = await session.summary();
		expect(text).toContain("Stop:\n  [*] command: true");
		expect(text.split("Stop:")[1]).not.toContain("impeccable_gate");
		expect(text).toContain("SessionStart:");
	});

	// F9 (C-F9-04): the ralph-loop Stop hook is not registered by `nycode install`; the settings snippet of
	// docs/optional-packages.md is the way in, so the test loads that very snippet.
	it("registers the ralph-loop Stop hook from the optional-packages snippet and keeps the impeccable gate", async () => {
		const doc = readFileSync(new URL("../../../../docs/optional-packages.md", import.meta.url), "utf8");
		const snippet = /```json\n(\{\n {2}"hooks"[\s\S]*?)\n```/.exec(doc)?.[1] ?? "";
		const settings = JSON.parse(snippet) as { hooks: Record<string, unknown> };
		const text = await (await startSession(settings)).summary();
		const stop = text.split("Stop:")[1] ?? "";
		expect(stop).toContain(
			'[*] command: bash "$HOME/.nycode/agent/git/github.com/marcioazam/ralph-loop/hooks/stop-hook.sh"',
		);
		expect(stop).toMatch(/impeccable_gate\.sh" hook/);
	});

	it("an empty PreToolUse in the GLOBAL settings turns the guard off and warns once", async () => {
		const hooks = { PreToolUse: [] };
		const session = await startSession({ hooks }, { global: { hooks } });
		expect(session.notify.mock.calls.filter(([text]) => String(text).includes("guard.py"))).toHaveLength(1);
		expect(await session.summary()).not.toContain("PreToolUse:");
		expect(await session.toolCall("rm -rf /")).toBeUndefined();
	});

	it("an empty PreToolUse that only the project's settings carries does not turn the guard off", async () => {
		const session = await startSession({ hooks: { PreToolUse: [] } });
		expect(await session.toolCall("rm -rf /")).toMatchObject({ block: true });
	});

	it("disableAllHooks in a project file keeps the guard; in the user's own file it turns everything off", async () => {
		const project = await startSession({}, { projectClaude: { disableAllHooks: true } });
		expect(await project.toolCall("rm -rf /")).toMatchObject({ block: true });
		expect(await project.summary()).not.toContain("SessionStart:");
		const user = await startSession({}, { userClaude: { disableAllHooks: true } });
		expect(await user.toolCall("rm -rf /")).toBeUndefined();
	});
});

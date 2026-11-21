// Characterization of the print-mode behaviour pi-code 1.7.0 carried as the local patch `commands-print`
// (D-32): with no UI a failed injected command reports on stderr and sets the exit code, and a successful one
// holds the handler until the run it started settles (agent_settled), or gives up after 60 s when none starts.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionAPI, ExtensionCommandContext } from "../../../src/core/extensions/types.ts";
import commandsExtension from "../../../src/extensions/commands/index.ts";

type Handler = (...args: never[]) => unknown;

let home: string;
let savedExitCode: typeof process.exitCode;

beforeEach(() => {
	home = fs.mkdtempSync(path.join(os.tmpdir(), "nycode-commands-print-"));
	fs.mkdirSync(path.join(home, ".claude", "commands"), { recursive: true });
	vi.stubEnv("HOME", home);
	vi.stubEnv("USERPROFILE", home);
	savedExitCode = process.exitCode;
});

afterEach(() => {
	process.exitCode = savedExitCode;
	vi.useRealTimers();
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
	fs.rmSync(home, { recursive: true });
});

function writeCommand(name: string, body: string): void {
	fs.writeFileSync(path.join(home, ".claude", "commands", `${name}.md`), `---\ndescription: test\n---\n${body}\n`);
}

interface Harness {
	run: (hasUI: boolean, isIdle?: () => boolean) => Promise<void>;
	settle: () => void;
	sendUserMessage: ReturnType<typeof vi.fn>;
	notify: ReturnType<typeof vi.fn>;
	exec: ReturnType<typeof vi.fn>;
}

/** Loads the extension against a recording fake, runs session_start, and returns a runner for one command. */
async function load(command: string, execResult: { stdout: string; stderr: string; code: number }): Promise<Harness> {
	const events = new Map<string, Handler>();
	const commands = new Map<string, { handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> }>();
	const sendUserMessage = vi.fn();
	const notify = vi.fn();
	const exec = vi.fn(async () => execResult);
	const fake = {
		on: (event: string, handler: Handler) => void events.set(event, handler),
		registerCommand: (
			name: string,
			options: { handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> },
		) => void commands.set(name, options),
		registerTool: vi.fn(),
		sendUserMessage,
		exec,
		getActiveTools: () => [],
		setActiveTools: vi.fn(),
		setModel: vi.fn(),
		setThinkingLevel: vi.fn(),
	} as unknown as ExtensionAPI;
	commandsExtension(fake);
	const base = { cwd: home, isProjectTrusted: () => false };
	await (events.get("session_start") as (e: unknown, c: unknown) => Promise<void>)({}, { ...base, hasUI: false });
	const registered = commands.get(command);
	if (!registered) throw new Error(`command ${command} was not registered`);
	return {
		run: (hasUI, isIdle = () => true) =>
			registered.handler("", { ...base, hasUI, isIdle, ui: { notify } } as unknown as ExtensionCommandContext),
		settle: () => (events.get("agent_settled") as () => void)(),
		sendUserMessage,
		notify,
		exec,
	};
}

describe("commands print mode (commands-print patch)", () => {
	it("without UI, a failed injected span goes to stderr, sets exit code 1 and sends nothing", async () => {
		writeCommand("boom", "Run !`false` now");
		const h = await load("boom", { stdout: "", stderr: "exploded", code: 1 });
		const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
		process.exitCode = undefined;

		await h.run(false);

		expect(h.notify).toHaveBeenCalledWith(expect.stringContaining("exploded"), "error");
		expect(stderr).toHaveBeenCalledTimes(1);
		expect(String(stderr.mock.calls[0]?.[0])).toMatch(/^boom: [\s\S]*exploded[\s\S]*\n$/);
		expect(process.exitCode).toBe(1);
		expect(h.sendUserMessage).not.toHaveBeenCalled();
	});

	it("with a UI, a failed injected span only notifies: no stderr, no exit code", async () => {
		writeCommand("boom", "Run !`false` now");
		const h = await load("boom", { stdout: "", stderr: "exploded", code: 1 });
		const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
		process.exitCode = undefined;

		await h.run(true);

		expect(h.notify).toHaveBeenCalledWith(expect.stringContaining("exploded"), "error");
		expect(stderr).not.toHaveBeenCalled();
		expect(process.exitCode).toBeUndefined();
		expect(h.sendUserMessage).not.toHaveBeenCalled();
	});

	it("with a UI, a successful command sends the expanded body and returns without waiting", async () => {
		writeCommand("hello", "Say hello");
		const h = await load("hello", { stdout: "", stderr: "", code: 0 });

		await h.run(true);

		expect(h.sendUserMessage).toHaveBeenCalledTimes(1);
		expect(h.sendUserMessage).toHaveBeenCalledWith("Say hello");
	});

	it("without UI, holds the handler until agent_settled once the run has started", async () => {
		writeCommand("hello", "Say hello");
		const h = await load("hello", { stdout: "", stderr: "", code: 0 });
		let done = false;

		const pending = h
			.run(false, () => h.sendUserMessage.mock.calls.length === 0)
			.then(() => {
				done = true;
			});
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(h.sendUserMessage).toHaveBeenCalledWith("Say hello");
		expect(done).toBe(false);

		h.settle();
		await pending;
		expect(done).toBe(true);
	});

	it("without UI, gives up after 60 s when no run ever starts", async () => {
		vi.useFakeTimers();
		writeCommand("hello", "Say hello");
		const h = await load("hello", { stdout: "", stderr: "", code: 0 });
		let done = false;

		const pending = h
			.run(false, () => true)
			.then(() => {
				done = true;
			});
		await vi.advanceTimersByTimeAsync(59_000);
		expect(done).toBe(false);

		await vi.advanceTimersByTimeAsync(2_000);
		await pending;
		expect(done).toBe(true);
	});
});

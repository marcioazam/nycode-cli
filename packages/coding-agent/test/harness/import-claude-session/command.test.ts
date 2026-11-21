// /puxar: argument handling and the hand-off to puxar.py (exec is faked; no real Claude session is read).
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionAPI, ExtensionCommandContext } from "../../../src/core/extensions/types.ts";
import importClaudeSessionExtension from "../../../src/extensions/import-claude-session/index.ts";

type Handler = (args: string, ctx: ExtensionCommandContext) => Promise<void>;

let dir: string;
const notify = vi.fn();
const switchSession = vi.fn();
const exec = vi.fn();
let handler: Handler;
let currentFile: string | undefined;

function fakeContext(): ExtensionCommandContext {
	return {
		cwd: "/work",
		ui: { notify },
		sessionManager: { getSessionDir: () => "/sessions", getSessionFile: () => currentFile },
		waitForIdle: async () => {},
		switchSession,
	} as unknown as ExtensionCommandContext;
}

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "nycode-puxar-"));
	currentFile = undefined;
	notify.mockReset();
	switchSession.mockReset().mockResolvedValue({ cancelled: false });
	exec.mockReset();
	let registered: Handler | undefined;
	importClaudeSessionExtension({
		exec,
		registerCommand: (name: string, options: { handler: Handler }) => {
			if (name === "puxar") registered = options.handler;
		},
	} as unknown as ExtensionAPI);
	if (!registered) throw new Error("puxar not registered");
	handler = registered;
});

afterEach(() => {
	rmSync(dir, { recursive: true });
});

describe("/puxar", () => {
	it("shows the usage without arguments", async () => {
		await handler("  ", fakeContext());
		expect(notify).toHaveBeenCalledWith(expect.stringContaining("uso: /puxar"), "warning");
		expect(exec).not.toHaveBeenCalled();
	});

	it("passes profile, cwd and session dir to the script and reports its failure", async () => {
		exec.mockResolvedValue({ code: 1, stdout: "", stderr: "perfil x não existe\n" });
		await handler("x", fakeContext());
		expect(exec).toHaveBeenCalledWith("python3", [expect.stringMatching(/puxar\.py$/), "x", "/work", "/sessions"], {
			timeout: 120_000,
		});
		expect(notify).toHaveBeenCalledWith("perfil x não existe", "error");
	});

	it("errors when the script names no session file", async () => {
		exec.mockResolvedValue({ code: 0, stdout: "importada: abc\n", stderr: "" });
		await handler("1", fakeContext());
		expect(notify).toHaveBeenCalledWith(expect.stringContaining("não informou o arquivo"), "error");
		expect(switchSession).not.toHaveBeenCalled();
	});

	it("switches to the imported session", async () => {
		const file = join(dir, "s.jsonl");
		writeFileSync(file, "");
		exec.mockResolvedValue({ code: 0, stdout: `importada: abc\nNYCODE_SESSION_FILE=${file}\n`, stderr: "" });
		await handler("1", fakeContext());
		expect(switchSession).toHaveBeenCalledWith(file, expect.objectContaining({ withSession: expect.any(Function) }));
	});

	it("does not switch when the imported session is already open", async () => {
		const file = join(dir, "s.jsonl");
		writeFileSync(file, "");
		currentFile = file;
		exec.mockResolvedValue({ code: 0, stdout: `importada: abc\nNYCODE_SESSION_FILE=${file}\n`, stderr: "" });
		await handler("1", fakeContext());
		expect(notify).toHaveBeenCalledWith(expect.stringContaining("já é a sessão aberta"), "info");
		expect(switchSession).not.toHaveBeenCalled();
	});

	it("warns when the switch is cancelled", async () => {
		const file = join(dir, "s.jsonl");
		writeFileSync(file, "");
		switchSession.mockResolvedValue({ cancelled: true });
		exec.mockResolvedValue({ code: 0, stdout: `x\nNYCODE_SESSION_FILE=${file}\n`, stderr: "" });
		await handler("1", fakeContext());
		expect(notify).toHaveBeenCalledWith(expect.stringContaining("cancelada"), "warning");
	});
});

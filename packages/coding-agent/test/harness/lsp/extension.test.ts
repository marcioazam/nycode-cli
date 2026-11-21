// The lsp extension end to end against a fake language server (fixtures/fake-server.mjs): post-edit
// diagnostics on write/edit, the five tools, once-per-session failure text and shutdown.
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ENV_AGENT_DIR } from "../../../src/config.ts";
import type { ExtensionAPI, ExtensionContext } from "../../../src/core/extensions/types.ts";
import lspExtension from "../../../src/extensions/lsp/index.ts";

const fakeServer = fileURLToPath(new URL("./fixtures/fake-server.mjs", import.meta.url));
const savedAgentDir = process.env[ENV_AGENT_DIR];

type Handler = (event: unknown, ctx: ExtensionContext) => Promise<unknown>;
interface Tool {
	execute(
		id: string,
		params: unknown,
		signal: undefined,
		onUpdate: undefined,
		ctx: ExtensionContext,
	): Promise<unknown>;
}

let workspace: string;
let ctx: ExtensionContext;
const handlers = new Map<string, Handler>();
const tools = new Map<string, Tool>();
const renderers: string[] = [];

function writeServers(servers: unknown[]) {
	writeFileSync(path.join(process.env[ENV_AGENT_DIR] ?? "", "lsp.json"), JSON.stringify({ servers }));
}

const fakeServerConfig = {
	id: "fake",
	include: ["**/*.txt"],
	rootMarkers: ["marker.root"],
	bin: process.execPath,
	args: [fakeServer],
	cwd: "{root}",
	diagnosticsWaitMs: 200,
	startupTimeoutMs: 10_000,
};

beforeEach(() => {
	const base = realpathSync(mkdtempSync(path.join(tmpdir(), "lsp-ext-")));
	const agentDir = path.join(base, "agent");
	process.env[ENV_AGENT_DIR] = agentDir;
	mkdirSync(agentDir, { recursive: true });
	workspace = path.join(base, "ws");
	mkdirSync(workspace);
	writeFileSync(path.join(workspace, "marker.root"), "");
	writeFileSync(path.join(workspace, "bad.txt"), "BAD\n");
	writeFileSync(path.join(workspace, "good.txt"), "fine\n");
	ctx = { cwd: workspace, hasUI: false } as unknown as ExtensionContext; // only cwd, hasUI and signal are read
	handlers.clear();
	tools.clear();
	renderers.length = 0;
	const api = {
		on: (name: string, fn: Handler) => handlers.set(name, fn),
		registerTool: (tool: { name: string } & Tool) => tools.set(tool.name, tool),
		registerMessageRenderer: (type: string) => renderers.push(type),
	};
	lspExtension(api as unknown as ExtensionAPI);
});

afterEach(async () => {
	await handlers.get("session_shutdown")?.({}, ctx);
	if (savedAgentDir === undefined) delete process.env[ENV_AGENT_DIR];
	else process.env[ENV_AGENT_DIR] = savedAgentDir;
});

const afterWrite = (file: string, isError = false) =>
	handlers.get("tool_result")?.(
		{ toolName: "write", isError, input: { path: file }, content: [{ type: "text", text: "ok" }] },
		ctx,
	);
const callTool = async (name: string, params: unknown) => {
	const result = (await tools.get(name)?.execute("id", params, undefined, undefined, ctx)) as {
		content: { text: string }[];
	};
	return result.content[0]?.text ?? "";
};

describe("registration", () => {
	it("registers the five tools, the tool_result and session_shutdown hooks and the diagnostics renderer", () => {
		expect([...tools.keys()].sort()).toEqual([
			"lsp_definition",
			"lsp_diagnostics",
			"lsp_hover",
			"lsp_references",
			"lsp_symbols",
		]);
		expect([...handlers.keys()].sort()).toEqual(["session_shutdown", "tool_result"]);
		expect(renderers).toEqual(["lsp-diagnostics"]);
	});
});

describe("post-edit diagnostics", () => {
	beforeEach(() => writeServers([fakeServerConfig]));

	it("appends only the errors to the tool result of a write", async () => {
		const result = (await afterWrite("bad.txt")) as { content: { type: string; text: string }[] };
		expect(result.content).toHaveLength(2);
		expect(result.content[0]?.text).toBe("ok");
		const text = result.content[1]?.text ?? "";
		expect(text).toContain("⚠️ fake:\nbad.txt:1:1 - error: fake: bad token [7]");
		expect(text).not.toContain("just a warning");
	});

	it("adds nothing for a clean file, a failed tool, another tool or a file no server matches", async () => {
		expect(await afterWrite("good.txt")).toBeUndefined();
		expect(await afterWrite("bad.txt", true)).toBeUndefined();
		expect(
			await handlers.get("tool_result")?.({ toolName: "bash", isError: false, input: {}, content: [] }, ctx),
		).toBeUndefined();
		writeFileSync(path.join(workspace, "notes.md"), "BAD");
		expect(await afterWrite("notes.md")).toBeUndefined();
	});
});

describe("tools", () => {
	beforeEach(() => writeServers([fakeServerConfig]));

	it("lsp_diagnostics returns every stored severity after an edit and a no-diagnostics note before", async () => {
		const file = path.join(workspace, "bad.txt");
		expect(await callTool("lsp_diagnostics", { path: "bad.txt" })).toBe(
			`LSP diagnostics:\n\n✅ no diagnostics recorded for ${file}`,
		);
		await afterWrite("bad.txt");
		const text = await callTool("lsp_diagnostics", { path: "bad.txt" });
		expect(text).toContain("error: fake: bad token [7]");
		expect(text).toContain("warning: fake: just a warning");
	});

	it("lsp_hover forwards the request to the matching server", async () => {
		expect(JSON.parse(await callTool("lsp_hover", { path: "bad.txt", line: 0, character: 0 }))).toEqual({
			contents: "fake hover",
		});
	});

	it("reports when no server matches the file", async () => {
		writeFileSync(path.join(workspace, "notes.md"), "x");
		expect(await callTool("lsp_symbols", { path: "notes.md" })).toBe("No matching LSP server for notes.md");
	});
});

describe("server failures", () => {
	it("reports a missing binary, then backs off before the next attempt", async () => {
		writeServers([{ ...fakeServerConfig, bin: "nycode-no-such-language-server" }]);
		const first = (await afterWrite("bad.txt")) as { content: { text: string }[] };
		expect(first.content[1]?.text).toContain("fake: LSP binary not found: nycode-no-such-language-server");
		const second = (await afterWrite("bad.txt")) as { content: { text: string }[] };
		expect(second.content[1]?.text).toMatch(/fake: unavailable \(.*LSP binary not found.*\); retry after /);
	});

	it("skips servers whose root markers are missing without a warning", async () => {
		writeServers([{ ...fakeServerConfig, rootMarkers: ["no-such-marker.zz"] }]);
		expect(await afterWrite("bad.txt")).toBeUndefined();
	});
});

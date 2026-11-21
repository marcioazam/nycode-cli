// K11 (C-F8-11) for the tools a codemode script calls: a nested call goes through the same permission gate as a
// direct one. Native engine: gate.ts denies a command the guard denies. Script engine: the embedded guard.py PreToolUse
// hook (the `hooks` extension) sees the nested call. The `bash` here is a recorder, so nothing real runs.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentTool } from "@nycode/agent-core";
import { fauxAssistantMessage, fauxToolCall } from "@nycode/ai";
import { Type } from "typebox";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCodemodeExtension } from "../../../src/extensions/codemode/index.ts";
import hooksExtension from "../../../src/extensions/hooks/index.ts";
import { createHarness, createTestUiContext, getToolResult, type Harness } from "../../suite/harness.ts";

let root: string;
let saved: { agentDir?: string; home?: string };
const harnesses: Harness[] = [];

beforeEach(() => {
	saved = { agentDir: process.env.NYCODE_CODING_AGENT_DIR, home: process.env.HOME };
	root = mkdtempSync(join(tmpdir(), "nested-gate-"));
	// An empty HOME keeps the developer's ~/.claude hooks out of the chain.
	process.env.HOME = join(root, "home");
	process.env.NYCODE_CODING_AGENT_DIR = join(root, "agent");
	mkdirSync(process.env.HOME, { recursive: true });
	mkdirSync(process.env.NYCODE_CODING_AGENT_DIR, { recursive: true });
});

afterEach(() => {
	while (harnesses.length > 0) harnesses.pop()?.cleanup();
	for (const [key, value] of [
		["NYCODE_CODING_AGENT_DIR", saved.agentDir],
		["HOME", saved.home],
	] as const) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	rmSync(root, { recursive: true });
});

// One safe command and one the guard denies, called in this order from inside the script.
const SCRIPT = `
const outcome = {};
for (const command of ["ls", "rm -rf /"]) {
	try { await tools.bash({ command }); outcome[command] = "ran"; }
	catch (error) { outcome[command] = error.message; }
}
text(JSON.stringify(outcome));
`;

describe.each(["native", "script"] as const)("permissions.engine %s", (engine) => {
	it("judges a bash call made from a codemode script like a direct one", async () => {
		writeFileSync(
			join(process.env.NYCODE_CODING_AGENT_DIR ?? "", "settings.json"),
			JSON.stringify({ permissions: { engine } }),
		);
		const ran: string[] = [];
		const bash: AgentTool = {
			name: "bash",
			label: "Bash",
			description: "Recorder.",
			parameters: Type.Object({ command: Type.String() }),
			execute: async (_id, params) => {
				ran.push((params as { command: string }).command);
				return { content: [{ type: "text", text: "ok" }], details: {} };
			},
		};
		const harness = await createHarness({
			tools: [bash],
			initialActiveToolNames: ["codemode", "bash"],
			extensionFactories: [createCodemodeExtension(), hooksExtension],
		});
		harnesses.push(harness);
		await harness.session.bindExtensions({ uiContext: createTestUiContext() });
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("codemode", { code: SCRIPT })], { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("run it");

		const result = getToolResult(harness, "codemode");
		const text = result.content.map((part) => (part.type === "text" ? part.text : "")).join("\n");
		const outcome = JSON.parse(text.slice(text.indexOf("{"))) as Record<string, string>;
		expect(outcome.ls).toBe("ran");
		expect(outcome["rm -rf /"]).toContain("Bloqueado pelo guard");
		expect(ran).toEqual(["ls"]);
	});
});

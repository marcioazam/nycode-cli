// Smoke test for the embedded subagent extension: loaded against a fake ExtensionAPI it registers the `subagent`
// tool and the /tasks, /agents and /subagents-setup commands (and /team, which only exists in the main session).
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ENV_AGENT_DIR } from "../../../src/config.ts";
import type { ExtensionAPI } from "../../../src/core/extensions/types.ts";
import { builtInExtensions } from "../../../src/extensions/index.ts";
import subagentExtension from "../../../src/extensions/subagent/index.ts";
import { childNestingEnv } from "../../../src/extensions/subagent/nesting/index.ts";

const tmp = mkdtempSync(join(tmpdir(), "nycode-subagent-register-"));
const saved = { agentDir: process.env[ENV_AGENT_DIR], marker: process.env.NYCODE_SUBAGENT };

beforeAll(() => {
	// The routing policy file and the fleet state must never come from the real agent dir.
	process.env[ENV_AGENT_DIR] = join(tmp, "agent");
	mkdirSync(join(tmp, "agent"));
	delete process.env.NYCODE_SUBAGENT;
});

afterAll(() => {
	if (saved.agentDir === undefined) delete process.env[ENV_AGENT_DIR];
	else process.env[ENV_AGENT_DIR] = saved.agentDir;
	if (saved.marker !== undefined) process.env.NYCODE_SUBAGENT = saved.marker;
	rmSync(tmp, { recursive: true, force: true });
});

interface Recorded {
	tools: Array<{ name: string; description: string }>;
	commands: string[];
	events: string[];
}

function load(): Recorded {
	const recorded: Recorded = { tools: [], commands: [], events: [] };
	const api = {
		on: (event: string) => {
			recorded.events.push(event);
		},
		events: { on: () => () => {} },
		registerTool: (tool: { name: string; description: string }) => {
			recorded.tools.push(tool);
		},
		registerCommand: (name: string) => {
			recorded.commands.push(name);
		},
		getActiveTools: () => [],
		setActiveTools: () => {},
	};
	subagentExtension(api as unknown as ExtensionAPI);
	return recorded;
}

describe("subagent extension", () => {
	it("registers the subagent tool and its commands", () => {
		const recorded = load();
		expect(recorded.tools.map((tool) => tool.name)).toEqual(["subagent"]);
		expect(recorded.commands.sort()).toEqual(["agents", "subagents-setup", "tasks", "team"]);
		expect(recorded.events).toContain("session_start");
	});

	it("names the nycode agent directories in the tool description", () => {
		const [tool] = load().tools;
		expect(tool?.description).toContain("~/.nycode/agent/agents");
		expect(tool?.description).toContain(".nycode/agents");
		expect(tool?.description).not.toMatch(/\.pi\b/);
	});

	it("is registered as a builtin named subagent", () => {
		const entry = builtInExtensions.find(
			(extension) => typeof extension !== "function" && extension.name === "subagent",
		);
		expect(entry).toMatchObject({ name: "subagent", builtin: true });
	});

	it("marks the child process with NYCODE_SUBAGENT, the variable session-title, memory and hooks read", () => {
		expect(childNestingEnv({})).toMatchObject({ NYCODE_SUBAGENT: "1", NYCODE_SUBAGENT_DEPTH: "1" });
	});
});

// The built-in agents (Explore, Plan, general-purpose) ship as markdown next to the extension. In pi-code they were
// found through import.meta.dirname; embedded, the directory resolves through getBuiltinAgentsDir and copy-assets
// (copy-binary-assets for the standalone binary) puts it in dist. Project agents live under CONFIG_DIR_NAME.
import * as fs from "node:fs";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { CONFIG_DIR_NAME, ENV_AGENT_DIR, getBuiltinAgentsDir } from "../../../src/config.ts";
import { discoverAgents } from "../../../src/extensions/subagent/registry/agents.ts";

const tmp = mkdtempSync(join(tmpdir(), "nycode-subagent-agents-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe("getBuiltinAgentsDir", () => {
	it("holds the three built-in agents", () => {
		const names = fs.readdirSync(getBuiltinAgentsDir()).filter((name) => name.endsWith(".md"));
		expect(names.sort()).toEqual(["explore.md", "general-purpose.md", "plan.md"]);
	});
});

describe("discoverAgents", () => {
	it("lists the built-in agents with the builtin source", () => {
		const previous = process.env[ENV_AGENT_DIR];
		const previousHome = process.env.HOME;
		process.env[ENV_AGENT_DIR] = join(tmp, "agent");
		process.env.HOME = join(tmp, "home"); // no user agents of the machine in the way
		try {
			const builtin = discoverAgents(tmp, "user")
				.agents.filter((agent) => agent.source === "builtin")
				.map((agent) => agent.name);
			// resources/agents (K6) adds embedded agents of the same source, some with the bundled names
			expect(builtin).toEqual(expect.arrayContaining(["Explore", "Plan", "general-purpose"]));
		} finally {
			if (previous === undefined) delete process.env[ENV_AGENT_DIR];
			else process.env[ENV_AGENT_DIR] = previous;
			if (previousHome === undefined) delete process.env.HOME;
			else process.env.HOME = previousHome;
		}
	});

	it("reads project agents from the project config directory", () => {
		const dir = join(tmp, "project", CONFIG_DIR_NAME, "agents");
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "scout.md"), "---\nname: scout\ndescription: Looks around\n---\nLook around.\n");
		const found = discoverAgents(join(tmp, "project"), "project");
		expect(found.projectAgentsDir).toBe(dir);
		expect(found.agents.map((agent) => agent.name)).toContain("scout");
	});
});

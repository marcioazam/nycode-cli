// lsp.json loading: the global file lives in the nycode agent dir, the project one in `<configDir>/lsp.json`
// and needs a trust decision; a project entry overrides the global one by id.
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CONFIG_DIR_NAME, ENV_AGENT_DIR } from "../../../src/config.ts";
import type { ExtensionContext } from "../../../src/core/extensions/types.ts";
import { loadLspConfig } from "../../../src/extensions/lsp/_shared/config/config.ts";
import { getTrustStorePath, sha256 } from "../../../src/extensions/lsp/_shared/config/trust.ts";

const savedAgentDir = process.env[ENV_AGENT_DIR];
let agentDir: string;
let project: string;

beforeEach(() => {
	const base = realpathSync(mkdtempSync(path.join(tmpdir(), "lsp-config-")));
	agentDir = path.join(base, "agent");
	project = path.join(base, "project");
	mkdirSync(agentDir, { recursive: true });
	mkdirSync(path.join(project, CONFIG_DIR_NAME), { recursive: true });
	process.env[ENV_AGENT_DIR] = agentDir;
});

afterEach(() => {
	if (savedAgentDir === undefined) delete process.env[ENV_AGENT_DIR];
	else process.env[ENV_AGENT_DIR] = savedAgentDir;
});

function ctx(choice?: string): ExtensionContext {
	return {
		cwd: project,
		hasUI: choice !== undefined,
		ui: { select: async () => choice },
	} as unknown as ExtensionContext; // only cwd, hasUI and ui.select are read
}

const writeGlobal = (servers: unknown[]) => writeFileSync(path.join(agentDir, "lsp.json"), JSON.stringify({ servers }));
const projectFile = () => path.join(project, CONFIG_DIR_NAME, "lsp.json");
const writeProject = (servers: unknown[]) => writeFileSync(projectFile(), JSON.stringify({ servers }));

describe("global config", () => {
	it("reads getAgentDir()/lsp.json and drops entries without id or bin", async () => {
		writeGlobal([{ id: "a", bin: "a-bin", args: ["--x"], include: ["**/*.a"] }, { id: "no-bin" }, { bin: "x" }, 5]);
		const loaded = await loadLspConfig(ctx());
		expect(loaded.items.map((item) => item.id)).toEqual(["a"]);
		expect(loaded.items[0]).toMatchObject({ bin: "a-bin", args: ["--x"], include: ["**/*.a"] });
		expect(loaded.layers.map((layer) => layer.path)).toEqual([path.join(agentDir, "lsp.json")]);
	});

	it("is empty when the file is missing and warns when it is not valid JSON", async () => {
		expect((await loadLspConfig(ctx())).items).toEqual([]);
		writeFileSync(path.join(agentDir, "lsp.json"), "{nope");
		const loaded = await loadLspConfig(ctx());
		expect(loaded.items).toEqual([]);
		expect(loaded.warnings[0]).toContain("Failed to load global lsp config");
	});
});

describe("project config trust", () => {
	it("is rejected without a UI", async () => {
		writeProject([{ id: "p", bin: "p-bin" }]);
		const loaded = await loadLspConfig(ctx());
		expect(loaded.items).toEqual([]);
		expect(loaded.warnings[0]).toContain("project-local config rejected in non-interactive mode");
	});

	it("is trusted once without being remembered", async () => {
		writeProject([{ id: "p", bin: "p-bin" }]);
		const loaded = await loadLspConfig(ctx("Trust once"));
		expect(loaded.items.map((item) => item.id)).toEqual(["p"]);
		expect((await loadLspConfig(ctx())).items).toEqual([]);
	});

	it("is remembered by content hash under the agent dir with 'Trust always', and a change asks again", async () => {
		writeProject([{ id: "p", bin: "p-bin" }]);
		expect((await loadLspConfig(ctx("Trust always"))).items).toHaveLength(1);
		const store = getTrustStorePath("lsp");
		expect(store).toBe(path.join(agentDir, "trust", "lsp.json"));
		expect(JSON.parse(readFileSync(store, "utf8")).trustedHashes).toEqual([
			sha256(readFileSync(projectFile(), "utf8")),
		]);

		expect((await loadLspConfig(ctx())).items.map((item) => item.id)).toEqual(["p"]);
		writeProject([{ id: "p", bin: "other-bin" }]);
		expect((await loadLspConfig(ctx())).items).toEqual([]);
	});

	it("is dropped on 'Reject'", async () => {
		writeProject([{ id: "p", bin: "p-bin" }]);
		const loaded = await loadLspConfig(ctx("Reject"));
		expect(loaded.items).toEqual([]);
		expect(loaded.warnings[0]).toContain("rejected by user");
	});

	it("ignores a legacy .pi/lsp.json", async () => {
		mkdirSync(path.join(project, ".pi"));
		writeFileSync(path.join(project, ".pi", "lsp.json"), JSON.stringify({ servers: [{ id: "old", bin: "old" }] }));
		const loaded = await loadLspConfig(ctx("Trust always"));
		expect(loaded.items).toEqual([]);
		expect(loaded.layers).toEqual([]);
	});
});

describe("layer merge", () => {
	it("lets a trusted project entry override the global one by id, and enabled:false remove it", async () => {
		writeGlobal([
			{ id: "a", bin: "global-a" },
			{ id: "b", bin: "global-b" },
		]);
		writeProject([
			{ id: "a", bin: "project-a" },
			{ id: "b", enabled: false },
		]);
		const loaded = await loadLspConfig(ctx("Trust once"));
		expect(loaded.items.map((item) => [item.id, item.bin])).toEqual([["a", "project-a"]]);
	});
});

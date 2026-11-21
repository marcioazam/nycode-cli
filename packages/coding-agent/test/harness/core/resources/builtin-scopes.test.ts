// K6 in the extensions that load agents, commands, skills for `/skill:` and rules: each one asks the same resolver and
// gives the embedded resource the lowest precedence; a user or project resource with the same name replaces it.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONFIG_DIR_NAME } from "../../../../src/config.ts";
import { RESOURCES_MARKER } from "../../../../src/core/builtin-resources.ts";
import type { ExtensionAPI, ExtensionContext } from "../../../../src/core/extensions/types.ts";
import { parseCommandFile } from "../../../../src/extensions/_shared/commands/command-file.ts";
import claudeRulesExtension from "../../../../src/extensions/claude-rules/index.ts";
import { agentOmitsClaudeMd } from "../../../../src/extensions/claude-rules/omit-claude-md.ts";
import { collectCommands, commandDirs, expandCommand } from "../../../../src/extensions/commands/expand.ts";
import { skillDirs } from "../../../../src/extensions/skills-compat/index.ts";
import { discoverAgents } from "../../../../src/extensions/subagent/registry/agents.ts";
import { createResourcesFixture, type ResourcesFixture } from "./fixture.ts";

const agent = (name: string, body: string) => `---\nname: ${name}\ndescription: ${body}\n---\n${body}\n`;

let fx: ResourcesFixture;
let home: string;
let cwd: string;
beforeEach(() => {
	fx = createResourcesFixture();
	home = process.env.HOME as string;
	cwd = join(fx.root, "project");
	mkdirSync(cwd, { recursive: true });
});
afterEach(() => fx.dispose());

describe("agents", () => {
	it("lists the embedded agents with the builtin source and resolves the marker in the prompt", () => {
		fx.write("agents/Explore.md", agent("Explore", `see ${RESOURCES_MARKER}/rules/safety.md`));
		const found = discoverAgents(cwd, "user").agents.find((a) => a.name === "Explore");
		expect(found?.source).toBe("builtin");
		expect(found?.systemPrompt).toContain(`see ${fx.resources}/rules/safety.md`);
	});

	it("a user agent and a project agent each replace the embedded one of the same name", () => {
		fx.write("agents/Explore.md", agent("Explore", "embedded"));
		fx.write("agents/Plan.md", agent("Plan", "embedded"));
		const userDir = join(home, ".claude", "agents");
		mkdirSync(userDir, { recursive: true });
		writeFileSync(join(userDir, "Explore.md"), agent("Explore", "user"));
		const projectDir = join(cwd, CONFIG_DIR_NAME, "agents");
		mkdirSync(projectDir, { recursive: true });
		writeFileSync(join(projectDir, "Plan.md"), agent("Plan", "project"));
		const byName = new Map(discoverAgents(cwd, "both").agents.map((a) => [a.name, a]));
		expect([byName.get("Explore")?.source, byName.get("Explore")?.description]).toEqual(["user", "user"]);
		expect([byName.get("Plan")?.source, byName.get("Plan")?.description]).toEqual(["project", "project"]);
	});

	it("a missing resources directory embeds nothing", () => {
		expect(discoverAgents(cwd, "user").agents.filter((a) => a.filePath.startsWith(fx.root))).toEqual([]);
	});

	it("omitClaudeMd of an embedded agent is honored, a user agent of the same name decides first", () => {
		fx.write("agents/Explore.md", "---\nname: Explore\nomitClaudeMd: true\n---\nbody\n");
		expect(agentOmitsClaudeMd("Explore")).toBe(true);
		const userDir = join(process.env.NYCODE_CODING_AGENT_DIR as string, "agents");
		mkdirSync(userDir, { recursive: true });
		writeFileSync(join(userDir, "Explore.md"), "---\nname: Explore\n---\nbody\n");
		expect(agentOmitsClaudeMd("Explore")).toBe(false);
	});
});

describe("commands", () => {
	const body = (text: string) => `---\ndescription: d\n---\n${text}\n`;
	const loadBody = async (dirs: string[], name: string) => {
		const found = collectCommands(dirs).find((c) => c.name === name);
		if (!found) return undefined;
		const runner = { exec: vi.fn() };
		return expandCommand(
			runner,
			parseCommandFile(readFileSync(found.filePath, "utf-8")),
			"",
			{ cwd },
			found.filePath,
		);
	};

	it("an embedded command loads with the marker resolved", async () => {
		fx.write("commands/ship.md", body(`run ${RESOURCES_MARKER}/skills/x`));
		expect(await loadBody(commandDirs(cwd, home, false), "ship")).toBe(`run ${fx.resources}/skills/x`);
	});

	it("a personal command replaces the embedded one, and a project command replaces both", async () => {
		fx.write("commands/ship.md", body("embedded"));
		fx.write("commands/lint.md", body("embedded"));
		mkdirSync(join(home, ".claude", "commands"), { recursive: true });
		writeFileSync(join(home, ".claude", "commands", "ship.md"), body("personal"));
		mkdirSync(join(cwd, ".claude", "commands"), { recursive: true });
		writeFileSync(join(cwd, ".claude", "commands", "lint.md"), body("project"));
		const dirs = commandDirs(cwd, home, true);
		expect(dirs[0]).toBe(join(fx.resources, "commands"));
		expect(await loadBody(dirs, "ship")).toBe("personal");
		expect(await loadBody(dirs, "lint")).toBe("project");
	});

	it("a missing resources directory embeds nothing", () => {
		expect(commandDirs(cwd, home, true)).toEqual([]);
	});
});

describe("skill roots", () => {
	it("the embedded skills come last, so any other root wins a first-match lookup", () => {
		fx.write("skills/alpha/SKILL.md", "---\nname: alpha\ndescription: d\n---\n");
		mkdirSync(join(home, ".claude", "skills"), { recursive: true });
		expect(skillDirs(cwd, home, false)).toEqual([join(home, ".claude", "skills"), join(fx.resources, "skills")]);
	});
});

describe("rules", () => {
	type Handler = (event: unknown, ctx: ExtensionContext) => unknown;
	const rule = (text: string) => `${text}\n`;

	/** The system prompt the extension returns for a session in `cwd`, or "" when it adds nothing. */
	async function rulesPrompt(): Promise<string> {
		const handlers = new Map<string, Handler>();
		claudeRulesExtension({
			on: (name: string, fn: Handler) => handlers.set(name, fn),
			events: { emit: () => {} },
		} as unknown as ExtensionAPI);
		const ctx = {
			cwd,
			hasUI: false,
			isProjectTrusted: () => false,
			ui: { notify: () => {} },
		} as unknown as ExtensionContext;
		await handlers.get("session_start")?.({}, ctx);
		const result = handlers.get("before_agent_start")?.({ systemPrompt: "base", systemPromptOptions: {} }, ctx);
		return (result as { systemPrompt: string } | undefined)?.systemPrompt ?? "";
	}

	it("inlines the embedded top-level rules and leaves ref/ on demand, with the marker resolved", async () => {
		fx.write("rules/safety.md", rule(`Safety: read ${RESOURCES_MARKER}/rules/ref/a.md.`));
		fx.write("rules/ref/a.md", rule("On-demand reference."));
		const prompt = await rulesPrompt();
		expect(prompt).toContain(`Safety: read ${fx.resources}/rules/ref/a.md.`);
		expect(prompt).not.toContain("On-demand reference.");
	});

	it("a user rule file of the same name replaces the embedded one; the others stay, embedded first", async () => {
		fx.write("rules/safety.md", rule("embedded safety"));
		fx.write("rules/style.md", rule("embedded style"));
		mkdirSync(join(home, ".claude", "rules"), { recursive: true });
		writeFileSync(join(home, ".claude", "rules", "safety.md"), rule("user safety"));
		const prompt = await rulesPrompt();
		expect(prompt).not.toContain("embedded safety");
		expect(prompt.indexOf("embedded style")).toBeGreaterThan(-1);
		expect(prompt.indexOf("embedded style")).toBeLessThan(prompt.indexOf("user safety"));
	});

	it("a missing resources directory embeds nothing", async () => {
		expect(await rulesPrompt()).toBe("");
	});
});

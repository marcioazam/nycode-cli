// K6: the built-in scope of the resource loader. Embedded skills have the lowest precedence: a user, project or
// package skill with the same name replaces them, silently; a missing resources directory embeds nothing.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	builtinResourceDir,
	getBuiltinResourcesRoot,
	RESOURCES_MARKER,
	resolveResourcesMarker,
} from "../../../../src/core/builtin-resources.ts";
import { DefaultResourceLoader } from "../../../../src/core/resource-loader.ts";
import { SettingsManager } from "../../../../src/core/settings-manager.ts";
import { createResourcesFixture, type ResourcesFixture } from "./fixture.ts";

const skill = (name: string, description: string) =>
	`---\nname: ${name}\ndescription: ${description}\n---\nBody of ${name}.\n`;

let fx: ResourcesFixture;
let cwd: string;
let agentDir: string;

beforeEach(() => {
	fx = createResourcesFixture();
	cwd = join(fx.root, "project");
	agentDir = process.env.NYCODE_CODING_AGENT_DIR as string;
	mkdirSync(cwd, { recursive: true });
});
afterEach(() => fx.dispose());

async function loadSkills(options: { noSkills?: boolean } = {}) {
	const loader = new DefaultResourceLoader({ cwd, agentDir, ...options });
	await loader.reload();
	return loader.getSkills();
}

describe("resources root and marker", () => {
	it("is <package>/resources and resolves the resources marker in every occurrence", () => {
		expect(getBuiltinResourcesRoot()).toBe(fx.resources);
		const text = `read ${RESOURCES_MARKER}/rules/ref/a.md and ${RESOURCES_MARKER}/skills`;
		expect(resolveResourcesMarker(text)).toBe(`read ${fx.resources}/rules/ref/a.md and ${fx.resources}/skills`);
	});

	it("treats a root with replacement patterns as data", () => {
		expect(resolveResourcesMarker(`${RESOURCES_MARKER}/x`, "/tmp/a$&b")).toBe("/tmp/a$&b/x");
	});

	it("reports a missing kind as undefined and nothing is embedded", async () => {
		expect(builtinResourceDir("skills")).toBeUndefined();
		const { skills, diagnostics } = await loadSkills();
		expect(skills).toEqual([]);
		expect(diagnostics).toEqual([]);
		fx.write("skills/alpha/SKILL.md", skill("alpha", "embedded"));
		expect(builtinResourceDir("skills")).toBe(join(fx.resources, "skills"));
	});
});

describe("built-in skills in the resource loader (K6)", () => {
	it("loads an embedded skill when nothing overrides it", async () => {
		fx.write("skills/alpha/SKILL.md", skill("alpha", "embedded"));
		const { skills } = await loadSkills();
		expect(skills.map((s) => [s.name, s.description])).toEqual([["alpha", "embedded"]]);
	});

	it("a user skill replaces the embedded one of the same name, without a collision warning", async () => {
		fx.write("skills/alpha/SKILL.md", skill("alpha", "embedded"));
		fx.write("skills/beta/SKILL.md", skill("beta", "embedded"));
		mkdirSync(join(agentDir, "skills", "alpha"), { recursive: true });
		writeFileSync(join(agentDir, "skills", "alpha", "SKILL.md"), skill("alpha", "user"));
		const { skills, diagnostics } = await loadSkills();
		expect(skills.map((s) => [s.name, s.description]).sort()).toEqual([
			["alpha", "user"],
			["beta", "embedded"],
		]);
		expect(diagnostics.filter((d) => d.type === "collision")).toEqual([]);
	});

	it("a project skill replaces the embedded one too", async () => {
		fx.write("skills/alpha/SKILL.md", skill("alpha", "embedded"));
		const dir = join(cwd, ".nycode", "skills", "alpha");
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "SKILL.md"), skill("alpha", "project"));
		const settingsManager = SettingsManager.create(cwd, agentDir, { projectTrusted: true });
		const loader = new DefaultResourceLoader({ cwd, agentDir, settingsManager });
		await loader.reload();
		const { skills, diagnostics } = loader.getSkills();
		expect(skills.map((s) => [s.name, s.description])).toEqual([["alpha", "project"]]);
		expect(diagnostics.filter((d) => d.type === "collision")).toEqual([]);
	});

	it("--no-skills leaves the embedded skills out", async () => {
		fx.write("skills/alpha/SKILL.md", skill("alpha", "embedded"));
		expect((await loadSkills({ noSkills: true })).skills).toEqual([]);
	});
});

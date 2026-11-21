// K7: the built-in contract is the lowest-precedence context file of the system prompt (AGENTS.md comes after it).
// Print mode swaps it for headless.md through the headless-lean extension; the title may be `(pi)` or `(nycode)`.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	readBuiltinInstruction,
	setBuiltinInstructions,
	withBuiltinInstructions,
} from "../../../../src/core/builtin-instructions.ts";
import { RESOURCES_MARKER } from "../../../../src/core/builtin-resources.ts";
import type { ExtensionAPI } from "../../../../src/core/extensions/types.ts";
import { buildSystemPrompt } from "../../../../src/core/system-prompt.ts";
import claudeRulesExtension from "../../../../src/extensions/claude-rules/index.ts";
import headlessLean, { headlessFloor } from "../../../../src/extensions/headless-lean/index.ts";
import { createResourcesFixture, type ResourcesFixture } from "./fixture.ts";

const CONTRACT = `# Working contract (nycode)\n\nRead ${RESOURCES_MARKER}/rules/ref/a.md before acting.\n`;
const HEADLESS = "# Working contract (nycode, headless)\n\n- Act by default.\n";
const options = { cwd: "/work", selectedTools: [], skills: [] };
const agents = { path: "/work/AGENTS.md", content: "Project rules." };

let fx: ResourcesFixture;
beforeEach(() => {
	fx = createResourcesFixture();
	setBuiltinInstructions(true);
});
afterEach(() => {
	setBuiltinInstructions(false);
	fx.dispose();
});

describe("system prompt with the built-in contract (K7)", () => {
	it("puts contract.md before AGENTS.md, drops its comment and resolves the marker", () => {
		fx.write("instructions/contract.md", `<!-- maintainer note -->\n${CONTRACT}`);
		const prompt = buildSystemPrompt({ ...options, contextFiles: [agents] });
		expect(prompt).toContain(
			`<project_instructions path="${fx.resources}/instructions/contract.md">\n# Working contract (nycode)`,
		);
		expect(prompt).toContain(`Read ${fx.resources}/rules/ref/a.md before acting.`);
		expect(prompt).not.toContain("maintainer note");
		expect(prompt.indexOf("Working contract")).toBeLessThan(prompt.indexOf("Project rules."));
	});

	it("without resources the prompt is the upstream one", () => {
		const prompt = buildSystemPrompt({ ...options, contextFiles: [agents] });
		expect(withBuiltinInstructions([agents])).toEqual([agents]);
		expect(prompt).toContain(
			`<project_context>\nProject-specific instructions and guidelines:\n\n<project_instructions path="/work/AGENTS.md">`,
		);
		expect(prompt).not.toContain("Working contract");
		expect(buildSystemPrompt({ ...options, contextFiles: [] })).not.toContain("project_context");
	});

	it("is off until the claude-rules extension turns it on: the core alone builds the upstream prompt", () => {
		fx.write("instructions/contract.md", CONTRACT);
		setBuiltinInstructions(false);
		expect(buildSystemPrompt({ ...options, contextFiles: [] })).not.toContain("Working contract");
		claudeRulesExtension({ on: () => {}, events: { emit: () => {} } } as unknown as ExtensionAPI);
		expect(buildSystemPrompt({ ...options, contextFiles: [] })).toContain("Working contract (nycode)");
	});

	it("is left out when the instruction files are switched off (-nc, omitClaudeMd agents)", () => {
		fx.write("instructions/contract.md", CONTRACT);
		process.env.CLAUDE_CODE_DISABLE_CLAUDE_MDS = "1";
		expect(buildSystemPrompt({ ...options, contextFiles: [] })).not.toContain("Working contract");
	});

	it("follows a rewritten file", () => {
		fx.write("instructions/contract.md", CONTRACT);
		expect(readBuiltinInstruction("contract")).toContain("Read ");
		fx.write("instructions/contract.md", "# Working contract (nycode)\n\nSecond version, longer.\n");
		expect(readBuiltinInstruction("contract")).toContain("Second version");
	});

	it("reads headless.md and lite.md on demand and reports a missing one as undefined", () => {
		fx.write("instructions/headless.md", HEADLESS);
		expect(readBuiltinInstruction("headless")).toBe(HEADLESS.trim());
		expect(readBuiltinInstruction("lite")).toBeUndefined();
	});
});

describe("print mode contract (headless.md)", () => {
	it("replaces the contract in the provider payload with the embedded headless.md, accepting both titles", () => {
		fx.write("instructions/headless.md", HEADLESS);
		const headless = readBuiltinInstruction("headless") as string;
		for (const title of ["(pi)", "(nycode)"]) {
			const text = [
				`<project_instructions path="/x/contract.md">\n# Working contract ${title}\nlong text\n</project_instructions>`,
				"<skills>\n The following skills provide specialized instructions.\n<available_skills>\n</available_skills>\n</skills>",
			].join("\n\n");
			const payload = { system: [{ type: "text", text }] };
			headlessFloor(payload, headless);
			expect(payload.system[0].text).toContain(
				`<project_instructions path="/x/contract.md">\n${headless}\n</project_instructions>`,
			);
			expect(payload.system[0].text).not.toContain("long text");
			expect(payload.system[0].text).not.toContain("available_skills");
		}
	});
});

describe("headless-lean reads the embedded headless.md", () => {
	type Handler = (event: unknown, ctx: unknown) => unknown;
	const payload = () => ({
		system: [
			{
				type: "text",
				text: [
					'<project_instructions path="/x/contract.md">\n# Working contract (nycode)\nlong text\n</project_instructions>',
					"<skills>\n The following skills provide specialized instructions.\n<available_skills>\n</available_skills>\n</skills>",
				].join("\n\n"),
			},
		],
	});
	const start = () => {
		const handlers: Record<string, Handler> = {};
		headlessLean({
			on: (name: string, handler: Handler) => {
				handlers[name] = handler;
			},
		} as unknown as ExtensionAPI);
		return handlers.before_provider_request;
	};
	const ctx = { hasUI: false, model: { api: "anthropic-messages" } };

	it("print mode: headless.md replaces the contract", () => {
		fx.write("instructions/headless.md", HEADLESS);
		const out = start()({ payload: payload() }, ctx) as ReturnType<typeof payload>;
		expect(out.system[0].text).toContain(`\n${HEADLESS.trim()}\n</project_instructions>`);
		expect(out.system[0].text).not.toContain("long text");
	});

	it("the user's CLAUDE.headless.md in the agent directory wins over the embedded one", () => {
		fx.write("instructions/headless.md", HEADLESS);
		writeFileSync(
			join(process.env.NYCODE_CODING_AGENT_DIR as string, "CLAUDE.headless.md"),
			"# Working contract (own)\n",
		);
		const out = start()({ payload: payload() }, ctx) as ReturnType<typeof payload>;
		expect(out.system[0].text).toContain("\n# Working contract (own)\n</project_instructions>");
	});

	it("interactive sessions keep the full contract", () => {
		fx.write("instructions/headless.md", HEADLESS);
		const out = start()({ payload: payload() }, { ...ctx, hasUI: true });
		expect(out).toBeUndefined();
	});
});

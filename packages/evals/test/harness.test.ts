import { homedir } from "node:os";
import { getDocsPath, getExamplesPath, getReadmePath } from "@nycode/coding-agent";
import { describe, expect, it, vi } from "vitest";
import { buildSystemPrompt } from "../../coding-agent/src/core/system-prompt.ts";
import {
	applyIsolatedEnvironment,
	createNycodeDocumentationEvalHarness,
	DOCUMENTATION_EVAL_TOOLS,
	excludeNycodeDocumentation,
	resolveDocumentationVariant,
	resolveModelSelection,
	verifySystemPrompt,
} from "../src/harness.ts";

describe("resolveModelSelection", () => {
	it("prefers an explicit harness model", () => {
		expect(
			resolveModelSelection(
				{ provider: "anthropic", id: "claude-opus-4-6" },
				{ NYCODE_PROVIDER: "openai-codex", NYCODE_MODEL: "gpt-5.6-sol" },
			),
		).toEqual({ provider: "anthropic", id: "claude-opus-4-6" });
	});

	it("uses trimmed environment defaults", () => {
		expect(
			resolveModelSelection(undefined, { NYCODE_PROVIDER: " openai-codex ", NYCODE_MODEL: " gpt-5.6-sol " }),
		).toEqual({
			provider: "openai-codex",
			id: "gpt-5.6-sol",
		});
	});

	it.each([{}, { NYCODE_PROVIDER: "openai-codex" }, { NYCODE_MODEL: "gpt-5.6-sol" }])(
		"rejects incomplete model selection",
		(environment) => {
			expect(() => resolveModelSelection(undefined, environment)).toThrow("Select a harness model explicitly");
		},
	);
});

describe("isolateProcessEnvironment", () => {
	it("removes runner metadata and restores the process environment", () => {
		vi.stubEnv("NYCODE_EVAL_VARIANT", "with_docs");
		vi.stubEnv("NYCODE_EVAL_ARTIFACT_DIR", "/tmp/artifacts");
		const oldHome = process.env.HOME;
		try {
			const restore = applyIsolatedEnvironment("/tmp/eval-home", "/tmp/eval-agent");
			try {
				expect(homedir()).toBe("/tmp/eval-home");
				expect(process.env.NYCODE_CODING_AGENT_DIR).toBe("/tmp/eval-agent");
				expect(process.env.NYCODE_EVAL_VARIANT).toBeUndefined();
				expect(process.env.NYCODE_EVAL_ARTIFACT_DIR).toBeUndefined();
			} finally {
				restore();
			}
			expect(process.env.HOME).toBe(oldHome);
			expect(process.env.NYCODE_EVAL_VARIANT).toBe("with_docs");
		} finally {
			vi.unstubAllEnvs();
		}
	});
});

describe("documentation variant", () => {
	it.each(["without_docs", "with_docs"] as const)("accepts %s", (variant) => {
		expect(resolveDocumentationVariant(variant)).toBe(variant);
	});

	it.each([undefined, "", "other"])("rejects invalid variant %s", (variant) => {
		expect(() => resolveDocumentationVariant(variant)).toThrow("NYCODE_EVAL_VARIANT");
	});

	it("strips only the documentation routing section from the default Nycode prompt", () => {
		const prompt = buildSystemPrompt({
			cwd: "/workspace",
			selectedTools: [...DOCUMENTATION_EVAL_TOOLS],
		});
		expect(prompt).toContain("\n<docs>\nNycode documentation (read only");
		expect(prompt).toContain("\n<rules>\n");
		expect(prompt).toContain("\n<cwd>\n/workspace\n</cwd>");
		expect(prompt).toContain("docs/models.md");

		const stripped = excludeNycodeDocumentation(prompt);
		expect(stripped).toContain("\n<rules>\n");
		expect(stripped).toContain("\n<cwd>\n/workspace\n</cwd>");
		expect(stripped).not.toContain("<docs>");
		expect(stripped).not.toContain("Nycode documentation");
		expect(stripped).not.toContain("docs/models.md");
		expect(stripped).not.toContain(getReadmePath());
		expect(stripped).not.toContain(getDocsPath());
		expect(stripped).not.toContain(getExamplesPath());
	});

	it("verifies the prompt that was sent", () => {
		const prompt = buildSystemPrompt({
			cwd: "/workspace",
			selectedTools: [...DOCUMENTATION_EVAL_TOOLS],
		});
		const stripped = excludeNycodeDocumentation(prompt);

		expect(verifySystemPrompt(stripped, { name: "without_docs", expectedNycodeDocumentation: false })).toBe(stripped);
		expect(() => verifySystemPrompt(prompt, { name: "without_docs", expectedNycodeDocumentation: false })).toThrow(
			"does not match",
		);
	});

	it("fails closed when prompt markers are missing", () => {
		expect(() => excludeNycodeDocumentation("Instructions")).toThrow("no Nycode documentation section");
		expect(() => excludeNycodeDocumentation("\n<docs>\nNycode documentation\n</docs>")).toThrow(
			"no working-directory section",
		);
	});

	it("rejects documentation harnesses outside the container sandbox", () => {
		expect(() => createNycodeDocumentationEvalHarness()).toThrow("isolated container sandbox");
	});
});

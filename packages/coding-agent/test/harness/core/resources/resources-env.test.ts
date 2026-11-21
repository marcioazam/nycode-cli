// The resources root is exported as NYCODE_RESOURCES by the claude-rules extension, so the shell commands in the
// embedded texts expand in the bash tool (and in child processes, which inherit the env).
import { rmSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setBuiltinInstructions } from "../../../../src/core/builtin-instructions.ts";
import type { ExtensionAPI } from "../../../../src/core/extensions/types.ts";
import { createBashToolDefinition } from "../../../../src/core/tools/bash.ts";
import claudeRulesExtension from "../../../../src/extensions/claude-rules/index.ts";
import { createResourcesFixture, type ResourcesFixture } from "./fixture.ts";

let fx: ResourcesFixture;
beforeEach(() => {
	fx = createResourcesFixture();
	delete process.env.NYCODE_RESOURCES;
});
afterEach(() => {
	setBuiltinInstructions(false);
	fx.dispose();
});

const load = () => claudeRulesExtension({ on: () => {}, events: { emit: () => {} } } as unknown as ExtensionAPI);

describe("NYCODE_RESOURCES export", () => {
	it("is visible to a bash tool command", async () => {
		fx.write("instructions/contract.md", "x");
		load();
		const tool = createBashToolDefinition(fx.root);
		const result = await tool.execute(
			"id",
			{ command: 'echo "$NYCODE_RESOURCES"' },
			undefined,
			undefined,
			undefined as never,
		);
		expect(JSON.stringify(result.content)).toContain(fx.resources);
	});

	it("does not override a user value", () => {
		fx.write("instructions/contract.md", "x");
		process.env.NYCODE_RESOURCES = "/user/own";
		load();
		expect(process.env.NYCODE_RESOURCES).toBe("/user/own");
	});

	it("is not set without a resources directory", () => {
		rmSync(fx.resources, { recursive: true, force: true });
		load();
		expect(process.env.NYCODE_RESOURCES).toBeUndefined();
	});
});

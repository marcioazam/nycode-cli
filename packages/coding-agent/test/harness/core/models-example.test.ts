// Contract of examples/config/models.json: the refusal fallback of claude-sonnet-5-5 -> claude-sonnet-5.
// The registry applies the example as a real models.json, so the merge with the built-in catalog is the product's own.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AnthropicMessagesCompat } from "@nycode/ai/compat";
import { getModels } from "@nycode/ai/compat";
import { afterEach, describe, expect, it } from "vitest";
import { AuthStorage } from "../../../src/core/auth-storage.ts";
import { createModelRegistry } from "../../model-runtime-test-utils.ts";

const examplePath = new URL("../../../examples/config/models.json", import.meta.url);
const example = JSON.parse(readFileSync(examplePath, "utf8"));
const override = example.providers.anthropic.modelOverrides["claude-sonnet-5-5"];
const fallback = override.compat.allowedFallbackModels[0];

let tempDir: string | undefined;

afterEach(() => {
	if (tempDir) rmSync(tempDir, { recursive: true });
	tempDir = undefined;
});

describe("examples/config/models.json", () => {
	it("asks for a fallback to claude-sonnet-5 priced like claude-sonnet-5", () => {
		expect(override.compat.allowedFallbackModels).toHaveLength(1);
		expect(fallback).toEqual({
			provider: "anthropic",
			model: "claude-sonnet-5",
			cost: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
		});
		expect(Object.keys(override)).toEqual(["compat"]);
	});

	it("matches the built-in price of the fallback model", () => {
		const sonnet5 = getModels("anthropic").find((model) => model.id === "claude-sonnet-5");
		expect(sonnet5?.cost).toEqual(fallback.cost);
	});

	it("loads as models.json, keeps the built-in compat and adds the fallback", async () => {
		tempDir = mkdtempSync(join(tmpdir(), "models-example-"));
		const modelsPath = join(tempDir, "models.json");
		writeFileSync(modelsPath, JSON.stringify(example));
		const registry = await createModelRegistry(AuthStorage.inMemory(), modelsPath);

		const merged = registry.find("anthropic", "claude-sonnet-5-5")?.compat as AnthropicMessagesCompat | undefined;
		const builtIn = getModels("anthropic").find((model) => model.id === "claude-sonnet-5-5")
			?.compat as AnthropicMessagesCompat;

		expect(registry.getError()).toBeUndefined();
		expect(merged?.allowedFallbackModels).toEqual([fallback]);
		expect(merged).toMatchObject({ ...builtIn, allowedFallbackModels: [fallback] });
	});
});

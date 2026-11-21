import { describe, expect, it } from "vitest";
import { VIRTUAL_MODULES } from "../../../src/core/extensions/virtual-modules.ts";

// Regression test for #11156: extensions importing @nycode/ai/models
// (e.g. for clampThinkingLevel) failed with "Cannot find module" in embedded
// runtimes because the subpath was missing from the virtual module map.
describe("nycode-ai/models virtual module", () => {
	it("exposes the nycode-ai /models entrypoint to extensions", () => {
		const models = VIRTUAL_MODULES["@nycode/ai/models"] as { clampThinkingLevel?: unknown } | undefined;
		expect(models).toBeDefined();
		expect(typeof models?.clampThinkingLevel).toBe("function");
	});

	it("no longer exposes the legacy @mariozechner scope", () => {
		expect(Object.keys(VIRTUAL_MODULES).filter((id) => id.startsWith("@mariozechner/"))).toEqual([]);
	});
});

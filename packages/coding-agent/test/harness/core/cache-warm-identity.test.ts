// Regression for cache warming: the warmer stopped with "conversation context changed" because isCurrent required
// object identity, while the session projection recreates custom_message entries (e.g. claude-hook-context) with
// another timestamp. Messages now match by content; the timestamp never reaches the provider.
import { describe, expect, it } from "vitest";
import { nycodeSameContextMessage as same } from "../../../src/core/sdk.ts";

const content = "context";
const live = { role: "custom", customType: "claude-hook-context", content, display: false, timestamp: 1 };
const projected = { ...live, details: undefined, timestamp: 2 };

describe("nycodeSameContextMessage", () => {
	it("accepts the same object", () => {
		expect(same(live, live)).toBe(true);
	});

	it("accepts equal content in distinct objects when only the timestamp differs", () => {
		expect(same(live, projected)).toBe(true);
		expect(
			same(
				{ role: "user", content: [{ type: "text", text: "a" }], timestamp: 1 },
				{ role: "user", content: [{ type: "text", text: "a" }], timestamp: 9 },
			),
		).toBe(true);
	});

	it("rejects changed content, role or details", () => {
		expect(same(live, { ...projected, content: [{ type: "text", text: "context" }] })).toBe(false);
		expect(same(live, { ...projected, content: "other" })).toBe(false);
		expect(same(live, { ...projected, role: "user" })).toBe(false);
		expect(same(live, { ...projected, details: { x: 1 } })).toBe(false);
	});

	it("rejects a missing message", () => {
		expect(same(live, undefined)).toBe(false);
		expect(same(undefined, live)).toBe(false);
	});
});

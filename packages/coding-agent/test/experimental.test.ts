import { afterEach, describe, expect, it } from "vitest";
import { areExperimentalFeaturesEnabled } from "../src/core/experimental.ts";

describe("areExperimentalFeaturesEnabled", () => {
	const originalNycodeExperimental = process.env.NYCODE_EXPERIMENTAL;

	afterEach(() => {
		if (originalNycodeExperimental === undefined) {
			delete process.env.NYCODE_EXPERIMENTAL;
		} else {
			process.env.NYCODE_EXPERIMENTAL = originalNycodeExperimental;
		}
	});

	it("returns false when NYCODE_EXPERIMENTAL is unset", () => {
		delete process.env.NYCODE_EXPERIMENTAL;

		expect(areExperimentalFeaturesEnabled()).toBe(false);
	});

	it("returns false when NYCODE_EXPERIMENTAL is empty", () => {
		process.env.NYCODE_EXPERIMENTAL = "";

		expect(areExperimentalFeaturesEnabled()).toBe(false);
	});

	it("returns true when NYCODE_EXPERIMENTAL is set to 1", () => {
		process.env.NYCODE_EXPERIMENTAL = "1";

		expect(areExperimentalFeaturesEnabled()).toBe(true);
	});

	it("returns false when NYCODE_EXPERIMENTAL is set to 0", () => {
		process.env.NYCODE_EXPERIMENTAL = "0";

		expect(areExperimentalFeaturesEnabled()).toBe(false);
	});

	it("returns false when NYCODE_EXPERIMENTAL is set to a non-1 value", () => {
		process.env.NYCODE_EXPERIMENTAL = "true";

		expect(areExperimentalFeaturesEnabled()).toBe(false);
	});
});

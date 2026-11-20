import { describe, expect, it } from "vitest";
import { getNycodeUserAgent } from "../src/utils/nycode-user-agent.ts";

describe("getNycodeUserAgent", () => {
	it("formats the user agent expected by pi.dev", () => {
		const runtime = process.versions.bun ? `bun/${process.versions.bun}` : `node/${process.version}`;
		const userAgent = getNycodeUserAgent("1.2.3");

		expect(userAgent).toBe(`nycode/1.2.3 (${process.platform}; ${runtime}; ${process.arch})`);
		expect(userAgent).toMatch(/^nycode\/[^\s()]+ \([^;()]+;\s*[^;()]+;\s*[^()]+\)$/);
	});
});

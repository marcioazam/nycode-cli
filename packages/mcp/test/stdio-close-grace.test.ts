// Regression for the slow exit (docs/specs/0003-boot-exit.md): closing the stdio transport waited 500 ms before
// SIGTERM on a server still booting (not reading stdin). The grace is now 100 ms.
import { describe, expect, it } from "vitest";
import { StdioTransport } from "../src/index.ts";

describe("StdioTransport close grace", () => {
	it("sends SIGTERM about 100 ms after closing stdin on a server that ignores it", async () => {
		// Server that ignores stdin while "booting" (like a cold npx) and dies on SIGTERM.
		const transport = new StdioTransport({
			command: process.execPath,
			args: ["-e", "setTimeout(() => {}, 20000)"],
		});
		await transport.start();
		const started = performance.now();
		await transport.close();
		const elapsed = performance.now() - started;
		// >= 90: the grace is honored; < 400: well below the old 500 ms, loose for slow CI.
		expect(elapsed).toBeGreaterThanOrEqual(90);
		expect(elapsed).toBeLessThan(400);
	});
});

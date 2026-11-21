// Ported from the upstream package's node:test file: a server that ignores SIGTERM is SIGKILLed after the grace period.
import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import { terminateChild } from "../../../src/extensions/lsp/process.ts";

describe("terminateChild", () => {
	it("SIGKILLs a child that ignores SIGTERM", async () => {
		const child = spawn(
			process.execPath,
			["-e", "process.on('SIGTERM',()=>{});process.stdin.resume();console.log('up')"],
			{ stdio: ["pipe", "pipe", "inherit"] },
		);
		await new Promise((resolve) => child.stdout.once("data", resolve));
		const exited = new Promise<string | null>((resolve) => child.once("exit", (_code, signal) => resolve(signal)));
		terminateChild(child, 300);
		const signal = await Promise.race([
			exited,
			new Promise<string>((r) => setTimeout(() => r("STILL_ALIVE"), 3_000)),
		]);
		if (signal === "STILL_ALIVE") child.kill("SIGKILL");
		expect(signal).toBe("SIGKILL");
	});

	it("does nothing for a child that already exited", async () => {
		const child = spawn(process.execPath, ["-e", ""]);
		await new Promise((resolve) => child.once("exit", resolve));
		expect(() => terminateChild(child, 10)).not.toThrow();
	});
});

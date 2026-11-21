import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// config.ts decides "bun-binary" from import.meta.url (a compiled binary runs from a `$bunfs` virtual
// path). Load it once under such a URL so the real detection code runs, and hand that copy to the CLI.
// The query keeps the specifier out of tsc's module resolution.
vi.mock("../../../src/config.ts", async () => {
	const specifier = "../../../src/config.ts?as-bun-binary";
	return await import(/* @vite-ignore */ specifier);
});

import { isBunBinary } from "../../../src/config.ts";
import { handlePackageCommand } from "../../../src/package-manager-cli.ts";

describe("nycode update on a standalone binary", () => {
	const originalExitCode = process.exitCode;
	const originalNetwork = process.env.NYCODE_OFFLINE;

	beforeEach(() => {
		delete process.env.NYCODE_OFFLINE;
		delete process.env.NYCODE_SELF_UPDATE_COMMAND;
		process.exitCode = undefined;
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
		process.exitCode = originalExitCode;
		if (originalNetwork === undefined) delete process.env.NYCODE_OFFLINE;
		else process.env.NYCODE_OFFLINE = originalNetwork;
	});

	it("prints the GitHub Releases URL and runs nothing", async () => {
		expect(isBunBinary).toBe(true);
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => Response.json({ tag_name: "v999.0.0" })),
		);
		vi.spyOn(console, "log").mockImplementation(() => {});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		expect(await handlePackageCommand(["update", "--self"])).toBe(true);

		const stderr = errorSpy.mock.calls.map(([message]) => String(message)).join("\n");
		expect(stderr).toContain("Download from: https://github.com/marcioazam/nycode/releases/latest");
		expect(process.exitCode).toBe(1);
	});
});

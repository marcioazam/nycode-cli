// K14 / C-F4-03: with an empty HOME the CLI starts under the nycode brand and --help lists the permission flags.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { VERSION } from "../src/config.ts";

let home: string;

beforeAll(() => {
	home = mkdtempSync(join(tmpdir(), "nycode-cli-brand-"));
});

afterAll(() => {
	rmSync(home, { recursive: true });
});

function run(...args: string[]) {
	// Runs the sources through the same resolver as `npm run generate:schemas`, so no build is needed.
	const result = spawnSync(
		process.execPath,
		["--import", "./src/experimental/source-resolver.ts", "src/cli.ts", ...args],
		{
			cwd: join(import.meta.dirname, ".."),
			env: { PATH: process.env.PATH, HOME: home, USERPROFILE: home, NYCODE_OFFLINE: "1" },
			encoding: "utf8",
			timeout: 60_000,
		},
	);
	return { status: result.status, out: `${result.stdout}${result.stderr}` };
}

describe("CLI brand with an empty HOME", () => {
	it("--version exits cleanly with the package version and never the pi title", () => {
		const { status, out } = run("--version");
		expect(status).toBe(0);
		expect(out.trim()).toBe(VERSION);
		expect(out).not.toContain("π");
	});

	it("--help is titled nycode, never pi, and lists the four permission flags", () => {
		const { status, out } = run("--help");
		expect(status).toBe(0);
		expect(out).toMatch(/^nycode - /);
		expect(out).not.toContain("π");
		for (const flag of ["--bypass", "--dangerously-skip-permissions", "--safe", "--no-bypass"]) {
			expect(out).toContain(flag);
		}
	});
});

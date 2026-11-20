import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const originalPackageDir = process.env.NYCODE_PACKAGE_DIR;
let dir: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "nycode-app-title-"));
	process.env.NYCODE_PACKAGE_DIR = dir;
	vi.resetModules();
});

afterEach(() => {
	if (originalPackageDir === undefined) delete process.env.NYCODE_PACKAGE_DIR;
	else process.env.NYCODE_PACKAGE_DIR = originalPackageDir;
	rmSync(dir, { recursive: true });
	vi.resetModules();
});

test("APP_TITLE falls back to nycode when package.json is missing", async () => {
	const { APP_TITLE } = await import("../src/config.ts");
	expect(APP_TITLE).not.toBe("π");
	expect(APP_TITLE).toContain("nycode");
});

test("APP_TITLE falls back to nycode when package.json has no nycodeConfig", async () => {
	writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "x", version: "1.0.0" }));
	const { APP_TITLE } = await import("../src/config.ts");
	expect(APP_TITLE).toBe("nycode");
});

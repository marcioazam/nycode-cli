// K13: `files` of packages/coding-agent/package.json ships resources/. Proof by `npm pack --dry-run --json` on a copy
// of the real manifest with a fixture resource; the same fixture without the entry does not list it.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

interface PackResult {
	files: Array<{ path: string }>;
}

const manifest = JSON.parse(readFileSync(join(import.meta.dirname, "../../../../package.json"), "utf-8")) as {
	files: string[];
};
const tmp = mkdtempSync(join(tmpdir(), "nycode-pack-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function packedFiles(name: string, files: string[]): string[] {
	const dir = join(tmp, name);
	for (const rel of ["dist/index.js", "resources/instructions/contract.md"]) {
		mkdirSync(dirname(join(dir, rel)), { recursive: true });
		writeFileSync(join(dir, rel), "fixture\n");
	}
	writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "fixture", version: "1.0.0", files }));
	const out = execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
		cwd: dir,
		encoding: "utf-8",
	});
	// npm 12 keys the result by package name, earlier versions return an array
	const parsed = JSON.parse(out) as PackResult[] | Record<string, PackResult>;
	const result = Array.isArray(parsed) ? parsed[0] : parsed.fixture;
	return result.files.map((file) => file.path);
}

describe("npm pack of @nycode/coding-agent", () => {
	it("lists a file under resources/ with the real `files` field", () => {
		expect(manifest.files).toContain("resources");
		expect(packedFiles("with", manifest.files)).toContain("resources/instructions/contract.md");
	});

	it("does not list it without the entry (what the check guards against)", () => {
		const without = manifest.files.filter((entry) => entry !== "resources");
		expect(packedFiles("without", without)).not.toContain("resources/instructions/contract.md");
	});
});

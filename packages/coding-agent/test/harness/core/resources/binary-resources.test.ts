// K6: the standalone binary resolves the built-in resources next to the executable, so scripts/build-binaries.sh must
// copy `resources/` into every platform directory. A full binary build is too slow for a unit test: this checks the
// static contract (the "Copy shared files" loop and the bun-binary package dir); the real build is the F11 rehearsal.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const pkgRoot = join(import.meta.dirname, "../../../..");
const script = readFileSync(join(pkgRoot, "../../scripts/build-binaries.sh"), "utf-8");
const config = readFileSync(join(pkgRoot, "src/config.ts"), "utf-8");

describe("binary ships the built-in resources", () => {
	it("copies resources/ into each platform directory in the shared-files loop", () => {
		const loop = script.split("# Copy shared files to each platform directory")[1]?.split("\ndone")[0] ?? "";
		expect(loop).toMatch(/^\s*cp -r resources "\$OUTPUT_DIR\/\$platform\/"$/m);
	});

	it("resolves the package dir of a bun binary to the executable directory", () => {
		expect(config).toMatch(/if \(isBunBinary\) \{\s*\/\/[^\n]*\n\s*return dirname\(process\.execPath\);/);
	});
});

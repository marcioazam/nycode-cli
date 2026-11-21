// The four built-in output styles ship with nycode as the lowest-precedence source. In pi-code they sat next to the
// extension; embedded, the directory resolves through getBuiltinStylesDir and copy-assets puts it in dist.
import * as fs from "node:fs";
import { describe, expect, it } from "vitest";
import { getBuiltinStylesDir } from "../../../src/config.ts";

describe("getBuiltinStylesDir", () => {
	it("holds the four built-in styles", () => {
		const names = fs.readdirSync(getBuiltinStylesDir()).filter((name) => name.endsWith(".md"));
		expect(names.sort()).toEqual(["concise.md", "explanatory.md", "learning.md", "proactive.md"]);
	});
});

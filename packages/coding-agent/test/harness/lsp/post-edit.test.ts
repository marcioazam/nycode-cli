// Ported from the upstream package's node:test file: the post-edit text keeps only errors, capped, once per session.

import { describe, expect, it } from "vitest";
import type { Diagnostic } from "vscode-languageserver-protocol";
import { formatPostEdit, oncePerSession } from "../../../src/extensions/lsp/post-edit.ts";

const diag = (severity: number | undefined, message = "m", extra: Partial<Diagnostic> = {}): Diagnostic =>
	({
		range: { start: { line: 2, character: 4 }, end: { line: 2, character: 5 } },
		severity,
		message,
		...extra,
	}) as Diagnostic; // test fixture: only the fields the formatter reads

describe("formatPostEdit", () => {
	it("keeps only errors, capped at 10 with remainder", () => {
		const out = formatPostEdit(
			"ts",
			"/r/a.ts",
			Array.from({ length: 12 }, (_, i) => diag(1, `e${i}`)),
			"/r",
		);
		const lines = out.split("\n");
		expect(lines[0]).toBe("⚠️ ts:");
		expect(lines).toHaveLength(12);
		expect(lines[11]).toBe("… 2 more errors");
	});

	it("filters warnings, info and hints", () => {
		const out = formatPostEdit("ts", "/r/a.ts", [diag(2, "w"), diag(3, "i"), diag(4, "h"), diag(1, "boom")], "/r");
		expect(out).toContain("boom");
		expect(out.split("\n")).toHaveLength(2);
	});

	it("keeps an undefined severity", () => {
		expect(formatPostEdit("ts", "/r/a.ts", [diag(undefined, "x")], "/r")).toContain("x");
	});

	it("returns an empty string for no diagnostics or warnings only", () => {
		expect(formatPostEdit("ts", "/r/a.ts", [], "/r")).toBe("");
		expect(formatPostEdit("ts", "/r/a.ts", [diag(2), diag(4)], "/r")).toBe("");
	});

	it("formats the line with the relative path, source and code", () => {
		const out = formatPostEdit("ts", "/r/src/a.ts", [diag(1, "bad", { source: "tsc", code: 2322 })], "/r");
		expect(out).toBe("⚠️ ts:\nsrc/a.ts:3:5 - error: tsc: bad [2322]");
	});

	it("uses the basename when the file is the root, and the absolute path without a root", () => {
		expect(formatPostEdit("ts", "/r/a.ts", [diag(1)], "/r/a.ts")).toContain("\na.ts:3:5");
		expect(formatPostEdit("ts", "/r/a.ts", [diag(1)])).toContain("\n/r/a.ts:3:5");
	});
});

describe("oncePerSession", () => {
	it("is true the first time a message appears and false after", () => {
		const seen = new Set<string>();
		expect(oncePerSession(seen, "a")).toBe(true);
		expect(oncePerSession(seen, "a")).toBe(false);
		expect(oncePerSession(seen, "b")).toBe(true);
	});
});

// The text the lsp extension shows the model: full diagnostics for `lsp_diagnostics`, warnings and sections.

import { describe, expect, it } from "vitest";
import type { Diagnostic } from "vscode-languageserver-protocol";
import {
	formatLspDiagnostics,
	formatWarnings,
	hasIssueOutput,
	joinSections,
	truncateOutput,
} from "../../../src/extensions/lsp/_shared/output.ts";

const range = { start: { line: 0, character: 1 }, end: { line: 0, character: 2 } };

describe("formatLspDiagnostics", () => {
	it("says so when there are no diagnostics", () => {
		expect(formatLspDiagnostics("ts", "/r/a.ts", [], "/r")).toBe("✅ ts: no diagnostics");
	});

	it("labels every severity and lists related information", () => {
		const diagnostics: Diagnostic[] = [
			{ range, severity: 1, message: "e" },
			{ range, severity: 2, message: "w" },
			{ range, severity: 3, message: "i" },
			{ range, severity: 4, message: "h" },
			{
				range,
				message: "d",
				relatedInformation: [{ location: { uri: "file:///r/b.ts", range }, message: "see" }],
			},
		];
		const out = formatLspDiagnostics("ts", "/r/a.ts", diagnostics, "/r");
		expect(out).toContain("a.ts:1:2 - error: e");
		expect(out).toContain("warning: w");
		expect(out).toContain("info: i");
		expect(out).toContain("hint: h");
		expect(out).toContain("diagnostic: d\n  related: /r/b.ts:1:2 see");
	});

	it("caps the list at 20 with a remainder line", () => {
		const diagnostics = Array.from({ length: 23 }, (_, i): Diagnostic => ({ range, severity: 1, message: `m${i}` }));
		const lines = formatLspDiagnostics("ts", "/r/a.ts", diagnostics, "/r").split("\n");
		expect(lines).toHaveLength(22);
		expect(lines[21]).toBe("… 3 more diagnostics");
	});
});

describe("text helpers", () => {
	it("formats warnings and joins non-empty sections", () => {
		expect(formatWarnings("T", [])).toBe("");
		expect(formatWarnings("T", ["a", "b"])).toBe("T:\n\n⚠️ a\n⚠️ b");
		expect(joinSections("T", ["", "  "])).toBe("");
		expect(joinSections("T", ["x", "y"])).toBe("T:\n\nx\ny");
	});

	it("truncates long output and detects issue markers", () => {
		expect(truncateOutput("  abc  ")).toBe("abc");
		expect(truncateOutput("abcdef", 3)).toBe("abc\n… output truncated (3 more characters)");
		expect(hasIssueOutput("⚠️ x")).toBe(true);
		expect(hasIssueOutput("fine")).toBe(false);
	});
});

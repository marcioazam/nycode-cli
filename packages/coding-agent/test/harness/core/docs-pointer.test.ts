// Ported from import/ny-pi/extensions/pi-docs/index.test.ts (K7): mode `auto` rules, the one-line pointer in the
// prompt, custom prompts untouched, and the /docs-pointer command.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getAgentDir, getDocsPath, getExamplesPath, getReadmePath } from "../../../src/config.ts";
import { getDocsPointerMode, setDocsPointerMode, wantsFullDocs } from "../../../src/core/docs-pointer.ts";
import type { ExtensionAPI } from "../../../src/core/extensions/types.ts";
import { buildSystemPromptSections } from "../../../src/core/system-prompt.ts";
import docsPointerExtension from "../../../src/extensions/docs-pointer/index.ts";

const home = mkdtempSync(join(tmpdir(), "docs-pointer-home-"));
const other = mkdtempSync(join(tmpdir(), "docs-pointer-other-"));
const dir = (name: string, pkg?: string) => {
	const d = join(home, name);
	mkdirSync(d, { recursive: true });
	if (pkg) writeFileSync(join(d, "package.json"), pkg);
	return d;
};
const pointer = `nycode docs live in ${getDocsPath()} (README at ${getReadmePath()}, examples at ${getExamplesPath()}); read them only when the task is about nycode itself.`;
const sections = (cwd: string, customPrompt?: string) =>
	buildSystemPromptSections({ cwd, customPrompt, contextFiles: [], skills: [] });

afterEach(() => setDocsPointerMode("auto"));

describe("wantsFullDocs", () => {
	it("honours on/off and the auto rules", () => {
		expect(wantsFullDocs("on", other, home)).toBe(true);
		expect(wantsFullDocs("off", home, home)).toBe(false);
		expect(wantsFullDocs("auto", home, home)).toBe(true);
		expect(wantsFullDocs("auto", join(getAgentDir(), "x"), home)).toBe(true);
		expect(wantsFullDocs("auto", dir("p1", '{"keywords":["nycode-package"]}'), home)).toBe(true);
		expect(wantsFullDocs("auto", dir("p2", '{"dependencies":{"@nycode/coding-agent":"1"}}'), home)).toBe(true);
		expect(wantsFullDocs("auto", dir("p3", '{"name":"x"}'), home)).toBe(false);
		expect(wantsFullDocs("auto", other, home)).toBe(false);
	});
});

describe("docs section in the system prompt", () => {
	it("is one line outside nycode work and full when asked", () => {
		const docs = sections(other).docs;
		expect(docs).toBe(`<docs>\n${pointer}\n</docs>`);
		expect(docs.split("\n")).toHaveLength(3);
		setDocsPointerMode("on");
		expect(sections(other).docs).toContain("- Additional docs:");
		setDocsPointerMode("off");
		expect(sections(home).docs).toContain(pointer);
	});

	it("leaves custom prompts without a docs section", () => {
		expect(sections(other, "mine").docs).toBeUndefined();
	});
});

describe("/docs-pointer command", () => {
	it("switches the mode and reports it", async () => {
		let command: { handler: (args: string, ctx: never) => Promise<unknown> } | undefined;
		docsPointerExtension({
			registerCommand: (name: string, c: typeof command) => {
				expect(name).toBe("docs-pointer");
				command = c;
			},
		} as unknown as ExtensionAPI);
		const notes: string[] = [];
		const ctx = { cwd: other, ui: { notify: (m: string) => notes.push(m) } } as never;
		await command?.handler("on", ctx);
		expect(getDocsPointerMode()).toBe("on");
		await command?.handler("bogus", ctx);
		await command?.handler("", ctx);
		expect(notes).toEqual([
			"docs-pointer: on (full docs section)",
			"Usage: /docs-pointer on|off|auto",
			"docs-pointer: on (full docs section)",
		]);
	});
});

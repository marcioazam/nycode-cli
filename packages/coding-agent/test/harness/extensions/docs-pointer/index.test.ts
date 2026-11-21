// Ported from import/ny-pi/extensions/pi-docs/index.test.ts: mode `auto` rules, the before_agent_start override
// of the docs section, custom prompts untouched, and the /docs-pointer command.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getAgentDir, getDocsPath, getExamplesPath, getReadmePath } from "../../../../src/config.ts";
import type { ExtensionAPI } from "../../../../src/core/extensions/types.ts";
import { normalizeBuildSystemPromptOptions } from "../../../../src/core/system-prompt.ts";
import docsPointerExtension from "../../../../src/extensions/docs-pointer/index.ts";
import {
	getDocsPointerMode,
	setDocsPointerMode,
	wantsFullDocs,
} from "../../../../src/extensions/docs-pointer/pointer.ts";

const home = mkdtempSync(join(tmpdir(), "docs-pointer-home-"));
const other = mkdtempSync(join(tmpdir(), "docs-pointer-other-"));
const dir = (name: string, pkg?: string) => {
	const d = join(home, name);
	mkdirSync(d, { recursive: true });
	if (pkg) writeFileSync(join(d, "package.json"), pkg);
	return d;
};
const pointer = `nycode docs live in ${getDocsPath()} (README at ${getReadmePath()}, examples at ${getExamplesPath()}); read them only when the task is about nycode itself.`;

type Handler = (event: unknown, ctx: unknown) => unknown;

function load() {
	let onStart: Handler | undefined;
	let command: { handler: (args: string, ctx: never) => Promise<unknown> } | undefined;
	docsPointerExtension({
		on: (name: string, h: Handler) => {
			if (name === "before_agent_start") onStart = h;
		},
		registerCommand: (name: string, c: typeof command) => {
			expect(name).toBe("docs-pointer");
			command = c;
		},
	} as unknown as ExtensionAPI);
	// Runs the handler on fresh options and returns the docs section the prompt would carry.
	const start = (cwd: string, customPrompt?: string, docs?: string) => {
		const systemPromptOptions = normalizeBuildSystemPromptOptions({ cwd, customPrompt });
		if (docs) systemPromptOptions.sections.docs = docs;
		onStart?.({ systemPromptOptions }, { cwd });
		return systemPromptOptions.sections.docs;
	};
	return { start, command: () => command };
}

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

describe("before_agent_start", () => {
	it("sets the one-line pointer outside nycode work and leaves the full section when asked", () => {
		const { start } = load();
		expect(start(other)).toBe(pointer);
		setDocsPointerMode("on");
		expect(start(other)).toBeUndefined();
		expect(start(other, undefined, "full")).toBe("full");
		setDocsPointerMode("off");
		expect(start(home)).toBe(pointer);
	});

	it("removes the pointer it set when the mode returns to on, and only that", () => {
		const { start } = load();
		const options = normalizeBuildSystemPromptOptions({ cwd: other });
		const handlerCtx = { cwd: other };
		let onStart: Handler | undefined;
		docsPointerExtension({
			on: (_: string, h: Handler) => {
				onStart = h;
			},
			registerCommand: () => {},
		} as unknown as ExtensionAPI);
		onStart?.({ systemPromptOptions: options }, handlerCtx);
		expect(options.sections.docs).toBe(pointer);
		setDocsPointerMode("on");
		onStart?.({ systemPromptOptions: options }, handlerCtx);
		expect(options.sections.docs).toBeUndefined();
		expect(start(other, undefined, "theirs")).toBe("theirs");
	});

	it("does nothing with a custom prompt", () => {
		const { start } = load();
		expect(start(other, "mine")).toBeUndefined();
	});
});

describe("/docs-pointer command", () => {
	it("switches the mode and reports it", async () => {
		const { command } = load();
		const notes: string[] = [];
		const ctx = { cwd: other, ui: { notify: (m: string) => notes.push(m) } } as never;
		await command()?.handler("on", ctx);
		expect(getDocsPointerMode()).toBe("on");
		await command()?.handler("bogus", ctx);
		await command()?.handler("", ctx);
		expect(notes).toEqual([
			"docs-pointer: on (full docs section)",
			"Usage: /docs-pointer on|off|auto",
			"docs-pointer: on (full docs section)",
		]);
	});
});

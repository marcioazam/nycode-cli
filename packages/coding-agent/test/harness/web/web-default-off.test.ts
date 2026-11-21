// The web extension ships off: a default session registers no web tools; `builtin:web` (the `extensions` setting
// or `-e`) turns it on. Loading registers tools only and sends no request.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DefaultResourceLoader } from "../../../src/core/resource-loader.ts";
import { builtInExtensions } from "../../../src/extensions/index.ts";

let root: string;
let cwd: string;
let agentDir: string;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "nycode-web-"));
	cwd = join(root, "project");
	agentDir = join(root, "agent");
	mkdirSync(cwd, { recursive: true });
	mkdirSync(agentDir, { recursive: true });
});

afterEach(() => {
	vi.unstubAllGlobals();
	rmSync(root, { recursive: true });
});

async function toolNames(options: { settings?: object; additionalExtensionPaths?: string[] }): Promise<string[]> {
	if (options.settings) writeFileSync(join(agentDir, "settings.json"), JSON.stringify(options.settings));
	const fetchSpy = vi.fn();
	vi.stubGlobal("fetch", fetchSpy);
	const loader = new DefaultResourceLoader({
		cwd,
		agentDir,
		extensionFactories: builtInExtensions.filter((e) => typeof e !== "function" && e.name === "web"),
		additionalExtensionPaths: options.additionalExtensionPaths,
	});
	await loader.reload();
	expect(loader.getExtensions().errors).toEqual([]);
	expect(fetchSpy).not.toHaveBeenCalled();
	return loader.getExtensions().extensions.flatMap((extension) => [...extension.tools.keys()]);
}

describe("builtin:web", () => {
	it("registers no web tools in a default session", async () => {
		expect(await toolNames({})).not.toContain("web_search");
	});

	it("registers web_search and web_fetch with -e builtin:web", async () => {
		const names = await toolNames({ additionalExtensionPaths: ["builtin:web"] });
		expect(names).toContain("web_search");
		expect(names).toContain("web_fetch");
	});

	it("registers web_search when the extensions setting names builtin:web", async () => {
		expect(await toolNames({ settings: { extensions: ["builtin:web"] } })).toContain("web_search");
	});

	it("stays off when the setting disables it", async () => {
		expect(await toolNames({ settings: { extensions: ["-builtin:web"] } })).not.toContain("web_search");
	});
});

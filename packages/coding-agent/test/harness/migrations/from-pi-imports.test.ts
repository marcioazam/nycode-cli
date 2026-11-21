// `migrate from-pi` warns about extensions that still import the pi module names; it never rewrites user code.
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { hashTree, makeHome } from "./from-pi-fixture.ts";

const legacy = (specifier: string): string => `import x from "${specifier}";\nexport default x;\n`;

function put(root: string, rel: string, content: string): void {
	const path = join(root, rel);
	mkdirSync(join(path, ".."), { recursive: true });
	writeFileSync(path, content);
}

describe("migrate from-pi extension import warnings", () => {
	it("lists each legacy import of an extension with its @nycode name", async () => {
		const h = makeHome();
		put(h.source, "extensions/a.ts", legacy("@mariozechner/pi-coding-agent"));
		put(h.source, "extensions/dir/index.js", legacy("@earendil-works/pi-ai/oauth"));
		put(h.source, "extensions/m.mjs", legacy("@mariozechner/pi-tui"));
		put(h.source, "extensions/ok.ts", legacy("@nycode/coding-agent"));
		expect(await h.run([])).toBe(0);
		const text = h.out.join("\n");
		expect(text).toContain("extensions/a.ts: import @mariozechner/pi-coding-agent: rename to @nycode/coding-agent");
		expect(text).toContain("extensions/dir: import @earendil-works/pi-ai/oauth: rename to @nycode/ai/oauth");
		expect(text).toContain("extensions/m.mjs: import @mariozechner/pi-tui: rename to @nycode/tui");
		expect(text).not.toContain("extensions/ok.ts");
	});

	it("scans local packages listed in settings", async () => {
		const h = makeHome();
		put(h.source, "vendor/pi-lsp/src/main.ts", legacy("@mariozechner/pi-agent-core"));
		expect(await h.run([])).toBe(0);
		expect(h.out.join("\n")).toContain("import @mariozechner/pi-agent-core: rename to @nycode/agent-core");
	});

	it("skips node_modules, symlinks, other extensions and files over 1 MiB, and never rewrites code", async () => {
		const h = makeHome();
		put(h.source, "extensions/node_modules/dep/index.js", legacy("@mariozechner/pi-ai"));
		put(h.source, "extensions/notes.md", legacy("@mariozechner/pi-ai"));
		put(h.source, "extensions/big.ts", `${legacy("@mariozechner/pi-ai")}${" ".repeat(1024 * 1024)}`);
		put(h.home, "outside.ts", legacy("@mariozechner/pi-ai"));
		symlinkSync(join(h.home, "outside.ts"), join(h.source, "extensions", "link.ts"));
		const before = hashTree(h.source);
		expect(await h.run([])).toBe(0);
		await h.run(["--apply"]);
		expect(h.out.join("\n")).not.toContain("@mariozechner");
		expect(hashTree(h.source)).toEqual(before);
	});
});

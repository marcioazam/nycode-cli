// Port of patches/pi-code/zzzzzzzzzzzzzzzzzz-memory-notice (node:test).
// Owner request (2026-11-14, variant C): "Memory: 11 memories loaded" becomes `◆ memória  11 notas · 7 projeto · … · /memory`.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { memoryNotice } from "../../../src/extensions/memory/index.ts";

const tmp = mkdtempSync(join(tmpdir(), "memory-notice-test-"));
afterAll(() => rmSync(tmp, { recursive: true }));

const dir = join(tmp, "mem");
mkdirSync(dir);
const note = (name: string, type?: string) =>
	writeFileSync(join(dir, `${name}.md`), type ? `---\ntype: ${type}\n---\n# ${name}\n` : `# ${name}\n`);
note("a", "project");
note("b", "project");
note("c", "feedback");
note("d", "user");
note("e", "reference");
note("f");
note("g", "coisa-estranha");
const index = [
	"# Memory index",
	..."abcdefg".split("").map((n) => `- [${n}](${n}.md): resumo`),
	"- [sumiu](sumiu.md): arquivo ausente",
	"texto solto",
].join("\n");
const theme = {
	fg: (color: string, text: string) => `<${color}>${text}</>`,
	bold: (text: string) => `*${text}*`,
} as unknown as Parameters<typeof memoryNotice>[2];

describe("memoryNotice", () => {
	it('counts by type, in Portuguese, most common first; no type, unknown type and missing file fall under "sem tipo"', () => {
		expect(memoryNotice(dir, index, theme, {})).toBe(
			"<accent>◆</> <text>*memória*</>  <muted>8 notas</> <dim>·</> <muted>3 sem tipo · 2 projeto · 1 orientação · 1 usuário · 1 referência</> <dim>· /memory</>",
		);
	});

	it("one note: singular; a single type; no theme prints no color", () => {
		expect(memoryNotice(dir, "- [a](a.md): x", undefined, {})).toBe("◆ memória  1 nota · 1 projeto · /memory");
	});

	it("empty index: no notice", () => {
		expect(memoryNotice(dir, "# Memory index\n")).toBeUndefined();
	});

	it("a link leaving the memory directory is not read", () => {
		writeFileSync(join(tmp, "fora.md"), "---\ntype: project\n---\n");
		expect(memoryNotice(dir, "- [x](../fora.md): y", undefined, {})).toBe("◆ memória  1 nota · 1 sem tipo · /memory");
	});

	// Owner request (2026-11-14): minimal brain icon for memory, only where a Nerd Font renders (kitty or NYCODE_NERD_FONT=1);
	// an ASCII request or an unknown terminal keeps the diamond.
	it("icon: brain with a Nerd Font, diamond without", () => {
		const iconDir = mkdtempSync(join(tmpdir(), "mem-icone-"));
		writeFileSync(join(iconDir, "a.md"), "---\ntype: project\n---\nx");
		const de = (env: Record<string, string>) =>
			memoryNotice(iconDir, "- [a](a.md): x", undefined, env)?.split(" ")[0];
		expect(de({ TERM: "xterm-kitty" })).toBe("\uee9c");
		expect(de({ KITTY_WINDOW_ID: "3" })).toBe("\uee9c");
		expect(de({ NYCODE_NERD_FONT: "1" })).toBe("\uee9c");
		expect(de({ TERM: "xterm-kitty", NYCODE_ASCII_ICONS: "1" })).toBe("◆");
		expect(de({ TERM: "xterm-256color" })).toBe("◆");
		rmSync(iconDir, { recursive: true });
	});

	// Owner request (2026-11-14): the memory notice in a neutral-background box. The notify goes out marked with U+2063 (invisible)
	// and the core draws the box; without the mark the box is not drawn.
	it("the start notice goes out marked for the neutral box", () => {
		const src = readFileSync(join(import.meta.dirname, "../../../src/extensions/memory/index.ts"), "utf8");
		// Split so the needle is not a template-looking string literal (biome noTemplateCurlyInString).
		const needle = ["ctx.ui.notify(`\\u2063$", '{notice}`, "info")'].join("");
		expect(src.includes(needle)).toBe(true);
	});
});

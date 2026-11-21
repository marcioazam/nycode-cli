// Port of patches/pi-code/zzzzzzzzzzzzzzzzzzzzzzzz-rules-notice (node:test): the session-start notice of the loaded rules.
// Owner request (2026-11-15, variant A): "Rules loaded: global yes, project 0" becomes a neutral box
// `⚖ regras  2 globais · nenhuma do projeto · sempre ativas`, drawn like the memory notice.
import { describe, expect, it } from "vitest";
import { rulesLoadedMessage } from "../../../src/extensions/claude-rules/index.ts";

type RuleSet = Parameters<typeof rulesLoadedMessage>[0];

const set = (inline: number, scoped: number): RuleSet =>
	({
		inline: Array.from({ length: inline }, () => ({})),
		scoped: Array.from({ length: scoped }, () => ({})),
	}) as unknown as RuleSet;
const theme = {
	fg: (color: string, text: string) => `<${color}>${text}</>`,
	bold: (text: string) => `*${text}*`,
} as unknown as Parameters<typeof rulesLoadedMessage>[2];

describe("rulesLoadedMessage", () => {
	it("colors of the memory notice: accent icon, bold title, muted counts, dim mode", () => {
		expect(rulesLoadedMessage(set(2, 0), set(0, 0), theme, {})).toBe(
			"<accent>§</> <text>*regras*</>  <muted>2 globais</> <dim>·</> <muted>nenhuma do projeto</> <dim>· sempre ativas</>",
		);
	});

	it("singular, project only, per file and mixed", () => {
		expect(rulesLoadedMessage(set(1, 0), set(0, 0), undefined, {})).toBe(
			"§ regras  1 global · nenhuma do projeto · sempre ativa",
		);
		expect(rulesLoadedMessage(set(0, 0), set(0, 3), undefined, {})).toBe(
			"§ regras  nenhuma global · 3 do projeto · por arquivo",
		);
		expect(rulesLoadedMessage(set(2, 1), set(1, 1), undefined, {})).toBe(
			"§ regras  3 globais · 2 do projeto · 3 sempre ativas · 2 por arquivo",
		);
	});

	it("gavel with a Nerd Font (kitty or NYCODE_NERD_FONT=1); an ASCII request wins", () => {
		// kitty draws the icon over the next cell: two spaces keep the gap.
		expect(
			rulesLoadedMessage(set(1, 0), set(0, 0), undefined, { KITTY_WINDOW_ID: "1" })?.startsWith("\uf0e3  regras"),
		).toBe(true);
		expect(
			rulesLoadedMessage(set(1, 0), set(0, 0), undefined, { NYCODE_NERD_FONT: "1" })?.startsWith("\uf0e3 regras"),
		).toBe(true);
		expect(
			rulesLoadedMessage(set(1, 0), set(0, 0), undefined, {
				NYCODE_NERD_FONT: "1",
				NYCODE_ASCII_ICONS: "1",
			})?.startsWith("§ regras"),
		).toBe(true);
	});

	it("no rule: no notice", () => {
		expect(rulesLoadedMessage(set(0, 0), set(0, 0), theme, {})).toBeUndefined();
	});
});

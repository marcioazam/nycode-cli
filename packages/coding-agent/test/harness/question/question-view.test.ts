// Ported from zzzzzzzzzzzzzzzzz-question-view.test.ts (owner request 2026-11-14): the question tool shows as a list
// (● chosen, ○ the rest), drawn only once.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { asTheme, captureTool, type Rendered } from "./support.ts";

// Fixed icon in the tests: without a Nerd Font the question uses `?` (see questionGlyph).
beforeEach(() => vi.stubEnv("NYCODE_ASCII_ICONS", "1"));

const tool = captureTool({ emit() {}, on() {} });
const theme = asTheme({ fg: (c: string, s: string) => `<${c}:${s}>`, bold: (s: string) => `*${s}*` });
const draw = (c: Rendered) => c.render(200).map((l) => l.trimEnd());
const call = (args: unknown, isPartial = true) => draw(tool.renderCall(args, theme, { isPartial }));
const render = (details: unknown, expanded: boolean) =>
	draw(tool.renderResult({ content: [{ type: "text", text: "x" }], details }, { expanded, isPartial: false }, theme));
const result = (details: unknown) => render(details, false);
const open = (details: unknown) => render(details, true);

const args = {
	question: "Como resolvo?",
	header: "Tipos",
	options: [
		{ label: "Tipos continuam ciano (Recomendado · ~80%)", description: "oculta" },
		{ label: "Tipos na cor do texto" },
	],
};
const details = {
	question: "Como resolvo?",
	header: "Tipos",
	options: ["Tipos continuam ciano (Recomendado · ~80%)", "Tipos na cor do texto"],
};
const ASK = "<dim:│> <muted:Como resolvo?>";

describe("question result view", () => {
	// Owner request (2026-11-14): while the dialog is open the question does not also show in the chat (it was duplicated);
	// the block enters the chat only after the answer, drawn by the result.
	it("renderCall draws nothing, pending or not: the question enters the chat only with the answer", () => {
		expect(call(args).join("").trim()).toBe("");
		expect(call(args, false).join("").trim()).toBe("");
	});

	// Variant A (owner, 2026-11-14): state + icon + title + ANSWER on the header, the question below with │; options only when open.
	// The title is always "pergunta"; the model's label (header) follows, dimmed.
	it('without header the label is just "pergunta"', () => {
		expect(result({ question: "Qual?", options: ["a", "b"], answer: "a" })).toEqual([
			"  <accent:?> <toolTitle:*pergunta*>  <success:a>",
			"<dim:│> <muted:Qual?><dim: · ctrl+o abre>",
		]);
	});

	it("answered: answer on the header (without the label), question below; open lists ● chosen and ○ the rest", () => {
		const d = { ...details, answer: "Tipos continuam ciano (Recomendado · ~80%)" };
		expect(result(d)).toEqual([
			"  <accent:?> <toolTitle:*pergunta*> <dim:· Tipos>  <success:Tipos continuam ciano>",
			`${ASK}<dim: · ctrl+o abre>`,
		]);
		expect(open(d)).toEqual([
			"  <accent:?> <toolTitle:*pergunta*> <dim:· Tipos>  <success:Tipos continuam ciano>",
			`${ASK}<dim: · ctrl+o fecha>`,
			"<dim:│> <success:●> <text:Tipos continuam ciano>  <dim:recomendada · ~80%>",
			"<dim:│> <dim:○> <dim:Tipos na cor do texto>",
		]);
	});

	it('free text: the typed text is the answer; open shows it as the chosen row, without "Outra resposta"', () => {
		const d = { ...details, answer: "meu jeito", wasCustom: true };
		expect(result(d)[0]).toBe("  <accent:?> <toolTitle:*pergunta*> <dim:· Tipos>  <success:meu jeito>");
		const lines = open(d);
		expect(lines.at(-1)).toBe("<dim:│> <success:●> <text:meu jeito>");
		expect(lines.some((l) => l.includes("Outra resposta"))).toBe(false);
	});

	it("multiSelect marks several", () => {
		const d = { question: "Q?", options: ["a", "b", "c"], multiSelect: true, answer: "a, c" };
		expect(result(d)[0]).toBe("  <accent:?> <toolTitle:*pergunta*>  <success:a, c>");
		expect(open(d).slice(2)).toEqual([
			"<dim:│> <success:●> <text:a>",
			"<dim:│> <dim:○> <dim:b>",
			"<dim:│> <success:●> <text:c>",
		]);
	});

	it("cancelled and timed out: no state icon, the reason in yellow instead of the answer; open lists everything ○ dim", () => {
		expect(result({ ...details, answer: null })).toEqual([
			"  <accent:?> <toolTitle:*pergunta*> <dim:· Tipos>  <warning:cancelada> <dim:· sem resposta>",
			`${ASK}<dim: · ctrl+o abre>`,
		]);
		expect(open({ ...details, answer: null }).slice(2)).toEqual([
			"<dim:│> <dim:○> <dim:Tipos continuam ciano>  <dim:recomendada · ~80%>",
			"<dim:│> <dim:○> <dim:Tipos na cor do texto>",
		]);
		expect(result({ ...details, answer: "", timedOut: true })[0]).toBe(
			"  <accent:?> <toolTitle:*pergunta*> <dim:· Tipos>  <warning:tempo esgotado> <dim:· seguiu sem resposta>",
		);
	});

	it("batch: one block per question, separated by a blank line", () => {
		const a = { question: "A?", options: ["x"], answer: "x" };
		const b = { question: "B?", options: ["y"], answer: "y" };
		const lines = result({ ...a, questions: [a, b] });
		expect(lines.filter((l) => l.includes("<accent:?>")).length).toBe(2);
		expect(lines.map((l) => l === "")).toEqual([false, false, true, false, false]);
	});

	it("without details the result stays the returned text", () => {
		expect(draw(tool.renderResult({ content: [{ type: "text", text: "erro" }] }, {}, theme))).toEqual(["erro"]);
	});
});

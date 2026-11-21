// Ported from zzzzzzzzzzzzzzzzzzzz-question-dialog.test.ts (owner request 2026-11-14): the question was drawn twice (chat and
// dialog) and the dialog cut texts with "...". Variant B: numbered list, ★ on the recommended option, panel of the focused one.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { askViaOverlay } from "../../../src/extensions/question/overlay.ts";
import type { DisplayOption } from "../../../src/extensions/question/types.ts";
import { buildQuestionLines, questionGlyph } from "../../../src/extensions/question/view.ts";
import {
	ansi,
	asTheme,
	captureTool,
	type Factory,
	fakeCtx,
	fakeEditor,
	limpo,
	opts,
	other,
	stripAnsi,
	stripTags,
	tagTheme,
} from "./support.ts";

// Fixed icon in the tests: without a Nerd Font the question uses `?` (the balloon icon depends on the terminal; see questionGlyph).
beforeEach(() => vi.stubEnv("NYCODE_ASCII_ICONS", "1"));

const lines = (over: Record<string, unknown>) =>
	buildQuestionLines({
		width: 80,
		question: "Qual?",
		header: "Abordagem",
		options: [...opts, other],
		optionIndex: 1,
		editMode: false,
		multiSelect: false,
		checked: [],
		editor: fakeEditor,
		theme: tagTheme,
		...over,
	});

describe("question dialog", () => {
	it("header: ? title on the left, kind on the right; footer with 1-N", () => {
		expect(limpo(lines({ theme: ansi }))[1]).toMatch(/^ \? pergunta · Abordagem +escolha uma$/);
		expect(limpo(lines({ theme: ansi, options: opts, multiSelect: true, checked: [true, false] }))[1]).toMatch(
			/^ \? pergunta · Abordagem +escolha um ou mais$/,
		);
		expect(limpo(lines({ theme: ansi, header: undefined }))[1]).toMatch(/^ \? pergunta +escolha uma$/);
		expect(limpo(lines({ theme: ansi })).at(-2)).toBe(" 1-3 escolhe · ↑↓ move · s pula · ? ajuda · esc sai");
		expect(limpo(lines({ theme: ansi, options: opts, multiSelect: true, checked: [] })).at(-2)).toBe(
			" 1-2 marca · ↑↓ move · espaço marca · ⏎ confirma · s pula · ? ajuda · esc sai",
		);
		expect(lines({}).some((l) => l.includes("<accent><b>❯ 2</b></accent>  <accent><b>beta"))).toBe(true);
	});

	// Owner, 2026-11-15: the list shows only the title (the one-line summary is gone); the description stays in the focused panel.
	it("variant B: one row per option with number and title only; ★ recommended; panel of the focused option only, stable height", () => {
		const longa =
			"Mesma conta do baseline já gravado. Então a comparação continua limpa e eu tento de novo a cada 30 minutos, sem trocar de conta nem de modelo no meio.";
		const o: DisplayOption[] = [
			{ label: "Esperar (Recomendado · ~80%)", description: longa },
			{ label: "Reduzir", description: "Corta o lote pela metade." },
			{ label: "Type something.", isOther: true },
		];
		const ver = (optionIndex: number) =>
			limpo(
				buildQuestionLines({
					width: 90,
					question:
						"A conta está no limite de uso desde 14:12 e as duas retomadas falharam, então o lote parou. Como seguir?",
					header: "Conta",
					options: o,
					optionIndex,
					editMode: false,
					multiSelect: false,
					checked: [],
					editor: fakeEditor,
					theme: ansi,
				}),
			);
		const t = ver(0);
		expect(t.join(" ").replace(/\s+/g, " ")).toContain("então o lote parou. Como seguir?"); // whole question, wrapped
		expect(t.every((x) => [...x].length <= 90) && !t.some((x) => x.includes("..."))).toBe(true);
		const i = t.findIndex((x) => x.startsWith(" ❯ 1  Esperar"));
		expect(t[i]).toMatch(/^ ❯ 1 {2}Esperar +★ recomendada · ~80%$/);
		expect(t[i + 1]).toBe("   2  Reduzir");
		expect(t[i + 2]).toBe("   3  Outra resposta…");
		expect(t[i + 3]).toBe("");
		expect(t[i + 4]).toMatch(/^ ─── Esperar ─+$/);
		const painel = t.slice(i + 5, -3);
		expect(painel.length).toBeGreaterThanOrEqual(2);
		expect(painel.join(" ").replace(/\s+/g, " ")).toContain("nem de modelo no meio."); // whole description
		// focus on another option: the panel swaps and the dialog height does not change
		const t2 = ver(1);
		expect(t2.some((x) => /^ ─── Reduzir ─+$/.test(x)) && t2.includes(" Corta o lote pela metade.")).toBe(true);
		expect(t2.length).toBe(t.length);
		expect(ver(2).length).toBe(t.length);
		// no descriptions: no summary and no panel
		const curto = limpo(lines({ theme: ansi, options: [{ label: "sim" }, { label: "não" }], optionIndex: 0 }));
		expect(curto.slice(3, -3)).toEqual(["", " ❯ 1  sim", "   2  não"]);
	});

	function drive(options: DisplayOption[], multiSelect: boolean, keys: string[]) {
		let handler: { handleInput(d: string): void } | undefined;
		const ctx = fakeCtx(
			(f: Factory) =>
				new Promise((resolve) => {
					handler = f({ requestRender() {}, terminal: { rows: 24, columns: 80 } }, tagTheme, null, resolve);
				}),
		);
		const p = askViaOverlay({ question: "Qual?", options: opts, multiSelect }, ctx, options, multiSelect);
		for (const k of keys) handler?.handleInput(k);
		return p;
	}

	it("numeric key: picks and confirms; in multi marks; on 'Outra resposta' opens the text; out of range is ignored", async () => {
		expect(await drive([...opts, other], false, ["2"])).toEqual({ answer: "beta", wasCustom: false, index: 2 });
		expect(await drive([...opts, other], false, ["9", "1"])).toEqual({ answer: "alpha", wasCustom: false, index: 1 });
		expect(await drive([...opts, other], false, ["3", "o", "i", "\r"])).toEqual({ answer: "oi", wasCustom: true });
		expect(await drive(opts, true, ["2", "1", "\r"])).toEqual({ answer: "alpha, beta", wasCustom: false });
		expect(await drive([...opts, other], false, ["\x1b[B", "\r"])).toEqual({
			answer: "beta",
			wasCustom: false,
			index: 2,
		}); // arrows still work
	});

	it("chat: the call draws nothing; the question enters only with the answer", () => {
		const tool = captureTool();
		const args = { question: "Como?", options: [{ label: "a" }, { label: "b" }] };
		for (const isPartial of [true, false])
			expect(tool.renderCall(args, tagTheme, { isPartial }).render(80).join("").trim()).toBe("");
		const res = tool
			.renderResult(
				{
					content: [{ type: "text", text: "x" }],
					details: { question: "Como?", options: ["a", "b"], answer: "a" },
				},
				{},
				tagTheme,
			)
			.render(80);
		// variant A of the block (owner, 2026-11-14): answer on the header, question below
		expect(stripTags(res).replace(/\s+/g, " ")).toMatch(/\? .*pergunta.* a │ Como\? · ctrl\+o abre/);
	});

	// Owner request (2026-11-14): question icon = two balloons (cod-comment_discussion, U+EAC7), one color, in the chat block and
	// the dialog header. Only where there is a Nerd Font; otherwise `?`.
	it("icon: balloons with Nerd Font, ? without", () => {
		expect(questionGlyph({ TERM: "xterm-kitty" })).toBe("\ueac7");
		expect(questionGlyph({ KITTY_WINDOW_ID: "1" })).toBe("\ueac7");
		expect(questionGlyph({ NYCODE_NERD_FONT: "1" })).toBe("\ueac7");
		expect(questionGlyph({ TERM: "xterm-kitty", NYCODE_ASCII_ICONS: "1" })).toBe("?");
		expect(questionGlyph({ TERM: "xterm-256color" })).toBe("?");
		vi.stubEnv("NYCODE_ASCII_ICONS", "");
		vi.stubEnv("NYCODE_NERD_FONT", "1");
		vi.stubEnv("TERM", "xterm-256color"); // kitty would take two spaces after the glyph
		vi.stubEnv("KITTY_WINDOW_ID", "");
		try {
			expect(limpo(lines({ theme: ansi }))[1].startsWith(" \ueac7 pergunta · Abordagem")).toBe(true);
		} finally {
			vi.stubEnv("NYCODE_NERD_FONT", "");
			vi.stubEnv("NYCODE_ASCII_ICONS", "1");
		}
	});

	// Owner request (2026-11-14): the recommended option row takes a soft background across the whole row, with or without focus.
	// Owner, 2026-11-15: it uses the system palette cyan (token syntaxType) over toolPendingBg, no longer green.
	it("recommended: ★ in cyan (syntaxType) and toolPendingBg across the row, with and without focus; the others have no background", () => {
		const cor = asTheme({
			fg: (_c: string, x: string) => `\x1b[2m${x}\x1b[22m`,
			bold: (x: string) => `\x1b[1m${x}\x1b[22m`,
			bg: (c: string, x: string) => `\x1b[48;5;${c === "toolPendingBg" ? 22 : 99}m${x}\x1b[49m`,
		});
		const o: DisplayOption[] = [
			{ label: "Esperar (Recomendado)", description: "Mesma conta." },
			{ label: "Reduzir", description: "Corta o lote." },
			{ label: "Type something.", isOther: true },
		];
		for (const optionIndex of [0, 1]) {
			const l = buildQuestionLines({
				width: 70,
				question: "Qual?",
				options: o,
				optionIndex,
				editMode: false,
				multiSelect: false,
				checked: [],
				editor: fakeEditor,
				theme: cor,
			});
			const rec = l.filter((x) => x.includes("Esperar") && x.includes("★"));
			expect(rec.length).toBe(1);
			expect(rec[0].startsWith("\x1b[48;5;22m") && rec[0].endsWith("\x1b[49m")).toBe(true);
			expect([...stripAnsi(rec[0])].length).toBe(70); // full width
			expect(stripAnsi(rec[0])).toMatch(/★ recomendada $/);
			expect(l.filter((x) => x.includes("\x1b[48;")).length).toBe(1);
		}
		// width 140: the `<tag>` theme counts as visible width; with 70 the truncation cut the </syntaxType>.
		const tags = buildQuestionLines({
			width: 140,
			question: "Qual?",
			options: o,
			optionIndex: 1,
			editMode: false,
			multiSelect: false,
			checked: [],
			editor: fakeEditor,
			theme: tagTheme,
		}).join("\n");
		expect(tags).toContain("<syntaxType>★ recomendada</syntaxType>");
		// theme without background (or without recommended): nothing changes
		expect(lines({ theme: ansi }).some((x) => x.includes("\x1b[48;"))).toBe(false);
	});
});

// Port of the todo-follow-active patch tests (pi-code 1.7.0) to vitest against the embedded source.
// Bug (2026-11-15): numa lista maior que a janela, a aba Todo ficava presa no topo e mostrava só linhas feitas
// ("Todo 8/13", 6 linhas "feito"); o item em andamento e os pendentes ficavam fora da tela.
import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { PlanSection } from "../../../../src/extensions/plan-mode/section.ts";
import type { Loose } from "../support.ts";

vi.hoisted(() => {
	process.env.NO_COLOR = "1";
});

const theme = { fg: (_c: string, t: string) => t, bold: (t: string) => t };
const tui = { requestRender() {}, terminal: { rows: 40 } };
const ctx: Loose = {
	hasUI: true,
	ui: { setWidget: (_k: string, f?: (t: unknown, th: unknown) => unknown) => void f?.(tui, theme) },
};
const step = (n: number, completed = false) => ({ step: n, text: `passo ${n}`, completed });

const body = (s: Loose): string =>
	s
		.render(200)
		.join("\n")
		.replace(/\x1b\[[0-9;]*m/g, "");

test("a janela acompanha o primeiro item não concluído", () => {
	const s = new PlanSection();
	s.update(
		ctx,
		Array.from({ length: 13 }, (_, i) => step(i + 1, i < 8)),
		"todo",
	);
	const out = body(s);
	assert.match(out, /passo 9\b/, "o primeiro item aberto aparece");
	assert.doesNotMatch(out, /passo 1\b/, "o topo já concluído sai da janela");
});

test("lista que cabe na janela não rola", () => {
	const s = new PlanSection();
	s.update(ctx, [step(1, true), step(2, true), step(3)], "todo");
	assert.match(body(s), /passo 1\b[\s\S]*passo 3\b/);
});

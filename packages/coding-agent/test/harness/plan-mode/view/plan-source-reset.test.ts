// Port of the plan-source-reset patch tests (pi-code 1.7.0) to vitest against the embedded source.
// Bug (2026-11-13): quando a execução de um plano terminava, a seção passava a mostrar a lista do `todo` sem
// zerar relógio e gasto (um todo velho herdava 4.0M tok/$1.90 do plano) e o cabeçalho continuava "PLAN".
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

function section(clock: { t: number }) {
	const s = new PlanSection();
	s.now = () => clock.t;
	return s;
}
// Sem ANSI e com espaços colapsados: aba + detalhe viram `Plan 1/3 10:00`. O detalhe (relógio) é a linha de rodapé da
// seção desde o patch plan-footer (dono, 2026-11-14; antes vinha na própria linha das abas).
const title = (s: Loose): string => {
	const l = s.render(200);
	return `${l.find((x: string) => /^(Plan|Todo) \d+\/\d+/.test(x)) ?? ""} ${l.at(-1) ?? ""}`
		.replace(/\x1b\[[0-9;]*m/g, "")
		.replace(/\s+/g, " ");
};

test("fim do plano: a lista do todo começa com relógio zerado e cabeçalho TODO", () => {
	const clock = { t: 1_000_000 };
	const s = section(clock);
	s.update(ctx, [step(1, true), step(2), step(3)], "plan");
	clock.t += 600_000; // 10 min de plano
	assert.match(title(s), /^Plan 1\/3 10:00/);
	s.update(ctx, [step(1)], "todo");
	const t = title(s);
	assert.match(t, /^Todo 0\/1/);
	assert.doesNotMatch(t, /10:00/);
	assert.doesNotMatch(t, /Plan/);
	s.shutdown(ctx);
});

test("mesma origem: o relógio do plano continua entre atualizações", () => {
	const clock = { t: 1_000_000 };
	const s = section(clock);
	s.update(ctx, [step(1), step(2)], "plan");
	clock.t += 120_000;
	s.update(ctx, [step(1, true), step(2)], "plan");
	assert.match(title(s), /^Plan 1\/2 02:00/);
	s.shutdown(ctx);
});

test("sem origem informada: continua PLAN (compatível com chamadores antigos)", () => {
	const s = section({ t: 0 });
	s.update(ctx, [step(1)]);
	assert.match(title(s), /^Plan 0\/1/);
	s.shutdown(ctx);
});

test("todo: lista não vazia toda concluída some; pendente/in_progress faz reaparecer; plano concluído continua", () => {
	const widgets: Array<[string, unknown]> = [];
	const c: Loose = {
		hasUI: true,
		ui: {
			setWidget: (k: string, f?: (t: unknown, th: unknown) => unknown) => {
				widgets.push([k, f]);
				f?.(tui, theme);
			},
		},
	};
	const shown = () => widgets.length > 0 && widgets.at(-1)![1] !== undefined;
	const s = section({ t: 0 });
	s.update(c, [], "todo");
	assert.equal(shown(), false, "vazia");
	s.update(c, [step(1), step(2, true)], "todo");
	assert.equal(shown(), true, "mista");
	s.update(c, [step(1, true), step(2, true)], "todo");
	assert.equal(shown(), false, "toda concluída");
	s.update(c, [step(1, true), step(2, true), step(3)], "todo");
	assert.equal(shown(), true, "nova tarefa reaparece");
	assert.match(title(s), /^Todo 2\/3/);
	s.update(c, [step(1, true), step(2, true), step(3, true)], "todo");
	assert.equal(shown(), false);
	s.update(c, [step(1, true)], "plan");
	assert.equal(shown(), true, "plano concluído segue visível");
	s.shutdown(c);
});

// Ported from zzzzzzz-subagent-model-effort/render.test.ts (pi-code patch tests); same cases and expectations.
// Modelo e esforço na lista e no viewer (docs/subagent-model-effort.md, AC1-AC3, AC6)
import assert from "node:assert/strict";
import { visibleWidth } from "@nycode/tui";
import { test } from "vitest";
import type { FleetSource, RunRecord } from "../../../../src/extensions/subagent/fleet/types.ts";
import * as panel from "../../../../src/extensions/subagent/fleet-ui/panel.ts";
import * as label from "../../../../src/extensions/subagent/fleet-ui/style/runtime-label.ts";
import * as vm from "../../../../src/extensions/subagent/fleet-ui/view-model.ts";
import * as viewer from "../../../../src/extensions/subagent/fleet-ui/viewer.ts";
import { fleetTestEnv } from "../support/fleet-env.ts";

fleetTestEnv("fleet-model-effort-render-");

const NOW = 1_000_000;
const theme = { fg: (_c: string, s: string) => s, bold: (s: string) => s };
const ansiTheme = {
	fg: (c: string, s: string) => `\u001b[3${c.length % 8}m${s}\u001b[0m`,
	bold: (s: string) => `\u001b[1m${s}\u001b[22m`,
};
const strip = (s: string): string => s.replace(/\u001b\[[0-9;]*m/g, "");
const WIDTHS = [20, 40, 80, 160];

const rec = (over: Record<string, unknown> = {}) =>
	({
		v: 1,
		id: "a",
		parentId: null,
		depth: 1,
		agent: "swarm-worker",
		task: "implement the feature",
		background: false,
		state: "running",
		startedAt: NOW - 60_000,
		updatedAt: NOW,
		turns: 1,
		toolCalls: 1,
		tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, context: 114_400 },
		cost: 1.234,
		ownerPid: 1,
		activity: "Reading files",
		...over,
	}) as unknown as RunRecord;
// /tasks mode (panel:false) lists finished runs too; panel mode hides `done`.
const rowOf = (r: RunRecord) => vm.buildRows([r], { now: NOW, panel: false })[0];
const render = (r: RunRecord, width: number, t: panel.UiTheme = theme) => panel.renderRow(rowOf(r), false, t, width);

const OBSERVED = {
	provider: "anthropic",
	model: "claude-sonnet-5-5",
	effort: "medium",
	modelSeen: true as const,
	effortSeen: true as const,
};

test("lista a 160 colunas: provedor/modelo completo e esforço, antes da tarefa", () => {
	const out = render(rec(OBSERVED), 160);
	assert.ok(out.includes("swarm-worker [anthropic/claude-sonnet-5-5 · medium]"), out);
	assert.ok(out.indexOf("[anthropic") < out.indexOf("implement the feature"));
	assert.ok(out.includes("114.4k tok") && out.includes("$1.23"));
});

test("lista a 80 colunas mantém modelo e esforço; tarefa longa não engole a metadado", () => {
	const out = render(rec({ ...OBSERVED, task: "x".repeat(300) }), 80);
	assert.ok(/\[(anthropic\/)?claude-sonnet-5-5 ?· ?medium\]/.test(out), out);
	assert.ok(visibleWidth(out) <= 80);
});

test("configurado: model com provedor no id e esforço off aparecem", () => {
	const out = render(rec({ model: "anthropic/claude-sonnet-5-5", effort: "off" }), 160);
	assert.ok(out.includes("[anthropic/claude-sonnet-5-5 · off]"), out);
});

test("sem metadado (registro antigo ou esforço ausente): ? explícito, sem inventar medium", () => {
	for (const r of [rec(), rec({ model: "a/b" })]) {
		const out = render(r, 160);
		assert.ok(out.includes("?"), out);
		assert.ok(!/medium|high/.test(out));
	}
	assert.ok(render(rec(), 160).includes("[? · ?]"));
	assert.ok(render(rec({ model: "a/b" }), 160).includes("[a/b · ?]"));
});

test("larguras 20/40/80/160 com ANSI e com tema simples: nunca passa da largura, nenhum crash", () => {
	const variants = [
		rec(),
		rec(OBSERVED),
		rec({ ...OBSERVED, task: "tarefa \u001b[31mvermelha\u001b[0m ".repeat(20), state: "done" }),
		rec({ model: "a".repeat(200), effort: "off", task: "", activity: "" }),
	];
	for (const r of variants) {
		for (const w of WIDTHS) {
			for (const t of [theme, ansiTheme]) {
				const out = render(r, w, t);
				assert.ok(visibleWidth(out) <= w, `${w}: ${strip(out)}`);
			}
		}
	}
});

test("candidatos: do mais largo ao mais curto, sempre entre colchetes", () => {
	const c = label.listMeta(OBSERVED);
	assert.equal(c[0], "[anthropic/claude-sonnet-5-5 · medium]");
	assert.equal(c[1], "[claude-sonnet-5-5 · medium]");
	assert.ok(c.length >= 3 && c.every((s: string) => s.startsWith("[") && s.endsWith("]")));
	assert.ok(c.every((s: string, i: number) => i === 0 || visibleWidth(s) <= visibleWidth(c[i - 1])));
	assert.deepEqual(label.listMeta({}).at(0), "[? · ?]");
	assert.equal(
		label.listMeta({ provider: "openrouter", model: "anthropic/x", effort: "low" })[0],
		"[openrouter/anthropic/x · low]",
	);
});

test("metadado fica na lista de /tasks (buildRows com panel:false) e na linha de cada grau", () => {
	const child = rec({ id: "b", parentId: "a", depth: 2, agent: "child", ...OBSERVED, effort: "high" });
	const rows = vm.buildRows([rec(), child], { now: NOW, panel: false });
	assert.equal(rows.length, 2);
	assert.ok(panel.renderRow(rows[1], false, theme, 160).includes("· high]"));
});

function viewerOf(r: RunRecord) {
	const records = [r];
	const src: FleetSource = {
		list: () => records,
		readTranscript: () => ({ items: [], next: 0 }),
		stop: () => "stopping",
		send: () => "queued",
		hasForeground: () => false,
		detachForeground: () => 0,
		onChange: () => () => {},
	};
	return new viewer.ViewerComponent({
		source: src,
		theme,
		id: r.id,
		done() {},
		requestRender() {},
		rows: () => 30,
		now: () => NOW,
		poll: false,
	});
}

/** Header row 2 (index 2 of the render): `model · effort`, then neighbours; it is the only place the viewer shows the runtime. */
const runtimeLine = (lines: string[]): string => lines[2];

test("viewer: modelo e esforço na linha 2 do cabeçalho, sem rótulos, origem observada", () => {
	const lines = viewerOf(rec(OBSERVED)).render(120);
	assert.equal(runtimeLine(lines), "anthropic/claude-sonnet-5-5 · medium");
	assert.equal(label.runtimeSummary(rec(OBSERVED)), "anthropic/claude-sonnet-5-5 · medium");
	assert.match(lines[1], /● rodando · /, "status intacto");
	assert.ok(!lines.some((s: string) => /^(Model|Effort):/.test(s)), "sem as linhas rotuladas antigas");
});

test("viewer: configurado, off, e desconhecido", () => {
	const both = (r: RunRecord) => label.runtimeSummary(r);
	assert.equal(both(rec({ model: "a/b", effort: "off" })), "a/b (configurado) · off (configurado)");
	assert.equal(both(rec({ model: "a/b" })), "a/b (configurado) · ainda não informado");
	assert.equal(both(rec()), "ainda não informado · ainda não informado");
	assert.equal(
		runtimeLine(viewerOf(rec({ model: "a/b", effort: "off" })).render(120)),
		"a/b (configurado) · off (configurado)",
	);
	assert.equal(runtimeLine(viewerOf(rec()).render(120)), "ainda não informado · ainda não informado");
});

test("viewer: a 20/40/80/160 a linha 2 respeita a largura; modelo e esforço aparecem inteiros quando cabem e são cortados pela direita", () => {
	const long = { provider: "p".repeat(60), model: "m".repeat(80) };
	for (const w of WIDTHS) {
		for (const effort of ["off", "high"]) {
			for (const meta of [OBSERVED, long]) {
				const r = rec({ ...meta, effort, modelSeen: true, effortSeen: true });
				const lines = viewerOf(r).render(w);
				assert.ok(
					lines.every((s: string) => visibleWidth(s) <= w),
					String(w),
				);
				const line = runtimeLine(lines).replace(/\x1b\[[0-9;]*m/g, "");
				const full = label.runtimeSummary(r);
				assert.ok(visibleWidth(line) <= w, `${w}: ${line}`);
				// Truncation only cuts the end: what is shown is a prefix of the full text (the model comes first).
				assert.ok(full.startsWith(line.replace(/(…|\.\.\.)$/, "")) && line.length > 0, `prefixo@${w}: ${line}`);
				if (visibleWidth(full) <= w) assert.equal(line, full, `${w}/${effort}: cabe inteiro`);
				else assert.ok(/(…|\.\.\.)$/.test(line) || visibleWidth(line) === w, `${w}/${effort}: cortado na largura`);
				if (meta === OBSERVED && w >= 40) assert.ok(line.endsWith(` · ${effort}`), `${w} ${effort}: ${line}`);
			}
		}
	}
	assert.ok(
		runtimeLine(viewerOf(rec({ ...OBSERVED, provider: "p".repeat(40) })).render(160)).includes(
			`${"p".repeat(40)}/claude-sonnet-5-5`,
		),
	);
});

test("viewer: a altura total acompanha as linhas (CHROME_ROWS) com a linha nova", () => {
	const lines = viewerOf(rec(OBSERVED)).render(80);
	const h = Math.max(3, Math.floor(30 * 0.85) - 6);
	assert.equal(lines.length, 6 + h);
});

test("painel a 60 colunas: modelo+esforço mais curto cabe com o tempo; a tarefa trunca e as estatísticas caem", () => {
	const out = render(rec({ ...OBSERVED, effort: "high", task: "x".repeat(100) }), 60);
	assert.ok(out.includes("[claude-sonnet-5-5 · high]"), out);
	assert.ok(out.includes("1m 0s") && out.includes("…"), out);
	assert.ok(!out.includes("tok") && !out.includes("$"), out);
	assert.ok(visibleWidth(out) <= 60);
});

test("painel: sempre que cabe cabeça + menor candidato + tempo, o esforço aparece (nenhum modelo de tamanho algum o perde)", () => {
	const tasks = ["", "short", "x".repeat(200)];
	for (const model of ["m", "claude-sonnet-5-5", "z".repeat(150)]) {
		for (const effort of ["off", "high"]) {
			for (const task of tasks) {
				const r = rec({ model, effort, task, activity: "Reading files" });
				const shortest = label.listMeta(r).at(-1)!;
				for (let w = 20; w <= 170; w++) {
					const out = render(r, w);
					assert.ok(visibleWidth(out) <= w, `${w}: ${out}`);
					if (w >= visibleWidth("○ swarm-worker") + 1 + visibleWidth(shortest) + 1 + 7)
						assert.ok(
							out.includes(`·${effort}]`) || out.includes(` ${effort}]`),
							`${w}/${model.length}/${task.length}: ${out}`,
						);
				}
			}
		}
	}
});

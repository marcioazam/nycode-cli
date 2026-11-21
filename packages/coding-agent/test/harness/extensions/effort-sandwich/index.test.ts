// Ported from import/ny-pi/extensions/effort-sandwich/index.test.ts (node:test -> vitest); env names are NYCODE_*.
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";
import ext, { levelFor } from "../../../../src/extensions/effort-sandwich/index.ts";

test("levelFor: high nos N primeiros turnos, nível inicial depois", () => {
	assert.equal(levelFor(0, "low", 2), "high");
	assert.equal(levelFor(1, "low", 2), "high");
	assert.equal(levelFor(2, "low", 2), "low");
	assert.equal(levelFor(9, "off", 2), "off");
});

test("levelFor: inicial >= high não muda nada", () => {
	for (const l of ["high", "xhigh", "max"]) {
		assert.equal(levelFor(0, l, 2), l);
		assert.equal(levelFor(5, l, 2), l);
	}
});

function setup(env: Record<string, string | undefined>, hasUI: boolean, initial: string, depth?: string) {
	const saved = { ...process.env };
	process.env.NYCODE_CODING_AGENT_DIR = mkdtempSync(join(tmpdir(), "effort-sandwich-"));
	Object.assign(process.env, env);
	if (depth === undefined) delete process.env.NYCODE_SUBAGENT_DEPTH;
	else process.env.NYCODE_SUBAGENT_DEPTH = depth;
	for (const k of Object.keys(env)) if (env[k] === undefined) delete process.env[k];
	let level = initial;
	const sets: string[] = [];
	const handlers: Record<string, (e: unknown, c: unknown) => unknown> = {};
	ext({
		on: (n: string, h: never) => {
			handlers[n] = h;
		},
		getThinkingLevel: () => level,
		setThinkingLevel: (l: string) => {
			level = l;
			sets.push(l);
		},
	} as never);
	const turn = (i: number) => handlers.turn_start?.({ turnIndex: i }, { hasUI });
	const restore = () => {
		process.env = saved;
	};
	return { turn, sets, restore, handlers };
}

test("sem a env (padrão desligado) ou com NYCODE_EFFORT_SANDWICH=0: nenhum handler registrado", () => {
	for (const v of [undefined, "0"]) {
		const s = setup({ NYCODE_EFFORT_SANDWICH: v }, false, "low");
		assert.deepEqual(Object.keys(s.handlers), []);
		s.restore();
	}
});

test("ligado com TURNS padrão, headless de topo: high só no turno 0, volta a medium no turno 1", () => {
	const s = setup({ NYCODE_EFFORT_SANDWICH: "1", NYCODE_EFFORT_SANDWICH_TURNS: undefined }, false, "medium");
	for (let i = 0; i < 4; i++) s.turn(i);
	assert.deepEqual(s.sets, ["high", "medium"]);
	s.restore();
});

test("TURNS=2: high nos turnos 0-1, volta a low no turno 2", () => {
	const s = setup({ NYCODE_EFFORT_SANDWICH: "1", NYCODE_EFFORT_SANDWICH_TURNS: "2" }, false, "low");
	for (let i = 0; i < 5; i++) s.turn(i);
	assert.deepEqual(s.sets, ["high", "low"]);
	s.restore();
});

test("NYCODE_EFFORT_SANDWICH_TURNS=3 segura high por 3 turnos", () => {
	const s = setup({ NYCODE_EFFORT_SANDWICH: "1", NYCODE_EFFORT_SANDWICH_TURNS: "3" }, false, "medium");
	s.turn(0);
	s.turn(2);
	assert.deepEqual(s.sets, ["high"]);
	s.turn(3);
	assert.deepEqual(s.sets, ["high", "medium"]);
	s.restore();
});

test("inicial já high: nunca chama setThinkingLevel", () => {
	const s = setup({ NYCODE_EFFORT_SANDWICH: "1" }, false, "xhigh");
	for (let i = 0; i < 4; i++) s.turn(i);
	assert.deepEqual(s.sets, []);
	s.restore();
});

test("com UI ou subagente: não faz nada", () => {
	const ui = setup({ NYCODE_EFFORT_SANDWICH: "1" }, true, "low");
	ui.turn(0);
	assert.deepEqual(ui.sets, []);
	ui.restore();
	const sub = setup({ NYCODE_EFFORT_SANDWICH: "1" }, false, "low", "1");
	sub.turn(0);
	assert.deepEqual(sub.sets, []);
	sub.restore();
});

test("NYCODE_EFFORT_SANDWICH_TURNS: padrão 1; inteiro positivo passa; resto cai no padrão", () => {
	const sets = (turns: string | undefined) => {
		const s = setup({ NYCODE_EFFORT_SANDWICH: "1", NYCODE_EFFORT_SANDWICH_TURNS: turns }, false, "low");
		for (let i = 0; i < 7; i++) s.turn(i);
		s.restore();
		return s.sets;
	};
	assert.deepEqual(sets("5"), ["high", "low"]);
	for (const v of [undefined, "0", "-1", "x", "1.5", ""]) assert.deepEqual(sets(v), ["high", "low"], String(v));
});

test("NYCODE_EFFORT_SANDWICH_TURNS=5 segura high por 5 turnos", () => {
	const s = setup({ NYCODE_EFFORT_SANDWICH: "1", NYCODE_EFFORT_SANDWICH_TURNS: "5" }, false, "low");
	s.turn(4);
	assert.deepEqual(s.sets, ["high"]);
	s.turn(5);
	assert.deepEqual(s.sets, ["high", "low"]);
	s.restore();
});

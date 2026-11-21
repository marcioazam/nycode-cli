// Port of the todo-active patch tests (pi-code 1.7.0) to vitest against the embedded source.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";
import { activeStep, PlanTimes } from "../../../../src/extensions/plan-mode/table.ts";

// Mesmo mapeamento de index.ts para os todos do evento pi-code:todos.
const asItems = (todos: Array<{ id: number; status: string }>) =>
	todos.map((t) => ({
		step: t.id,
		text: `t${t.id}`,
		completed: t.status === "completed",
		doing: t.status === "in_progress",
	}));

test("index.ts mapeia id e in_progress dos todos", () => {
	const src = readFileSync(new URL("../../../../src/extensions/plan-mode/index.ts", import.meta.url), "utf8");
	// Biome puts each field of the mapping on its own line, so the original `[^\n]*` becomes a lazy span.
	assert.match(src, /step: t\.id,[\s\S]*?doing: t\.status === "in_progress"/);
});

test("(a) activeStep é o todo em andamento, não o primeiro aberto", () => {
	const items = asItems([
		{ id: 3, status: "pending" },
		{ id: 5, status: "in_progress" },
		{ id: 9, status: "pending" },
	]);
	assert.deepEqual(
		items.map((i) => i.step),
		[3, 5, 9],
	);
	assert.equal(activeStep(items), 5);
});

test("(b) nenhum em andamento: activeStep indefinido", () => {
	assert.equal(
		activeStep(
			asItems([
				{ id: 3, status: "pending" },
				{ id: 5, status: "completed" },
			]),
		),
		undefined,
	);
});

test("(c) relógio do todo em andamento começa agora, mesmo após um concluído", () => {
	const t = new PlanTimes();
	t.observe(
		asItems([
			{ id: 2, status: "completed" },
			{ id: 3, status: "pending" },
			{ id: 5, status: "in_progress" },
		]),
		1000,
	);
	assert.equal(t.window(5, 1500)!.from, 1000);
	assert.equal(t.window(3, 1500), undefined);
});

test("(d) volta a pending: relógio descartado", () => {
	const t = new PlanTimes();
	t.observe(asItems([{ id: 5, status: "in_progress" }]), 1000);
	t.observe(asItems([{ id: 5, status: "pending" }]), 2000);
	assert.equal(t.window(5, 3000), undefined);
});

test("(e) modo plano (sem doing) inalterado", () => {
	const items = [
		{ step: 1, text: "a", completed: true },
		{ step: 2, text: "b", completed: false },
		{ step: 3, text: "c", completed: false },
	];
	assert.equal(activeStep(items), 2);
	const t = new PlanTimes();
	t.observe(
		items.map((i) => ({ ...i, completed: false })),
		1000,
	);
	t.observe(items, 2000);
	assert.equal(t.window(2, 2500)!.from, 2000);
	assert.equal(t.window(3, 2500), undefined);
});

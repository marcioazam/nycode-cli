// Ported from subagent-panel/fleet-ui.test.ts (pi-code patch tests); same cases and expectations.
// Testes do painel/viewer da frota (subagent/fleet-ui)
import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";
import { fleetTestEnv } from "../support/fleet-env.ts";
import { fakeCtx, fakeSource, K, NOW, rec, tagTheme, theme, tree3 } from "../support/fleet-ui-fixtures.ts";

fleetTestEnv("fleet-ui-test-");
const vm: any = await import("../../../../src/extensions/subagent/fleet-ui/view-model.ts");
const panel: any = await import("../../../../src/extensions/subagent/fleet-ui/panel.ts");
const viewer: any = await import("../../../../src/extensions/subagent/fleet-ui/viewer.ts");
const fleetUi: any = await import("../../../../src/extensions/subagent/fleet-ui/index.ts");
const palette: any = await import("../../../../src/extensions/subagent/fleet-ui/style/palette.ts");
await palette.ready;
const { visibleWidth }: any = await import("@nycode/tui");

const rowsOf = (records: any[], over: Record<string, unknown> = {}) =>
	vm.buildRows(records, { now: NOW, panel: true, ...over });
const ids = (rows: any[]) => rows.map((r) => r.id);

// ---- view model ----

afterEach(() => vi.useRealTimers());

test("visibilidade: running, done some, failed/cancelled 30 s, dispensado", () => {
	const records = [
		rec("r", null, 1),
		rec("d", null, 1, { state: "done", endedAt: NOW - 1 }),
		rec("f", null, 1, { state: "failed", endedAt: NOW - 29_000, error: "boom", startedAt: NOW - 59_000 }),
		rec("fold", null, 1, { state: "failed", endedAt: NOW - 30_001 }),
		rec("c", null, 1, { state: "cancelled", endedAt: NOW - 10, startedAt: NOW - 58_000 }),
	];
	// Siblings by startedAt ascending (ties fall back to the id).
	assert.deepEqual(ids(rowsOf(records)), ["r", "f", "c"]);
	assert.deepEqual(ids(rowsOf(records, { dismissed: new Set(["f"]) })), ["r", "c"]);
	assert.equal(rowsOf(records, { panel: false }).length, 5, "/tasks não esconde nada");
});

test("visibilidade: netos terminados só com o pai rodando; ancestrais ocultos escondem filhos", () => {
	const records = [
		rec("p", null, 1),
		rec("k-done", "p", 2, { state: "done", endedAt: NOW - 5 }),
		rec("k-run", "p", 2),
		rec("q", null, 1, { state: "failed", endedAt: NOW - 100 }),
		rec("qk", "q", 2, { state: "done", endedAt: NOW - 100 }),
		rec("h", null, 1, { state: "done", endedAt: NOW - 100 }),
		rec("hk", "h", 2),
	];
	assert.deepEqual(ids(rowsOf(records)), ["p", "k-done", "k-run", "q"]);
});

test("pai ausente pendura em main; irmãos por startedAt; ciclo não quebra", () => {
	const records = [
		rec("late", null, 1, { startedAt: NOW - 10 }),
		rec("orphan", "ghost", 2, { startedAt: NOW - 50 }),
		rec("self", "self", 1, { startedAt: NOW - 70 }),
	];
	const rows = rowsOf(records);
	assert.deepEqual(ids(rows), ["self", "orphan", "late"]);
	assert.equal(rows[1].depth, 1);
	assert.equal(rows[1].parentId, null);
	assert.equal(vm.finishedCount([rec("o", "ghost", 2, { state: "done", endedAt: NOW - 5 })], NOW), 1);
});

test("guias de uma árvore de 3 níveis com irmãos", () => {
	const rows = rowsOf(tree3());
	assert.deepEqual(
		rows.map((r: any) => [r.id, r.guides]),
		[
			["a", ""],
			["a1", "├─ "],
			["a1x", "│  ├─ "],
			["a1y", "│  └─ "],
			["a2", "└─ "],
			["a2x", "   └─ "],
			["b", ""],
		],
	);
});

test("colapso mostra (+N) e esconde descendentes; N conta visíveis", () => {
	const rows = rowsOf(tree3(), { collapsed: new Set(["a"]) });
	assert.deepEqual(ids(rows), ["a", "b"]);
	assert.equal(rows[0].hiddenDescendants, 5);
	assert.equal(rows[0].collapsed, true);
	assert.match(panel.renderRow(rows[0], false, theme, 80), /a-a \(\+5( · [●✕] \d+)*\)/);
	const inner = rowsOf(tree3(), { collapsed: new Set(["a1"]) });
	assert.equal(inner.find((r: any) => r.id === "a1").hiddenDescendants, 2);
	assert.equal(inner.find((r: any) => r.id === "a").hiddenDescendants, 0);
	// colapsar um nó sem filhos visíveis não marca nada
	assert.equal(rowsOf(tree3(), { collapsed: new Set(["b"]) }).at(-1).collapsed, false);
});

test("dica de terminados: só depth 1 done nos últimos 30 s", () => {
	const records = [
		rec("d1", null, 1, { state: "done", endedAt: NOW - 1000 }),
		rec("d2", null, 1, { state: "done", endedAt: NOW - 29_999 }),
		rec("old", null, 1, { state: "done", endedAt: NOW - 30_000 }),
		rec("f", null, 1, { state: "failed", endedAt: NOW - 1 }),
		rec("deep", "f", 2, { state: "done", endedAt: NOW - 1 }),
	];
	assert.equal(vm.finishedCount(records, NOW), 2);
	const view = { rows: [], focused: false, selectedId: null, hint: "", hintColor: "muted", running: 0, finished: 2 };
	assert.deepEqual(
		panel.renderPanel(view, theme, 80),
		[],
		"finished runs only: no footer line (the title summary counts them)",
	);
	assert.deepEqual(panel.renderPanel({ ...view, finished: 0 }, theme, 80), []);
});

test("newestRootFirst, elapsed e chainOf/neighbours", () => {
	const rows = rowsOf(tree3(), { panel: false, newestRootFirst: true });
	assert.equal(rows[0].id, "b");
	assert.equal(rows.find((r: any) => r.id === "a").elapsedMs, NOW - 1);
	const done = rowsOf([rec("z", null, 1, { state: "failed", endedAt: NOW - 20_000 })]);
	assert.equal(done[0].elapsedMs, 40_000);
	assert.deepEqual(
		vm.chainOf(tree3(), "a1x").map((r: any) => r.id),
		["a", "a1", "a1x"],
	);
	const n = vm.neighbours(tree3(), "a1");
	assert.deepEqual(
		[n.siblings.map((r: any) => r.id), n.children.map((r: any) => r.id), n.parent.id],
		[["a1", "a2"], ["a1x", "a1y"], "a"],
	);
	assert.deepEqual(vm.neighbours(tree3(), "nope"), { siblings: [], children: [] });
	assert.equal(vm.runningCount(rows), 7);
});

// ---- render ----

test("largura: nenhuma linha excede o width (20, 40, 80, 160)", () => {
	const records = [
		rec("a", null, 1, { activity: "x".repeat(120) }),
		rec("b", "a", 2, { activity: "Reading connect_target.rs tests and more", agent: "gateway-engineer" }),
		rec("c", "b", 3, { agent: "a-very-long-agent-name-here", cost: 0.001, tokens: { context: 2_500_000 } }),
		rec("d", null, 1, { state: "failed", endedAt: NOW - 1, error: "e".repeat(200) }),
		rec("e", null, 1, { state: "cancelled", endedAt: NOW - 1 }),
		rec("g", null, 1, { activity: undefined }),
	];
	const rows = rowsOf(records, { collapsed: new Set(["d"]) });
	for (const width of [20, 40, 80, 160]) {
		for (const selected of [false, true]) {
			for (const row of rows)
				assert.ok(visibleWidth(panel.renderRow(row, selected, tagTheme, width)) <= width, `${row.id}@${width}`);
		}
		const lines = panel.renderPanel(
			{ rows, focused: true, selectedId: "b", hint: "x".repeat(100), hintColor: "dim", running: 3, finished: 1 },
			tagTheme,
			width,
		);
		for (const l of lines) assert.ok(visibleWidth(l) <= width, `panel@${width}: ${l}`);
	}
});

test("largura curta descarta custo, depois tokens, depois atividade", () => {
	const row = rowsOf([rec("a", null, 1, { agent: "agent", activity: "Reading files" })])[0];
	const full = panel.renderRow(row, false, theme, 80);
	assert.match(full, /Reading files/);
	assert.match(full, /1m 0s \| 114\.4k tok \| {3}\$1\.23$/);
	assert.match(panel.renderRow(row, false, theme, 48), /1m 0s \| 114\.4k tok$/);
	assert.doesNotMatch(panel.renderRow(row, false, theme, 48), /\$/);
	const small = panel.renderRow(row, false, theme, 24);
	assert.match(small, /1m 0s$/);
	assert.doesNotMatch(small, /tok|Reading/);
	assert.equal(panel.formatCost(0.004), "<$0.01");
	assert.equal(panel.formatCost(12), "$12.00");
});

test("estilo por grau: glifo, selo, cores, estado sobrescreve atividade", () => {
	const records = [rec("a", null, 1), rec("b", "a", 2), rec("c", "b", 3), rec("d", "c", 4)];
	const [r1, r2, r3, r4] = rowsOf(records);
	const l1 = panel.renderRow(r1, false, tagTheme, 200);
	const l2 = panel.renderRow(r2, false, tagTheme, 200);
	const l3 = panel.renderRow(r3, false, tagTheme, 200);
	const l4 = panel.renderRow(r4, false, tagTheme, 200);
	assert.ok(l1.includes("<text>○</text>"));
	assert.ok(l1.includes("*<text>a-a</text>*") && l1.includes("<muted>Reading files"));
	assert.ok(
		l2.includes("<muted>◦</muted>") &&
			l2.includes("<muted>a-b</muted><dim>²</dim>") &&
			l2.includes("<dim>Reading files"),
	);
	assert.ok(l3.includes("<dim>·</dim>") && l3.includes("<dim>a-c</dim><dim>³</dim>"));
	assert.ok(l4.includes("⁴"));
	const sel = panel.renderRow(r1, true, tagTheme, 200);
	assert.ok(
		sel.startsWith("<accent>❯</accent> ") && sel.includes("<accent>a-a</accent>"),
		"column 0: the selection glyph replaces the state glyph, no gutter",
	);
	const fin = (state: string, extra = {}) =>
		panel.renderRow(
			rowsOf([rec("x", null, 1, { state, endedAt: NOW - 1, ...extra })], { panel: false })[0],
			false,
			tagTheme,
			200,
		);
	assert.ok(fin("done").includes("<success>✓ done</success>"));
	assert.ok(fin("failed", { error: "oops" }).includes("<error>✗ oops</error>"));
	assert.ok(fin("failed").includes("<error>✗ failed</error>"));
	assert.ok(fin("cancelled").includes("<warning>■ stopped</warning>"));
	assert.ok(fin("done").includes("<dim>a-x</dim>"));
	assert.equal(panel.superscript(12), "¹²");
});

test("painel: main focado/desfocado, janela de 10 linhas com … N more", () => {
	const records = Array.from({ length: 14 }, (_, i) => rec(`r${i}`, null, 1, { startedAt: i }));
	const rows = rowsOf(records);
	const base = {
		rows,
		focused: false,
		selectedId: null,
		hint: "14 running · ↓ to manage",
		hintColor: "muted",
		running: 14,
		finished: 0,
	};
	const idle = panel.renderPanel(base, theme, 100);
	assert.equal(idle.length, 1 + 10 + 1 + 1);
	assert.match(idle[0], /^● main +14 running · ↓ to manage$/);
	assert.equal(idle.at(-2), "… 4 more");
	assert.equal(idle.at(-1), "");
	const sel = panel.renderPanel({ ...base, focused: true, selectedId: "r13" }, theme, 100);
	assert.ok(sel.some((l: string) => l.startsWith("❯ a-r13")));
	assert.ok(!sel.some((l: string) => l.includes("a-r0 ")));
	assert.match(sel[0], /^○ main/);
	assert.ok(panel.renderPanel({ ...base, focused: true, selectedId: null }, theme, 100)[0].startsWith("❯ main"));
	assert.ok(
		idle.every((l: string) => !l.startsWith(" ")),
		"panel starts at column 0, aligned with the status line",
	);
	assert.ok(panel.renderPanel(base, theme, 8).every((l: string) => visibleWidth(l) <= 8));
});

// ---- controller ----

const OK = { editorText: "", editorFocused: true, overlayOpen: false };

function controllerOf(records: any[]) {
	const src = fakeSource(records);
	const clock = { now: NOW };
	const c = new panel.PanelController({ getSource: () => src, now: () => clock.now });
	return { c, src, clock };
}

test("controller: não entra sozinho com ↓ (a entrada é o título em section-nav); enterBody() dá o teclado à primeira linha; release ignorado", () => {
	const { c } = controllerOf([rec("a", null, 1), rec("b", "a", 2)]);
	assert.deepEqual(c.handleKey(K.down, OK), { consume: false }, "sem foco o controller não toma ↓");
	assert.equal(c.focused, false);
	assert.deepEqual(c.handleKey("\x1b[1;1:3B", OK), { consume: false }, "release");
	assert.deepEqual(c.handleKey("a", OK), { consume: false });
	assert.equal(c.enterBody(), true);
	assert.equal(c.focused, true);
	assert.equal(c.selectedId, "a");
	assert.deepEqual(c.handleKey(K.down, { ...OK, editorFocused: false }), { consume: false }, "foco alheio desfoca");
	assert.equal(c.focused, false);
	const empty = controllerOf([]);
	assert.equal(empty.c.enterBody(), false, "sem linhas não há corpo");
	const noSource = new panel.PanelController({ getSource: () => undefined, now: () => NOW });
	assert.deepEqual(noSource.rows(), []);
	assert.equal(noSource.view().finished, 0);
	assert.deepEqual(noSource.handleKey(K.ctrlB, OK), { consume: false });
});

test("controller: overlay e foco alheio desfocam sem consumir", () => {
	const { c } = controllerOf([rec("a", null, 1)]);
	c.enterBody();
	assert.equal(c.focused, true);
	assert.deepEqual(c.handleKey(K.down, { ...OK, overlayOpen: true }), { consume: false });
	assert.equal(c.focused, false);
	c.handleKey(K.down, OK);
	assert.deepEqual(c.handleKey(K.down, { ...OK, editorFocused: false }), { consume: false });
	assert.equal(c.focused, false);
});

test("controller: navegação, enter, esc, ↑ no main", () => {
	const { c } = controllerOf([rec("a", null, 1), rec("b", "a", 2), rec("z", null, 1, { startedAt: NOW })]);
	c.enterBody();
	c.handleKey(K.down, OK);
	assert.equal(c.selectedId, "b");
	assert.deepEqual(c.handleKey(K.enter, OK), { consume: true, action: { type: "open", id: "b" } });
	c.handleKey(K.down, OK);
	c.handleKey(K.down, OK);
	assert.equal(c.selectedId, "z", "down limitado ao fim");
	c.handleKey(K.up, OK);
	c.handleKey(K.up, OK);
	c.handleKey(K.up, OK);
	assert.equal(c.selectedId, null);
	assert.deepEqual(c.handleKey(K.enter, OK), { consume: true });
	assert.equal(c.focused, false, "enter no main volta ao prompt");
	c.enterBody();
	c.handleKey(K.up, OK);
	assert.equal(c.selectedId, null);
	assert.deepEqual(c.handleKey(K.up, OK), { consume: true });
	assert.equal(c.focused, false, "↑ acima do topo");
	c.enterBody();
	assert.deepEqual(c.handleKey(K.esc, OK), { consume: true });
	assert.equal(c.focused, false);
});

test("controller: → e ← expandem, recolhem e sobem ao pai", () => {
	const { c } = controllerOf(tree3());
	c.enterBody(); // a
	c.handleKey(K.left, OK); // recolhe
	assert.ok(c.collapsed.has("a"));
	assert.deepEqual(ids(c.rows()), ["a", "b"]);
	c.handleKey(K.right, OK); // expande
	assert.ok(!c.collapsed.has("a"));
	c.handleKey(K.right, OK); // já expandido: vai ao primeiro filho
	assert.equal(c.selectedId, "a1");
	c.handleKey(K.right, OK);
	assert.equal(c.selectedId, "a1x");
	c.handleKey(K.right, OK); // sem filhos: fica
	assert.equal(c.selectedId, "a1x");
	c.handleKey(K.left, OK);
	assert.equal(c.selectedId, "a1");
	c.handleKey(K.left, OK); // recolhe a1
	c.handleKey(K.left, OK); // a1 recolhido: sobe
	assert.equal(c.selectedId, "a");
	c.handleKey(K.left, OK);
	c.handleKey(K.left, OK);
	assert.equal(c.selectedId, null, "depth 1 sem filhos visíveis sobe ao main");
});

test("controller: x x para (arma por 2 s), expira, e dispensa terminado", () => {
	const { c, clock } = controllerOf([
		rec("a", null, 1),
		rec("f", null, 1, { state: "failed", endedAt: NOW - 1, startedAt: NOW - 5 }),
	]);
	c.enterBody();
	assert.deepEqual(c.handleKey("x", OK), { consume: true });
	assert.match(c.view().hint, /^press x again to stop a-a$/);
	clock.now += 1999;
	assert.deepEqual(c.handleKey("x", OK), { consume: true, action: { type: "stop", id: "a" } });
	assert.match(c.view().hint, /↑↓ select/, "desarma depois do stop");
	// expiração
	c.handleKey("x", OK);
	clock.now += 2500;
	assert.doesNotMatch(c.view().hint, /press x again/);
	assert.deepEqual(c.handleKey("x", OK), { consume: true }, "rearma, não para");
	// mover a seleção desarma
	c.handleKey(K.down, OK);
	assert.equal(c.selectedId, "f");
	assert.deepEqual(c.handleKey("x", OK), { consume: true, action: { type: "dismiss", id: "f" } });
	assert.ok(c.dismissed.has("f"));
	assert.equal(c.selectedId, "a", "seleção reparada para a linha restante");
	// x no main cai em "outra tecla"
	c.handleKey(K.up, OK);
	assert.deepEqual(c.handleKey("x", OK), { consume: false });
	assert.equal(c.focused, false);
});

test("controller: ctrl+b com e sem chamada em primeiro plano, em qualquer foco", () => {
	const { c, src } = controllerOf([rec("a", null, 1)]);
	assert.deepEqual(c.handleKey(K.ctrlB, OK), { consume: false });
	src.foreground = true;
	assert.deepEqual(c.handleKey(K.ctrlB, OK), { consume: true, action: { type: "detach" } });
	c.handleKey(K.down, OK);
	assert.deepEqual(c.handleKey(K.ctrlB, OK), { consume: true, action: { type: "detach" } });
});

test("controller: tecla imprimível desfoca sem consumir; linha que some é reparada", () => {
	const { c, src } = controllerOf([
		rec("a", null, 1),
		rec("b", null, 1, { startedAt: NOW - 1 }),
		rec("c", null, 1, { startedAt: NOW }),
	]);
	c.enterBody();
	assert.deepEqual(c.handleKey("h", OK), { consume: false });
	assert.equal(c.focused, false);
	c.enterBody();
	c.handleKey(K.down, OK);
	assert.equal(c.selectedId, "b");
	src.records = [src.records[0], src.records[2]]; // b some
	assert.deepEqual(c.handleKey(K.down, OK), { consume: true });
	assert.equal(c.selectedId, "c");
	src.records = [];
	c.view();
	assert.equal(c.focused, false, "sem linhas: desfoca");
	assert.equal(c.view().rows.length, 0);
});

test("executeAction: abrir, detach, stop com cada desfecho", () => {
	const src = fakeSource([rec("a", null, 1)]);
	const notes: Array<[string, string?]> = [];
	const opened: string[] = [];
	const env = {
		source: src,
		notify: (m: string, t?: string) => notes.push([m, t]),
		open: (id: string) => opened.push(id),
	};
	panel.executeAction({ type: "open", id: "a" }, env);
	panel.executeAction({ type: "detach" }, env);
	panel.executeAction({ type: "stop", id: "a" }, env);
	src.stopOutcome = "not-running";
	panel.executeAction({ type: "stop", id: "a" }, env);
	src.stopOutcome = "refused";
	panel.executeAction({ type: "stop", id: "a" }, env);
	src.stopOutcome = "unknown";
	panel.executeAction({ type: "stop", id: "gone" }, env);
	panel.executeAction({ type: "dismiss", id: "a" }, env);
	src.detachForeground = () => 0;
	panel.executeAction({ type: "detach" }, env);
	assert.deepEqual(opened, ["a"]);
	assert.equal(notes[0][0], "Moved 2 subagent call(s) to the background");
	assert.equal(notes[1][0], "Stopping a-a…");
	assert.match(notes[2][0], /not running/);
	assert.match(notes[3][0], /Could not stop/);
	assert.match(notes[4][0], /gone: run not found/);
	assert.equal(notes.length, 5);
});

// ---- viewer ----

test("/tasks: sem runs avisa; lista todos (sem esconder), enter abre o viewer e volta à lista", async () => {
	const empty = fakeCtx([]);
	await viewer.openTasksBrowser(empty.ctx, fakeSource([]));
	assert.deepEqual(empty.notes, [["Nenhum agente nesta sessão.", "info"]]);

	const records = [
		rec("a", null, 1, { startedAt: 1 }),
		rec("d", null, 1, { state: "done", endedAt: NOW, startedAt: 2 }),
	];
	const src = fakeSource(records);
	const { ctx, calls, comps } = fakeCtx([
		(c: any) => {
			// lista: desce e abre
			const lines = c.render(80);
			assert.equal(
				lines[0].replace(/\x1b\[[0-9;]*m/g, ""),
				"─".repeat(80),
				"régua no topo do overlay (HUD-colored)",
			);
			assert.match(lines[1], /Agentes \(2\)/);
			assert.match(lines[2], /a-d/, "raiz mais nova primeiro");
			c.handleInput("\x1b[1;1:3B");
			c.handleInput(K.down);
			c.handleInput(K.down);
			c.handleInput(K.up);
			c.handleInput(K.enter);
		},
		(c: any) => c.handleInput(K.esc), // viewer fecha
		(c: any) => c.handleInput(K.esc), // lista fecha
	]);
	await viewer.openTasksBrowser(ctx, src);
	assert.equal(comps.length, 3);
	assert.equal(comps[1].id, "d");
	assert.deepEqual(calls[0], {
		overlay: true,
		overlayOptions: { anchor: "bottom-center", width: "100%", maxHeight: "85%", margin: 0 },
	});
	assert.equal(viewer.overlays.open, 0);
});

test("TasksComponent: seleção limitada e timers soltos no dispose", () => {
	const src = fakeSource([rec("a", null, 1), rec("b", null, 1, { startedAt: NOW })]);
	let picked: any = "unset";
	const t = new viewer.TasksComponent({
		source: src,
		theme,
		done: (id: any) => {
			picked = id;
		},
		requestRender() {},
		rows: () => 20,
		now: () => NOW,
	});
	assert.equal(src.listeners.length, 1);
	t.handleInput(K.up);
	t.handleInput(K.enter);
	assert.equal(picked, "b");
	t.handleInput(K.down);
	t.handleInput(K.down);
	t.handleInput(K.enter);
	assert.equal(picked, "a");
	t.handleInput(K.esc);
	assert.equal(picked, undefined);
	t.invalidate();
	t.dispose();
	assert.equal(src.listeners.length, 0);
	const big = new viewer.TasksComponent({
		source: fakeSource(Array.from({ length: 40 }, (_, i) => rec(`r${i}`, null, 1))),
		theme,
		done() {},
		requestRender() {},
		rows: () => 20,
		now: () => NOW,
		selectedId: "r5",
		poll: false,
	});
	assert.ok(big.render(60).every((l: string) => visibleWidth(l) <= 60));
});

// ---- index ----

function fakePi() {
	const handlers: Record<string, (...a: any[]) => any> = {};
	return {
		handlers,
		pi: {
			on: (e: string, h: (...a: any[]) => any) => {
				handlers[e] = h;
			},
		} as any,
	};
}

function fakeUi(over: Record<string, unknown> = {}) {
	const rec2: any = { widgets: [] as any[], inputs: [] as any[], notes: [] as any[], editorText: "" };
	const tui = {
		requestRender: () => {
			rec2.renders = (rec2.renders ?? 0) + 1;
		},
		focusedComponent: undefined as any,
		terminal: { rows: 30 },
	};
	const ctx = {
		hasUI: true,
		ui: {
			setWidget: (key: string, content: any, options: any) => rec2.widgets.push({ key, content, options }),
			onTerminalInput: (h: any) => {
				rec2.inputs.push(h);
				return () => rec2.inputs.splice(rec2.inputs.indexOf(h), 1);
			},
			getEditorText: () => rec2.editorText,
			notify: (m: string, t: string) => rec2.notes.push([m, t]),
			custom: async () => undefined,
		},
		...over,
	};
	return { ctx: ctx as any, rec: rec2, tui };
}

test("registerFleetUi: widget abaixo do editor, teclas, sem UI/filho não registra, shutdown limpa", async () => {
	const src = fakeSource([rec("a", null, 1)]);
	const { pi, handlers } = fakePi();
	let source: any;
	const api = fleetUi.registerFleetUi(pi, () => source);
	const { ctx, rec: r, tui } = fakeUi();

	// sem UI e em processo filho: nada
	await handlers.session_start({}, { ...ctx, hasUI: false });
	process.env.NYCODE_SUBAGENT = "1";
	await handlers.session_start({}, ctx);
	delete process.env.NYCODE_SUBAGENT;
	assert.equal(r.widgets.length, 0);

	await handlers.session_start({}, ctx);
	assert.equal(r.widgets[0].key, "pi-code-fleet");
	assert.deepEqual(r.widgets[0].options, { placement: "belowEditor" });
	const comp = r.widgets[0].content(tui, theme);
	assert.deepEqual(comp.render(80), [], "sem source: nada");
	comp.invalidate();

	source = src; // aparece depois
	const out = comp.render(80).map((l: string) => l.replace(/\x1b\[[0-9;]*m/g, ""));
	assert.equal(out.length, 5, "blank spacing + tab bar + rule + main + row");
	assert.equal(out[0], "", "the group opens with a blank line");
	assert.match(out[1]!, /^Agentes \d+( +\d+\/\d+)?$/);
	assert.match(out[2]!, /^━+─*$/, "rule right below the tab bar, ━ under the open tab");
	assert.notEqual(out.at(-1), "", "the group does not end with a blank line");
	assert.equal(r.inputs.length, 1);
	assert.equal(r.inputs[0]("a"), undefined);
	assert.deepEqual(r.inputs[0](K.down), { consume: true });
	assert.ok(r.renders > 0);
	tui.focusedComponent = { render() {} }; // diálogo: não é o editor
	assert.equal(r.inputs[0](K.down), undefined);
	tui.focusedComponent = { getText() {}, setText() {} };
	r.inputs[0](K.down); // refoca: a aba aberta
	r.inputs[0](K.enter); // aba → corpo
	src.foreground = true;
	r.inputs[0](K.ctrlB);
	assert.deepEqual(r.notes.at(-1), ["Moved 2 subagent call(s) to the background", "info"]);
	r.editorText = "";
	r.inputs[0](K.enter); // open → ctx.ui.custom
	await new Promise((res) => setTimeout(res, 0)); // o overlay (flag) fecha
	r.inputs[0](K.esc); // corpo → aba
	src.records.push(rec("f", null, 1, { startedAt: NOW + 1 }));
	r.inputs[0](K.enter);
	r.inputs[0](K.down);
	r.inputs[0]("x");
	r.inputs[0]("x");
	assert.deepEqual(src.calls.stop, ["f"]);

	await handlers.session_shutdown();
	assert.equal(r.inputs.length, 0);
	assert.deepEqual(r.widgets.at(-1), { key: "pi-code-fleet", content: undefined, options: undefined });
	await handlers.session_shutdown(); // idempotente

	const { ctx: c2, rec: r2 } = fakeUi();
	await api.openTasks({ ...c2, hasUI: false });
	assert.deepEqual(r2.notes, []);
	await api.openTasks(c2);
	assert.deepEqual(r2.notes, []);
	source = undefined;
	await api.openTasks(c2);
	assert.deepEqual(r2.notes, [["No subagent runs in this session.", "info"]]);
});

test("registerFleetUi: o tick de 1 s assina um source que só aparece depois do session_start e repinta quando há linhas", async () => {
	vi.useFakeTimers({ toFake: ["setInterval"] });
	const { pi, handlers } = fakePi();
	const src = fakeSource([]);
	let source: any;
	fleetUi.registerFleetUi(pi, () => source);
	const { ctx, rec: r, tui } = fakeUi();
	try {
		await handlers.session_start({}, ctx);
		r.widgets[0].content(tui, theme); // guarda o tui que o render usa
		source = src;
		assert.equal(src.listeners.length, 0, "ainda não assinou");
		vi.advanceTimersByTime(1000);
		assert.equal(src.listeners.length, 1, "o tick assinou o source tardio");
		assert.equal(r.renders ?? 0, 0, "sem linhas o tick não repinta");
		src.listeners[0]();
		assert.equal(r.renders, 1, "a mudança do source repinta pela assinatura do tick");
		src.records.push(rec("a", null, 1));
		vi.advanceTimersByTime(1000);
		assert.equal(r.renders, 2, "com linhas o tick repinta");
		assert.equal(src.listeners.length, 1, "o mesmo source não é assinado de novo");
	} finally {
		await handlers.session_shutdown();
		vi.useRealTimers();
	}
	assert.equal(src.listeners.length, 0);
});

test("registerFleetUi: o main desenha estado, tempo, contexto e custo da sessão (só visual)", async () => {
	const { pi, handlers } = fakePi();
	const src = fakeSource([rec("a", null, 1)]);
	fleetUi.registerFleetUi(pi, () => src);
	const branch = [
		{ type: "message", message: { role: "user" } },
		{ type: "message", message: { role: "assistant", usage: { cost: { total: 1.5 } } } },
		{ type: "message", message: { role: "assistant", usage: { cost: { total: 0.25 } } } },
	];
	const {
		ctx,
		rec: r,
		tui,
	} = fakeUi({ sessionManager: { getBranch: () => branch }, getContextUsage: () => ({ tokens: 163_000 }) });
	// [0] is the blank spacing, [1] the tab bar, [2] its rule (interactive-display contract); the main line is [3]
	const lines = (): string =>
		r.widgets[0]
			.content(tui, theme)
			.render(120)[3]
			.replace(/\x1b\[[0-9;]*m/g, "");
	await handlers.session_start({}, ctx);
	assert.match(lines(), /main idle/);
	assert.match(lines(), /163\.0k tok \| +\$1\.75$/);
	assert.doesNotMatch(lines(), /\dm \d+s \|/, "ocioso: sem tempo de execução");
	handlers.agent_start();
	assert.match(lines(), /thinking…/);
	assert.match(lines(), /\d+s \| +163\.0k tok/);
	handlers.tool_execution_start();
	assert.match(lines(), /working/);
	handlers.turn_start();
	assert.match(lines(), /thinking…/, "novo turno volta a pensar");
	branch.push({ type: "message", message: { role: "assistant", usage: { cost: { total: 0.5 } } } });
	await handlers.turn_end({}, ctx);
	assert.match(lines(), /\$2\.25$/);
	await handlers.agent_settled({}, ctx);
	assert.match(lines(), /main idle/);
	const { ctx: bare } = fakeUi();
	await handlers.session_start({}, bare);
	assert.doesNotMatch(
		r.widgets[0]
			.content(tui, theme)
			.render(120)[3]
			.replace(/\x1b\[[0-9;]*m/g, ""),
		/tok/,
		"sem fonte de contexto/custo a coluna some em branco",
	);
});

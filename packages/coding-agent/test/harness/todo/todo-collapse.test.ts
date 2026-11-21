// Port of the todo-collapse patch tests (pi-code 1.7.0) to vitest against the embedded source. The widget and
// collapse cases are gone with the widget they tested (03 §2.3).
import assert from "node:assert/strict";
import { test } from "vitest";
import type { Todo } from "../../../src/extensions/todo/index.ts";
import todoExtension, * as mod from "../../../src/extensions/todo/index.ts";

const todo = (id: number, status: Todo["status"], text: string, activeForm?: string) => ({
	id,
	status,
	text,
	activeForm,
});

/** Starts the extension with a todo list replayed from a custom entry. */
function start(todos: object[]) {
	const handlers = new Map<string, (...a: any[]) => any>();
	const shortcuts = new Map<string, any>();
	const emitted: any[] = [];
	const nycode: any = new Proxy(
		{
			events: { emit: (c: string, d: any) => emitted.push([c, d]) },
			on: (n: string, h: any) => handlers.set(n, h),
			registerShortcut: (k: string, o: any) => shortcuts.set(k, o),
		},
		{ get: (t: any, k) => t[k] ?? (() => {}) },
	);
	todoExtension(nycode);
	const widgets: any[] = [];
	const ui = { setWidget: (key: string, factory: any) => widgets.push({ key, factory }) };
	const entries = todos.length ? [{ type: "custom", customType: "pi-code:todo", data: { todos, nextId: 9 } }] : [];
	const ctx: any = { hasUI: true, ui, sessionManager: { getBranch: () => entries } };
	handlers.get("session_start")!({}, ctx);
	return { shortcuts, widgets, emitted };
}

// The old chat widget rendered [] and, drawing no rows, could never receive a click or wheel event: it was removed
// (03 §2.3). The list reaches the Plan section only through the event.
test("o chat não registra widget nem atalho de todos; a lista vai ao Plan por evento", () => {
	const s = start([todo(1, "completed", "a"), todo(2, "in_progress", "b", "Doing b"), todo(3, "pending", "c")]);
	assert.equal(s.widgets.length, 0);
	assert.equal(s.shortcuts.size, 0);
	assert.deepEqual(s.emitted.at(-1), [
		"pi-code:todos",
		[
			{ id: 1, text: "a", status: "completed" },
			{ id: 2, text: "Doing b", status: "in_progress" },
			{ id: 3, text: "c", status: "pending" },
		],
	]);
});

// ---- cobertura do comportamento completo de todo.ts ----
const theme2: any = { fg: (c: string, t: string) => `<${c}>${t}</${c}>`, bold: (t: string) => `*${t}*` };
const dump = (c: any, w = 200) =>
	c
		.render(w)
		.map((l: string) => l.trimEnd())
		.join("\n");

function boot(entries: any[] = [], ctxOver: any = {}) {
	const handlers = new Map<string, (...a: any[]) => any>();
	const commands = new Map<string, any>();
	const appended: any[] = [];
	let tool: any;
	const nycode: any = {
		events: { emit() {} },
		on: (n: string, h: any) => handlers.set(n, h),
		registerShortcut: () => {},
		registerCommand: (n: string, c: any) => commands.set(n, c),
		registerTool: (t: any) => {
			tool = t;
		},
		appendEntry: (type: string, data: any) => appended.push({ type, data }),
	};
	todoExtension(nycode);
	const notes: any[] = [];
	const ui = {
		notify: (m: string, l: string) => notes.push([m, l]),
		custom: async (f: any) => f({}, theme2, {}, () => {}),
	};
	const ctx: any = { hasUI: true, mode: "tui", ui, sessionManager: { getBranch: () => entries }, ...ctxOver };
	return {
		handlers,
		commands,
		appended,
		tool,
		notes,
		ctx,
		ui,
		run: (p: any) => tool.execute("id", p, undefined, undefined, ctx),
		text: async (p: any) => (await tool.execute("id", p)).content[0].text,
	};
}
const snap = (todos: object[], nextId = 5) => ({ type: "custom", customType: "pi-code:todo", data: { todos, nextId } });

test("execute: add exige texto, atribui ids crescentes e persiste snapshot", async () => {
	const b = boot();
	const bad = await b.run({ action: "add" });
	assert.equal(bad.content[0].text, "Error: text required for add");
	assert.equal(bad.details.error, "text required for add");
	assert.equal(b.appended.length, 0);
	assert.equal(await b.text({ action: "add", text: "one", activeForm: "Doing one" }), "Added todo #1: one");
	assert.equal(await b.text({ action: "add", text: "two" }), "Added todo #2: two");
	assert.equal(b.appended.length, 2);
	assert.deepEqual(b.appended[1], {
		type: "pi-code:todo",
		data: { todos: [todo(1, "pending", "one", "Doing one"), todo(2, "pending", "two", undefined)], nextId: 3 },
	});
});

test("execute: start/complete/delete validam id e existência", async () => {
	const b = boot();
	await b.run({ action: "add", text: "a" });
	for (const action of ["start", "complete", "delete"]) {
		assert.equal(await b.text({ action }), `Error: id required for ${action}`);
		assert.equal(await b.text({ action, id: 99 }), "Error: #99 not found");
	}
	assert.equal(b.appended.length, 1); // falhas não persistem
});

test("execute: start rebaixa o in_progress anterior e grava activeForm", async () => {
	const b = boot();
	for (const t of ["a", "b", "c"]) await b.run({ action: "add", text: t });
	assert.equal(await b.text({ action: "start", id: 1 }), "Started #1: a");
	assert.equal(
		await b.text({ action: "start", id: 2, activeForm: "Doing b" }),
		"Started #2: b (moved #1 back to pending)",
	);
	const listed = (await b.run({ action: "list" })).details.todos;
	assert.deepEqual(
		listed.map((t: any) => t.status),
		["pending", "in_progress", "pending"],
	);
	assert.equal(listed[1].activeForm, "Doing b");
	// reiniciar o mesmo todo não o rebaixa
	assert.equal(await b.text({ action: "start", id: 2 }), "Started #2: b");
});

test("execute: complete, delete, list e clear (reinicia nextId)", async () => {
	const b = boot();
	for (const t of ["a", "b"]) await b.run({ action: "add", text: t });
	assert.equal(await b.text({ action: "complete", id: 1 }), "Completed #1: a");
	assert.equal(await b.text({ action: "list" }), "[x] #1: a\n[ ] #2: b");
	const n = b.appended.length;
	assert.equal(await b.text({ action: "delete", id: 2 }), "Deleted #2: b");
	await b.run({ action: "start", id: 1 });
	assert.equal(await b.text({ action: "list" }), "[>] #1: a");
	assert.equal(b.appended.length, n + 2); // list não persiste
	assert.equal(await b.text({ action: "clear" }), "Cleared 1 todos");
	assert.equal(await b.text({ action: "list" }), "No todos");
	assert.equal(await b.text({ action: "add", text: "z" }), "Added todo #1: z");
});

test("execute: ação desconhecida vira erro", async () => {
	const r = await boot().run({ action: "explode" });
	assert.equal(r.content[0].text, "Error: unknown action: explode");
});

test("o resultado carrega cópias: mutações posteriores não alteram detalhes antigos", async () => {
	const b = boot();
	const added = await b.run({ action: "add", text: "a" });
	await b.run({ action: "complete", id: 1 });
	assert.equal(added.details.todos[0].status, "pending");
});

test("renderCall mostra ação, id, texto e activeForm", () => {
	const b = boot();
	assert.equal(
		dump(b.tool.renderCall({ action: "start", id: 3, text: "x", activeForm: "Xing" }, theme2, {})),
		'<toolTitle>*todo *</toolTitle><muted>start</muted> <accent>#3</accent> <dim>"x"</dim> <dim>(Xing)</dim>',
	);
	assert.equal(
		dump(b.tool.renderCall({ action: "list" }, theme2, {})),
		"<toolTitle>*todo *</toolTitle><muted>list</muted>",
	);
});

test("renderResult: sem details, erro, mutação, start e list (curto/expandido/vazio)", () => {
	const b = boot();
	const r = (details: any, text = "msg", expanded = false) =>
		dump(b.tool.renderResult({ content: [{ type: "text", text }], details }, { expanded }, theme2, {}));
	assert.equal(r(undefined, "plain"), "plain");
	assert.equal(dump(b.tool.renderResult({ content: [], details: undefined }, { expanded: false }, theme2, {})), "");
	assert.equal(r({ action: "add", todos: [], nextId: 1, error: "bad" }), "<error>Error: bad</error>");
	assert.equal(r({ action: "add", todos: [], nextId: 1 }), "<muted>msg</muted>");
	assert.equal(
		r({ action: "start", todos: [], nextId: 1 }),
		"<accent>em andamento</accent><dim> · </dim><muted>msg</muted>",
	);
	assert.equal(
		r({ action: "complete", todos: [], nextId: 1 }),
		"<success>concluída</success><dim> · </dim><muted>msg</muted>",
	);
	assert.equal(r({ action: "list", todos: [], nextId: 1 }), "<dim>No todos</dim>");
	const many = Array.from({ length: 7 }, (_, i) => todo(i + 1, i === 0 ? "completed" : "pending", `t${i + 1}`));
	const short = r({ action: "list", todos: many, nextId: 8 }).split("\n");
	assert.equal(short[0], "<muted>7 todo(s):</muted>");
	assert.equal(short.length, 1 + 5 + 1);
	assert.equal(short[1], "<success>concluída   </success> <accent>#1</accent> <dim>t1</dim>");
	assert.equal(short.at(-1), "<dim>... 2 more</dim>");
	const full = r({ action: "list", todos: many, nextId: 8 }, "m", true).split("\n");
	assert.equal(full.length, 8);
	assert.ok(!full.join().includes("more"));
});

test("replay: snapshot do provedor, legado (done) e details vazios de chamada falha", () => {
	const legacyResult = (details: any) => ({
		type: "message",
		message: { role: "toolResult", toolName: "todo", details },
	});
	const b = boot([
		legacyResult({
			todos: [
				{ id: 1, text: "old", done: true },
				{ id: 2, text: "new" },
			],
			nextId: 3,
		}),
		legacyResult({}), // falha persistida como details: {}
		{ type: "message", message: { role: "user" } },
		{ type: "message", message: { role: "toolResult", toolName: "other", details: { todos: [], nextId: 1 } } },
	]);
	b.handlers.get("session_start")!({}, b.ctx);
	return b.run({ action: "list" }).then((r: any) => {
		assert.deepEqual(r.details.todos, [
			{ id: 1, status: "completed", text: "old" },
			{ id: 2, status: "pending", text: "new" },
		]);
		assert.equal(r.details.nextId, 3);
	});
});

test("replay: snapshot do provedor supera resultados legados posteriores", async () => {
	const legacy = {
		type: "message",
		message: {
			role: "toolResult",
			toolName: "todo",
			details: { todos: [{ id: 7, text: "legacy", status: "pending" }], nextId: 8 },
		},
	};
	const b = boot([snap([todo(1, "in_progress", "real", "Real")], 2), legacy]);
	b.handlers.get("session_start")!({}, b.ctx);
	assert.equal(await b.text({ action: "list" }), "[>] #1: real");
	assert.equal(await b.text({ action: "add", text: "n" }), "Added todo #2: n");
});

test("session_tree/session_compact refazem o replay; ctx obsoleto mantém o estado; outro erro propaga", async () => {
	let entries: any[] = [snap([todo(1, "pending", "a")])];
	const b = boot(entries);
	b.ctx.sessionManager.getBranch = () => entries;
	b.handlers.get("session_start")!({}, b.ctx);
	entries = [snap([todo(4, "pending", "tree")], 5)];
	b.handlers.get("session_tree")!({}, b.ctx);
	assert.equal(await b.text({ action: "list" }), "[ ] #4: tree");
	entries = [snap([todo(6, "pending", "compact")], 7)];
	b.handlers.get("session_compact")!({}, b.ctx);
	assert.equal(await b.text({ action: "list" }), "[ ] #6: compact");
	const stale = {
		...b.ctx,
		sessionManager: {
			getBranch: () => {
				throw new Error("ctx is stale after session replacement");
			},
		},
	};
	assert.doesNotThrow(() => b.handlers.get("session_tree")!({}, stale));
	assert.equal(await b.text({ action: "list" }), "[ ] #6: compact");
	const broken = {
		...b.ctx,
		sessionManager: {
			getBranch: () => {
				throw new Error("disk on fire");
			},
		},
	};
	assert.throws(() => b.handlers.get("session_compact")!({}, broken), /disk on fire/);
});

test("normalizeTodo: status explícito, done legado e padrão pending", () => {
	assert.deepEqual(
		mod.normalizeTodo({ id: 1, text: "a", status: "in_progress", activeForm: "A" }),
		todo(1, "in_progress", "a", "A"),
	);
	assert.deepEqual(mod.normalizeTodo({ id: 2, text: "b", done: true }), { id: 2, text: "b", status: "completed" });
	assert.deepEqual(mod.normalizeTodo({ id: 3, text: "c" }), { id: 3, text: "c", status: "pending" });
});

test("/todos: sem UI avisa erro; sem tui notifica a lista simples", async () => {
	const b = boot([snap([todo(1, "completed", "a"), todo(2, "pending", "b")])]);
	b.handlers.get("session_start")!({}, b.ctx);
	const h = b.commands.get("todos").handler;
	await h("", { ...b.ctx, hasUI: false });
	assert.deepEqual(b.notes, [["/todos requires interactive mode", "error"]]);
	b.notes.length = 0;
	await h("", { ...b.ctx, mode: "rpc" });
	assert.deepEqual(b.notes, [["[x] #1: a\n[ ] #2: b", "info"]]);
});

test("/todos em tui: componente lista, mostra vazio, cacheia por largura e fecha com Esc/Ctrl+C", async () => {
	const b = boot([snap([todo(1, "completed", "a"), todo(2, "in_progress", "b", "Doing b")])]);
	b.handlers.get("session_start")!({}, b.ctx);
	let comp: any;
	let closed = 0;
	b.ctx.ui.custom = async (f: any) => {
		comp = f({}, theme2, {}, () => closed++);
	};
	await b.commands.get("todos").handler("", b.ctx);
	const lines = comp.render(100);
	assert.ok(lines.includes("  <muted>1/2 completed</muted>"));
	assert.ok(lines.includes("  <success>concluída   </success> <accent>#1</accent> <dim>a</dim>"));
	assert.ok(lines.includes("  <accent>em andamento</accent> <accent>#2</accent> <text>b</text> <dim>(Doing b)</dim>"));
	assert.ok(lines.includes("  <dim>Press Escape to close</dim>"));
	assert.equal(comp.render(100), lines); // cache
	assert.notEqual(comp.render(40), lines);
	comp.invalidate();
	assert.notEqual(comp.render(100), lines);
	comp.handleInput("x");
	assert.equal(closed, 0);
	comp.handleInput("\x1b");
	comp.handleInput("\x03");
	assert.equal(closed, 2);

	const empty = boot();
	let ec: any;
	empty.ctx.ui.custom = async (f: any) => {
		ec = f({}, theme2, {}, () => {});
	};
	await empty.commands.get("todos").handler("", empty.ctx);
	assert.ok(ec.render(80).includes("  <dim>No todos yet. Ask the agent to add some!</dim>"));
});

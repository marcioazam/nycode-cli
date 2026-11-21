// Ported from subagent-panel/fleet-ui.test.ts (pi-code patch tests); same cases and expectations.
// Testes do viewer da frota (subagent/fleet-ui/viewer.ts): formatadores, render, rolagem, teclas e poll.
import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";
import { fleetTestEnv } from "../support/fleet-env.ts";
import { fakeSource, K, NOW, rec, tagTheme, theme, tree3 } from "../support/fleet-ui-fixtures.ts";

fleetTestEnv("fleet-viewer-test-");
const viewer: any = await import("../../../../src/extensions/subagent/fleet-ui/viewer.ts");
const palette: any = await import("../../../../src/extensions/subagent/fleet-ui/style/palette.ts");
await palette.ready;
const { visibleWidth }: any = await import("@nycode/tui");

afterEach(() => vi.useRealTimers());

test("formatadores do viewer: itens do transcript", () => {
	const f = (item: any, w = 40) => viewer.formatItem({ t: 0, ...item }, tagTheme, w);
	assert.deepEqual(f({ kind: "user", text: "oi" }), ["<accent>› oi</accent>"]);
	assert.deepEqual(f({ kind: "tool_call", text: "bash   ls\n-la" }), ["<muted>⏺ bash ls -la</muted>"]);
	assert.deepEqual(f({ kind: "note", text: "n" }), ["<dim>n</dim>"]);
	assert.deepEqual(f({ kind: "assistant", text: "" }), ["<text></text>"]);
	const wrapped = f({ kind: "assistant", text: "word ".repeat(20) });
	assert.ok(wrapped.length > 1 && wrapped.every((l: string) => visibleWidth(l) <= 40));
	assert.deepEqual(f({ kind: "tool_result", text: "a\nb\nc\nd\ne" }), [
		"<dim>  ⎿ a</dim>",
		"<dim>    b</dim>",
		"<dim>    c</dim>",
		"<dim>  … mais 2 linhas</dim>",
	]);
	assert.deepEqual(f({ kind: "tool_result", text: "bad", isError: true }), ["<error>  ⎿ bad</error>"]);
	assert.ok(f({ kind: "tool_result", text: "x".repeat(200) }, 20).every((l: string) => visibleWidth(l) <= 20));
});

test("formatadores do viewer: desfechos de envio, estado, breadcrumb e navegação", () => {
	assert.equal(viewer.sendOutcomeText("queued"), "↪ enviada; o agente lê depois do passo atual");
	assert.equal(viewer.sendOutcomeText("resumed"), "↪ retomado com a sua mensagem");
	assert.equal(viewer.sendOutcomeText("not-running"), "o agente já terminou; mensagem não enviada");
	assert.equal(viewer.sendOutcomeText("unknown"), "agente não encontrado");
	assert.deepEqual(["running", "done", "failed", "cancelled"].map(viewer.stateLabel), [
		"● rodando",
		"✓ concluído",
		"✗ falhou",
		"■ parado",
	]);
	assert.equal(viewer.breadcrumb(tree3(), "a1x"), "main › a-a › a-a1² › a-a1x³");
	assert.equal(viewer.breadcrumb(tree3(), "a"), "main › a-a");
	const header = (id: string) => viewer.headerLines(tree3(), id, NOW, theme, 200);
	assert.match(header("a1")[1], /ao lado: a-a2 · filhos: a-a1x, a-a1y$/);
	assert.match(header("a1x")[1], /ao lado: a-a1y$/);
	assert.doesNotMatch(header("a1x")[1], /filhos/);
});

function viewerOf(records: any[], transcripts: Record<string, any[]> = {}, rows = 20) {
	const src = fakeSource(records, transcripts);
	const clock = { now: NOW };
	const state = { closed: 0, renders: 0 };
	const v = new viewer.ViewerComponent({
		source: src,
		theme,
		id: records[0].id,
		done: () => state.closed++,
		requestRender: () => state.renders++,
		rows: () => rows,
		now: () => clock.now,
		poll: false,
	});
	return { v, src, clock, state };
}
const item = (kind: string, text: string, extra = {}) => ({ t: 0, kind, text, ...extra });

test("viewer: render com cabeçalho, nav, corpo, input e rodapé; largura respeitada", () => {
	const { v, src } = viewerOf(tree3(), {
		a: [item("user", "faça"), item("assistant", "ok"), item("tool_call", "bash ls"), item("tool_result", "1\n2")],
	});
	const lines = v.render(60);
	assert.equal(lines[0], "─".repeat(60), "régua no topo do overlay");
	assert.match(lines[1], /^main › a-a +● rodando · 16m 40s · 114\.4k tok · \$1\.23$/);
	assert.match(lines[2], /^ainda não informado · ainda não informado · ao lado: a-b/);
	assert.match(viewer.headerLines(tree3(), "a", NOW, theme, 200)[1], /ao lado: a-b · filhos: a-a1, a-a2$/);
	assert.ok(lines.includes("› faça") && lines.includes("⏺ bash ls") && lines.includes("  ⎿ 1"));
	assert.ok(lines.at(-1).startsWith("↑↓ rolar"));
	assert.ok(lines.every((l: string) => visibleWidth(l) <= 60));
	assert.equal(lines.at(-2), "❯ Mensagem para este agente");
	src.records = [];
	assert.match(v.render(60)[1], /main › \(agente não encontrado\)/);
});

test("viewer: leitura incremental, teto de 2000 itens e auto-follow / rolagem", () => {
	const many = Array.from({ length: 2100 }, (_, i) => item("note", `n${i}`));
	const { v, src } = viewerOf([rec("a", null, 1)], { a: many });
	assert.equal(v.items.length, 2000);
	assert.equal(v.items[0].text, "n100");
	const bottom = v.render(80);
	assert.ok(bottom.includes("n2099") && !bottom.includes("n100"));
	v.handleInput(K.up);
	v.handleInput(K.up);
	assert.ok(!v.render(80).includes("n2099"), "rolou para cima: não segue");
	src.transcripts.a.push(item("note", "novo"));
	v.refresh();
	assert.ok(!v.render(80).includes("novo"), "sem auto-follow enquanto rolado");
	v.handleInput(K.end);
	assert.ok(v.render(80).includes("novo"));
	v.handleInput(K.pgUp);
	v.handleInput(K.home);
	assert.ok(v.render(80).includes("n101"));
	v.handleInput(K.pgDn);
	v.handleInput(K.down);
	v.invalidate();
	assert.ok(v.render(40).length > 0);
});

test("viewer: ←/→ irmãos, tab filho, ⇧tab pai (depth 1 fecha), esc", () => {
	const { v, state } = viewerOf(tree3());
	v.handleInput(K.right);
	assert.equal(v.id, "b");
	v.handleInput(K.right);
	assert.equal(v.id, "b", "último irmão");
	v.handleInput(K.left);
	assert.equal(v.id, "a");
	v.handleInput(K.tab);
	assert.equal(v.id, "a1");
	v.handleInput(K.tab);
	assert.equal(v.id, "a1x");
	v.handleInput(K.tab);
	assert.equal(v.id, "a1x", "sem filhos");
	v.handleInput(K.shiftTab);
	assert.equal(v.id, "a1");
	v.handleInput(K.shiftTab);
	v.handleInput(K.shiftTab);
	assert.equal(state.closed, 1, "depth 1 fecha");
	v.handleInput(K.esc);
	assert.equal(state.closed, 2);
});

test("viewer: input, backspace, esc limpa antes de fechar, enter envia e mostra o desfecho", () => {
	const { v, src, state } = viewerOf([rec("a", null, 1)]);
	for (const ch of "olá") v.handleInput(ch);
	v.handleInput(K.bs);
	assert.equal(v.input, "ol");
	v.handleInput(K.left); // com texto, ←/→ não trocam de irmão
	v.handleInput("x"); // com texto, x é caractere
	assert.equal(v.input, "olx");
	v.handleInput(K.esc);
	assert.equal(v.input, "");
	assert.equal(state.closed, 0);
	v.handleInput("\x1b[120;1:3u"); // release
	v.handleInput("\x01"); // controle não vira texto
	assert.equal(v.input, "");
	v.handleInput("   ");
	v.handleInput(K.enter);
	assert.deepEqual(src.calls.send, [], "só espaços não envia");
	v.handleInput("pare");
	v.handleInput(K.enter);
	assert.deepEqual(src.calls.send, [["a", "pare"]]);
	assert.equal(v.input, "");
	assert.match(v.render(100).at(-3), /^↪ enviada; o agente lê depois/);
	for (const [out, text] of [
		["resumed", "↪ retomado com a sua mensagem"],
		["not-running", "o agente já terminou; mensagem não enviada"],
		["unknown", "agente não encontrado"],
	]) {
		src.sendOutcome = out;
		v.handleInput("m");
		v.handleInput(K.enter);
		assert.equal(v.render(100).at(-3), text);
	}
});

test("viewer: x x para em 2 s; expira; terminado é somente leitura", () => {
	const { v, src, clock } = viewerOf([rec("a", null, 1)]);
	v.handleInput("x");
	assert.equal(v.outcome, "");
	assert.equal(v.render(100).at(-1), "▲ x de novo para parar a-a · o trabalho em andamento se perde · esc fecha");
	clock.now += 2001;
	v.handleInput("x");
	assert.deepEqual(src.calls.stop, []);
	clock.now += 100;
	v.handleInput("x");
	assert.deepEqual(src.calls.stop, ["a"]);
	assert.equal(v.outcome, "Stopping a-a…");
	const done = viewerOf([rec("d", null, 1, { state: "done", endedAt: NOW })]);
	assert.equal(done.v.render(100).at(-3), "somente leitura: o agente já terminou");
	done.v.handleInput("x");
	assert.match(done.v.outcome, /o agente já terminou; nada a parar/);
	const bg = viewerOf([rec("bg", null, 1, { state: "done", endedAt: NOW, background: true })]);
	assert.equal(bg.v.render(100).at(-3), "");
	const gone = viewerOf([rec("g", null, 1)]);
	gone.src.records = [];
	gone.v.handleInput("x");
	assert.equal(gone.v.outcome, "agente não encontrado");
});

test("viewer: com poll liga timer e onChange, dispose solta", () => {
	const src = fakeSource([rec("a", null, 1)], { a: [item("note", "um")] });
	const v = new viewer.ViewerComponent({
		source: src,
		theme,
		id: "a",
		done() {},
		requestRender() {},
		rows: () => 20,
		now: () => NOW,
	});
	assert.equal(src.listeners.length, 1);
	src.transcripts.a.push(item("note", "dois"));
	src.listeners[0]();
	assert.equal(v.items.length, 2);
	v.dispose();
	assert.equal(src.listeners.length, 0);
	v.dispose();
});

// ---- /tasks ----

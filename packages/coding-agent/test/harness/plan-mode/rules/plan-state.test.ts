// Port of the plan-state patch tests (pi-code 1.7.0, docs/sync-observabilidade.md D1 to D7 and the pi-code:plan-state channel) to vitest.
import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { renderDoneTags } from "../../../../src/extensions/plan-mode/render/done-view.ts";
import { fakePi, type Loose } from "../support.ts";

vi.hoisted(() => {
	process.env.NO_COLOR = "1";
});

const PLAN3 =
	"Tier: T0 (teste)\n1. contar a.txt\n- wc -l a.txt\n2. contar b.txt\n- wc -l b.txt\n3. contar c.txt\n- wc -l c.txt";
const STATE = "pi-code:plan-state";
const say = (text: string) => ({ role: "assistant", content: [{ type: "text", text }] });
const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "").replace(/\s+/g, " ");

/** Uma instância da extensão com pi falso; `branch` é o que o gerenciador de sessão devolve (muda entre eventos). */
function boot(branch: Loose[] = []) {
	const fake = fakePi();
	const { pi, handlers: on, bus, cmds, tools, shortcuts, entries, emitted } = fake;
	let renders = 0;
	let component: Loose;
	const tui = { requestRender: () => void renders++, terminal: { rows: 40 } };
	const theme = { fg: (_c: string, s: string) => s, bold: (s: string) => s };
	const ctx: Loose = {
		hasUI: true,
		abort() {},
		isIdle: () => true,
		ui: {
			notify() {},
			setStatus() {},
			setWidget: (_k: string, f?: (t: unknown, th: unknown) => unknown) => {
				component = f?.(tui, theme);
			},
			select: async () => "Execute the plan (track progress)",
			editor: async () => "",
			input: async () => "",
			theme,
		},
		sessionManager: { getEntries: () => branch, getBranch: () => branch },
	};
	const fire = async (event: string, payload: unknown = {}) => {
		for (const h of on[event] ?? []) await h(payload, ctx);
	};
	const execute = async () => {
		await cmds.plan.handler("", ctx);
		await tools.plan_mode_complete.execute("id", { plan: PLAN3 });
		await fire("agent_end", { messages: [] });
	};
	const turn = (text: string) => fire("turn_end", { message: say(text) });
	const rows = (): string => strip((component?.render(200) ?? []).join("\n"));
	const plan = () => entries.filter((e) => e.customType === "plan-mode");
	const context = async () => JSON.stringify(await on.before_agent_start.at(-1)({}, ctx)) ?? "";
	return {
		pi,
		on,
		bus,
		cmds,
		tools,
		shortcuts,
		entries,
		emitted,
		ctx,
		fire,
		execute,
		turn,
		rows,
		plan,
		context,
		component: () => component,
		renders: () => renders,
	};
}

test("D1: turnos sem mudança não regravam o plano; marcar etapa grava uma vez; alternar o plan mode grava uma por mudança", async () => {
	const t = boot();
	await t.execute();
	const base = t.plan().length;
	await t.turn("trabalhando");
	await t.turn("ainda trabalhando");
	await t.turn("mais um turno");
	assert.equal(t.plan().length, base, "três turnos idênticos: nenhuma entrada nova");
	await t.turn("[DONE:1]");
	assert.equal(t.plan().length, base + 1);
	await t.turn("[DONE:1] de novo");
	assert.equal(t.plan().length, base + 1, "a mesma marca não regrava");
	const before = t.plan().length;
	await t.shortcuts[0].handler(t.ctx);
	await t.shortcuts[0].handler(t.ctx);
	assert.equal(t.plan().length, before + 2);
});

test("D1: depois de restaurar, o payload igual ao da entrada do ramo não é regravado", async () => {
	const first = boot();
	await first.execute();
	await first.turn("[DONE:1]");
	const saved = first.plan().at(-1)!;
	const t = boot([{ type: "custom", customType: "plan-mode", data: saved.data }]);
	await t.fire("session_start");
	await t.turn("sem tag");
	assert.equal(t.plan().length, 0);
});

test("D3: PLAN WAITING / PLAN BLOCKED aparecem na seção como em espera / bloqueado; novo prompt limpa", async () => {
	const t = boot();
	await t.execute();
	assert.match(t.rows(), /fazendo/);
	assert.doesNotMatch(t.rows(), /em espera/);
	await t.turn("lanes no ar\nPLAN WAITING: bg-1a2b3c rodando a revisão");
	assert.match(t.rows(), /em espera/);
	assert.doesNotMatch(t.rows(), /fazendo/);
	await t.fire("before_agent_start");
	assert.match(t.rows(), /fazendo/);
	assert.doesNotMatch(t.rows(), /em espera/);
	await t.turn("PLAN BLOCKED: preciso da sua decisão");
	assert.match(t.rows(), /bloqueado/);
	assert.doesNotMatch(t.rows(), /fazendo/);
	await t.turn("texto citando PLAN WAITING: no meio da frase");
	assert.doesNotMatch(t.rows(), /em espera/, "citação no meio da frase não conta");
});

test("D3: o bloco de chat reconhece fg-<id> além de bg-<id>", () => {
	const steps = [{ step: 1, text: "revisar" }];
	assert.match(renderDoneTags("PLAN WAITING: fg-ab12cd34 duas faixas", steps), /segundo plano · fg-ab12cd34/);
	assert.match(renderDoneTags("PLAN WAITING: bg-0f1e2d duas faixas", steps), /segundo plano · bg-0f1e2d/);
});

test("D4: durante a execução o rodapé mostra todo d/t e o item em andamento", async () => {
	const t = boot();
	await t.execute();
	assert.doesNotMatch(t.rows(), /todo \d+\/\d+/);
	t.pi.events.emit("pi-code:todos", [
		{ id: 1, text: "a", status: "completed" },
		{ id: 2, text: "Rodando o gate", status: "in_progress" },
		{ id: 3, text: "c", status: "pending" },
	]);
	assert.match(t.rows(), /todo 1\/3 · Rodando o gate/);
	t.pi.events.emit("pi-code:todos", []);
	assert.doesNotMatch(t.rows(), /todo \d+\/\d+/);
});

test("D6: session_tree para um ramo sem o plano desliga a execução (nenhum [EXECUTING PLAN])", async () => {
	const todos = [
		{ step: 1, text: "a", completed: false },
		{ step: 2, text: "b", completed: false },
	];
	const branch: Loose[] = [
		{ type: "custom", customType: "plan-mode", data: { enabled: false, executing: true, todos, savedTools: [] } },
	];
	const t = boot(branch);
	await t.fire("session_start");
	assert.match(await t.context(), /EXECUTING PLAN/);
	branch.length = 0;
	await t.fire("session_tree");
	assert.doesNotMatch(await t.context(), /EXECUTING PLAN/);
	assert.deepEqual(t.emitted.filter(([c]) => c === STATE).at(-1)?.[1], { executing: false, done: 0, total: 0 });
});

test('D7: marca skipped e pausa sobrevivem a uma nova instância + session_start; o tempo vira "desde a retomada"', async () => {
	const first = boot();
	await first.execute();
	const comp = first.component();
	comp.handleInput("s"); // pula a etapa 1 (cursor inicial)
	await new Promise((r) => setTimeout(r, 5));
	comp.handleInput("p"); // pausa
	const saved = first.plan().at(-1)!.data;
	assert.deepEqual(
		saved.marks?.map((m: Loose) => [m[0], m[1].status]),
		[[1, "skipped"]],
	);
	assert.equal(saved.paused, true);

	const t = boot([{ type: "custom", customType: "plan-mode", data: JSON.parse(JSON.stringify(saved)) }]);
	await t.fire("session_start");
	assert.match(t.rows(), /pulado/);
	assert.match(t.rows(), /pausado/);
	assert.match(t.rows(), /desde a retomada/);
	assert.equal(t.plan().length, 0, "restaurar não regrava o que já está no ramo");
});

test("canal pi-code:plan-state: {executing, step, done, total}, só quando o estado muda", async () => {
	const t = boot();
	await t.execute();
	const states = () => t.emitted.filter(([c]) => c === STATE).map(([, d]) => d);
	assert.deepEqual(states().at(-1), { executing: true, step: 1, done: 0, total: 3 });
	const n = states().length;
	await t.turn("sem tag");
	assert.equal(states().length, n, "sem mudança, sem evento");
	await t.turn("[DONE:1]");
	assert.deepEqual(states().at(-1), { executing: true, step: 2, done: 1, total: 3 });
	await t.turn("[DONE:2] [DONE:3]");
	await t.fire("agent_end", { messages: [{ ...say("fim"), stopReason: "stop" }] });
	assert.deepEqual(states().at(-1), { executing: false, done: 0, total: 0 });
});

/** Fonte falsa do fleet no slot de globalThis que `fleetSourceForUi()` lê. */
function fakeFleet(initial: Loose[]) {
	let list = initial;
	const subs = new Set<() => void>();
	const slot = Symbol.for("pi-code.fleet.source");
	(globalThis as Record<symbol, unknown>)[slot] = {
		source: {
			list: () => list,
			onChange: (cb: () => void) => {
				subs.add(cb);
				return () => subs.delete(cb);
			},
		},
	};
	return {
		set: (l: Loose[]) => {
			list = l;
			for (const cb of [...subs]) cb();
		},
		off: () => delete (globalThis as Record<symbol, unknown>)[slot],
	};
}
const lane = (over: Loose) => ({ id: "fg-1", agent: "swarm-worker", state: "running", depth: 1, ...over });

test("D13: a linha da etapa em andamento mostra `· agente estado` das faixas com planStep === step e running; onChange redesenha", async () => {
	const fleet = fakeFleet([lane({ planStep: 2 }), lane({ id: "fg-2", agent: "outro", planStep: 1, state: "done" })]);
	try {
		const t = boot();
		await t.execute();
		assert.doesNotMatch(t.rows(), /swarm-worker/, "planStep 2 não é a etapa em andamento (1)");
		assert.doesNotMatch(t.rows(), /outro/, "faixa concluída não aparece");
		await t.turn("[DONE:1]");
		assert.match(t.rows(), /contar b\.txt · swarm-worker running/i);
		const n = t.renders();
		fleet.set([lane({ planStep: 2, state: "done" })]);
		assert.ok(t.renders() > n, "a mudança do fleet pede redesenho");
		assert.doesNotMatch(t.rows(), /swarm-worker/);
	} finally {
		fleet.off();
	}
});

test("D13: sem planStep ou sem fonte do fleet o resultado é o de hoje", async () => {
	const fleet = fakeFleet([lane({})]);
	try {
		const t = boot();
		await t.execute();
		assert.doesNotMatch(t.rows(), /swarm-worker/);
	} finally {
		fleet.off();
	}
	const t = boot();
	await t.execute();
	assert.match(t.rows(), /contar a\.txt/i);
});

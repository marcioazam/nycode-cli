// Port of the plan-no-interrupt patch test (pi-code 1.7.0) to vitest against the embedded source.
// Contrato do dono (2026-11-15): só o fim do plano ou um pedido explícito ao LLM (PLAN CANCELLED) encerra o plan mode.
import assert from "node:assert/strict";
import { test } from "vitest";
import { assistant, fakeCtx, fakePi, fakeUi, type Loose, PLAN } from "../support.ts";

/** Sobe a extensão em plan mode; `select` registra cada abertura do menu. */
async function setup(selectImpl?: () => Promise<string | undefined>) {
	const fake = fakePi({ allTools: ["read", "bash", "edit", "plan_mode_complete"] });
	const { on, cmds, tools, sent, entries } = fake;
	const selects: string[] = [];
	const notes: string[] = [];
	const ui = fakeUi({
		notify: (t: string) => notes.push(t),
		select: async (title: string) => {
			selects.push(title);
			return selectImpl ? selectImpl() : "Stay in plan mode";
		},
	});
	const ctx: Loose = fakeCtx({ ui });
	await cmds.plan.handler("", ctx);
	const planOn = () => entries.filter((e) => e.customType === "plan-mode").at(-1)?.data.enabled === true;
	return { on, tools, ctx, sent, selects, notes, planOn, active: fake.active };
}

const submit = (s: Awaited<ReturnType<typeof setup>>) => s.tools.plan_mode_complete.execute("id", { plan: PLAN });

test("Esc na fase de plano: sem menu, plan mode continua", async () => {
	const s = await setup();
	await s.on.agent_end({ messages: [assistant("parcial", "aborted")] }, s.ctx);
	assert.deepEqual(s.selects, []);
	assert.equal(s.planOn(), true);
});

test("Esc depois de plan_mode_complete: sem menu", async () => {
	const s = await setup();
	await submit(s);
	await s.on.agent_end({ messages: [assistant("x", "aborted")] }, s.ctx);
	assert.deepEqual(s.selects, []);
	assert.equal(s.planOn(), true);
});

test("run sem plan_mode_complete (só pergunta ou prosa com lista): sem menu nem lista de passos", async () => {
	const s = await setup();
	await s.on.agent_end({ messages: [assistant("Plan:\n1. fazer a\n2. fazer b\nQual formato prefere?")] }, s.ctx);
	assert.deepEqual(s.selects, []);
	assert.deepEqual(
		s.sent.filter((m) => m.customType === "plan-todo-list"),
		[],
	);
	assert.equal(s.planOn(), true);
});

test("plan_mode_complete aceito + run normal: o menu aparece", async () => {
	const s = await setup();
	await submit(s);
	await s.on.agent_end({ messages: [assistant("plano enviado")] }, s.ctx);
	assert.deepEqual(s.selects, ["Plan mode - what next?"]);
});

test("agent_end não fica preso no menu quando o run foi abortado", async () => {
	const s = await setup(() => new Promise(() => {})); // menu que nunca responde
	await submit(s);
	const done = await Promise.race([
		s.on.agent_end({ messages: [assistant("x", "aborted")] }, s.ctx).then(() => "resolved"),
		new Promise((r) => setTimeout(() => r("stuck"), 200)),
	]);
	assert.equal(done, "resolved");
	assert.deepEqual(s.selects, []);
});

test("PLAN CANCELLED na fase de plano: plan mode desliga, restaura ferramentas e notifica", async () => {
	const s = await setup();
	await s.on.agent_end({ messages: [assistant("Certo, saindo.\nPLAN CANCELLED")] }, s.ctx);
	assert.equal(s.planOn(), false);
	assert.ok(s.active().includes("edit"));
	assert.ok(s.notes.some((n) => /disabled/i.test(n)));
	assert.deepEqual(s.selects, []);
});

test("PLANO CANCELADO no meio de uma frase não cancela", async () => {
	const s = await setup();
	await s.on.agent_end({ messages: [assistant("Se quiser, escreva PLANO CANCELADO para sair.")] }, s.ctx);
	assert.equal(s.planOn(), true);
});

test("contexto do plan mode ensina PLAN CANCELLED só a pedido explícito", async () => {
	const s = await setup();
	const r = s.on.before_agent_start({}, s.ctx);
	assert.match(r.message.content, /PLAN CANCELLED/);
	assert.match(r.message.content, /explicitly/i);
});

async function executing() {
	const s = await setup(async () => "Execute the plan (track progress)");
	await submit(s);
	await s.on.agent_end({ messages: [assistant("ok")] }, s.ctx);
	const ended = () => s.sent.filter((m) => ["plan-complete", "plan-stalled", "plan-cancelled"].includes(m.customType));
	return { ...s, ended };
}

test("execução com várias runs sem [DONE] continua executando", async () => {
	const e = await executing();
	for (let i = 0; i < 6; i++) await e.on.agent_end({ messages: [assistant("só conversei")] }, e.ctx);
	assert.deepEqual(e.ended(), []);
	const ctxMsg = e.on.before_agent_start({}, e.ctx);
	assert.match(ctxMsg.message.content, /EXECUTING PLAN/);
	assert.match(ctxMsg.message.content, /PLAN CANCELLED/);
});

test("PLAN CANCELLED na execução: encerra como plan-cancelled com os passos não feitos", async () => {
	const e = await executing();
	await e.on.agent_end({ messages: [assistant("Cancelado a seu pedido.\nPLAN CANCELLED")] }, e.ctx);
	assert.equal(e.ended().length, 1);
	assert.equal(e.ended()[0].customType, "plan-cancelled");
	assert.match(e.ended()[0].content, /1\. contar a\.txt[\s\S]*2\. contar b\.txt/i);
});

test("execução: todos [DONE] encerra como plan-complete", async () => {
	const e = await executing();
	const done = assistant("feito [DONE:1] [DONE:2]");
	await e.on.turn_end({ message: done }, e.ctx);
	await e.on.agent_end({ messages: [done] }, e.ctx);
	assert.equal(e.ended().length, 1);
	assert.equal(e.ended()[0].customType, "plan-complete");
});

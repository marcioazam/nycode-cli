// Port of the plan-stalled patch test (pi-code 1.7.0) to vitest against the embedded source.
// Superado em parte em 2026-11-15 (plan-no-interrupt): sem encerramento por runs paradas.
// Pedido do dono (2026-11-14): interromper um turno encerrava a execução do plano e a mensagem saía como [plan-complete].
import assert from "node:assert/strict";
import { test } from "vitest";
import { assistant, fakeCtx, fakePi, type Loose, startExecution } from "../support.ts";

/** Sobe a extensão e entra em execução de um plano de 2 etapas. */
async function executing() {
	const fake = fakePi();
	const ctx = fakeCtx();
	await startExecution(fake, ctx);
	const ended = () =>
		fake.sent.filter((m: Loose) => m.customType === "plan-complete" || m.customType === "plan-stalled");
	return { on: fake.on, ctx, ended, assistant };
}

test("turno interrompido pelo usuário não conta como turno sem progresso", async () => {
	const { on, ctx, ended, assistant } = await executing();
	for (let i = 0; i < 4; i++) await on.agent_end({ messages: [assistant("parcial", "aborted")] }, ctx);
	assert.deepEqual(ended(), []);
});

// Contrato 2026-11-15 (revoga o limite de 2 runs): run sem progresso nunca encerra o plano.
test("execução parada sem progresso continua ativa: nem plan-stalled nem plan-complete", async () => {
	const { on, ctx, ended, assistant } = await executing();
	await on.agent_end({ messages: [assistant("nada")] }, ctx);
	await on.agent_end({ messages: [assistant("interrompido", "aborted")] }, ctx);
	for (let i = 0; i < 5; i++) await on.agent_end({ messages: [assistant("nada")] }, ctx);
	assert.deepEqual(ended(), []);
});

test("plano concluído continua saindo como plan-complete", async () => {
	const { on, ctx, ended, assistant } = await executing();
	const done = assistant("feito [DONE:1] [DONE:2]");
	await on.turn_end({ message: done }, ctx);
	await on.agent_end({ messages: [done] }, ctx);
	assert.equal(ended().length, 1);
	assert.equal(ended()[0].customType, "plan-complete");
	assert.match(ended()[0].content, /Plan Complete/);
});

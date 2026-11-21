// Port of the plan-cache-keep patch test (pi-code 1.7.0) to vitest against the embedded source.
// Bug (2026-11-14): ao sair do modo plano um handler `context` removia as notas [PLAN MODE ACTIVE] do
// histórico; o pi então reenviava prompt e ferramentas como cabeçalho novo e o cache de prompt era perdido
// (0 de 35,7k tokens lidos). Agora nada é removido e a saída acrescenta uma nota [PLAN MODE ENDED].
import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { fakePi, type Loose } from "../support.ts";

vi.hoisted(() => {
	process.env.NO_COLOR = "1";
});

function load() {
	const fake = fakePi({ active: ["read", "bash", "edit", "write"], flag: false });
	const theme = { fg: (_c: string, t: string) => t, bold: (t: string) => t };
	const ctx: Loose = {
		hasUI: true,
		isIdle: () => true,
		sessionManager: { getSessionId: () => "abcdef0123456789" },
		ui: { theme, notify() {}, setStatus() {}, setWidget() {} },
	};
	return {
		handlers: fake.handlers,
		sent: fake.sent as Array<{ customType: string; content: string }>,
		toggle: () => fake.shortcuts[0].handler(ctx) as Promise<void>,
		tools: () => fake.active(),
	};
}

test("nenhum handler context: o histórico não é reescrito ao sair do modo plano", () => {
	assert.equal(load().handlers.context, undefined);
});

test("sair do modo plano acrescenta a nota [PLAN MODE ENDED] e devolve as ferramentas", async () => {
	const s = load();
	await s.toggle();
	assert.deepEqual(s.tools(), ["read", "bash", "write", "edit"]);
	assert.equal(s.sent.length, 0);
	await s.toggle();
	assert.deepEqual(s.tools(), ["read", "bash", "edit", "write"]);
	assert.deepEqual(
		s.sent.map((m) => m.customType),
		["plan-mode-ended"],
	);
	assert.match(s.sent[0]!.content, /^\[PLAN MODE ENDED\].*no longer apply/);
});

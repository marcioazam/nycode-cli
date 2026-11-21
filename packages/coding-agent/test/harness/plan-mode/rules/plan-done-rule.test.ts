// Port of the plan-done-rule patch test (pi-code 1.7.0) to vitest against the embedded source.
import assert from "node:assert/strict";
import { test } from "vitest";
import { fakeCtx, fakePi, type Loose, PLAN } from "../support.ts";

test("execução do plano: a mensagem inicial e o contexto de cada turno exigem a tag literal [DONE:n]", async () => {
	const fake = fakePi({ active: ["read", "bash", "edit", "plan_mode_complete"] });
	const { cmds, tools, on, sent } = fake;
	const ctx = fakeCtx();
	await cmds.plan.handler("", ctx);
	await tools.plan_mode_complete.execute("id", { plan: PLAN });
	await on.agent_end({ messages: [] }, ctx);
	const exec = sent.find((m: Loose) => m.customType === "plan-mode-execute");
	assert.match(exec.content, /Start with: contar a\.txt\n.*literal tag \[DONE:n\]/i);
	const injected = JSON.stringify(await on.before_agent_start({}, ctx));
	assert.match(injected, /literal tag \[DONE:n\].*not prose or checkboxes/);
	// D5 (docs/sync-observabilidade.md): a regra também liga a caixa de `## Progresso` do registro à mesma resposta da tag.
	assert.match(exec.content, /tick box n under `## Progresso`/);
	assert.match(injected, /tick box n under `## Progresso`/);
	// D14 (docs/sync-observabilidade.md): a tag só conta na resposta final do turno (sem chamada de ferramenta).
	for (const t of [exec.content, injected])
		assert.match(t, /final reply of the turn \(the message without a tool call\)/);
	assert.match(injected, /repeat the tag in the final reply/);
	const rule = /^When you finish step n.*$/m.exec(exec.content)![0];
	assert.ok(rule.split(/\s+/).length < 60, `DONE_RULE com ${rule.split(/\s+/).length} palavras`);
});

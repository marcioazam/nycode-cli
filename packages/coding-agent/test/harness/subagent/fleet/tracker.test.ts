// Ported from zzzzzzz-subagent-model-effort/tracker.test.ts (pi-code patch tests); same cases and expectations.
// Modelo e esforço no registro da frota (docs/subagent-model-effort.md, AC3-AC6)
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "vitest";
import { fleetTestEnv } from "../support/fleet-env.ts";

const SRC = join(import.meta.dirname, "../../../../src/extensions/subagent");
fleetTestEnv("fleet-model-effort-");
const store: any = await import("../../../../src/extensions/subagent/fleet/store.ts");
const trackerMod: any = await import("../../../../src/extensions/subagent/fleet/tracker.ts");
const childMod: any = await import("../../../../src/extensions/subagent/core/child.ts");

const id = (n: number): string => `fg-${n.toString(16).padStart(8, "0")}`;
const line = (ev: unknown): string => JSON.stringify(ev);
function mainFleet(): string {
	delete process.env.NYCODE_SUBAGENT_DEPTH;
	delete process.env.NYCODE_SUBAGENT;
	return store.ensureFleetDir();
}
const start = (opts: Record<string, unknown>, n: number) => {
	const dir = mainFleet();
	const tr = trackerMod.startTracking({ id: id(n), agent: "swarm-worker", task: "t", background: false, ...opts });
	const read = () => {
		tr.flush(true);
		return JSON.parse(readFileSync(join(dir, `${id(n)}.json`), "utf8"));
	};
	return { tr, read, dir };
};

test("configuredRuntime: lê o argv real (modelo com sufixo, --thinking, sem nada, sufixo que não é nível)", () => {
	const c = trackerMod.configuredRuntime;
	assert.deepEqual(c(["--mode", "json", "--model", "anthropic/claude-sonnet-5-5:medium", "--tools", "read"]), {
		model: "anthropic/claude-sonnet-5-5",
		effort: "medium",
	});
	assert.deepEqual(c(["--model", "m", "--thinking", "off"]), { model: "m", effort: "off" });
	assert.deepEqual(c(["--thinking", "high"]), { effort: "high" });
	assert.deepEqual(c(["--model", "m:off"]), { model: "m", effort: "off" });
	assert.deepEqual(c(["--model", "openrouter/x:free"]), { model: "openrouter/x:free" });
	assert.deepEqual(c(["--mode", "json", "-p"]), {});
	assert.deepEqual(c(["--model"]), {});
});

test("configuredRuntime acompanha agentInvocationArgs: agent.model, alias e CLAUDE_CODE_SUBAGENT_MODEL", () => {
	const c = trackerMod.configuredRuntime;
	const base = { name: "w", description: "d", systemPrompt: "", source: "user" };
	assert.deepEqual(c(childMod.agentInvocationArgs({ ...base, model: "a/b", effort: "low" })), {
		model: "a/b",
		effort: "low",
	});
	assert.deepEqual(c(childMod.agentInvocationArgs({ ...base }, "anthropic/alias-resolved")), {
		model: "anthropic/alias-resolved",
	});
	const saved = process.env.CLAUDE_CODE_SUBAGENT_MODEL;
	process.env.CLAUDE_CODE_SUBAGENT_MODEL = "env/model";
	try {
		assert.deepEqual(
			c(childMod.agentInvocationArgs({ ...base })),
			{ model: "env/model" },
			"sem effort: desconhecido, não herdado",
		);
	} finally {
		if (saved === undefined) delete process.env.CLAUDE_CODE_SUBAGENT_MODEL;
		else process.env.CLAUDE_CODE_SUBAGENT_MODEL = saved;
	}
});

test("tracker: configurado explícito fica no registro como não observado", () => {
	const { read } = start({ model: "anthropic/claude-sonnet-5-5", effort: "medium" }, 1);
	const rec = read();
	assert.equal(rec.model, "anthropic/claude-sonnet-5-5");
	assert.equal(rec.effort, "medium");
	assert.equal(rec.modelSeen, undefined);
	assert.equal(rec.effortSeen, undefined);
	store.removeFleetDir();
});

test("tracker: sem esforço configurado o registro não inventa um (nem medium)", () => {
	const { read } = start({}, 2);
	const rec = read();
	assert.equal("effort" in rec, false);
	assert.equal("model" in rec, false);
	assert.equal("provider" in rec, false);
	store.removeFleetDir();
});

test("tracker: esforço off configurado é preservado", () => {
	const { read } = start({ effort: "off" }, 3);
	assert.equal(read().effort, "off");
	store.removeFleetDir();
});

test("tracker: message_start do assistente já traz o modelo físico e o esforço observados", () => {
	const { tr, read } = start({ model: "anthropic/configured", effort: "low" }, 4);
	tr.onLine(
		line({
			type: "message_start",
			message: { role: "assistant", provider: "openai-codex", model: "gpt-5.6-luna", thinkingLevel: "high" },
		}),
	);
	const rec = read();
	assert.equal(rec.provider, "openai-codex");
	assert.equal(rec.model, "gpt-5.6-luna");
	assert.equal(rec.effort, "high");
	assert.equal(rec.modelSeen, true);
	assert.equal(rec.effortSeen, true);
	store.removeFleetDir();
});

test("tracker: message_end sobrescreve; sem thinkingLevel mantém o esforço anterior; user não conta", () => {
	const { tr, read } = start({ model: "a/b", effort: "low" }, 5);
	tr.onLine(
		line({
			type: "message_end",
			message: { role: "user", provider: "x", model: "y", thinkingLevel: "xhigh", content: "oi" },
		}),
	);
	assert.equal(read().model, "a/b", "mensagem de user não é runtime do modelo");
	tr.onLine(
		line({
			type: "message_end",
			message: {
				role: "assistant",
				provider: "anthropic",
				model: "claude-sonnet-5-5",
				content: [],
				usage: { input: 1, output: 1, totalTokens: 2 },
			},
		}),
	);
	const rec = read();
	assert.equal(rec.provider, "anthropic");
	assert.equal(rec.model, "claude-sonnet-5-5");
	assert.equal(rec.effort, "low");
	assert.equal(rec.effortSeen, undefined, "esforço ainda é o configurado");
	store.removeFleetDir();
});

test("tracker: thinking_level_changed troca o esforço e marca observado", () => {
	const { tr, read } = start({}, 6);
	tr.onLine(line({ type: "thinking_level_changed", level: "off" }));
	let rec = read();
	assert.equal(rec.effort, "off");
	assert.equal(rec.effortSeen, true);
	tr.onLine(line({ type: "thinking_level_changed", level: "high" }));
	assert.equal(read().effort, "high");
	tr.onLine(line({ type: "thinking_level_changed", level: "não é nível!" }));
	assert.equal(read().effort, "high", "valor inválido é ignorado");
	tr.onLine(line({ type: "thinking_level_changed" }));
	rec = read();
	assert.equal(rec.effort, "high");
	store.removeFleetDir();
});

test("tracker: metadados inválidos ou enormes são limpos/ignorados", () => {
	const { tr, read } = start({}, 7);
	tr.onLine(
		line({ type: "message_start", message: { role: "assistant", provider: 42, model: "", thinkingLevel: {} } }),
	);
	assert.equal("model" in read(), false);
	tr.onLine(
		line({ type: "message_start", message: { role: "assistant", provider: "p\u001b[31m", model: "m".repeat(500) } }),
	);
	const rec = read();
	assert.equal(rec.provider, "p", "sequência ANSI removida");
	assert.equal(rec.model.length, 120);
	store.removeFleetDir();
});

test("tracker: resume recomeça do configurado do novo argv; contadores seguem", () => {
	const { tr, read } = start({ model: "a/b", effort: "low" }, 8);
	tr.onLine(
		line({
			type: "message_end",
			message: {
				role: "assistant",
				provider: "p",
				model: "m",
				thinkingLevel: "high",
				content: [],
				usage: { input: 3, output: 4, totalTokens: 7 },
			},
		}),
	);
	tr.finish({ exitCode: 0 });
	assert.equal(read().state, "done");
	const again = trackerMod.startTracking({
		id: id(8),
		agent: "swarm-worker",
		task: "t2",
		background: true,
		model: "c/d",
	});
	const dir = store.currentFleetDir();
	const rec = JSON.parse(readFileSync(join(dir, `${id(8)}.json`), "utf8"));
	assert.equal(rec.model, "c/d");
	assert.equal("effort" in rec, false, "o esforço antigo não vaza para a nova execução");
	assert.equal(rec.modelSeen, undefined);
	assert.equal(rec.turns, 1);
	again.finish({ exitCode: 0 });
	store.removeFleetDir();
});

test("wiring: run.ts e background.ts passam o argv resolvido ao startTracking", () => {
	for (const f of ["core/run.ts", "fleet/background.ts"]) {
		const src = readFileSync(join(SRC, f), "utf8");
		assert.match(src, /configuredRuntime\(/, f);
	}
});

// D10 (docs/sync-observabilidade.md): maxTurns termina como done, mas o registro diz que a saída é parcial.
test("D10 tracker: finish({exitCode:0, partial:true}) grava partial:true e segue done; sem partial o campo não existe", () => {
	const a = start({}, 20);
	a.tr.finish({ exitCode: 0, partial: true });
	const rec = a.read();
	assert.equal(rec.state, "done");
	assert.equal(rec.partial, true);
	const b = start({}, 21);
	b.tr.finish({ exitCode: 0 });
	assert.equal("partial" in b.read(), false);
	store.removeFleetDir();
});

test("D10 view-model: a linha de um run parcial leva partial; wiring de run.ts e background.ts", async () => {
	const vm: any = await import("../../../../src/extensions/subagent/fleet-ui/view-model.ts");
	const mk = (rid: string, over: object) => ({
		v: 1,
		id: rid,
		parentId: null,
		depth: 1,
		agent: "a",
		task: "t",
		background: true,
		state: "done",
		startedAt: 1,
		updatedAt: 2,
		endedAt: 2,
		turns: 1,
		toolCalls: 0,
		tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, context: 0 },
		cost: 0,
		ownerPid: process.pid,
		...over,
	});
	const rows = vm.buildRows([mk(id(22), { partial: true }), mk(id(23), {})] as any[], { now: 3, panel: false });
	assert.equal(rows.find((r: any) => r.id === id(22)).partial, true);
	assert.equal("partial" in rows.find((r: any) => r.id === id(23)), false);
	for (const f of ["core/run.ts", "fleet/background.ts"])
		assert.match(readFileSync(join(SRC, f), "utf8"), /partial: .*partial/, f);
});

test('D8 run.ts abre a faixa antes do spawn: startTracking com activity "starting" e sem criar o tracker dentro do runAttempt', () => {
	const src = readFileSync(join(SRC, "core/run.ts"), "utf8");
	assert.match(src, /(?:let|const) tracker\b[^;]*?= startTracking\(\{[^}]*activity: "starting"/);
	assert.doesNotMatch(src, /tracker \?\?= startTracking/);
	const dir = mainFleet();
	const rec = trackerMod.startTracking({
		id: id(24),
		agent: "swarm-worker",
		task: "t",
		background: false,
		activity: "starting",
	});
	rec.flush(true);
	assert.equal(JSON.parse(readFileSync(join(dir, `${id(24)}.json`), "utf8")).activity, "starting");
	rec.finish({ exitCode: 0 });
	store.removeFleetDir();
});

// D11 (docs/sync-observabilidade.md): id comum chamada ↔ run ↔ etapa do plano no registro do fleet.
test("D11 tracker: o registro leva toolCallId (da chamada em curso) e planStep (do canal pi-code:plan-state); ausentes ficam omitidos", () => {
	const dir = mainFleet();
	const readRec = (n: number) => JSON.parse(readFileSync(join(dir, `${id(n)}.json`), "utf8"));
	trackerMod.setPlanStep(3);
	const a = trackerMod.toolCallScope.run("call_77", () =>
		trackerMod.startTracking({ id: id(30), agent: "swarm-worker", task: "t", background: false }),
	);
	assert.equal(readRec(30).toolCallId, "call_77");
	assert.equal(readRec(30).planStep, 3);
	trackerMod.setPlanStep(undefined);
	const b = trackerMod.startTracking({ id: id(31), agent: "swarm-worker", task: "t", background: false });
	assert.equal("toolCallId" in readRec(31), false);
	assert.equal("planStep" in readRec(31), false);
	a.finish({ exitCode: 0, partial: true });
	assert.deepEqual(trackerMod.laneOutcome(id(30)), {
		toolCallId: "call_77",
		planStep: 3,
		state: "done",
		exitCode: 0,
		partial: true,
	});
	assert.deepEqual(trackerMod.laneOutcome(id(99)), {});
	b.finish({ exitCode: 1 });
	assert.equal(trackerMod.laneOutcome(id(31)).state, "failed");
	store.removeFleetDir();
});

test("D11 wiring: execute roda dentro do toolCallScope, o canal plan-state é lido e o evento do ciclo leva a correlação", () => {
	const index = readFileSync(join(SRC, "index.ts"), "utf8");
	assert.match(index, /toolCallScope\.run\(toolCallId,/);
	assert.match(index, /nycode\.events\?\.on\(PLAN_STATE_CHANNEL/);
	assert.match(index, /\.\.\.laneCorrelation\(\),\s*\.\.\.\(phase === "stop" \? laneOutcome\(agentId\)/);
	assert.match(readFileSync(join(SRC, "core/modes.ts"), "utf8"), /\.\.\.laneOutcome\(run\.id\)/);
	assert.match(readFileSync(join(SRC, "../_shared/events/subagent-events.ts"), "utf8"), /pi-code:plan-state/);
});

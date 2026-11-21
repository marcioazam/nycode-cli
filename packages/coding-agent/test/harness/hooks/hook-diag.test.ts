// Ported from zzzzzzzzzzzzzzzzzzzzzz-hook-diag/hook-diag.test.ts. The patch-apply case and the comparison against
// runners-orig.ts (the unpatched module) have no counterpart; the unpatched result is asserted literally.
import { afterEach, describe, expect, it } from "vitest";
import { type HookRunResult, runHookCommand } from "../../../src/extensions/hooks/runners.ts";

interface DiagRecord {
	sev: number;
	quieto: boolean;
	fonte: string;
	tipo: string;
	msg: string;
	detalhe?: string;
	dados: { durMs: number; evento: string; comando: string; code: number; timedOut: boolean; spawnFailed: boolean };
}

const KEY = Symbol.for("pi-harness:diag");
const slot = globalThis as Record<symbol, unknown>;
afterEach(() => {
	delete slot[KEY];
});

const run = (cmd: string, ms = 5000, payload: unknown = { hook_event_name: "PreToolUse" }) =>
	runHookCommand(cmd, payload, ms);
const capture = async (cmd: string, ms?: number, payload?: unknown) => {
	const recs: DiagRecord[] = [];
	slot[KEY] = (record: DiagRecord) => recs.push(record);
	const result = await run(cmd, ms, payload);
	return { result, recs };
};

describe("hook diagnostics sink", () => {
	it("sucesso: sev 9, quieto, durMs numérico", async () => {
		const { result, recs } = await capture("/bin/true");
		expect(result.code).toBe(0);
		expect(recs).toHaveLength(1);
		const r = recs[0];
		expect(r.sev).toBe(9);
		expect(r.quieto).toBe(true);
		expect(r.fonte).toBe("hook");
		expect(r.tipo).toBe("hook");
		expect(typeof r.dados.durMs).toBe("number");
		expect(r.msg).toMatch(/^PreToolUse · true · ok · \d+ ms$/);
		expect(r.detalhe).toBeUndefined();
		expect([r.dados.evento, r.dados.comando, r.dados.code, r.dados.timedOut, r.dados.spawnFailed]).toEqual([
			"PreToolUse",
			"/bin/true",
			0,
			false,
			false,
		]);
	});

	it("saída 2 com stderr: sev 13, bloqueou, detalhe com o stderr", async () => {
		const { recs } = await capture("echo proibido >&2; exit 2");
		expect(recs[0].sev).toBe(13);
		expect(recs[0].quieto).toBe(false);
		expect(recs[0].msg).toMatch(/bloqueou \(2\)/);
		expect(recs[0].detalhe).toMatch(/proibido/);
	});

	it("saída 1: sev 17", async () => {
		const { recs } = await capture("exit 1");
		expect(recs[0].sev).toBe(17);
		expect(recs[0].quieto).toBe(false);
		expect(recs[0].msg).toMatch(/saiu 1/);
	});

	it("timeout: sev 17 e timedOut", async () => {
		const { result, recs } = await capture("sleep 5", 100);
		expect(result.timedOut).toBe(true);
		expect(recs[0].sev).toBe(17);
		expect(recs[0].dados.timedOut).toBe(true);
		expect(recs[0].msg).toMatch(/timeout/);
	});

	it("falha ao iniciar: sev 17 e spawnFailed", async () => {
		const recs: DiagRecord[] = [];
		slot[KEY] = (record: DiagRecord) => recs.push(record);
		const result = await runHookCommand("/nao/existe/hook-diag", {}, 5000, { args: [] });
		expect(result.spawnFailed).toBe(true);
		expect(recs[0].sev).toBe(17);
		expect(recs[0].dados.spawnFailed).toBe(true);
		expect(recs[0].dados.evento).toBe("hook");
		expect(recs[0].msg).toMatch(/não iniciou/);
	});

	it("comando longo é truncado a 200; stderr a 2048", async () => {
		const { recs } = await capture(`: ${"x".repeat(400)}; head -c 5000 /dev/zero | tr '\\0' e >&2; exit 1`);
		expect(recs[0].dados.comando).toHaveLength(200);
		expect(recs[0].detalhe).toHaveLength(2048);
	});

	it("sink que lança não muda o resultado; sem sink o resultado é o original", async () => {
		slot[KEY] = () => {
			throw new Error("boom");
		};
		const thrown = await run("echo oi; echo err >&2; exit 3");
		delete slot[KEY];
		const plain: HookRunResult = await run("echo oi; echo err >&2; exit 3");
		const original = { code: 3, stdout: "oi\n", stderr: "err\n", timedOut: false };
		expect(thrown).toEqual(original);
		expect(plain).toEqual(original);
	});
});

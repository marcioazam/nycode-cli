// Ported from import/ny-pi/extensions/auto-resume/index.test.ts (17 cases; the kill-switch case now goes through the
// handler and `harness.autoResume` / NYCODE_AUTO_RESUME). HOME points at an empty directory so the HUD usage cache of
// the machine running the tests never feeds the account-limit wait.
import { strict as assert } from "node:assert";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "vitest";
import type { ExtensionAPI } from "../../../../src/core/extensions/types.ts";
import autoResumeExtension, {
	decideResume,
	limitReset,
	markLimit,
	sleep,
} from "../../../../src/extensions/auto-resume/index.ts";

const register = autoResumeExtension;
const waiter =
	(waits: number[], result: boolean): typeof sleep =>
	async (ms) => {
		waits.push(ms);
		return result;
	};

type Handlers = Record<string, any>;

/** Loads the extension against a fake API and returns the handlers it registered, by event name. */
function load(wait: typeof sleep, now?: () => number, settings: unknown = {}): Handlers {
	const handlers: Handlers = {};
	register(
		{
			getSettings: () => settings,
			on: (event: string, fn: unknown) => {
				handlers[event] = fn;
			},
		} as unknown as ExtensionAPI,
		wait,
		now,
	);
	return handlers;
}

const ENV_KEYS = ["NYCODE_SUBAGENT", "NYCODE_AUTO_RESUME", "HOME", "USERPROFILE"] as const;
const saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

beforeEach(() => {
	for (const k of ENV_KEYS) saved[k] = process.env[k];
	delete process.env.NYCODE_SUBAGENT;
	delete process.env.NYCODE_AUTO_RESUME;
	process.env.HOME = process.env.USERPROFILE = mkdtempSync(join(tmpdir(), "auto-resume-home-"));
});

afterEach(() => {
	for (const k of ENV_KEYS) {
		if (saved[k] === undefined) delete process.env[k];
		else process.env[k] = saved[k];
	}
});

describe("auto-resume", () => {
	const err = (errorMessage: string) => ({
		type: "message",
		message: { role: "assistant", stopReason: "error", errorMessage },
	});
	const ok = { type: "message", message: { role: "assistant", stopReason: "stop" } };
	const resumed = { type: "custom_message", customType: "auto-resume", content: "x" };

	it("sem erro: nada", () => {
		assert.equal(decideResume([ok]).action, "none");
		assert.equal(decideResume([]).action, "none");
	});

	it("503 retryável: tentativa 1 com 30s", () => {
		for (const m of ["503 credential validation failed", "503 status code (no body)"]) {
			const d: any = decideResume([err(m)]);
			assert.equal(d.action, "resume");
			assert.equal(d.attempt, 1);
			assert.equal(d.delayMs, 30_000);
			assert.match(d.message, /^Auto-resume 1\/5: .*"503/);
		}
	});

	it("não retryável e overflow: nada", () => {
		assert.equal(decideResume([err("401 authentication_error: invalid x-api-key")]).action, "none");
		assert.equal(decideResume([err("400 invalid_request_error: messages.0 bad")]).action, "none");
		assert.equal(decideResume([err("prompt is too long: 250000 tokens > 200000 maximum")]).action, "none");
		assert.equal(decideResume([err("insufficient_quota 429")]).action, "none");
	});

	it("contagem consecutiva, reset após resposta ok, give_up em 5", () => {
		const e = err("503 status code (no body)");
		const chain = (n: number) => [...Array.from({ length: n }, () => [e, resumed]).flat(), e];
		assert.equal((decideResume(chain(1)) as any).delayMs, 90_000);
		assert.equal((decideResume(chain(2)) as any).delayMs, 180_000);
		assert.equal((decideResume(chain(4)) as any).delayMs, 600_000);
		assert.equal(decideResume(chain(5)).action, "give_up");
		assert.equal((decideResume([...chain(4).slice(0, -1), ok, e]) as any).attempt, 1);
	});

	it("sleep abortável", async () => {
		const c = new AbortController();
		const p = sleep(60_000, c.signal);
		c.abort();
		assert.equal(await p, false);
		assert.equal(await sleep(1), true);
	});

	it("handler: continua com a mensagem; aborto e exceção liberam", async () => {
		const status: any[] = [];
		const ctx = (branch: any[]) => ({
			sessionManager: { getBranch: () => branch },
			ui: { setStatus: (...a: any[]) => status.push(a) },
		});
		const handler = load(async () => true).agent_before_settle;
		const r = await handler({ entries: [1] }, ctx([err("503")]));
		assert.equal(r.continue, true);
		assert.equal(r.entries.at(-1).customType, "auto-resume");
		assert.equal(status.length, 2);
		assert.equal(status[1][1], undefined);
		const aborted = load(async () => false).agent_before_settle;
		assert.equal(await aborted({ entries: [] }, ctx([err("503")])), undefined);
		assert.equal(await aborted({ entries: [] }, {}), undefined);
	});

	// ---- limite da conta (pedido 2026-11-13): sem retry, espera o reset e retoma ----
	const LIMIT =
		'429 {"type":"error","error":{"type":"rate_limit_error","message":"This request would exceed your account\'s rate limit. Please try again later."}}';
	const NOW = Date.UTC(2026, 10, 13, 15, 0, 0);

	it("markLimit: só o limite da conta vira não-retryável para o pi (quota exceeded), o resto fica igual", () => {
		const m = markLimit(LIMIT)!;
		assert.match(m, /quota exceeded/);
		assert.ok(m.endsWith(LIMIT));
		assert.equal(markLimit(m), undefined, "idempotente");
		assert.equal(markLimit("429 Too Many Requests"), undefined, "throttle curto continua com o retry do pi");
		assert.equal(markLimit("503 overloaded"), undefined);
	});

	it("limitReset: headers do 429, depois retry-after, depois o cache do HUD; só horários futuros", () => {
		const s = (ms: number) => String(Math.floor(ms / 1000));
		assert.equal(
			limitReset({ "anthropic-ratelimit-unified-reset": s(NOW + 3_600_000) }, undefined, NOW),
			NOW + 3_600_000,
		);
		assert.equal(
			limitReset({ "anthropic-ratelimit-unified-reset": new Date(NOW + 60_000).toISOString() }, undefined, NOW),
			NOW + 60_000,
		);
		const win = {
			"anthropic-ratelimit-unified-5h-status": "rejected",
			"anthropic-ratelimit-unified-5h-reset": s(NOW + 2_460_000),
			"anthropic-ratelimit-unified-7d-status": "allowed",
			"anthropic-ratelimit-unified-7d-reset": s(NOW + 9e8),
		};
		assert.equal(limitReset(win, undefined, NOW), NOW + 2_460_000, "a janela rejeitada manda");
		assert.equal(limitReset({ "retry-after": "120" }, undefined, NOW), NOW + 120_000);
		const cache = {
			rate_limits: {
				five_hour: { used_percentage: 99, resets_at: (NOW + 2_460_000) / 1000 },
				seven_day: { used_percentage: 40, resets_at: (NOW + 9e8) / 1000 },
			},
		};
		assert.equal(limitReset({}, cache, NOW), NOW + 2_460_000, "cache: a janela cheia");
		assert.equal(
			limitReset({}, { rate_limits: { seven_day: { used_percentage: 10, resets_at: (NOW + 5e6) / 1000 } } }, NOW),
			NOW + 5e6,
			"nenhuma cheia: o reset mais próximo",
		);
		assert.equal(
			limitReset(
				{ "anthropic-ratelimit-unified-reset": s(NOW - 1000) },
				{ rate_limits: { five_hour: { used_percentage: 100, resets_at: (NOW - 5) / 1000 } } },
				NOW,
			),
			undefined,
			"passado não vale",
		);
		assert.equal(limitReset({ "retry-after": "x" }, { junk: 1 }, NOW), undefined);
		assert.equal(
			limitReset({ "retry-after": new Date(NOW + 300_000).toUTCString() }, undefined, NOW),
			NOW + 300_000,
			"retry-after em HTTP-date",
		);
		const nearest = { "anthropic-ratelimit-unified-7d-reset": s(NOW + 9e7), "retry-after": "600" };
		assert.equal(
			limitReset(nearest, undefined, NOW),
			NOW + 600_000,
			"retry-after explícito vence a janela mais próxima não rejeitada",
		);
		assert.equal(
			limitReset({ "anthropic-ratelimit-unified-reset": s(NOW + 30 * 86_400_000) }, undefined, NOW),
			undefined,
			"reset além de 8 dias é inválido (estouraria o setTimeout)",
		);
	});

	it("decideResume: limite da conta espera até o reset + 1 min; desconhecido 15 min; 3 esperas e desiste; filhos não esperam", () => {
		const e = err(markLimit(LIMIT)!);
		const d: any = decideResume([e], {}, { now: NOW, resetAt: NOW + 2_460_000 });
		assert.equal(d.action, "resume");
		assert.equal(d.delayMs, 2_460_000 + 60_000);
		assert.equal(d.kind, "limit");
		assert.match(d.message, /usage limit/);
		assert.equal((decideResume([e], {}, { now: NOW }) as any).delayMs, 15 * 60_000);
		const lim = { type: "custom_message", customType: "auto-resume-limit", content: "x" };
		assert.equal((decideResume([e, lim, e, lim, e], {}, { now: NOW }) as any).attempt, 3);
		assert.equal(decideResume([e, lim, e, lim, e, lim, e], {}, { now: NOW }).action, "give_up");
		assert.equal(
			decideResume([e], { NYCODE_SUBAGENT: "1" }, { now: NOW }).action,
			"none",
			"filho falha rápido; o principal espera",
		);
		assert.equal((decideResume([err("503"), resumed, e], {}, { now: NOW }) as any).kind, "limit");
	});

	it("handler: message_end marca o erro, after_provider_response guarda os headers do 429, settle espera e retoma", async () => {
		const waits: number[] = [];
		const h = load(waiter(waits, true), () => NOW);
		const msg = { role: "assistant", stopReason: "error", errorMessage: LIMIT };
		const r = await h.message_end({ message: msg });
		assert.match(r.message.errorMessage, /quota exceeded/);
		assert.equal(await h.message_end({ message: { role: "assistant", stopReason: "stop" } }), undefined);
		await h.after_provider_response({
			status: 429,
			headers: { "Anthropic-Ratelimit-Unified-Reset": String((NOW + 600_000) / 1000) },
		});
		await h.after_provider_response({ status: 200, headers: {} });
		const status: any[] = [];
		const notes: any[] = [];
		const ctx = {
			hasUI: true,
			sessionManager: { getBranch: () => [{ type: "message", message: r.message }] },
			ui: { setStatus: (...a: any[]) => status.push(a), notify: (...a: any[]) => notes.push(a) },
		};
		const out = await h.agent_before_settle({ entries: [] }, ctx);
		assert.deepEqual(waits, [660_000], "header do 429 sobrevive a um 200 sem headers de limite");
		assert.equal(out.continue, true);
		assert.equal(out.entries.at(-1).customType, "auto-resume-limit");
		assert.match(status[0][1], /limit/);
		assert.equal(status.at(-1)[1], undefined);
		assert.equal(notes.length, 1);
	});

	it("handler: resposta bem-sucedida descarta headers de um 429 antigo", async () => {
		const waits: number[] = [];
		const h = load(waiter(waits, true), () => NOW);
		await h.after_provider_response({
			status: 429,
			headers: { "anthropic-ratelimit-unified-reset": String((NOW + 3 * 3_600_000) / 1000) },
		});
		await h.message_end({ message: { role: "assistant", stopReason: "stop" } });
		assert.equal(await h.message_end({ message: { role: "user" } }), undefined);
		const r = await h.message_end({ message: { role: "assistant", stopReason: "error", errorMessage: LIMIT } });
		const ctx = {
			hasUI: true,
			sessionManager: { getBranch: () => [{ type: "message", message: r.message }] },
			ui: { setStatus() {}, notify() {} },
		};
		await h.agent_before_settle({ entries: [] }, ctx);
		assert.deepEqual(
			waits,
			[15 * 60_000],
			"sem header nem cache: padrão de 15 min, não o reset de 3 h do 429 antigo",
		);
	});

	it("handler: depois de 3 esperas desiste e avisa (ui ou stderr)", async () => {
		const h = load(
			async () => true,
			() => NOW,
		);
		const r = await h.message_end({ message: { role: "assistant", stopReason: "error", errorMessage: LIMIT } });
		const e = { type: "message", message: r.message };
		const lim = { type: "custom_message", customType: "auto-resume-limit", content: "x" };
		const branch = [e, lim, e, lim, e, lim, e];
		const notes: any[] = [];
		const errs: string[] = [];
		const write = process.stderr.write;
		try {
			assert.equal(
				await h.agent_before_settle(
					{ entries: [] },
					{
						hasUI: true,
						sessionManager: { getBranch: () => branch },
						ui: { notify: (...a: any[]) => notes.push(a) },
					},
				),
				undefined,
			);
			process.stderr.write = ((chunk: string) => {
				errs.push(chunk);
				return true;
			}) as typeof process.stderr.write;
			await h.agent_before_settle({ entries: [] }, { hasUI: true, sessionManager: { getBranch: () => branch } });
		} finally {
			process.stderr.write = write;
		}
		assert.equal(notes[0][1], "warning");
		assert.match(notes[0][0], /gave up after 3 waits/);
		assert.match(errs.join(""), /gave up after 3 waits/);
	});

	it("handler: Esc durante a espera descarta os headers usados (a próxima espera não herda o reset antigo)", async () => {
		const waits: number[] = [];
		const h = load(waiter(waits, false), () => NOW);
		await h.after_provider_response({
			status: 429,
			headers: { "anthropic-ratelimit-unified-reset": String((NOW + 3 * 3_600_000) / 1000) },
		});
		const r = await h.message_end({ message: { role: "assistant", stopReason: "error", errorMessage: LIMIT } });
		const ctx = {
			hasUI: true,
			sessionManager: { getBranch: () => [{ type: "message", message: r.message }] },
			ui: { setStatus() {}, notify() {} },
		};
		assert.equal(await h.agent_before_settle({ entries: [] }, ctx), undefined, "cancelado: não retoma");
		await h.agent_before_settle({ entries: [] }, ctx);
		assert.deepEqual(waits, [3 * 3_600_000 + 60_000, 15 * 60_000]);
	});

	it("handler: erro que não é de limite descarta headers de um 429 anterior", async () => {
		const waits: number[] = [];
		const h = load(waiter(waits, true), () => NOW);
		await h.after_provider_response({
			status: 429,
			headers: { "anthropic-ratelimit-unified-reset": String((NOW + 3 * 3_600_000) / 1000) },
		});
		assert.equal(
			await h.message_end({
				message: { role: "assistant", stopReason: "error", errorMessage: "429 too many requests" },
			}),
			undefined,
		);
		const r = await h.message_end({ message: { role: "assistant", stopReason: "error", errorMessage: LIMIT } });
		const ctx = {
			hasUI: true,
			sessionManager: { getBranch: () => [{ type: "message", message: r.message }] },
			ui: { setStatus() {}, notify() {} },
		};
		await h.agent_before_settle({ entries: [] }, ctx);
		assert.deepEqual(
			waits,
			[15 * 60_000],
			"o 429 comum já foi tratado; seus headers não definem a espera do limite seguinte",
		);
	});

	it("handler: limite da conta sem UI (-p) desiste na hora e avisa no stderr; com UI espera", async () => {
		const waits: number[] = [];
		const h = load(waiter(waits, true), () => NOW);
		const r = await h.message_end({ message: { role: "assistant", stopReason: "error", errorMessage: LIMIT } });
		const sessionManager = { getBranch: () => [{ type: "message", message: r.message }] };
		const errs: string[] = [];
		const write = process.stderr.write;
		process.stderr.write = ((chunk: string) => {
			errs.push(chunk);
			return true;
		}) as typeof process.stderr.write;
		try {
			assert.equal(await h.agent_before_settle({ entries: [] }, { hasUI: false, sessionManager }), undefined);
		} finally {
			process.stderr.write = write;
		}
		assert.deepEqual(waits, [], "sem UI: nenhuma espera");
		assert.match(errs.join(""), /without a UI/);
		const out = await h.agent_before_settle(
			{ entries: [] },
			{ hasUI: true, sessionManager, ui: { setStatus() {}, notify() {} } },
		);
		assert.equal(out.continue, true);
		assert.equal(waits.length, 1, "com UI: espera como antes");
	});

	it("decideResume: limite da conta sem UI é give_up; 503 sem UI segue com retentativa", () => {
		const d = decideResume([err(markLimit(LIMIT)!)], {}, { now: NOW, hasUI: false });
		assert.equal(d.action, "give_up");
		assert.equal(decideResume([err("503")], {}, { now: NOW, hasUI: false }).action, "resume");
	});

	it("kill switch: harness.autoResume=false or NYCODE_AUTO_RESUME=0 releases the settle without waiting", async () => {
		const waits: number[] = [];
		const settle = (settings: unknown) =>
			load(waiter(waits, true), undefined, settings).agent_before_settle(
				{ entries: [] },
				{
					sessionManager: { getBranch: () => [err("503")] },
				},
			);
		assert.equal(await settle({ harness: { autoResume: false } }), undefined);
		process.env.NYCODE_AUTO_RESUME = "0";
		assert.equal(await settle({}), undefined);
		assert.deepEqual(waits, []);
		process.env.NYCODE_AUTO_RESUME = "1";
		assert.equal((await settle({ harness: { autoResume: false } })).continue, true);
		assert.deepEqual(waits, [30_000]);
	});
});

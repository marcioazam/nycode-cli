// Port of the goal-lifecycle patch tests (pi-code 1.7.0) to vitest against the embedded source: /goal with a fake
// extension API (evaluator retries, failed-turn retry/pause). The original also applied the onda5-goal patch to a
// copy of the package; the embedded source already contains it, so that step has no counterpart.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, test, vi } from "vitest";
import { ENV_AGENT_DIR } from "../../../src/config.ts";
import type { ExtensionAPI } from "../../../src/core/extensions/types.ts";
import { setCompleteBackend } from "../../../src/extensions/_shared/model/model-complete.ts";
import { setManagedSettingsPath } from "../../../src/extensions/_shared/settings/managed-settings.ts";
import goalExtension from "../../../src/extensions/goal/index.ts";

/** Loose on purpose: the fake API, context and model records only carry the fields /goal reads. */
type Loose = any;

const tmp = mkdtempSync(join(tmpdir(), "goal-life-"));
const saved = { home: process.env.HOME, agentDir: process.env[ENV_AGENT_DIR] };
beforeAll(() => {
	// /goal reads user and managed settings (hooks restrictions): never the real ones.
	process.env.HOME = tmp;
	process.env[ENV_AGENT_DIR] = join(tmp, "agent");
	setManagedSettingsPath(join(tmp, "managed-settings.json"));
});
afterAll(() => {
	setManagedSettingsPath(undefined);
	for (const [key, value] of [
		["HOME", saved.home],
		[ENV_AGENT_DIR, saved.agentDir],
	] as const) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	rmSync(tmp, { recursive: true, force: true });
});
// The fake backend returns partial assistant messages, so its typed signature is bypassed.
const mc = { setCompleteBackend: (fn: Loose) => setCompleteBackend(fn) };

// node:test restored mocked timers after each test; vitest does not.
afterEach(() => {
	vi.useRealTimers();
});

const session: Loose = {
	provider: "anthropic",
	api: "anthropic-messages",
	id: "claude-opus-5-5",
	reasoning: true,
	thinkingLevelMap: { off: null, minimal: null, low: "low" },
	contextWindow: 1_000_000,
};
const haiku: Loose = {
	provider: "anthropic",
	api: "anthropic-messages",
	id: "claude-haiku-5-5",
	reasoning: true,
	thinkingLevelMap: { minimal: null },
	contextWindow: 1_000_000,
};
const oldHaiku: Loose = {
	provider: "anthropic",
	id: "claude-haiku-4-5-20251001",
	reasoning: true,
	contextWindow: 200_000,
};

function harness(hasUI = true) {
	const handlers: Record<string, Array<(payload: Loose, ctx: Loose) => unknown>> = {};
	const sent: { content: string; options: Loose }[] = [];
	const notes: { text: string; level: string }[] = [];
	const branch: Loose[] = [];
	let command: Loose;
	const pi: Loose = {
		registerCommand: (_name: string, def: Loose) => {
			command = def;
		},
		registerMessageRenderer: () => {},
		on: (event: string, fn: (payload: Loose, ctx: Loose) => unknown) => {
			handlers[event] = [...(handlers[event] ?? []), fn];
		},
		events: { on: () => {} },
		sendMessage: (msg: Loose, options: Loose) => {
			sent.push({ content: msg.content, options });
			branch.push({ type: "custom_message", customType: msg.customType, content: msg.content });
		},
		appendEntry: (customType: string, data: Loose) => branch.push({ type: "custom", customType, data }),
	};
	goalExtension(pi as ExtensionAPI);
	const ctx: Loose = {
		cwd: tmp,
		hasUI,
		model: session,
		modelRegistry: { getAvailable: () => [session, oldHaiku, haiku] },
		sessionManager: { getBranch: () => branch },
		ui: {
			notify: (text: string, level: string) => notes.push({ text, level }),
			setStatus: () => {},
			theme: { fg: (_c: string, t: string) => t },
		},
		isIdle: () => true,
		isProjectTrusted: () => true,
		waitForIdle: async () => {},
	};
	const fire = async (event: string, payload: Loose = {}) => {
		for (const fn of handlers[event] ?? []) await fn(payload, ctx);
	};
	return { ctx, sent, notes, branch, fire, command: () => command };
}

const assistant = (stopReason = "stop", errorMessage?: string) => ({
	role: "assistant",
	stopReason,
	errorMessage,
	content: [{ type: "text", text: "feito" }],
});
const reply = (text: string, stopReason = "stop") => ({
	role: "assistant",
	content: text ? [{ type: "text", text }] : [],
	stopReason,
	usage: { totalTokens: 10 },
});

test("avaliador: Haiku mais novo por padrão, retry com orçamento maior após corte, veredito final", async () => {
	const calls: Loose[] = [];
	const replies = [reply("", "length"), reply('{"ok": true, "reason": "ok"}')];
	mc.setCompleteBackend(async (model: Loose, _c: Loose, options: Loose) => {
		calls.push({ id: model.id, ...options });
		return replies.shift();
	});
	const h = harness();
	await h.fire("session_start");
	await h.command().handler("X pronto", h.ctx);
	await h.fire("agent_end", { messages: [assistant()] });
	assert.deepEqual(
		calls.map((c) => [c.id, c.maxTokens]),
		[
			["claude-haiku-5-5", 1024],
			["claude-haiku-5-5", 4096],
		],
	);
	assert.equal(calls[0].reasoning, undefined, "Haiku 5.5 aceita thinking off");
	assert.match(h.sent.at(-1)!.content, /Goal achieved .*\nEvaluator \(anthropic\/claude-haiku-5-5\): ok/);
	mc.setCompleteBackend(null);
});

test("avaliador: falha irrecuperável no Haiku cai para o modelo da sessão (com reasoning mínimo)", async () => {
	const calls: Loose[] = [];
	mc.setCompleteBackend(async (model: Loose, _c: Loose, options: Loose) => {
		calls.push({ id: model.id, reasoning: options.reasoning });
		if (model.id === "claude-haiku-5-5")
			return { ...reply(""), stopReason: "error", errorMessage: "404 not_found_error model" };
		return reply('{"ok": false, "reason": "falta Y"}');
	});
	const h = harness();
	await h.fire("session_start");
	await h.command().handler("X pronto", h.ctx);
	await h.fire("agent_start");
	await h.fire("tool_execution_start");
	await h.fire("agent_end", { messages: [assistant()] });
	assert.deepEqual(calls, [
		{ id: "claude-haiku-5-5", reasoning: undefined },
		{ id: "claude-opus-5-5", reasoning: "low" },
	]);
	assert.match(h.sent.at(-1)!.content, /Goal not yet met \(turn 1/);
	assert.equal(h.sent.at(-1)!.options.triggerTurn, true);
	mc.setCompleteBackend(null);
});

test("avaliador: 3 respostas ilegíveis pausam com aviso, goal continua ativo", async () => {
	let n = 0;
	mc.setCompleteBackend(async () => {
		n += 1;
		return reply("não sei");
	});
	const h = harness();
	await h.fire("session_start");
	await h.command().handler("X pronto", h.ctx);
	const before = h.sent.length;
	await h.fire("agent_end", { messages: [assistant()] });
	assert.equal(n, 3);
	assert.equal(h.sent.length, before, "nenhum turno novo");
	assert.match(h.notes.at(-1)!.text, /^Objetivo pausado: o avaliador falhou 3 vezes \(unreadable verdict: não sei\)/);
	await h.command().handler("", h.ctx);
	assert.match(h.notes.at(-1)!.text, /^Goal active: X pronto/);
	mc.setCompleteBackend(null);
});

test("turno falho transitório: 3 retries agendados e depois pausa; rate limit pausa direto", async () => {
	vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
	const h = harness();
	await h.fire("session_start");
	await h.command().handler("X pronto", h.ctx);
	for (let attempt = 1; attempt <= 3; attempt++) {
		await h.fire("agent_end", { messages: [assistant("error", "529 overloaded_error")] });
		await h.fire("agent_settled");
		assert.match(
			h.notes.at(-1)!.text,
			new RegExp(`nova tentativa em ${15 * 2 ** (attempt - 1)}s \\(${attempt}/3\\)`),
		);
		const before = h.sent.length;
		vi.advanceTimersByTime(15_000 * 2 ** (attempt - 1));
		assert.equal(h.sent.length, before + 1);
		assert.match(h.sent.at(-1)!.content, new RegExp(`^Goal retry ${attempt}/3 after a failed turn \\(overloaded`));
	}
	await h.fire("agent_end", { messages: [assistant("error", "529 overloaded_error")] });
	await h.fire("agent_settled");
	assert.match(h.notes.at(-1)!.text, /^Objetivo pausado \(overloaded, após 3 tentativas automáticas\)/);

	await h.fire("input", { source: "interactive" });
	await h.fire("agent_end", { messages: [assistant("error", "429 rate_limit_error")] });
	await h.fire("agent_settled");
	assert.match(h.notes.at(-1)!.text, /^Objetivo pausado \(rate limit\)/);
});

test("turno falho: prompt do usuário cancela o retry pendente; headless só pausa; erro irrecuperável limpa", async () => {
	vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
	const h = harness();
	await h.fire("session_start");
	await h.command().handler("X pronto", h.ctx);
	await h.fire("agent_end", { messages: [assistant("error", "fetch failed")] });
	await h.fire("agent_settled");
	const before = h.sent.length;
	await h.fire("input", { source: "interactive" });
	vi.advanceTimersByTime(60_000);
	assert.equal(h.sent.length, before);

	const headless = harness(false);
	await headless.fire("session_start");
	await headless.command().handler("X pronto", headless.ctx);
	await headless.fire("agent_end", { messages: [assistant("error", "fetch failed")] });
	await headless.fire("agent_settled");
	assert.match(headless.notes.at(-1)!.text, /^Objetivo pausado \(connection\)/);

	await h.fire("agent_end", { messages: [assistant("error", "401 authentication_error")] });
	await h.fire("agent_settled");
	assert.match(h.notes.at(-1)!.text, /^Objetivo encerrado após um erro sem recuperação \(authentication\)/);
});

test("NYCODE_GOAL_MODEL escolhe o avaliador", async () => {
	const ids: string[] = [];
	mc.setCompleteBackend(async (model: Loose) => {
		ids.push(model.id);
		return reply('{"ok": true, "reason": "r"}');
	});
	process.env.NYCODE_GOAL_MODEL = "claude-opus-5-5";
	try {
		const h = harness();
		await h.fire("session_start");
		await h.command().handler("X pronto", h.ctx);
		await h.fire("agent_end", { messages: [assistant()] });
		assert.deepEqual(ids, ["claude-opus-5-5"]);
	} finally {
		delete process.env.NYCODE_GOAL_MODEL;
		mc.setCompleteBackend(null);
	}
});

test("veredito forçado por ferramenta no Haiku (schema), texto no Opus; ferramenta rejeitada cai para texto", async () => {
	const calls: Loose[] = [];
	let rejectTool = false;
	mc.setCompleteBackend(async (model: Loose, context: Loose, options: Loose) => {
		calls.push({
			id: model.id,
			toolChoice: options.toolChoice,
			tools: context.tools?.map((x: Loose) => x.name),
			system: context.systemPrompt,
		});
		if (options.toolChoice && rejectTool)
			return { ...reply(""), stopReason: "error", errorMessage: "400 invalid_request_error: tool_choice" };
		if (options.toolChoice)
			return {
				role: "assistant",
				content: [
					{ type: "toolCall", id: "t1", name: "goal_verdict", arguments: { ok: false, reason: "falta Z" } },
				],
				stopReason: "toolUse",
				usage: {},
			};
		return reply('{"ok": true, "reason": "texto"}');
	});
	const h = harness();
	await h.fire("session_start");
	await h.command().handler("X pronto", h.ctx);
	await h.fire("agent_start");
	await h.fire("tool_execution_start");
	await h.fire("agent_end", { messages: [assistant()] });
	assert.deepEqual(calls[0].toolChoice, { type: "tool", name: "goal_verdict" });
	assert.deepEqual(calls[0].tools, ["goal_verdict"]);
	assert.match(calls[0].system, /calling the goal_verdict tool/);
	assert.match(h.sent.at(-1)!.content, /Goal not yet met \(turn 1.*: falta Z/);

	calls.length = 0;
	rejectTool = true;
	await h.fire("agent_end", { messages: [assistant()] });
	assert.deepEqual(
		calls.map((c) => [c.id, !!c.toolChoice]),
		[
			["claude-haiku-5-5", true],
			["claude-haiku-5-5", false],
		],
	);
	assert.match(h.sent.at(-1)!.content, /Goal achieved/);

	calls.length = 0;
	process.env.NYCODE_GOAL_MODEL = "claude-opus-5-5";
	try {
		const o = harness();
		await o.fire("session_start");
		await o.command().handler("X pronto", o.ctx);
		await o.fire("agent_end", { messages: [assistant()] });
		assert.equal(calls[0].toolChoice, undefined, "Opus 5.5 não desliga thinking: sem tool_choice forçado");
	} finally {
		delete process.env.NYCODE_GOAL_MODEL;
		mc.setCompleteBackend(null);
	}
});

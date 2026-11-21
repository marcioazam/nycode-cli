// Ported from zzzzzzzzzzzzzzzzzzzzzzzzzzzzzz-fleet-sync/fleet-sync.test.ts (pi-code patch tests); same cases and expectations.
// Testes do zzzzzzzzzzzzzzzzzzzzzzzzzzzzzz-fleet-sync.patch (docs/sync-observabilidade.md, D8-D11 + custo do painel):
//   env -u NYCODE_SUBAGENT npx vitest --run test/harness/subagent/fleet/sync/fleet-sync.test.ts
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, test, vi } from "vitest";
import type { ExtensionAPI } from "../../../../../src/core/extensions/types.ts";
import * as runMod from "../../../../../src/extensions/subagent/core/run.ts";
import type { SubagentDetails } from "../../../../../src/extensions/subagent/core/types.ts";
import * as store from "../../../../../src/extensions/subagent/fleet/store.ts";
import type { FleetSource, RunRecord } from "../../../../../src/extensions/subagent/fleet/types.ts";
import * as fleetUi from "../../../../../src/extensions/subagent/fleet-ui/index.ts";
import type { AgentConfig } from "../../../../../src/extensions/subagent/registry/agents.ts";
import { fleetTestEnv } from "../../support/fleet-env.ts";

const { tmp } = fleetTestEnv("fleet-sync-");

type Widget = (tui: unknown, theme: unknown) => { render(w: number): string[] };
const theme = {
	fg: (_c: string, t: string) => t,
	bold: (t: string) => t,
	italic: (t: string) => t,
	underline: (t: string) => t,
};
function fakePi() {
	const handlers: Record<string, (...a: unknown[]) => unknown> = {};
	return {
		handlers,
		pi: {
			on: (n: string, h: (...a: unknown[]) => unknown) => {
				handlers[n] = h;
			},
			registerCommand() {},
			registerShortcut() {},
		} as unknown as ExtensionAPI,
	};
}
const row: RunRecord = {
	v: 1,
	id: "fg-00000001",
	parentId: null,
	depth: 1,
	agent: "worker",
	task: "t",
	background: false,
	state: "running",
	startedAt: Date.now() - 60_000,
	updatedAt: Date.now(),
	turns: 1,
	toolCalls: 1,
	tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, context: 0 },
	cost: 0,
	ownerPid: 1,
	activity: "lendo",
};
const emptySource = {
	list: () => [row],
	readTranscript: () => ({ items: [], next: 0 }),
	stop: () => "unknown",
	send: () => "unknown",
	hasForeground: () => false,
	detachForeground: () => 0,
	onChange: () => () => {},
} as unknown as FleetSource;
function boot(calls: { n: number }) {
	const { pi, handlers } = fakePi();
	fleetUi.registerFleetUi(pi, () => emptySource);
	const widgets: Widget[] = [];
	const tui = { requestRender() {}, terminal: { rows: 40 } };
	const ctx = {
		hasUI: true,
		sessionManager: { getBranch: () => [] },
		getContextUsage: () => {
			calls.n++;
			return { tokens: 1000 * calls.n };
		},
		ui: {
			setWidget: (_k: string, f: Widget | undefined) => f && widgets.push(f),
			onTerminalInput: () => () => {},
			notify() {},
			setStatus() {},
			theme,
		},
	};
	return { handlers, ctx, widgets, tui };
}
const text = (w: Widget, tui: unknown): string =>
	w(tui, theme)
		.render(120)
		.join("\n")
		.replace(/\x1b\[[0-9;]*m/g, "");

afterEach(() => vi.useRealTimers());

test("painel: N desenhos dentro de 1 s chamam getContextUsage uma vez; os eventos de contexto e o TTL zeram a memória", async () => {
	// Relógio controlado (plano de testes, item 14): o painel guarda Date.now no registro, então o mock entra antes do boot.
	vi.useFakeTimers({ toFake: ["Date"], now: 1_700_000_000_000 });
	const calls = { n: 0 };
	const { handlers, ctx, widgets, tui } = boot(calls);
	await handlers.session_start({}, ctx);
	const draw = (): string => text(widgets[0], tui);
	const first = draw();
	for (let i = 0; i < 20; i++) draw();
	assert.equal(calls.n, 1, "vinte desenhos, uma leitura");
	assert.match(first, /1\.0k tok/);
	for (const ev of ["turn_end", "message_end", "session_compact", "agent_settled"]) {
		const before: number = calls.n;
		await handlers[ev]({}, ctx);
		draw();
		draw();
		assert.equal(calls.n, before + 1, `${ev} zera a memória: relê uma vez`);
	}
	const before: number = calls.n;
	vi.advanceTimersByTime(999);
	draw();
	assert.equal(calls.n, before, "antes de 1 s, não relê");
	vi.advanceTimersByTime(2);
	draw();
	assert.equal(calls.n, before + 1, "passado 1 s, relê");
});

// D10/D8 pela fiação real do run.ts (pi falso que fala e fica vivo até o SIGTERM do teto).
const fakeChild = join(tmp, "fake-pi.mjs");
writeFileSync(
	fakeChild,
	`process.stdout.write(JSON.stringify({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'fake done' }], stopReason: 'stop' } }) + '\\n')\nsetInterval(() => {}, 1000)\n`,
);
const agent: AgentConfig = {
	name: "fake",
	description: "fake",
	systemPrompt: "x",
	source: "user",
	filePath: join(tmp, "fake.md"),
};

async function lane(over: object, cwd?: string): Promise<RunRecord> {
	delete process.env.NYCODE_SUBAGENT_DEPTH;
	delete process.env.NYCODE_SUBAGENT;
	const dir = store.ensureFleetDir() as string;
	const savedArgv = process.argv[1];
	process.argv[1] = fakeChild;
	let id = "";
	try {
		await runMod
			.runSingleAgent({
				defaultCwd: cwd ?? tmp,
				agents: [{ ...agent, ...over }],
				agentName: "fake",
				task: "go",
				makeDetails: () => ({}) as unknown as SubagentDetails,
				onPhase: (p: string, _a: string, agentId: string) => {
					if (p === "start") id = agentId;
				},
			})
			.catch(() => undefined);
		return store.readRecord(dir, id) as RunRecord;
	} finally {
		process.argv[1] = savedArgv;
		store.removeFleetDir();
	}
}

test("D10 run.ts: maxTurns grava partial:true e done no registro do fleet", async () => {
	const rec = await lane({ maxTurns: 1 });
	assert.equal(rec.state, "done");
	assert.equal(rec.partial, true);
});

test("D8 run.ts: spawn que falha deixa a faixa failed com o motivo (a faixa já existe antes do spawn)", async () => {
	const rec = await lane({}, join(tmp, "nao-existe"));
	assert.ok(rec, "registro criado antes do spawn");
	assert.equal(rec.state, "failed");
	assert.ok(rec.error);
});

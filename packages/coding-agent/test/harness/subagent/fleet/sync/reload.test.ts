// Ported from zzzzzzzzzzzzzzzzzzzzzzzzzzzzzz-fleet-sync/reload.test.ts (pi-code patch tests); same cases and expectations.
// D15 (docs/sync-observabilidade.md): uma chamada `subagent {tasks}` auto-destacada sobrevive ao /reload: o resultado de cada faixa
// chega pela instância atual, sem "stale". Rodar: env -u NYCODE_SUBAGENT node --experimental-strip-types --test <este arquivo>
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "vitest";
import { fleetTestEnv } from "../../support/fleet-env.ts";

const { tmp } = fleetTestEnv("fleet-reload-");
const home = join(tmp, "home");
const agentDir = join(home, ".pi", "agent");
mkdirSync(join(agentDir, "agents"), { recursive: true });
writeFileSync(join(agentDir, "agents", "fake.md"), "---\nname: fake\ndescription: agente falso\n---\nVoce e falso.\n");
process.env.HOME = home;
process.env.NYCODE_CODING_AGENT_DIR = agentDir;
delete process.env.CLAUDE_CONFIG_DIR;
delete process.env.NYCODE_SUBAGENT;
delete process.env.NYCODE_SUBAGENT_DEPTH;
for (const k of ["NYCODE_SUBAGENT_ALLOWED_AGENTS", "NYCODE_FLEET_DIR", "NYCODE_FLEET_RUN_ID", "NYCODE_SUBAGENT_TREE"])
	delete process.env[k];

const store: any = await import("../../../../../src/extensions/subagent/fleet/store.ts");
const bgMod: any = await import("../../../../../src/extensions/subagent/fleet/background.ts");
const { default: subagentExtension }: any = await import("../../../../../src/extensions/subagent/index.ts");

// O filho só responde depois que `release-<tarefa>` existe.
const fakePi = join(tmp, "fake-pi-reload.mjs");
writeFileSync(
	fakePi,
	`import { existsSync } from 'node:fs'
import { join } from 'node:path'
const task = (process.argv.at(-1).match(/Task: ([\\s\\S]*)$/) ?? [])[1] ?? ''
const timer = setInterval(() => {
  if (!existsSync(join(process.env.FAKE_PI_DIR, 'release-' + task))) return
  clearInterval(timer)
  process.stdout.write(JSON.stringify({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'feito:' + task }], stopReason: 'stop' } }) + '\\n')
  process.exit(0)
}, 20)
`,
);
process.env.FAKE_PI_DIR = tmp;
const release = (task: string): void => writeFileSync(join(tmp, `release-${task}`), "");
const STALE = "This extension ctx is stale after session replacement or reload.";

/** Uma instância da extensão; `reload()` a deixa velha: todo acesso ao pi/ctx capturado lança, como o pi real. */
function instance() {
	const handlers = new Map<string, Array<(...a: any[]) => any>>();
	const tools: any[] = [];
	const sent: any[] = [];
	let stale = false;
	const guard = <T>(v: T): T => {
		if (stale) throw new Error(STALE);
		return v;
	};
	const pi: any = {
		on: (e: string, h: (...a: any[]) => any) => void handlers.set(e, [...(handlers.get(e) ?? []), h]),
		registerTool: (d: any) => void tools.push(d),
		registerCommand() {},
		get events() {
			return guard({ emit() {}, on: () => () => {} });
		},
		getActiveTools: () => guard(["subagent"]),
		getThinkingLevel: () => guard("off"),
		sendMessage: (msg: any) => void guard(sent.push(msg)),
		sendUserMessage: () => guard(undefined),
	};
	const ctx: any = {
		mode: "tui",
		hasUI: true,
		get cwd() {
			return guard(tmp);
		},
		get sessionManager() {
			return guard({ getBranch: () => [{ type: "message" }] });
		},
		get modelRegistry() {
			return guard({ getAvailable: () => [] });
		},
		get ui() {
			return guard({
				setWidget() {},
				onTerminalInput: () => () => {},
				getEditorText: () => "",
				notify() {},
				custom: async () => undefined,
			});
		},
	};
	const savedArgv = process.argv[1];
	process.argv[1] = fakePi;
	subagentExtension(pi);
	const fire = async (e: string, p: unknown = {}) => {
		for (const h of handlers.get(e) ?? []) await h(p, ctx);
	};
	const tool = tools.find((t) => t.name === "subagent");
	return {
		sent,
		fire,
		run: (params: object) => tool.execute("call", params, new AbortController().signal, undefined, ctx),
		reload: async () => {
			await fire("session_shutdown", { reason: "reload" });
			stale = true;
		},
		restoreArgv: () => {
			process.argv[1] = savedArgv;
		},
	};
}

async function waitFor<T>(what: string, probe: () => T | undefined | false): Promise<T> {
	const end = Date.now() + 8000;
	for (;;) {
		const v = probe();
		if (v) return v;
		if (Date.now() > end) assert.fail(`timeout waiting for ${what}`);
		await new Promise((r) => setTimeout(r, 50));
	}
}

test('D15: /reload com tasks:[2] em curso; as duas faixas terminam e o texto entregue traz os dois resultados, sem "stale"', async () => {
	const a = instance();
	let b: ReturnType<typeof instance> | undefined;
	try {
		await a.fire("session_start");
		const started = await a.run({
			tasks: [
				{ agent: "fake", task: "p1" },
				{ agent: "fake", task: "p2" },
			],
		});
		assert.match(started.content[0].text, /background/i);
		await a.reload();
		b = instance();
		await b.fire("session_start");
		release("p1"); // a primeira faixa termina sozinha; a segunda ainda roda
		await new Promise((r) => setTimeout(r, 400));
		release("p2");
		const msg = await waitFor("mensagem de conclusão", () =>
			b!.sent.find((m) => m.content.startsWith("Background subagent call finished")),
		);
		assert.match(msg.content, /feito:p1/);
		assert.match(msg.content, /feito:p2/);
		assert.doesNotMatch(msg.content, /stale/i);
	} finally {
		release("p1");
		release("p2");
		await (b ?? a).fire("session_shutdown", { reason: "reload" }).catch(() => {});
		const dir = store.currentFleetDir();
		for (const r of dir ? store.readRecords(dir) : [])
			if (r.pid && r.state === "running")
				try {
					process.kill(-r.pid, "SIGKILL");
				} catch {
					/* já saiu */
				}
		store.removeFleetDir();
		bgMod.resetBackgroundRuns();
		a.restoreArgv();
	}
});

test("D15: um onPhase que lança (pi velho) não troca o resultado da faixa nem derruba a chamada", async () => {
	const runMod = await import("../../../../../src/extensions/subagent/core/run.ts");
	const savedArgv = process.argv[1];
	process.argv[1] = fakePi;
	release("solo");
	try {
		const agent = {
			name: "fake",
			description: "f",
			systemPrompt: "x",
			source: "user",
			filePath: join(tmp, "fake.md"),
		};
		const res = await runMod.runSingleAgent({
			defaultCwd: tmp,
			agents: [agent as any],
			agentName: "fake",
			task: "solo",
			makeDetails: () => ({}) as any,
			onPhase: () => {
				throw new Error(STALE);
			},
		});
		assert.equal(res.exitCode, 0);
		assert.match(JSON.stringify(res.messages), /feito:solo/);
	} finally {
		process.argv[1] = savedArgv;
		store.removeFleetDir();
	}
});

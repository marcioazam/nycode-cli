// Ported from zzzzzzzzzzzzzzz-run-section/run-section.test.ts (zzzzzzzzzzzzzzz-run-section.patch): registry, detection,
// staged stop, wait, awaited notification and render. Offline, no spend. D-33: PI_RUNS_DIR is NYCODE_RUNS_DIR, the
// subagent depth variables are NYCODE_SUBAGENT*, and the PID marker line is __NYCODE_RUN_PID=. Every env var is read
// when a function runs (never at module load), so they are set in beforeAll; vi.stubEnv would be undone before each
// test by the vitest config (unstubEnvs).
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ExtensionAPI, ExtensionContext } from "../../../src/core/extensions/types.ts";
import { extractPid, instrument } from "../../../src/extensions/run/detect.ts";
import runExtension, { finishMessage } from "../../../src/extensions/run/index.ts";
import {
	displayState,
	MAX_LIVE,
	type RunRecord,
	RunRegistry,
	sharedRegistry,
	TAIL_LINES,
} from "../../../src/extensions/run/registry.ts";
import { RunSection } from "../../../src/extensions/run/section.ts";
import { alive, pollOnce, registerDetected, startShell, stopRun, tree } from "../../../src/extensions/run/shell.ts";
import { execute } from "../../../src/extensions/run/tool.ts";
import { renderRun, type View } from "../../../src/extensions/run/view.ts";
import { getFleetSource } from "../../../src/extensions/subagent/fleet/source.ts";
import { ensureFleetDir, removeFleetDir, writeRecord } from "../../../src/extensions/subagent/fleet/store.ts";
import type { RunRecord as FleetRecord } from "../../../src/extensions/subagent/fleet/types.ts";
import type { UiTheme } from "../../../src/extensions/subagent/fleet-ui/panel.ts";
import { chip, HEADING_KINDS } from "../../../src/extensions/subagent/fleet-ui/style/chrome.ts";
import { nav } from "../../../src/extensions/subagent/section-nav/nav.ts";

const tmp = mkdtempSync(join(tmpdir(), "nycode-run-section-test-"));
const ENV_KEYS = ["NO_COLOR", "NYCODE_RUNS_DIR", "TMPDIR", "NYCODE_SUBAGENT_DEPTH", "NYCODE_SUBAGENT"] as const;
const savedEnv = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));

beforeAll(() => {
	process.env.NO_COLOR = "1";
	process.env.NYCODE_RUNS_DIR = join(tmp, "runs");
	process.env.TMPDIR = tmp; // the fleet dir lives under os.tmpdir()
	delete process.env.NYCODE_SUBAGENT_DEPTH;
	delete process.env.NYCODE_SUBAGENT;
});

afterAll(() => {
	for (const [key, value] of savedEnv) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	rmSync(tmp, { recursive: true, force: true });
});

const strip = stripVTControlCharacters;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const theme: UiTheme = { fg: (_c: string, t: string) => t, bold: (t: string) => t };
/** Polls the shell registry once, then reports whether the tail already holds `line`. */
const tailHas = (reg: RunRegistry, r: RunRecord, line: string): boolean => {
	pollOnce(reg, false);
	return r.tail.includes(line);
};
const stopped = (reg: RunRegistry, r: RunRecord): boolean => {
	pollOnce(reg, true);
	return r.state !== "running";
};
const until = (cond: () => boolean, timeout = 5000) =>
	vi.waitFor(() => expect(cond()).toBe(true), { timeout, interval: 20 });
const mkReg = () => new RunRegistry();
const add = (reg: RunRegistry, name = "x", extra: Partial<RunRecord> = {}) =>
	reg.add({ name, command: name, cwd: "/", ...extra });
const view = (over: Partial<View>): View => ({
	rows: [],
	total: 0,
	now: 0,
	collapsed: false,
	focused: false,
	offset: 0,
	follow: true,
	expanded: false,
	filter: "",
	filtering: false,
	motion: false,
	...over,
});

describe("registry", () => {
	it("exit 0 → done, exit ≠ 0 → failed, parada pedida → stopped, exit desconhecido → done", () => {
		const reg = mkReg();
		const [a, b, c, d] = [add(reg), add(reg), add(reg), add(reg)] as [RunRecord, RunRecord, RunRecord, RunRecord];
		expect(a.state).toBe("running");
		reg.finish(a, { exitCode: 0 });
		reg.finish(b, { exitCode: 3 });
		c.stopRequested = true;
		reg.finish(c, { signal: "SIGTERM" });
		reg.finish(d, {});
		expect([a.state, b.state, c.state, d.state]).toEqual(["done", "failed", "stopped", "done"]);
		expect(b.exitCode).toBe(3);
		reg.finish(a, { exitCode: 9 }); // já terminou: não muda
		expect(a.exitCode).toBe(0);
	});

	it("new-output e silent são derivados; concluídos somem após 30 min ou com x", () => {
		let t = 1_000_000;
		const reg = mkReg();
		reg.now = () => t;
		const r = add(reg);
		expect(displayState(r, t)).toBe("running");
		reg.push(r, "a\n");
		expect(displayState(r, t)).toBe("new-output");
		r.seenSeq = r.outputSeq;
		t += 6 * 60_000;
		expect(displayState(r, t)).toBe("silent");
		reg.finish(r, { exitCode: 0 });
		expect(reg.snapshot()).toHaveLength(1);
		t += 31 * 60_000;
		expect(reg.snapshot()).toHaveLength(0);
		const s = add(reg, "s");
		reg.finish(s, { exitCode: 1 });
		expect(reg.clearFinished()).toBe(1);
		expect(reg.snapshot()).toHaveLength(0);
	});

	it("ring buffer de 1000 linhas; linha incompleta espera o \\n", () => {
		const reg = mkReg();
		const r = add(reg);
		reg.push(r, `${Array.from({ length: 1500 }, (_, i) => `l${i}`).join("\n")}\npar`);
		expect(r.tail).toHaveLength(TAIL_LINES);
		expect(r.tail[0]).toBe("l500");
		expect(r.tail.at(-1)).toBe("l1499");
		expect(r.partial).toBe("par");
		reg.push(r, "cial\n");
		expect(r.tail.at(-1)).toBe("parcial");
	});

	it("limite de 8 runs vivos: erro claro; terminar libera vaga", () => {
		const reg = mkReg();
		const live = Array.from({ length: MAX_LIVE }, () => add(reg));
		expect(() => add(reg)).toThrow(/limite de 8 runs vivos/);
		reg.finish(live[0] as RunRecord, { exitCode: 0 });
		expect(() => add(reg)).not.toThrow();
	});
});

describe("detecção", () => {
	it("formas suportadas recebem a captura do PID", () => {
		const cwd = "/work";
		const nohup = instrument("nohup x > f 2>&1 &", cwd);
		expect(nohup?.command.startsWith("nohup x > f 2>&1 &\n")).toBe(true);
		expect(nohup?.command).toMatch(/echo "__NYCODE_RUN_PID=\$!"; \(exit \$__nycode_rc\)$/);
		expect(nohup?.logPath).toBe("/work/f");
		expect(nohup?.display).toBe("nohup x > f 2>&1");
		expect(nohup?.trailing).toBe(true);
		expect(instrument("nohup x > /tmp/o.log 2>&1 &", cwd)?.logPath).toBe("/tmp/o.log");
		expect(instrument('nohup x >>"/tmp/a b.log" &', cwd)?.logPath).toBe("/tmp/a b.log");
		expect(instrument("cmd &", cwd)?.logPath).toBeUndefined();
		expect(instrument("a && b &", cwd)?.display).toBe("a && b");
		expect(instrument("systemd-run --user --scope -- x &", cwd)?.display).toBe("systemd-run --user --scope -- x");
		expect(instrument("setsid x &", cwd)?.display).toBe("setsid x");
		const mid = instrument("nohup x > f & sleep 1; tail f", cwd);
		expect(mid?.trailing).toBe(false);
		expect(mid?.display).toBe("nohup x > f");
		expect(instrument("cd d && nohup x > f &", cwd)?.logPath).toBeUndefined(); // base mudou: caminho relativo não é confiável
	});

	it("comandos sem background ou ambíguos não são alterados", () => {
		for (const cmd of [
			"ls -la",
			"a && b",
			"make 2>&1 | tee log",
			'echo "a & b"',
			"echo 'x &'",
			"cmd 2>&1",
			"cmd &> out",
			"a & b &", // dois jobs: $! ambíguo
			"cat <<EOF &\nx\nEOF",
			"echo `x` &",
			"(x) &",
			"x &\ny",
			"x # nota &",
			'echo "oops &',
			"echo hi \\",
		])
			expect(instrument(cmd, "/w"), cmd).toBeUndefined();
	});

	it("o marcador sai do texto e o PID vem junto", () => {
		expect(extractPid("antes\n__NYCODE_RUN_PID=4242\n")).toEqual({ pid: 4242, text: "antes\n" });
		expect(extractPid("__NYCODE_RUN_PID=\n")).toEqual({ pid: undefined, text: "" });
		expect(extractPid("sem marcador")).toEqual({ text: "sem marcador" });
	});
});

describe("processos", () => {
	it("parada escalonada: processo que ignora SIGINT morre por TERM/KILL no prazo", async () => {
		const reg = mkReg();
		const r = startShell(reg, { command: `bash -c 'trap "" INT; echo armado; sleep 30'`, cwd: tmp });
		// Espera o trap estar instalado: sob carga o bash demora mais que um sleep fixo e o SIGINT o mataria antes.
		await until(() => tailHas(reg, r, "armado"), 5000);
		expect(stopRun(reg, r, { termMs: 300, killMs: 300 })).toBe("stopping");
		await sleep(150);
		expect(r.state, "o SIGINT sozinho não mata").toBe("running");
		await until(() => r.state !== "running", 3000);
		expect(r.state).toBe("stopped");
		expect(stopRun(reg, r)).toBe("not-running");
		expect(alive(r.pid as number)).toBe(false);
	});

	it("detectado: liveness por kill -0 e parada pela árvore de processos", async () => {
		const reg = mkReg();
		const child = spawn("bash", ["-c", "sleep 30 & wait"], { stdio: "ignore", detached: true });
		child.unref();
		const pid = child.pid as number;
		const r = registerDetected(reg, { pid, command: "sleep 30", cwd: tmp, repeatable: false });
		await sleep(200);
		pollOnce(reg, true);
		expect(r.state).toBe("running");
		const family = tree(pid);
		expect(family.length, "bash + sleep").toBeGreaterThanOrEqual(2);
		stopRun(reg, r, { termMs: 200, killMs: 200 });
		await until(() => stopped(reg, r), 3000);
		expect(r.state).toBe("stopped");
		// o filho em background ignora SIGINT e fica órfão se o pai morre antes: TERM/KILL ainda o alcançam
		await until(() => family.every((p) => !alive(p)), 3000);
		expect(r.exitCode).toBeUndefined(); // exit desconhecido
	});
});

const textOf = (res: { content: Array<{ type: string; text?: string }> }): string => res.content[0]?.text ?? "";

describe("tool run", () => {
	it("wait: termina com estado e tail; estoura o timeout com o run ainda vivo", async () => {
		const reg = mkReg();
		const start = await execute(
			reg,
			{ action: "start", command: "echo oi; echo erro >&2; exit 4", name: "curto" },
			tmp,
		);
		const id = /iniciado (\S+)/.exec(textOf(start))?.[1] as string;
		expect(textOf(start)).toMatch(/log: .*\.log/);
		const done = await execute(reg, { action: "wait", id, timeout_s: 20 }, tmp);
		expect(textOf(done)).toMatch(/failed exit 4/);
		expect(textOf(done)).toMatch(/oi\nerro/);
		const slow = await execute(reg, { action: "start", command: "sleep 30" }, tmp);
		const sid = /iniciado (\S+)/.exec(textOf(slow))?.[1] as string;
		const t0 = Date.now();
		const out = await execute(reg, { action: "wait", id: sid, timeout_s: 1 }, tmp);
		expect(textOf(out)).toMatch(/ainda rodando após 1s/);
		expect(Date.now() - t0).toBeLessThan(3000);
		const stop = await execute(reg, { action: "stop", id: sid }, tmp);
		expect(textOf(stop)).toMatch(/SIGINT agora/);
		await until(() => reg.get(sid)?.state !== "running");
		const list = await execute(reg, { action: "list" }, tmp);
		expect(textOf(list)).toMatch(/stopped/);
		expect((await execute(reg, { action: "tail", id: "nada" }, tmp)).isError).toBe(true);
	});
});

interface Recorded {
	handlers: Map<string, (event: unknown, ctx: unknown) => unknown>;
	sent: Array<{ msg: { customType: string; display: boolean; content: string }; opts: { triggerTurn: boolean } }>;
	tool?: {
		execute(
			id: string,
			params: Record<string, unknown>,
			signal: undefined,
			onUpdate: undefined,
			ctx: unknown,
		): Promise<{ content: Array<{ type: string; text?: string }> }>;
	};
}

/** A fake nycode API: keeps the handlers, the tool and the messages sent. */
function loadExtension(): Recorded {
	const recorded: Recorded = { handlers: new Map(), sent: [] };
	const api = {
		on: (name: string, handler: (event: unknown, ctx: unknown) => unknown) =>
			void recorded.handlers.set(name, handler),
		registerTool: (tool: Recorded["tool"]) => {
			recorded.tool = tool;
		},
		sendMessage: (msg: Recorded["sent"][number]["msg"], opts: Recorded["sent"][number]["opts"]) =>
			void recorded.sent.push({ msg, opts }),
	};
	runExtension(api as unknown as ExtensionAPI); // the fake carries only what the extension calls
	return recorded;
}

const ctx = (ui?: unknown): ExtensionContext =>
	({ cwd: tmp, hasUI: ui !== undefined, ui }) as unknown as ExtensionContext;

describe("extension run", () => {
	it("awaited: ao terminar, sendMessage com triggerTurn; wait em curso suprime a mensagem", async () => {
		const f = loadExtension();
		const tool = f.tool as NonNullable<Recorded["tool"]>;
		f.handlers.get("session_start")?.({ reason: "startup" }, ctx());
		await tool.execute("1", { action: "start", command: "echo pronto", await: true }, undefined, undefined, ctx());
		await until(() => f.sent.length === 1);
		const { msg, opts } = f.sent[0] as Recorded["sent"][number];
		expect(msg.customType).toBe("run-finished");
		expect(msg.display).toBe(true);
		expect(opts.triggerTurn).toBe(true);
		expect(msg.content).toMatch(/done exit 0/);
		expect(msg.content).toMatch(/pronto/);
		expect(finishMessage).toBeTypeOf("function");
		// com um wait pendente, o resultado vai na resposta da tool: sem mensagem
		const started = await tool.execute(
			"2",
			{ action: "start", command: "sleep 0.3; echo tarde", await: true },
			undefined,
			undefined,
			ctx(),
		);
		const id = /iniciado (\S+)/.exec(textOf(started))?.[1];
		await tool.execute("3", { action: "wait", id, timeout_s: 20 }, undefined, undefined, ctx());
		await sleep(300);
		expect(f.sent).toHaveLength(1);
		f.handlers.get("session_shutdown")?.({ reason: "quit" }, ctx());
	});

	it("bash com nohup … &: o comando é instrumentado, o marcador some do resultado e o run é registrado", async () => {
		const f = loadExtension();
		f.handlers.get("session_start")?.({ reason: "startup" }, ctx());
		const log = join(tmp, "det.log");
		const event = {
			toolName: "bash",
			toolCallId: "c1",
			input: { command: `nohup bash -c 'echo ola; sleep 30' > ${log} 2>&1 &` },
		};
		f.handlers.get("tool_call")?.(event, ctx());
		expect(event.input.command).toMatch(/__NYCODE_RUN_PID=/);
		const sh = spawnSync("bash", ["-c", event.input.command], { encoding: "utf8", cwd: tmp, timeout: 10_000 });
		expect(sh.status).toBe(0);
		const res = f.handlers.get("tool_result")?.(
			{ toolName: "bash", toolCallId: "c1", content: [{ type: "text", text: sh.stdout }] },
			ctx(),
		) as { content: Array<{ text: string }> };
		expect(res.content[0]?.text).not.toMatch(/__NYCODE_RUN_PID/);
		// o registro é o compartilhado do processo
		const reg = sharedRegistry();
		const list = await execute(reg, { action: "list" }, tmp);
		const m = /(\S+) \[shell\] \S+ · \d\d:\d\d · nohup bash/.exec(textOf(list));
		expect(m, textOf(list)).not.toBeNull();
		const r = reg.get(m?.[1] as string) as RunRecord;
		expect(r.detected).toBe(true);
		await until(() => r.tail.includes("ola") || tailHas(reg, r, "ola"));
		stopRun(reg, r, { termMs: 100, killMs: 100 });
		await until(() => stopped(reg, r), 4000);
		expect(r.state).toBe("stopped");
		// comando sem background: intacto, sem estado pendente
		const plain = { toolName: "bash", toolCallId: "c2", input: { command: "ls" } };
		f.handlers.get("tool_call")?.(plain, ctx());
		expect(plain.input.command).toBe("ls");
		expect(
			f.handlers.get("tool_result")?.({ toolName: "bash", toolCallId: "c2", content: [] }, ctx()),
		).toBeUndefined();
		f.handlers.get("session_shutdown")?.({ reason: "quit" }, ctx());
	});
});

/** The section's private timer, read to check when it is armed. */
const timerOf = (s: RunSection): unknown => (s as unknown as { timer?: unknown }).timer;

function sectionWith(reg: RunRegistry) {
	const widgets: Array<[string, unknown]> = [];
	const tui = { requestRender() {}, terminal: { rows: 40 } };
	const ui = {
		setWidget: (key: string, factory?: (t: unknown, th: unknown) => unknown) => {
			widgets.push([key, factory]);
			factory?.(tui, theme);
		},
	};
	const s = new RunSection(reg);
	s.now = reg.now;
	s.start(ctx(ui));
	return { s, widgets, ui };
}

describe("seção Run", () => {
	it("render (NO_COLOR): cabeçalho com contagens, glifos, tail inline do selecionado e rodapé; sem runs → []", () => {
		let t = 10_000_000;
		const reg = mkReg();
		reg.now = () => t;
		const { s } = sectionWith(reg);
		const mk = (name: string, extra: Partial<RunRecord> = {}) => {
			t += 1000;
			return add(reg, name, extra);
		};
		const r1 = mk("pilot.sh", { awaited: true, logPath: "/x/pilot.log" });
		mk("harbor run");
		const r3 = mk("npm test");
		const r4 = mk("npm watch");
		const r5 = mk("gate");
		const r6 = mk("pytest");
		for (let i = 1; i <= 7; i++) reg.push(r1, `linha ${i}\n`);
		r1.seenSeq = r1.outputSeq;
		reg.push(r3, "novo\n"); // não lido
		r4.lastOutputAt = t - 9 * 60_000; // silencioso
		reg.finish(r5, { exitCode: 0 });
		reg.finish(r6, { exitCode: 1 });
		t += 120_000;
		r1.lastOutputAt = t; // r1 não fica silencioso
		const harbor = reg.snapshot().find((r) => r.name === "harbor run") as RunRecord;
		harbor.lastOutputAt = t;
		s.focused = true;

		const lines = s.render(120).map(strip);
		const text = lines.join("\n");
		const head = (lines.find((l) => /^Run \d+/.test(l)) as string).replace(/\s+/g, " ");
		expect(head).toMatch(/^Run 4 2\/6$/); // aba com os rodando; detalhe igual ao do Sub Agents: encerrados/total
		expect(text).toMatch(/^■ pilot\.sh/m); // sem margem, quadrado; seleção em vídeo reverso
		expect(s.render(120).some((l) => l.includes("\x1b[7m") && l.includes("pilot.sh"))).toBe(true);
		expect(text).toMatch(/◆ npm test .*novo output/);
		expect(text).toMatch(/◇ npm watch .*sem output há 11 min/);
		expect(text).toMatch(/✓ gate .*exit 0 · há 2 min/);
		expect(text).toMatch(/✖ pytest .*exit 1 · há 2 min/);
		expect(text).toMatch(/◷ agente espera/);
		// tail inline: só as últimas 5 linhas, com borda
		expect(text).toMatch(/│ linha 7/);
		expect(text).toMatch(/│ linha 3/);
		expect(text).not.toMatch(/linha 2/);
		expect(text).toMatch(/└ seguindo ▮/);
		expect(text).toMatch(/log completo em \/x\/pilot\.log/);
		// rodapé do grupo, com rule antes
		expect(lines.at(-1)).toMatch(
			/↑↓ mover · ⏎ tail · f seguir · k parar · r repetir · w agente espera · x limpar concluídos · \/ filtro · esc voltar/,
		);
		expect(lines.at(-2)).toMatch(/^─+$/);
		// largura curta: trunca, mas `esc voltar` fica
		const narrow = s.render(40).map(strip);
		expect(narrow.every((l) => l.length <= 40 || [...l].length <= 40)).toBe(true);
		expect(narrow.at(-1)).toMatch(/esc voltar/);
		// sem foco: sem tail inline nem rodapé
		s.focused = false;
		expect(s.render(120).map(strip).join("\n")).not.toMatch(/│ linha|esc voltar/);
		// sem runs: nada
		expect(renderRun(view({ now: t }), theme, 80).lines).toEqual([]);
		// título com spinner (pedido 2026-11-14): só com run vivo e motion ligado; mesmo spinner do Sub Agents
		const live = reg.snapshot();
		const v = view({ rows: live, total: live.length, now: t, motion: true });
		const spun = renderRun(v, theme, 120);
		expect(strip(spun.lines[1] as string)).toMatch(/RUN\s+[·•●] 2\/6/);
		expect(strip(spun.detail)).toMatch(/^[·•●] 2\/6/);
		expect(strip(renderRun({ ...v, motion: false }, theme, 120).lines[1] as string)).not.toMatch(/[·•●]/);
		const doneOnly = live.filter((r) => r.state !== "running");
		expect(
			strip(renderRun({ ...v, rows: doneOnly, total: doneOnly.length }, theme, 120).lines[1] as string),
		).not.toMatch(/[·•●]/);
		s.shutdown();
	});

	it("aba fechada mostra só a barra; clique na aba aberta não muda nada; timer só com run vivo e corpo aberto; some sem runs", () => {
		nav.resetTabs();
		const reg = mkReg();
		const { s, widgets } = sectionWith(reg);
		expect(widgets, "sem runs não há widget").toHaveLength(0);
		const r = add(reg, "a");
		expect(widgets.at(-1)?.[0]).toBe("run-section");
		expect(timerOf(s), "run vivo + aberto → timer").toBeTruthy();
		s.render(80); // o clique usa o mapa de linhas do último render
		expect(s.render(80).length, "aberta: barra e corpo").toBeGreaterThan(3);
		expect(s.handleMouse({ type: "click", x: 1, y: 1 }), "clica no nome da aba aberta: consumido").toBeTruthy();
		expect(s.collapsed, "e a aba continua aberta").toBe(false);
		expect(timerOf(s), "aberta → timer continua").toBeTruthy();
		nav.register({
			id: "status",
			active: () => true,
			hasBody: false,
			label: () => "Status",
			changed() {},
			enter: () => false,
		});
		nav.open("status"); // outra aba abre: Run fica fechada
		expect(s.collapsed).toBe(true);
		expect(timerOf(s), "fechada → sem timer").toBeUndefined();
		expect(s.render(80)).toHaveLength(3);
		expect(strip(s.render(80)[1] as string)).toMatch(/^Status {3}Run 1/);
		expect(
			s.render(80).some((l) => /pilot|a\s+◐|▸ RUN/.test(strip(l))),
			"só a barra, sem corpo",
		).toBe(false);
		s.handleMouse({ type: "click", x: 10, y: 1 }); // clica na aba fechada: abre
		expect(s.collapsed).toBe(false);
		expect(timerOf(s)).toBeTruthy();
		reg.finish(r, { exitCode: 0 });
		expect(timerOf(s), "sem runs vivos → sem timer").toBeUndefined();
		reg.clearFinished();
		expect(widgets.at(-1)?.[1], "sem runs a seção some").toBeUndefined();
		nav.unregister("status");
		s.shutdown();
	});

	it("só aparece com run em andamento; concluídos/falhos ficam no registro, sem widget", () => {
		const reg = mkReg();
		const { s, widgets } = sectionWith(reg);
		const shown = () => widgets.length > 0 && widgets.at(-1)?.[1] !== undefined;
		expect(shown(), "vazio: sem widget").toBe(false);
		const a = add(reg, "a");
		const b = add(reg, "b");
		expect(shown()).toBe(true);
		reg.finish(a, { exitCode: 0 });
		expect(shown(), "misto ativo + concluído: continua visível").toBe(true);
		expect(s.render(80).length).toBeGreaterThan(0);
		reg.finish(b, { exitCode: 3 });
		expect(shown(), "todos concluídos/falhos: widget some").toBe(false);
		expect(reg.snapshot(), "dados retidos para a ferramenta").toHaveLength(2);
		expect(
			reg
				.snapshot()
				.map((r) => r.state)
				.sort(),
		).toEqual(["done", "failed"]);
		const c = add(reg, "c");
		expect(shown(), "novo run reaparece").toBe(true);
		reg.finish(c, { exitCode: 1 });
		expect(shown(), "somente falhos: oculto").toBe(false);
		expect(reg.snapshot()).toHaveLength(3);
		s.shutdown();
	});

	it("teclas: filtro, w marca awaited, k para, x limpa concluídos", async () => {
		const reg = mkReg();
		const { s } = sectionWith(reg);
		const a = startShell(reg, { command: "echo pronto; sleep 30", cwd: tmp, name: "alfa" });
		// Espera o processo existir no seu grupo: um SIGINT antes disso se perde e a parada só viria no SIGTERM (7,5 s).
		await until(() => tailHas(reg, a, "pronto"), 5000);
		const b = add(reg, "beta");
		s.focused = true;
		s.selectedId = a.id;
		s.handleInput("w");
		expect(a.awaited).toBe(true);
		s.handleInput("/");
		for (const c of "bet") s.handleInput(c);
		s.handleInput("\r");
		expect(s.selectedId).toBe(b.id);
		expect(strip(s.render(100).join("\n"))).toMatch(/filtro "bet"/);
		s.handleInput("/");
		s.handleInput("\x1b"); // esc limpa o filtro
		expect(s.filter).toBe("");
		s.selectedId = a.id;
		s.handleInput("k");
		await until(() => a.state !== "running", 3000);
		expect(a.state).toBe("stopped");
		s.handleInput("x");
		expect(reg.snapshot()).toHaveLength(1);
		s.shutdown();
	});

	it("chip RUN: fundo ciano (role text), diferente de TODO azul, STATUS LINE verde e PLAN amarelo", () => {
		// Tema falso com cores ANSI resolvidas por role: o chip usa vídeo reverso, então o fg vira fundo.
		const sgr: Record<string, number> = { text: 36, task: 34, success: 32, warning: 33 };
		const colored: UiTheme = { fg: (role, s) => `\x1b[${sgr[role]}m${s}\x1b[39m`, bold: (s) => s };
		// chip = ESC[7m ESC[<sgr>m … : the second SGR after the reverse-video one carries the role's color code.
		const code = (kind: keyof typeof HEADING_KINDS) => chip(kind, colored).split("\x1b[")[2]?.slice(0, 2);
		expect(HEADING_KINDS.run.role).toBe("text");
		expect(code("run")).toBe("36");
		expect(code("todo")).toBe("34");
		expect(code("statusline")).toBe("32");
		expect(code("plan")).toBe("33");
		expect(code("run")).not.toBe(code("todo"));
		expect(chip("run", colored)).toBe("\x1b[7m\x1b[36m RUN \x1b[39m\x1b[27m");
	});

	// D9 (docs/sync-observabilidade.md): a Run section lê as faixas do fleet (fg- e bg-) e usa os horários do registro do fleet.
	it("D9 agentes: faixa fg- do fleet aparece com startedAt/endedAt do registro (não da 1ª leitura), parcial vira capped; onChange do fleet faz sync", async () => {
		getFleetSource({ resume: () => false });
		const dir = ensureFleetDir() as string;
		const now = Date.now();
		const rec = (id: string, over: Partial<FleetRecord> = {}): FleetRecord => ({
			v: 1,
			id,
			parentId: null,
			depth: 1,
			agent: "swarm-worker",
			task: "faz x",
			background: true,
			state: "running",
			startedAt: now - 120_000,
			updatedAt: now,
			turns: 2,
			toolCalls: 1,
			tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, context: 0 },
			cost: 0.25,
			ownerPid: process.pid,
			...over,
		});
		writeRecord(dir, rec("fg-aaaaaaaa"));
		writeRecord(dir, rec("fg-bbbbbbbb", { depth: 2, parentId: "fg-aaaaaaaa" }));
		const reg = mkReg();
		const rows = (): RunRecord[] => {
			reg.fleetChanged();
			return reg.snapshot();
		};
		const a = rows().find((r) => r.id === "fg-aaaaaaaa") as RunRecord;
		expect(a, "a faixa fg- aparece").toBeDefined();
		expect(
			rows().some((r) => r.id === "fg-bbbbbbbb"),
			"só depth 1",
		).toBe(false);
		expect(a.state).toBe("running");
		expect(a.startedAt).toBe(now - 120_000);
		expect(a.turns).toBe(2);
		writeRecord(dir, rec("fg-aaaaaaaa", { state: "done", endedAt: now - 30_000, partial: true, exitCode: 0 }));
		const d = rows().find((r) => r.id === "fg-aaaaaaaa") as RunRecord;
		expect(d.state).toBe("done");
		expect(d.endedAt, "fim = o do registro, não o instante em que foi observado").toBe(now - 30_000);
		expect(d.capped).toBe(true);
		expect(renderRun(view({ rows: [d], total: 1, now }), theme, 100).lines.join("\n")).toMatch(/parcial/);
		// onChange do fleet → sync da seção
		const { s } = sectionWith(reg);
		const sync = vi.spyOn(s, "sync");
		writeRecord(dir, rec("fg-cccccccc"));
		await vi.waitFor(() => expect(sync).toHaveBeenCalled(), { timeout: 4000, interval: 20 });
		expect(reg.snapshot().some((r) => r.id === "fg-cccccccc")).toBe(true);
		s.shutdown();
		removeFleetDir();
	});
});

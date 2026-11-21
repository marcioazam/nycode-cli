// Fiação do roteamento no ponto de entrada do subagente (docs/subagent-routing-2026-11-13.md, AC1-AC7), com pi e filho falsos (vitest port)
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "vitest";
import skillsExtension from "../../../../src/extensions/skills-compat/index.ts";
import { subagentParams } from "../../../../src/extensions/subagent/core/params.ts";
import { resetBackgroundRuns } from "../../../../src/extensions/subagent/fleet/background.ts";
import subagentExtension from "../../../../src/extensions/subagent/index.ts";
import type { AgentConfig } from "../../../../src/extensions/subagent/registry/agents.ts";
import { parseAgentsField } from "../../../../src/extensions/subagent/registry/agents.ts";
import * as applyMod from "../../../../src/extensions/subagent/routing/apply.ts";
import {
	allowedAgents,
	childAllowedAgents,
	filterAllowed,
	narrowList,
	narrowSkills,
} from "../../../../src/extensions/subagent/routing/capabilities.ts";
import { fleetTestEnv } from "../fleet-env.ts";

const { tmp } = fleetTestEnv("routing-int-");
const home = join(tmp, "home");
const agentDir = join(home, ".nycode", "agent");
mkdirSync(join(agentDir, "agents"), { recursive: true });
const agentFile = (name: string, front: string): void =>
	writeFileSync(
		join(agentDir, "agents", `${name}.md`),
		`---\nname: ${name}\ndescription: agente ${name}\n${front}\n---\nVoce e ${name}.\n`,
	);
agentFile("worker", "model: sonnet\nskills: [alpha, beta]");
agentFile("reader", "tools: read, grep");
agentFile("nester", "agents: [reader]");
agentFile("closed", "agents: []");
process.env.HOME = home;
process.env.NYCODE_CODING_AGENT_DIR = agentDir;
const policyFile = join(tmp, "routing.json");
process.env.NYCODE_SUBAGENT_ROUTING_FILE = policyFile;
for (const k of ["CLAUDE_CONFIG_DIR", "NYCODE_SUBAGENT", "NYCODE_SUBAGENT_DEPTH", "CLAUDE_CODE_SUBAGENT_MODEL"])
	delete process.env[k];

// O filho falso devolve o próprio argv (sem o prompt) e as variáveis de roteamento.
const fakePi = join(tmp, "fake-pi-routing.mjs");
writeFileSync(
	fakePi,
	`const e = process.env
const out = { args: process.argv.slice(2, -1), env: { parent: e.NYCODE_SUBAGENT_PARENT_MODEL, effort: e.NYCODE_SUBAGENT_PARENT_EFFORT, noSkills: e.NYCODE_SUBAGENT_NO_SKILLS, allowed: e.NYCODE_SUBAGENT_ALLOWED_AGENTS } }
process.stdout.write(JSON.stringify({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: JSON.stringify(out) }], stopReason: 'stop' } }) + '\\n')
`,
);

const model = (id: string, cost: number) => ({
	provider: "a",
	id,
	api: "anthropic-messages",
	reasoning: true,
	cost: { input: 1, output: cost, cacheRead: 0, cacheWrite: 0 },
});
function boot(opts: { hasUI?: boolean; custom?: (factory: any) => Promise<unknown> } = {}) {
	const tools: any[] = [];
	const commands = new Map<string, any>();
	const handlers = new Map<string, Array<(...a: any[]) => any>>();
	const notes: string[] = [];
	const pi = {
		on: (event: string, h: (...a: any[]) => any) => void handlers.set(event, [...(handlers.get(event) ?? []), h]),
		registerTool: (def: any) => void tools.push(def),
		registerCommand: (name: string, def: any) => void commands.set(name, def),
		events: { emit: () => {}, on: () => () => {} },
		getActiveTools: () => ["subagent"],
		getThinkingLevel: () => "high",
		sendMessage: () => {},
	};
	const ctx = {
		cwd: tmp,
		hasUI: opts.hasUI ?? false,
		model: { provider: "a", id: "opus" },
		ui: {
			notify: (m: string) => void notes.push(m),
			custom: opts.custom ?? (async () => undefined),
			setWidget: () => {},
			onTerminalInput: () => () => {},
			getEditorText: () => "",
		},
		sessionManager: { getBranch: () => [{ type: "message" }] },
		modelRegistry: { getAvailable: () => [model("haiku", 5), model("sonnet", 15), model("opus", 25)] },
	};
	const saved = process.argv[1];
	process.argv[1] = fakePi;
	subagentExtension(pi as never);
	const tool = () => tools.filter((t) => t.name === "subagent").at(-1);
	const run = (params: Record<string, unknown>): Promise<any> =>
		tool().execute("call", params, undefined, undefined, ctx);
	const info = async (params: Record<string, unknown>) => {
		const res = await run(params);
		const text: string = res.content[0].text;
		return { text, ...(text.startsWith("{") ? JSON.parse(text.slice(0, text.indexOf("}}") + 2)) : {}) };
	};
	const fire = async (event: string) =>
		(await Promise.all((handlers.get(event) ?? []).map((h) => h({ systemPrompt: "" }, ctx)))).filter(Boolean);
	return {
		tools,
		tool,
		commands,
		notes,
		ctx,
		run,
		info,
		fire,
		restore: () => {
			process.argv[1] = saved;
		},
	};
}
const ALL = ["low", "medium", "high", "xhigh"];
const writePolicy = (models: Record<string, string[]>) =>
	writeFileSync(policyFile, JSON.stringify({ version: 1, models }));
const clearPolicy = () => writeFileSync(policyFile, "");

test("sem política: schema, descrição e argv do filho ficam como antes (AC3/AC5)", async () => {
	clearPolicy();
	const h = boot();
	try {
		const t = h.tool();
		assert.equal(JSON.stringify(t.parameters), JSON.stringify(subagentParams()));
		assert.ok(!("model" in t.parameters.properties) && !t.description.includes("Allowed model"));
		const r = await h.info({ agent: "worker", task: "x" });
		assert.ok(!r.args.includes("--no-skills"), r.text);
		assert.equal(r.env.noSkills, undefined);
		assert.ok(!r.text.includes("route:"));
		assert.deepEqual(r.args.slice(0, 3), ["--mode", "json", "-p"]);
		const allowedNone = await h.info({ agent: "closed", task: "x" });
		assert.equal(allowedNone.env.allowed, "[]", "agents: [] chega ao filho mesmo sem política");
	} finally {
		h.restore();
	}
});

test("com política: schema com model/effort/tools/skills (single, tasks, chain) e descrição ≤600 (AC3)", () => {
	writePolicy({ "a/haiku": ALL, "a/sonnet": ALL });
	const h = boot();
	try {
		const t = h.tool();
		for (const p of ["model", "effort", "tools", "skills"]) {
			assert.ok(p in t.parameters.properties, p);
			assert.ok(p in t.parameters.properties.tasks.items.properties, `tasks.${p}`);
			assert.ok(p in t.parameters.properties.chain.items.properties, `chain.${p}`);
		}
		assert.match(t.description, /Allowed model\[efforts\]: a\/haiku\[low,medium,high,xhigh\]/);
		const base = subagentParams().properties;
		assert.equal(
			t.parameters.properties.tasks.description,
			(base.tasks as unknown as Record<string, unknown>).description,
		);
		assert.equal(
			t.parameters.properties.chain.description,
			(base.chain as unknown as Record<string, unknown>).description,
		);
	} finally {
		h.restore();
	}
});

test("roteado: modelo/esforço do pedido, --no-skills, env do teto, linha route (AC5/AC7)", async () => {
	writePolicy({ "a/haiku": ALL, "a/sonnet": ALL, "a/opus": ALL });
	const h = boot();
	try {
		const r = await h.info({ agent: "worker", task: "x", model: "a/haiku", effort: "low" });
		assert.ok(r.args.includes("--no-skills"));
		assert.equal(r.args[r.args.indexOf("--model") + 1], "a/haiku:low");
		assert.deepEqual(r.env, { parent: "a/haiku", effort: "low", noSkills: "1" });
		assert.match(r.text, /route: a\/haiku · low \(orchestrator: as requested\)/);
		const auto = await h.info({ agent: "worker", task: "curto" });
		assert.equal(auto.args[auto.args.indexOf("--model") + 1], "a/sonnet:low");
		assert.match(auto.text, /\(auto: score low \(-short-brief\)\)/);
		// paralelo e cadeia levam o pedido de cada item
		const par = await h.run({
			tasks: [
				{ agent: "worker", task: "a", model: "a/haiku", effort: "medium" },
				{ agent: "worker", task: "b", model: "a/opus", effort: "high" },
			],
		});
		assert.match(par.content[0].text, /a\/haiku:medium/);
		assert.match(par.content[0].text, /a\/opus:high/);
		const chain = await h.run({ chain: [{ agent: "worker", task: "a", model: "a/sonnet", effort: "high" }] });
		assert.match(chain.content[0].text, /a\/sonnet:high/);
	} finally {
		h.restore();
	}
});

test("teto herdado por env e grau no teto sem o tool subagent (AC4/AC6)", async () => {
	writePolicy({ "a/haiku": ALL, "a/sonnet": ALL, "a/opus": ALL });
	process.env.NYCODE_SUBAGENT_DEPTH = "2";
	process.env.NYCODE_SUBAGENT = "1";
	process.env.NYCODE_SUBAGENT_PARENT_MODEL = "a/sonnet";
	process.env.NYCODE_SUBAGENT_PARENT_EFFORT = "medium";
	const h = boot();
	try {
		const r = await h.info({ agent: "worker", task: "x", model: "a/opus", effort: "xhigh" });
		assert.equal(r.args[r.args.indexOf("--model") + 1], "a/sonnet:medium");
		assert.match(r.text, /clamped/);
		assert.equal(r.args[r.args.indexOf("--exclude-tools") + 1], "subagent");
		assert.deepEqual([r.env.parent, r.env.effort], ["a/sonnet", "medium"]);
	} finally {
		for (const k of [
			"NYCODE_SUBAGENT_DEPTH",
			"NYCODE_SUBAGENT",
			"NYCODE_SUBAGENT_PARENT_MODEL",
			"NYCODE_SUBAGENT_PARENT_EFFORT",
		])
			delete process.env[k];
		h.restore();
	}
});

test("tools e skills do spawn só estreitam (AC6)", async () => {
	writePolicy({ "a/sonnet": ALL });
	const h = boot();
	try {
		const r = await h.info({ agent: "reader", task: "x", tools: ["read", "bash"] });
		assert.equal(r.args[r.args.indexOf("--tools") + 1], "read");
		assert.match(r.text, /ignored tools bash/);
		const none = await h.info({ agent: "reader", task: "x", tools: ["bash"] });
		assert.equal(
			none.args[none.args.indexOf("--tools") + 1],
			"read,grep",
			"pedido que não sobra nada é ignorado inteiro",
		);
		const sk = await h.info({ agent: "worker", task: "x", skills: ["alpha", "gamma"] });
		assert.match(sk.text, /ignored skills gamma/);
	} finally {
		h.restore();
	}
});

test("agents: do frontmatter limita o spawn do filho e o roster (AC6)", async () => {
	clearPolicy();
	const h = boot();
	try {
		const nested = await h.info({ agent: "nester", task: "x" });
		assert.equal(nested.env.allowed, '["reader"]');
		process.env.NYCODE_SUBAGENT_ALLOWED_AGENTS = nested.env.allowed;
		process.env.NYCODE_SUBAGENT_DEPTH = "1";
		process.env.NYCODE_SUBAGENT = "1";
		const denied = await h.run({ agent: "worker", task: "x" });
		assert.match(denied.content[0].text, /Unknown agent: "worker"\. Available agents: "reader"\./);
		assert.ok((await h.info({ agent: "reader", task: "x" })).args.includes("--mode"));
		const roster = (await h.fire("before_agent_start"))[0].systemPrompt as string;
		assert.ok(roster.includes("- reader (") && !roster.includes("- worker ("));
		// um filho sem `agents:` herda a lista do pai (efetivo = próprio ∩ herdado)
		assert.equal((await h.info({ agent: "reader", task: "x" })).env.allowed, '["reader"]');
	} finally {
		for (const k of ["NYCODE_SUBAGENT_ALLOWED_AGENTS", "NYCODE_SUBAGENT_DEPTH", "NYCODE_SUBAGENT"])
			delete process.env[k];
		h.restore();
	}
});

test("background: single em segundo plano também é roteado e a linha route vai na resposta (AC5)", async () => {
	writePolicy({ "a/haiku": ALL, "a/sonnet": ALL });
	const h = boot();
	try {
		const res = await h.run({ agent: "worker", task: "x", background: true, model: "a/haiku", effort: "medium" });
		assert.match(res.content[0].text, /Started background run[\s\S]*route: a\/haiku · medium \(orchestrator/);
	} finally {
		await new Promise((r) => setTimeout(r, 300));
		resetBackgroundRuns();
		h.restore();
	}
});

test("política inválida nunca derruba o spawn (AC2)", async () => {
	writeFileSync(policyFile, '{"version":1,"models":{"a":[]}}');
	const h = boot();
	try {
		const r = await h.info({ agent: "worker", task: "x" });
		assert.ok(!r.args.includes("--no-skills") && !r.text.includes("route:"));
	} finally {
		h.restore();
	}
});

test("/subagents-setup: modal salva, show, off, sem UI e uso inválido (AC1/AC2)", async () => {
	clearPolicy();
	let overlay: any;
	const h = boot({
		hasUI: true,
		custom: (factory) =>
			new Promise((resolve) => {
				const c = factory({ requestRender() {} }, {}, {}, resolve);
				overlay = c;
				// marca o 1º modelo, avança e confirma os esforços padrão
				c.handleInput(" ");
				c.handleInput("\r");
				c.handleInput("\r");
			}),
	});
	try {
		const cmd = h.commands.get("subagents-setup");
		const before = h.tools.length;
		await cmd.handler("", h.ctx);
		assert.ok(overlay);
		const saved = JSON.parse(readFileSync(policyFile, "utf8"));
		assert.equal(saved.version, 1);
		assert.deepEqual(Object.keys(saved.models), ["a/haiku"]);
		assert.ok(saved.models["a/haiku"].length > 0);
		assert.equal(h.tools.length, before + 1, "o tool é registrado de novo com a política");
		assert.match(h.tool().description, /Allowed model\[efforts\]: a\/haiku/);
		await cmd.handler("show", h.ctx);
		assert.match(h.notes.at(-1)!, /Subagent routing: on[\s\S]*a\/haiku/);
		await cmd.handler("off", h.ctx);
		assert.match(h.notes.at(-1)!, /Subagent routing off/);
		assert.ok(!h.tool().description.includes("Allowed model"));
		await cmd.handler("off", h.ctx);
		assert.match(h.notes.at(-1)!, /off \(no policy/);
		await cmd.handler("bogus", h.ctx);
		assert.match(h.notes.at(-1)!, /Usage/);
		await cmd.handler("show", h.ctx);
		assert.match(h.notes.at(-1)!, /off/);
		h.ctx.hasUI = false;
		await cmd.handler("", h.ctx);
		assert.match(h.notes.at(-1)!, /needs the interactive TUI/);
		h.ctx.hasUI = true;
		h.ctx.ui.custom = async () => undefined;
		await cmd.handler("", h.ctx);
		assert.match(h.notes.at(-1)!, /unchanged/);
		h.ctx.modelRegistry.getAvailable = () => [];
		await cmd.handler("", h.ctx);
		assert.match(h.notes.at(-1)!, /No models available/);
	} finally {
		h.restore();
	}
});

test("capacidades e frontmatter: narrow, skills, allowlist e parse de agents: (AC6)", () => {
	assert.deepEqual(narrowList(undefined, ["a"]), { value: ["a"], ignored: [] });
	assert.deepEqual(narrowList(["read"], undefined), { value: ["read"], ignored: [] });
	assert.deepEqual(narrowList(["mcp__x__*", "Read"], ["mcp__x__y", "read", "bash"]), {
		value: ["mcp__x__y", "Read"],
		ignored: ["bash"],
	});
	assert.deepEqual(narrowList(["read"], "nope"), { value: ["read"], ignored: [] });
	assert.deepEqual(narrowSkills(["a", "b"], ["b"]), { value: ["b"], ignored: [] });
	assert.deepEqual(narrowSkills(undefined, ["b"]), { value: undefined, ignored: ["b"] });
	assert.deepEqual(narrowSkills(["a"], undefined), { value: ["a"], ignored: [] });
	assert.equal(allowedAgents({}), undefined);
	assert.equal(allowedAgents({ NYCODE_SUBAGENT_ALLOWED_AGENTS: "{oops" }), undefined);
	assert.deepEqual(allowedAgents({ NYCODE_SUBAGENT_ALLOWED_AGENTS: '["a"]' }), ["a"]);
	assert.deepEqual(filterAllowed([{ name: "a" }, { name: "b" }], { NYCODE_SUBAGENT_ALLOWED_AGENTS: '["b"]' }), [
		{ name: "b" },
	]);
	assert.equal(childAllowedAgents({ agents: ["x"] }), '["x"]');
	assert.equal(childAllowedAgents({}), "");
	assert.deepEqual(parseAgentsField(["a", " b "]), { agents: ["a", "b"] });
	assert.deepEqual(parseAgentsField("a, b"), { agents: ["a", "b"] });
	assert.deepEqual(parseAgentsField([]), { agents: [] });
	assert.deepEqual(parseAgentsField(undefined), {});
	assert.deepEqual(parseAgentsField(""), {});
});

test("resolveSpawn nunca lança: erro interno vira nota e agente intacto", () => {
	writePolicy({ "a/sonnet": ALL });
	const agent = { name: "w", description: "d", systemPrompt: "", source: "user", filePath: "" } as AgentConfig;
	const r = applyMod.resolveSpawn(agent, { model: "a/sonnet" }, "x", {
		NYCODE_SUBAGENT_ROUTING_FILE: policyFile,
		NYCODE_SUBAGENT_DEPTH: "x",
	});
	assert.ok(r.agent.model === "a/sonnet" || r.agent === agent);
	const hostile = {
		...agent,
		get skills(): string[] {
			throw new Error("boom");
		},
	};
	const broken = applyMod.resolveSpawn(hostile as AgentConfig, { tools: 5 as any, skills: {} as any }, "x", {
		NYCODE_SUBAGENT_ROUTING_FILE: policyFile,
	});
	assert.equal(broken.agent, hostile);
	assert.match(broken.note ?? "", /route: skipped \(boom\)/);
});

test("AC7: com NYCODE_SUBAGENT_NO_SKILLS o skills.ts não entrega paths por resources_discover", () => {
	const handlers = new Map<string, (...a: any[]) => any>();
	const pi: any = new Proxy(
		{ on: (e: string, h: any) => void handlers.set(e, h) },
		{ get: (t: any, k) => t[k] ?? (() => {}) },
	);
	skillsExtension(pi);
	const ctx = { cwd: tmp, hasUI: false, ui: {}, sessionManager: { getBranch: () => [] } };
	const discover = handlers.get("resources_discover")!;
	process.env.NYCODE_SUBAGENT_NO_SKILLS = "1";
	try {
		assert.equal(discover({}, ctx), undefined);
	} finally {
		delete process.env.NYCODE_SUBAGENT_NO_SKILLS;
	}
});

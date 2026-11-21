// Fix round 3 (docs/subagent-routing-2026-11-13.md) (vitest port)
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "vitest";
import type { AgentConfig } from "../../../../src/extensions/subagent/registry/agents.ts";
import * as applyMod from "../../../../src/extensions/subagent/routing/apply.ts";
import * as capMod from "../../../../src/extensions/subagent/routing/capabilities.ts";
import { registerRoutingCommand } from "../../../../src/extensions/subagent/routing/command.ts";
import * as policyMod from "../../../../src/extensions/subagent/routing/policy.ts";
import { fleetTestEnv } from "../fleet-env.ts";

const { tmp } = fleetTestEnv("routing-r3-");

const ALLOWED = "NYCODE_SUBAGENT_ALLOWED_AGENTS";
const file = join(tmp, "r3-policy.json");
const agent = (extra: Record<string, unknown> = {}) =>
	({
		name: "A",
		description: "d",
		systemPrompt: "",
		source: "user",
		filePath: "",
		...extra,
	}) as AgentConfig;

test("1: ALLOWED do filho = próprio ∩ herdado", () => {
	const env = (inherited?: string) => ({ ...(inherited ? { [ALLOWED]: inherited } : {}) });
	assert.equal(capMod.childAllowedAgents(agent({ agents: ["x"] }), env()), '["x"]');
	assert.equal(capMod.childAllowedAgents(agent(), env('["x"]')), '["x"]', "sem agents: herda");
	assert.equal(capMod.childAllowedAgents(agent({ agents: ["z"] }), env('["x"]')), "[]", "interseção vazia = nenhum");
	assert.equal(capMod.childAllowedAgents(agent({ agents: ["x", "y"] }), env('["y","x","w"]')), '["x","y"]');
	assert.equal(capMod.childAllowedAgents(agent({ agents: [] }), env('["x"]')), "[]");
	assert.equal(capMod.childAllowedAgents(agent(), env()), "");
	const noPolicy = { NYCODE_SUBAGENT_ROUTING_FILE: join(tmp, "absent.json") };
	assert.equal(
		applyMod.resolveSpawn(agent({ agents: ["z"] }), undefined, "x", { ...noPolicy, ...env('["x"]') }).env[ALLOWED],
		"[]",
	);
	assert.equal(applyMod.resolveSpawn(agent(), undefined, "x", { ...noPolicy, ...env('["x"]') }).env[ALLOWED], '["x"]');
	assert.equal(applyMod.resolveSpawn(agent(), undefined, "x", noPolicy).env[ALLOWED], undefined);
});

test("2: removePolicy só trata ENOENT como já off; /subagents-setup off notifica o erro", async () => {
	const env = { NYCODE_SUBAGENT_ROUTING_FILE: join(tmp, "gone.json") };
	assert.equal(policyMod.removePolicy(env), false);
	const dir = join(tmp, "dirpolicy");
	mkdirSync(dir);
	assert.throws(() => policyMod.removePolicy({ NYCODE_SUBAGENT_ROUTING_FILE: dir }));
	const handlers = new Map<string, any>();
	registerRoutingCommand({ registerCommand: (n: string, d: any) => void handlers.set(n, d) } as any, () => {});
	const notes: Array<[string, string]> = [];
	const saved = process.env.NYCODE_SUBAGENT_ROUTING_FILE;
	process.env.NYCODE_SUBAGENT_ROUTING_FILE = dir;
	try {
		await handlers
			.get("subagents-setup")
			.handler("off", { ui: { notify: (m: string, k: string) => void notes.push([m, k]) } });
	} finally {
		process.env.NYCODE_SUBAGENT_ROUTING_FILE = saved;
	}
	assert.equal(notes.length, 1);
	assert.equal(notes[0][1], "error");
	assert.doesNotMatch(notes[0][0], /^Subagent routing/);
});

test("3: savePolicy remove o tmp em falha e força 0600", () => {
	const dest = join(tmp, "dest-dir.json");
	mkdirSync(dest);
	const tmpFile = `${dest}.${process.pid}.tmp`;
	assert.throws(() =>
		policyMod.savePolicy({ version: 1, models: { a: ["low"] } }, { NYCODE_SUBAGENT_ROUTING_FILE: dest }),
	);
	assert.equal(existsSync(tmpFile), false);
	const ok = join(tmp, "ok.json");
	writeFileSync(`${ok}.${process.pid}.tmp`, "stale", { mode: 0o644 });
	chmodSync(`${ok}.${process.pid}.tmp`, 0o644);
	policyMod.savePolicy({ version: 1, models: { a: ["low"] } }, { NYCODE_SUBAGENT_ROUTING_FILE: ok });
	assert.equal(statSync(ok).mode & 0o777, 0o600);
});

test("4: política salva sem rota: capacidades valem, só modelo/esforço caem para o pin", () => {
	writeFileSync(file, JSON.stringify({ version: 1, models: { "a/sonnet": ["low"] } }));
	applyMod.setRoutingSession({ catalog: [{ key: "a/other", cost: 1 }] });
	try {
		const a = agent({ model: "pinned", tools: ["read", "grep"], skills: ["s1", "s2"] });
		const r = applyMod.resolveSpawn(a, { tools: ["read"], skills: ["s2"] }, "x", {
			NYCODE_SUBAGENT_ROUTING_FILE: file,
			NYCODE_SUBAGENT_DEPTH: "2",
		});
		assert.equal(r.agent.model, "pinned");
		assert.deepEqual(r.agent.tools, ["read"]);
		assert.deepEqual(r.agent.skills, ["s2"]);
		assert.deepEqual(r.args, ["--no-skills"]);
		assert.equal(r.env[applyMod.NO_SKILLS_ENV], "1");
		assert.ok(r.agent.disallowedTools?.includes("subagent"));
		assert.match(r.note ?? "", /^route: /);
		assert.equal(r.env[applyMod.PARENT_MODEL_ENV], undefined);
	} finally {
		applyMod.setRoutingSession({ catalog: [] });
	}
});

test("5: narrowList emite a grafia do agente; pedido sem casamento é ignorado", () => {
	assert.deepEqual(capMod.narrowList(["Read", "web_fetch"], ["read", "web-fetch", "bash"]), {
		value: ["Read", "web_fetch"],
		ignored: ["bash"],
	});
	assert.deepEqual(capMod.narrowList(["Read"], ["bash"]), { value: ["Read"], ignored: ["bash"] });
	assert.deepEqual(capMod.narrowList(["mcp__x__*"], ["mcp__x__y"]), { value: ["mcp__x__y"], ignored: [] });
	const note = applyMod.resolveSpawn(agent({ tools: ["Read"] }), { tools: ["bash"] }, "x", {
		NYCODE_SUBAGENT_ROUTING_FILE: file,
	}).note;
	assert.match(note ?? "", /ignored tools bash/);
});

test("6: parsePolicy rejeita chaves de protótipo", () => {
	for (const key of ["__proto__", "constructor", "prototype"]) {
		const raw = JSON.parse(`{"version":1,"models":{"${key}":["low"]}}`);
		assert.equal(typeof policyMod.parsePolicy(raw), "string", key);
	}
	assert.equal(typeof policyMod.parsePolicy({ version: 1, models: { "a/b": ["low"] } }), "object");
});

// Roteador puro e política (docs/subagent-routing-2026-11-13.md, AC2/AC4) (vitest port)
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "vitest";
import type { RoutingPolicy } from "../../../../src/extensions/subagent/routing/policy.ts";
import * as policyMod from "../../../../src/extensions/subagent/routing/policy.ts";
import {
	autoEffort,
	hasRisk,
	type RouteInput,
	type RouteResult,
	routeSpawn as routeSpawnRaw,
} from "../../../../src/extensions/subagent/routing/route.ts";
import { ROUTING_NOTE_MAX, routingDescription } from "../../../../src/extensions/subagent/routing/text.ts";
import { fleetTestEnv } from "../fleet-env.ts";

const { tmp } = fleetTestEnv("routing-route-");

const catalog = [
	{ key: "a/haiku", cost: 5 },
	{ key: "a/sonnet", cost: 15 },
	{ key: "a/opus", cost: 25 },
];
const ALL = ["low", "medium", "high", "xhigh"];
// The cases pass loose literals (string efforts, partial agents) on purpose: typing is cast here, behavior untouched.
const policy = (models: Record<string, string[]> = { "a/haiku": ALL, "a/sonnet": ALL, "a/opus": ALL }) =>
	({ version: 1, models }) as RoutingPolicy;
const routeMaybe = (input: object): RouteResult | undefined => routeSpawnRaw(input as RouteInput);
const routeSpawn = (input: object): RouteResult => routeSpawnRaw(input as RouteInput) as RouteResult;
const LONG = "x".repeat(500);
const base = {
	policy: policy(),
	catalog,
	parent: { model: "a/opus", effort: "xhigh" },
	degree: 1,
	agent: { name: "swarm-worker", pin: "sonnet" },
	brief: LONG,
};

test("auto: pin como dica, esforço medium sem sinais", () => {
	const r = routeSpawn(base);
	assert.equal(r.model, "a/sonnet");
	assert.equal(r.effort, "medium");
	assert.equal(r.source, "auto");
});

test("auto: brief curto e agente só-leitura baixam o esforço; revisor e risco sobem; nunca off nem max", () => {
	assert.equal(routeSpawn({ ...base, brief: "oi" }).effort, "low");
	assert.equal(routeSpawn({ ...base, agent: { name: "x", tools: ["read", "grep"], pin: "sonnet" } }).effort, "low");
	assert.equal(routeSpawn({ ...base, agent: { name: "code-reviewer", pin: "sonnet" } }).effort, "high");
	assert.equal(
		autoEffort({ agent: { name: "security-reviewer" }, brief: `${LONG} security race`, degree: 1 }).effort,
		"xhigh",
	);
	assert.equal(autoEffort({ agent: { name: "x" }, brief: "y", degree: 3 }).effort, "low");
	assert.equal(autoEffort({ agent: { name: "x" }, brief: "x".repeat(7000), degree: 1 }).effort, "high");
	assert.equal(autoEffort({ agent: { name: "x", tools: ["Write"] }, brief: LONG, degree: 1 }).effort, "medium");
});

test("risco (en e pt-BR) sobe um tier de modelo quando há", () => {
	assert.ok(
		hasRisk("fix the auth flow") &&
			hasRisk("falha de segurança") &&
			hasRisk("migração de dados") &&
			!hasRisk("rename a variable"),
	);
	const r = routeSpawn({ ...base, brief: `${LONG} migration` });
	assert.equal(r.model, "a/opus");
	assert.equal(r.effort, "high");
	assert.equal(
		routeSpawn({ ...base, policy: policy({ "a/sonnet": ALL }), brief: `${LONG} migration` }).model,
		"a/sonnet",
	);
});

test("pedido do orquestrador dentro da allowlist e do teto vale", () => {
	const r = routeSpawn({ ...base, request: { model: "a/haiku", effort: "high" } });
	assert.deepEqual([r.model, r.effort, r.source], ["a/haiku", "high", "orchestrator"]);
	const onlyEffort = routeSpawn({ ...base, request: { effort: "high" } });
	assert.deepEqual([onlyEffort.model, onlyEffort.effort, onlyEffort.source], ["a/sonnet", "high", "orchestrator"]);
});

test("pedido fora da allowlist vira o permitido mais próximo ≤ teto (clamped)", () => {
	const r = routeSpawn({
		...base,
		policy: policy({ "a/haiku": ALL, "a/opus": ALL }),
		parent: { model: "a/sonnet", effort: "high" },
		request: { model: "a/sonnet" },
	});
	assert.deepEqual([r.model, r.source], ["a/haiku", "clamped"]);
	assert.match(r.reason, /not allowed/);
	const unknown = routeSpawn({ ...base, request: { model: "z/unknown" } });
	assert.equal(unknown.source, "clamped");
});

test("teto do pai: modelo e esforço nunca sobem", () => {
	const r = routeSpawn({
		...base,
		parent: { model: "a/sonnet", effort: "low" },
		request: { model: "a/opus", effort: "xhigh" },
	});
	assert.deepEqual([r.model, r.effort, r.source], ["a/sonnet", "low", "clamped"]);
	assert.match(r.reason, /above the parent ceiling/);
	// auto com risco não passa do teto
	assert.equal(
		routeSpawn({ ...base, parent: { model: "a/sonnet", effort: "high" }, brief: `${LONG} security` }).model,
		"a/sonnet",
	);
});

test("teto insatisfazível: o permitido mais barato no menor esforço, com motivo", () => {
	const r = routeSpawn({
		...base,
		policy: policy({ "a/sonnet": ["medium", "high"], "a/opus": ALL }),
		parent: { model: "a/haiku", effort: "high" },
	});
	assert.deepEqual([r.model, r.effort, r.source], ["a/sonnet", "medium", "clamped"]);
	assert.match(r.reason, /no allowed model within the parent ceiling/);
});

test("esforço: só os permitidos do modelo; menor permitido quando tudo excede o alvo ou o teto", () => {
	const only = policy({ "a/sonnet": ["medium", "high"] });
	assert.equal(routeSpawn({ ...base, policy: only, request: { effort: "xhigh" } }).effort, "high");
	assert.equal(routeSpawn({ ...base, policy: only, brief: "oi" }).effort, "medium");
	const capped = routeSpawn({ ...base, policy: only, parent: { model: "a/opus", effort: "low" } });
	assert.equal(capped.effort, "medium");
	assert.match(capped.reason, /no allowed effort within the parent ceiling/);
	assert.equal(routeSpawn({ ...base, request: { effort: "bogus" } }).source, "auto");
});

test("pai desconhecido = sem teto; pin desconhecido cai no tier do pai; modelo fora do catálogo é pulado", () => {
	const r = routeSpawn({ ...base, parent: {}, agent: { name: "x", pin: "nope" } });
	assert.equal(r.model, "a/haiku");
	assert.equal(
		routeSpawn({ ...base, parent: { model: "a/opus" }, agent: { name: "x", pin: "nope" } }).model,
		"a/opus",
	);
	assert.equal(routeSpawn({ ...base, policy: policy({ "gone/model": ALL, "a/haiku": ALL }) }).model, "a/haiku");
	assert.equal(routeMaybe({ ...base, policy: policy({ "gone/model": ALL }) }), undefined);
	assert.equal(routeSpawn({ ...base, catalog: [], parent: {}, agent: { name: "x" } }).model, "a/haiku");
});

test("custos iguais dividem o tier; modelo sem custo só vale sem teto conhecido", () => {
	const tied = [{ key: "a/x", cost: 10 }, { key: "a/y", cost: 10 }, { key: "a/z" }];
	const r = routeSpawn({
		...base,
		policy: policy({ "a/x": ALL, "a/z": ALL }),
		catalog: tied,
		parent: { model: "a/y" },
		agent: { name: "q" },
	});
	assert.equal(r.model, "a/x");
	const noCap = routeSpawn({
		...base,
		policy: policy({ "a/z": ALL }),
		catalog: tied,
		parent: {},
		agent: { name: "q" },
	});
	assert.equal(noCap.model, "a/z");
});

test("é determinístico", () => {
	assert.deepEqual(routeSpawn(base), routeSpawn(base));
});

test("política: validação, escrita atômica 0600, arquivo inválido liga o aviso único e desliga o roteamento", () => {
	const file = join(tmp, "policy.json");
	const env = { NYCODE_SUBAGENT_ROUTING_FILE: file };
	assert.equal(policyMod.policyFile(env), file);
	assert.match(policyMod.policyFile({}), /subagent-routing\.json$/);
	assert.equal(policyMod.loadPolicy(env), undefined);
	assert.match(policyMod.formatPolicy(undefined, env), /off/);
	policyMod.savePolicy({ version: 1, models: { "a/opus": ["high", "low"] } }, env);
	assert.equal(statSync(file).mode & 0o777, 0o600);
	assert.deepEqual(policyMod.loadPolicy(env), { version: 1, models: { "a/opus": ["low", "high"] } });
	assert.match(policyMod.formatPolicy(policyMod.loadPolicy(env), env), /a\/opus: low, high/);
	assert.equal(existsSync(`${file}.${process.pid}.tmp`), false);
	assert.equal(JSON.parse(readFileSync(file, "utf8")).version, 1);
	const errors: string[] = [];
	const orig = console.error;
	console.error = (m: string) => errors.push(m);
	try {
		for (const bad of [
			"{",
			"[]",
			'{"version":2,"models":{}}',
			'{"version":1,"models":{}}',
			'{"version":1,"models":{"a":[]}}',
			'{"version":1,"models":{"a":["zzz"]}}',
			`{"version":1,"models":{"${"k".repeat(121)}":["low"]}}`,
			'{"version":1,"models":[]}',
		]) {
			writeFileSync(file, bad);
			assert.equal(policyMod.loadPolicy(env), undefined, bad);
		}
		writeFileSync(file, "{");
		policyMod.loadPolicy(env);
	} finally {
		console.error = orig;
	}
	assert.equal(errors.length, 8, "um aviso por causa distinta, nunca repetido");
	assert.equal(
		policyMod.loadPolicy({ NYCODE_SUBAGENT_ROUTING_FILE: tmp }),
		undefined,
		"ilegível (EISDIR) não derruba",
	);
	assert.equal(policyMod.removePolicy(env), true);
	assert.equal(policyMod.removePolicy(env), false);
	assert.equal(policyMod.parsePolicy(null), "not a JSON object");
	assert.equal(policyMod.parsePolicy({ version: 1, models: null }), "models must be an object");
});

test("descrição do tool: lista a allowlist, ≤600 caracteres mesmo com muitos modelos", () => {
	const small = routingDescription(policy());
	assert.match(small, /a\/haiku\[low,medium,high,xhigh\]/);
	assert.ok(small.length <= ROUTING_NOTE_MAX);
	const many = routingDescription(
		policy(Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`provider/model-${i}`, ALL]))),
	);
	assert.ok(many.length <= ROUTING_NOTE_MAX && many.includes("…"));
});

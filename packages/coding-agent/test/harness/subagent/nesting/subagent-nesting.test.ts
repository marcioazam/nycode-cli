// Bounded nesting (subagent/nesting): depth, concurrency, per-lane run and cost budgets, and the wiring (vitest port)
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, test } from "vitest";
import * as n from "../../../../src/extensions/subagent/nesting/index.ts";

const src = fileURLToPath(new URL("../../../../src/extensions/subagent/", import.meta.url));
const roots: string[] = [];
const tmpRoot = (prefix: string): string => {
	const d = mkdtempSync(join(tmpdir(), prefix));
	roots.push(d);
	return d;
};
afterAll(() => {
	for (const d of roots) rmSync(d, { recursive: true, force: true });
});

test("profundidade: sessão principal 0, marcador antigo 1, valor explícito vence", () => {
	assert.equal(n.subagentDepth({}), 0);
	assert.equal(n.subagentDepth({ NYCODE_SUBAGENT: "1" }), 1);
	assert.equal(n.subagentDepth({ NYCODE_SUBAGENT: "1", NYCODE_SUBAGENT_DEPTH: "2" }), 2);
	assert.equal(n.subagentDepth({ NYCODE_SUBAGENT_DEPTH: "lixo" }), 1);
});

test("cap padrão 3: profundidades 0-2 delegam, 3 é folha; cap limitado a 1..5", () => {
	for (const d of [0, 1, 2]) assert.equal(n.canSpawnSubagents({ NYCODE_SUBAGENT_DEPTH: String(d) }), true);
	assert.equal(n.canSpawnSubagents({ NYCODE_SUBAGENT_DEPTH: "3" }), false);
	assert.equal(n.canSpawnSubagents({ NYCODE_SUBAGENT_DEPTH: "1", NYCODE_SUBAGENT_MAX_DEPTH: "1" }), false);
	assert.equal(n.maxSubagentDepth({ NYCODE_SUBAGENT_MAX_DEPTH: "50" }), 5);
	assert.equal(n.maxSubagentDepth({ NYCODE_SUBAGENT_MAX_DEPTH: "0" }), 1);
});

test("filho herda marcador, profundidade+1 e a mesma árvore", () => {
	const child = n.childNestingEnv({ NYCODE_SUBAGENT_DEPTH: "1", NYCODE_SUBAGENT_TREE: "abc-1" });
	assert.deepEqual(child, { NYCODE_SUBAGENT: "1", NYCODE_SUBAGENT_DEPTH: "2", NYCODE_SUBAGENT_TREE: "abc-1" });
	// cada filho da sessão principal abre uma árvore (lane) nova
	const root = n.childNestingEnv({});
	assert.equal(root.NYCODE_SUBAGENT_DEPTH, "1");
	assert.match(root.NYCODE_SUBAGENT_TREE, /^\d+-[0-9a-f]{8}$/);
	assert.notEqual(n.childNestingEnv({}).NYCODE_SUBAGENT_TREE, root.NYCODE_SUBAGENT_TREE);
	// id de árvore com caractere de caminho é ignorado (não escapa do diretório temporário)
	assert.doesNotMatch(
		n.childNestingEnv({ NYCODE_SUBAGENT_DEPTH: "1", NYCODE_SUBAGENT_TREE: "../x" }).NYCODE_SUBAGENT_TREE,
		/\./,
	);
});

test("concorrência: 4 na principal, 2 abaixo, ajustável até 4", () => {
	assert.equal(n.parallelConcurrency({}), 4);
	assert.equal(n.parallelConcurrency({ NYCODE_SUBAGENT_DEPTH: "2" }), 2);
	assert.equal(n.parallelConcurrency({ NYCODE_SUBAGENT_DEPTH: "1", NYCODE_SUBAGENT_NESTED_CONCURRENCY: "9" }), 4);
});

test("orçamento por lane: conta, recusa o excesso sem gastar, árvores separadas, raiz sem cap", () => {
	const root = tmpRoot("nesting-budget-");
	assert.equal(n.claimSpawns(500, {}, root), undefined);
	assert.equal(readdirSync(root).length, 0);
	const env = { NYCODE_SUBAGENT_DEPTH: "1", NYCODE_SUBAGENT_TREE: "t1", NYCODE_SUBAGENT_BUDGET: "5" };
	assert.equal(n.claimSpawns(3, env, root), undefined);
	assert.equal(n.claimSpawns(2, env, root), undefined);
	const err = n.claimSpawns(1, env, root);
	assert.match(err ?? "", /5 of 5/);
	assert.equal(readdirSync(join(root, "pi-code-subagent-tree-t1")).length, 5);
	assert.equal(n.claimSpawns(1, { ...env, NYCODE_SUBAGENT_TREE: "t2" }, root), undefined);
});

test("fiação: run, background, modes e index usam o módulo de nesting", () => {
	// run/modes moved to core/, background to fleet/ (D-33 layout): the nesting module is one level up there.
	for (const f of ["core/run.ts", "fleet/background.ts", "core/modes.ts"])
		assert.match(readFileSync(`${src}/${f}`, "utf8"), /from "\.\.\/nesting\/index\.ts"/, f);
	assert.match(readFileSync(`${src}/index.ts`, "utf8"), /from "\.\/nesting\/index\.ts"/, "index.ts");
	assert.doesNotMatch(readFileSync(`${src}/core/run.ts`, "utf8"), /NYCODE_SUBAGENT: "1"/);
	assert.match(readFileSync(`${src}/core/run.ts`, "utf8"), /recordSpawnCost\(currentResult\.usage\.cost\)/);
});

test("orçamento de custo por lane: soma custos de filhos terminados; padrão 64 execuções e 20 USD", () => {
	const root = tmpRoot("nesting-cost-");
	const env = { NYCODE_SUBAGENT_DEPTH: "2", NYCODE_SUBAGENT_TREE: "c1" };
	n.recordSpawnCost(12.5, env, root);
	assert.equal(n.claimSpawns(1, env, root), undefined);
	n.recordSpawnCost(7.5, env, root);
	assert.match(n.claimSpawns(1, env, root) ?? "", /20\.00 of 20 USD/);
	assert.equal(n.claimSpawns(1, { ...env, NYCODE_SUBAGENT_COST_BUDGET: "0" }, root), undefined);
	n.recordSpawnCost(5, {}, root); // sessão principal não registra custo
	assert.equal(readdirSync(root).length, 1);
	const env2 = { NYCODE_SUBAGENT_DEPTH: "1", NYCODE_SUBAGENT_TREE: "c2" };
	assert.equal(n.claimSpawns(64, env2, root), undefined);
	assert.match(n.claimSpawns(1, env2, root) ?? "", /64 of 64 runs/);
});

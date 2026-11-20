// Testes do subagent-nesting.patch: node --experimental-strip-types --test ~/.pi/agent/claude-home/patches/pi-code/subagent-nesting.test.ts
import assert from 'node:assert/strict'
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

// O Node não tira tipos de .ts dentro de node_modules: testa uma cópia do módulo.
const tmp = mkdtempSync(join(tmpdir(), 'nesting-test-'))
const src = `${homedir()}/.pi/agent/npm/node_modules/pi-code/extensions/subagent`
// nesting/index.ts (era nesting.ts; movido para a raiz de subagent/ ficar em ≤7 arquivos de código em 2026-11-12).
cpSync(`${src}/nesting/index.ts`, join(tmp, 'nesting.ts'))
const n = await import(join(tmp, 'nesting.ts'))
after(() => rmSync(tmp, { recursive: true })) // a cópia vazava um /tmp/nesting-test-* por execução

test('profundidade: sessão principal 0, marcador antigo 1, valor explícito vence', () => {
  assert.equal(n.subagentDepth({}), 0)
  assert.equal(n.subagentDepth({ PI_CODE_SUBAGENT: '1' }), 1)
  assert.equal(n.subagentDepth({ PI_CODE_SUBAGENT: '1', PI_CODE_SUBAGENT_DEPTH: '2' }), 2)
  assert.equal(n.subagentDepth({ PI_CODE_SUBAGENT_DEPTH: 'lixo' }), 1)
})

test('cap padrão 3: profundidades 0-2 delegam, 3 é folha; cap limitado a 1..5', () => {
  for (const d of [0, 1, 2]) assert.equal(n.canSpawnSubagents({ PI_CODE_SUBAGENT_DEPTH: String(d) }), true)
  assert.equal(n.canSpawnSubagents({ PI_CODE_SUBAGENT_DEPTH: '3' }), false)
  assert.equal(n.canSpawnSubagents({ PI_CODE_SUBAGENT_DEPTH: '1', PI_CODE_SUBAGENT_MAX_DEPTH: '1' }), false)
  assert.equal(n.maxSubagentDepth({ PI_CODE_SUBAGENT_MAX_DEPTH: '50' }), 5)
  assert.equal(n.maxSubagentDepth({ PI_CODE_SUBAGENT_MAX_DEPTH: '0' }), 1)
})

test('filho herda marcador, profundidade+1 e a mesma árvore', () => {
  const child = n.childNestingEnv({ PI_CODE_SUBAGENT_DEPTH: '1', PI_CODE_SUBAGENT_TREE: 'abc-1' })
  assert.deepEqual(child, { PI_CODE_SUBAGENT: '1', PI_CODE_SUBAGENT_DEPTH: '2', PI_CODE_SUBAGENT_TREE: 'abc-1' })
  // cada filho da sessão principal abre uma árvore (lane) nova
  const root = n.childNestingEnv({})
  assert.equal(root.PI_CODE_SUBAGENT_DEPTH, '1')
  assert.match(root.PI_CODE_SUBAGENT_TREE, /^\d+-[0-9a-f]{8}$/)
  assert.notEqual(n.childNestingEnv({}).PI_CODE_SUBAGENT_TREE, root.PI_CODE_SUBAGENT_TREE)
  // id de árvore com caractere de caminho é ignorado (não escapa do diretório temporário)
  assert.doesNotMatch(n.childNestingEnv({ PI_CODE_SUBAGENT_DEPTH: '1', PI_CODE_SUBAGENT_TREE: '../x' }).PI_CODE_SUBAGENT_TREE, /\./)
})

test('concorrência: 4 na principal, 2 abaixo, ajustável até 4', () => {
  assert.equal(n.parallelConcurrency({}), 4)
  assert.equal(n.parallelConcurrency({ PI_CODE_SUBAGENT_DEPTH: '2' }), 2)
  assert.equal(n.parallelConcurrency({ PI_CODE_SUBAGENT_DEPTH: '1', PI_CODE_SUBAGENT_NESTED_CONCURRENCY: '9' }), 4)
})

test('orçamento por lane: conta, recusa o excesso sem gastar, árvores separadas, raiz sem cap', () => {
  const root = mkdtempSync(join(tmpdir(), 'nesting-budget-'))
  assert.equal(n.claimSpawns(500, {}, root), undefined)
  assert.equal(readdirSync(root).length, 0)
  const env = { PI_CODE_SUBAGENT_DEPTH: '1', PI_CODE_SUBAGENT_TREE: 't1', PI_CODE_SUBAGENT_BUDGET: '5' }
  assert.equal(n.claimSpawns(3, env, root), undefined)
  assert.equal(n.claimSpawns(2, env, root), undefined)
  const err = n.claimSpawns(1, env, root)
  assert.match(err, /5 of 5/)
  assert.equal(readdirSync(join(root, 'pi-code-subagent-tree-t1')).length, 5)
  assert.equal(n.claimSpawns(1, { ...env, PI_CODE_SUBAGENT_TREE: 't2' }, root), undefined)
})

test('patch instalado: run, background, modes e index usam o módulo', () => {
  for (const f of ['run.ts', 'background.ts', 'modes.ts', 'index.ts']) assert.match(readFileSync(`${src}/${f}`, 'utf8'), /from '\.\/nesting\/index\.ts'/, f)
  assert.doesNotMatch(readFileSync(`${src}/run.ts`, 'utf8'), /PI_CODE_SUBAGENT: '1'/)
  assert.match(readFileSync(`${src}/run.ts`, 'utf8'), /recordSpawnCost\(currentResult\.usage\.cost\)/)
})

test('orçamento de custo por lane: soma custos de filhos terminados; padrão 64 execuções e 20 USD', () => {
  const root = mkdtempSync(join(tmpdir(), 'nesting-cost-'))
  const env = { PI_CODE_SUBAGENT_DEPTH: '2', PI_CODE_SUBAGENT_TREE: 'c1' }
  n.recordSpawnCost(12.5, env, root)
  assert.equal(n.claimSpawns(1, env, root), undefined)
  n.recordSpawnCost(7.5, env, root)
  assert.match(n.claimSpawns(1, env, root), /20\.00 of 20 USD/)
  assert.equal(n.claimSpawns(1, { ...env, PI_CODE_SUBAGENT_COST_BUDGET: '0' }, root), undefined)
  n.recordSpawnCost(5, {}, root) // sessão principal não registra custo
  assert.equal(readdirSync(root).length, 1)
  const env2 = { PI_CODE_SUBAGENT_DEPTH: '1', PI_CODE_SUBAGENT_TREE: 'c2' }
  assert.equal(n.claimSpawns(64, env2, root), undefined)
  assert.match(n.claimSpawns(1, env2, root), /64 of 64 runs/)
})

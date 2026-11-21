/**
 * Bounded nesting (local patch, claude-home/patches/pi-code/subagent-nesting.patch):
 * the main session is depth 0, its children 1, grandchildren 2, and so on. A session
 * may spawn while its depth is below NYCODE_SUBAGENT_MAX_DEPTH (default 3: children,
 * grandchildren and great-grandchildren; the deepest level is a leaf). Steering, not a
 * sandbox. Each child of the main session roots its own tree (one lane); every run below it
 * shares the lane's budget: NYCODE_SUBAGENT_BUDGET runs (default 64, pi-subagents' per-tree
 * default) and NYCODE_SUBAGENT_COST_BUDGET USD of finished descendants (default 20: p99 of
 * one subagent run here was 7.2 USD, 2026-11-11). The main session is never capped: the
 * user sees every call it makes. Decision record: claude-home/docs/pi-multi-agent-2026-11-11.md.
 */
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

type Env = Record<string, string | undefined>

function intEnv(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number(raw)
  return Number.isInteger(n) ? Math.min(max, Math.max(min, n)) : fallback
}

/** Depth of this session; a child from an unpatched parent (marker only) counts as 1. */
export function subagentDepth(env: Env = process.env): number {
  if (env.NYCODE_SUBAGENT_DEPTH !== undefined) return intEnv(env.NYCODE_SUBAGENT_DEPTH, 1, 0, 99)
  return env.NYCODE_SUBAGENT ? 1 : 0
}

export function maxSubagentDepth(env: Env = process.env): number {
  return intEnv(env.NYCODE_SUBAGENT_MAX_DEPTH, 3, 1, 5)
}

export function canSpawnSubagents(env: Env = process.env): boolean {
  return subagentDepth(env) < maxSubagentDepth(env)
}

/** Parallel children run at once: 4 from the main session (the writer cap), 2 below it,
 * so a full depth-3 tree holds at most 4 + 8 + 16 = 28 child processes. */
export function parallelConcurrency(env: Env = process.env): number {
  return subagentDepth(env) === 0 ? 4 : intEnv(env.NYCODE_SUBAGENT_NESTED_CONCURRENCY, 2, 1, 4)
}

/** Env a child inherits: the marker, its depth and the tree id the budget is kept under.
 * A child of the main session gets a fresh tree; deeper children inherit their parent's. */
export function childNestingEnv(env: Env = process.env): Record<string, string> {
  return {
    NYCODE_SUBAGENT: '1',
    NYCODE_SUBAGENT_DEPTH: String(subagentDepth(env) + 1),
    NYCODE_SUBAGENT_TREE: subagentDepth(env) === 0 ? newTreeId() : treeId(env),
  }
}

const newTreeId = (): string => `${process.pid}-${randomUUID().slice(0, 8)}`
let ownTree: string | undefined
function treeId(env: Env): string {
  if (env.NYCODE_SUBAGENT_TREE && /^[\w-]+$/.test(env.NYCODE_SUBAGENT_TREE)) return env.NYCODE_SUBAGENT_TREE
  ownTree ??= newTreeId()
  return ownTree
}

const treeDir = (env: Env, root: string): string => path.join(root, `pi-code-subagent-tree-${treeId(env)}`)

/** Claim `count` spawns from the tree budget; an error string when it is spent. One file
 * per spawn (exclusive create) so concurrent processes in the tree never lose a count. */
// ponytail: check-then-claim across processes can overshoot by the siblings claiming at the same
// instant, and cost counts finished foreground runs only (background runs report no usage).
export function claimSpawns(count: number, env: Env = process.env, root = os.tmpdir()): string | undefined {
  if (subagentDepth(env) === 0) return undefined
  const budget = intEnv(env.NYCODE_SUBAGENT_BUDGET, 64, 1, 10_000)
  const costBudget = Number(env.NYCODE_SUBAGENT_COST_BUDGET ?? 20)
  const dir = treeDir(env, root)
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  const files = fs.readdirSync(dir)
  const used = files.filter((f) => f.startsWith('run-')).length
  const spent = files.filter((f) => f.startsWith('cost-')).reduce((sum, f) => sum + (Number(fs.readFileSync(path.join(dir, f), 'utf-8')) || 0), 0)
  if (used + count > budget) return `Subagent budget spent: ${used} of ${budget} runs in this lane (NYCODE_SUBAGENT_BUDGET); finish with what you have or report back.`
  if (Number.isFinite(costBudget) && costBudget > 0 && spent >= costBudget)
    return `Subagent cost budget spent: ${spent.toFixed(2)} of ${costBudget} USD in this lane (NYCODE_SUBAGENT_COST_BUDGET); finish with what you have or report back.`
  for (let i = 0; i < count; i++) fs.writeFileSync(path.join(dir, `run-${randomUUID()}`), '', { flag: 'wx' })
  return undefined
}

/** Charge a finished child's cost to this lane; the main session's own lanes are not capped. */
export function recordSpawnCost(cost: number, env: Env = process.env, root = os.tmpdir()): void {
  if (subagentDepth(env) === 0 || !(cost > 0)) return
  try {
    const dir = treeDir(env, root)
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
    fs.writeFileSync(path.join(dir, `cost-${randomUUID()}`), String(cost), { flag: 'wx' })
  } catch {
    // accounting must never fail the run it measures
  }
}

/**
 * The saved subagent routing policy (local patch zzzzzzzzzzz-subagent-routing, docs/subagent-routing-2026-11-13.md):
 * which models, and for each which efforts, spawned subagents may use. Without a file there is no policy and
 * the harness behaves as before. An invalid file never breaks a spawn: one warning, routing off.
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { ENV_AGENT_DIR, getAgentDir } from '../../../config.ts'

type Env = Record<string, string | undefined>

/** nycode's thinking levels in ascending order; the router's ladder is built on this order. */
export const EFFORTS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const
export type Effort = (typeof EFFORTS)[number]

export interface RoutingPolicy {
  version: 1
  models: Record<string, Effort[]>
}

const MAX_STRING = 120
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype'])
export const isEffort = (value: unknown): value is Effort => typeof value === 'string' && (EFFORTS as readonly string[]).includes(value)
export const effortRank = (effort: string): number => (EFFORTS as readonly string[]).indexOf(effort)

export function policyFile(env: Env = process.env): string {
  const override = env.NYCODE_SUBAGENT_ROUTING_FILE
  if (override) return override
  return path.join(env[ENV_AGENT_DIR] || getAgentDir(), 'subagent-routing.json')
}

/** The policy in `raw`, or the reason it is invalid. Efforts come back de-duplicated in ladder order. */
export function parsePolicy(raw: unknown): RoutingPolicy | string {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return 'not a JSON object'
  const { version, models } = raw as { version?: unknown; models?: unknown }
  if (version !== 1) return 'version must be 1'
  if (typeof models !== 'object' || models === null || Array.isArray(models)) return 'models must be an object'
  const out: Record<string, Effort[]> = {}
  for (const [key, efforts] of Object.entries(models)) {
    if (FORBIDDEN_KEYS.has(key)) return `model key ${key} is reserved`
    if (key.length === 0 || key.length > MAX_STRING) return `model key must be 1-${MAX_STRING} characters`
    if (!Array.isArray(efforts) || efforts.length === 0) return `model ${key} needs at least one effort`
    if (!efforts.every((e) => isEffort(e) && e.length <= MAX_STRING)) return `model ${key} has an unknown effort`
    out[key] = EFFORTS.filter((e) => efforts.includes(e))
  }
  if (Object.keys(out).length === 0) return 'models is empty'
  return { version: 1, models: out }
}

const warned = new Set<string>()
const warnOnce = (message: string): void => {
  if (warned.has(message)) return
  warned.add(message)
  console.error(message)
}

/** Missing file = no policy. Unreadable or invalid = one warning, no policy. */
export function loadPolicy(env: Env = process.env): RoutingPolicy | undefined {
  const file = policyFile(env)
  let text: string
  try {
    text = fs.readFileSync(file, 'utf-8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') warnOnce(`nycode-subagent: routing policy ${file} unreadable, routing off: ${(error as Error).message}`)
    return undefined
  }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    warnOnce(`nycode-subagent: routing policy ${file} is not valid JSON, routing off`)
    return undefined
  }
  const parsed = parsePolicy(raw)
  if (typeof parsed === 'string') {
    warnOnce(`nycode-subagent: routing policy ${file} invalid (${parsed}), routing off`)
    return undefined
  }
  return parsed
}

/** Atomic write (tmp + rename), mode 0600. */
export function savePolicy(policy: RoutingPolicy, env: Env = process.env): void {
  const file = policyFile(env)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  try {
    fs.writeFileSync(tmp, `${JSON.stringify(policy, null, 2)}\n`, { mode: 0o600 })
    fs.chmodSync(tmp, 0o600)
    fs.renameSync(tmp, file)
  } finally {
    fs.rmSync(tmp, { force: true })
  }
}

/** True when a file was removed, false when there was none (ENOENT); any other failure throws. */
export function removePolicy(env: Env = process.env): boolean {
  try {
    fs.unlinkSync(policyFile(env))
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

export function formatPolicy(policy: RoutingPolicy | undefined, env: Env = process.env): string {
  if (!policy) return `Subagent routing: off (no policy at ${policyFile(env)}).`
  const rows = Object.entries(policy.models).map(([model, efforts]) => `  ${model}: ${efforts.join(', ')}`)
  return [`Subagent routing: on (${policyFile(env)})`, ...rows].join('\n')
}

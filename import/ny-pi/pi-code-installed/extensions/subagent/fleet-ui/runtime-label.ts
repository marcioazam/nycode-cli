/**
 * Model and thinking level of a run, as the list row and the viewer show them.
 * Pure. Unknown stays unknown (`?` in the list, `ainda não informado` in the viewer): an absent effort is
 * never rendered as a default and never inherited from the parent. Record: docs/subagent-model-effort.md.
 */
import type { RunRecord } from '../fleet/types.ts'

export type RuntimeMeta = Pick<RunRecord, 'model' | 'provider' | 'effort' | 'modelSeen' | 'effortSeen'>

const UNKNOWN = '?'
const COMPACT_MODEL = 12

/** Provider/model and the bare model; the provider can already be in the id (argv `anthropic/x`). */
function names(m: RuntimeMeta): { full?: string; bare?: string } {
  if (!m.model) return {}
  if (m.provider) {
    const bare = m.model.startsWith(`${m.provider}/`) ? m.model.slice(m.provider.length + 1) : m.model
    return { full: `${m.provider}/${bare}`, bare }
  }
  const slash = m.model.indexOf('/')
  return { full: m.model, bare: slash > 0 ? m.model.slice(slash + 1) : m.model }
}

/** List candidates, widest first: `[provider/model · effort]`, `[model · effort]`, `[model·effort]`, `[model…·effort]`. */
export function listMeta(m: RuntimeMeta): string[] {
  const { full, bare } = names(m)
  const effort = m.effort ?? UNKNOWN
  const out = [`[${full ?? UNKNOWN} · ${effort}]`, `[${bare ?? UNKNOWN} · ${effort}]`, `[${bare ?? UNKNOWN}·${effort}]`]
  const short = bare && bare.length > COMPACT_MODEL ? `${bare.slice(0, COMPACT_MODEL - 1)}…` : (bare ?? UNKNOWN)
  out.push(`[${short}·${effort}]`)
  return out.filter((s, i) => out.indexOf(s) === i)
}

/** Viewer line: `model · effort`; `(configurado)` only for a value not yet observed. Unknown stays unknown, never a default. */
export function runtimeSummary(m: RuntimeMeta): string {
  const { full } = names(m)
  const model = full ? (m.modelSeen ? full : `${full} (configurado)`) : 'ainda não informado'
  const effort = m.effort ? (m.effortSeen ? m.effort : `${m.effort} (configurado)`) : 'ainda não informado'
  return `${model} · ${effort}`
}

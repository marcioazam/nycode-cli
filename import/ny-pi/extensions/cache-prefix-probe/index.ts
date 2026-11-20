/**
 * TEMPORÁRIA (diagnóstico, passo 3 de claude-home/docs/pi-memory-cache-sota-2026-11-13.md; remover no passo 6).
 * Por requisição Anthropic da sessão principal, compara o payload com o anterior do mesmo processo e grava em
 * ~/.cache/pi-cache-probe/<data>.jsonl só hashes e índices (nunca conteúdo): tools/system mudaram, primeiro bloco
 * de mensagem divergente. Cruza com o cacheRead das sessões pelo timestamp.
 * Reverter: apagar este diretório.
 */
import { createHash } from 'node:crypto'
import { appendFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

type Payload = { model?: string; tools?: unknown[]; system?: unknown; messages?: unknown[] }

const strip = (v: unknown): unknown =>
  JSON.parse(JSON.stringify(v ?? null, (k, x) => (k === 'cache_control' ? undefined : x)))
const h = (v: unknown) => createHash('sha1').update(JSON.stringify(strip(v))).digest('hex').slice(0, 10)

export function diff(prev: { tools: string; system: string; msgs: string[] } | undefined, p: Payload) {
  const cur = { tools: h(p.tools), system: h(p.system), msgs: (p.messages ?? []).map(h) }
  if (!prev) return { cur, rec: { first: true, tools: cur.tools, system: cur.system, n: cur.msgs.length } }
  let i = 0
  while (i < prev.msgs.length && i < cur.msgs.length && prev.msgs[i] === cur.msgs[i]) i++
  return {
    cur,
    rec: {
      toolsChanged: prev.tools !== cur.tools,
      systemChanged: prev.system !== cur.system,
      firstDiff: i < prev.msgs.length ? i : null, // null = histórico anterior intacto
      prevN: prev.msgs.length,
      n: cur.msgs.length,
    },
  }
}

export default function (pi: ExtensionAPI) {
  if (process.env.PI_CODE_SUBAGENT === '1') return
  const dir = join(homedir(), '.cache/pi-cache-probe')
  let prev: { tools: string; system: string; msgs: string[] } | undefined
  pi.on('before_provider_request', (event, ctx) => {
    try {
      const p = event.payload as Payload
      if (!p || !Array.isArray(p.messages)) return undefined
      const { cur, rec } = diff(prev, p)
      prev = cur
      mkdirSync(dir, { recursive: true })
      const now = new Date().toISOString()
      appendFileSync(join(dir, `${now.slice(0, 10)}.jsonl`), JSON.stringify({
        t: now, pid: process.pid, session: ctx.sessionManager.getSessionId?.(), model: p.model, ui: ctx.hasUI,
        ...rec,
      }) + '\n')
    } catch {
      // diagnóstico nunca afeta a requisição
    }
    return undefined
  })
}

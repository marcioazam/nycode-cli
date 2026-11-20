/**
 * Cache de 1 hora só no prefixo (tools + system) da sessão interativa principal; as mensagens ficam em 5 min.
 *
 * Uma pausa de 5 a 60 min expira o cache de 5 min e a chamada seguinte regrava tudo a 1,25×. Com o prefixo em 1h,
 * a parte fixa (~48K tokens) é lida a 0,05×, e só a conversa é regravada. O 1h custa 2× na gravação, por isso fica
 * fora do `pi -p` e dos subagentes, cujo prefixo quase nunca é reusado depois de 5 min. A API exige as entradas de
 * 1h antes das de 5 min; tools e system vêm antes das mensagens. Continuação de thread não reenvia system/tools.
 * Replay e A/B: ~/.pi/agent/claude-home/docs/pi-claude-harness-transfer-2026-11-12.md.
 *
 * PI_PREFIX_CACHE_1H=0 desliga; =1 força fora da sessão interativa (teste). Reverter: apagar este arquivo.
 */
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

type Env = Record<string, string | undefined>
type Block = { cache_control?: { type?: string; ttl?: string } }

export function enabled(hasUI: boolean, env: Env): boolean {
  if (env.PI_PREFIX_CACHE_1H === '0' || env.PI_CODE_SUBAGENT === '1') return false
  return hasUI || env.PI_PREFIX_CACHE_1H === '1'
}

/** Põe ttl 1h nos marcadores ephemeral sem ttl de tools e system; devolve o payload só se mudou. */
export function prefixTtl1h(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object') return undefined
  const p = payload as { tools?: unknown; system?: unknown }
  let changed = false
  for (const list of [p.tools, p.system]) {
    if (!Array.isArray(list)) continue
    for (const b of list as Block[]) {
      if (b?.cache_control?.type === 'ephemeral' && !b.cache_control.ttl) {
        b.cache_control = { ...b.cache_control, ttl: '1h' }
        changed = true
      }
    }
  }
  return changed ? payload : undefined
}

export default function (pi: ExtensionAPI) {
  pi.on('before_provider_request', (event, ctx) => (enabled(ctx.hasUI, process.env) ? prefixTtl1h(event.payload) : undefined))
}

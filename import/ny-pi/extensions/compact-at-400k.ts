/**
 * Compactação em 250k tokens (PI_COMPACT_AT), independente do modelo (rede de segurança).
 * O nome do arquivo é histórico (era 400k; docs/pi-claude-harness-transfer-2026-11-12.md passo 3).
 *
 * O caminho principal é nativo: compaction.modelOverrides em ~/.pi/agent/settings.json,
 * gerado por ~/.pi/agent/scripts/compaction-400k.py (reserveTokens = janela - PI_COMPACT_AT).
 * Esta extensão cobre modelos que ainda não estão nesses overrides (ex.: lançados depois):
 * quando a sessão fica ociosa (agent_settled), se o contexto passou do limite, compacta e aguarda.
 *
 * Limite: PI_COMPACT_AT (padrão 250000; o wrapper ~/.local/bin/pi exporta o mesmo valor).
 */

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

const DEFAULT_LIMIT = 250_000

// Só inteiro positivo vale; senão usa o padrão e avisa.
export function compactLimit(
  env: Record<string, string | undefined>,
  warn: (m: string) => void = console.error,
): number {
  const raw = env.PI_COMPACT_AT
  if (raw === undefined) return DEFAULT_LIMIT
  const n = Number(raw)
  if (raw.trim() !== '' && Number.isInteger(n) && n > 0) return n
  warn(`PI_COMPACT_AT="${raw}" recusado (esperado inteiro positivo); usando ${DEFAULT_LIMIT}`)
  return DEFAULT_LIMIT
}

export function reportCompactError(
  ctx: { hasUI: boolean; ui: { notify: (m: string, t: 'error') => void } },
  error: Error,
  warn: (m: string) => void = console.error,
): void {
  if (ctx.hasUI) ctx.ui.notify(`Compactação falhou: ${error.message}`, 'error')
  else warn(`Compactação falhou: ${error.message}`)
}

const LIMIT = compactLimit(process.env)

export default function (pi: ExtensionAPI) {
  let running = false

  pi.on('agent_settled', async (event, ctx) => {
    if (event.aborted) return
    if (running) return
    const tokens = ctx.getContextUsage()?.tokens
    if (tokens == null || tokens < LIMIT) return
    running = true
    if (ctx.hasUI) ctx.ui.notify(`Contexto em ${Math.round(tokens / 1000)}k ≥ ${LIMIT / 1000}k: compactando`, 'info')
    // agent_settled (ocioso) e aguardado: no `pi -p` o processo saía logo depois do agent_end e a compactação se
    // perdia; aguardar dentro do agent_end trava (a compactação espera o run terminar). 2026-11-12.
    await new Promise<void>((resolve) =>
      ctx.compact({
        onComplete: () => {
          running = false
          resolve()
        },
        onError: (error) => {
          running = false
          reportCompactError(ctx, error)
          resolve()
        },
      }),
    )
  })
}

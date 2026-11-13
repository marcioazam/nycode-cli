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

const LIMIT = Number(process.env.PI_COMPACT_AT ?? 250_000)

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
          if (ctx.hasUI) ctx.ui.notify(`Compactação falhou: ${error.message}`, 'error')
          resolve()
        },
      }),
    )
  })
}

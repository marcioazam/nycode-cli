/**
 * Desliga o `web_search` do pi-code (raspa o DuckDuckGo e falha com frequência) em toda sessão,
 * inclusive nos subagentes: o processo filho do `subagent` é o pi direto, não o wrapper
 * ~/.local/bin/pi, então não recebe o `--exclude-tools web_search` do wrapper.
 * A busca padrão é `mcp__keenable__search_web_pages` (direto); `web_fetch` continua ativo.
 *
 * Para manter o web_search numa execução: PI_KEEP_WEB_SEARCH=1 pi ...
 */

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

export default function (pi: ExtensionAPI) {
  if (process.env.PI_KEEP_WEB_SEARCH === '1') return
  pi.on('session_start', async () => {
    const active = pi.getActiveTools()
    if (active.includes('web_search')) pi.setActiveTools(active.filter((name: string) => name !== 'web_search'))
  })
}

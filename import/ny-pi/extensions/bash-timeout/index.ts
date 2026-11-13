/**
 * Teto e piso de tempo no `bash`: sem `timeout` explícito o comando ganha 600 s; acima de 1800 s é recusado.
 *
 * O pi não tem timeout padrão (`dist/core/tools/bash.js:17`: `timeout === undefined` → sem limite) e o máximo é
 * 2147483647 ms, então um comando que trava só termina com o Esc do usuário. Motivo (auditoria 2026-11-13, Bekaboo
 * `bash-timeout.ts` e woksin `wait-guard.ts`): comando pendurado congela a sessão, e `sleep`/poll de CI em primeiro
 * plano queima tempo de parede. A regra do harness já manda usar `nohup ... &` + poll curto; aqui vira mecânico.
 *
 * Os 600 s de padrão são deliberados: o gate do repositório (`git-deliver gate`) roda numa única chamada `bash`
 * sem `timeout` e leva minutos; um padrão curto (120 s, como no Bekaboo) o mataria e faria o gate parecer vermelho.
 *
 * `timeout` é em SEGUNDOS no schema do bash do pi.
 *
 * Reverter: apagar este diretório.
 */
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

export const DEFAULT_S = 600
export const MAX_S = 1800

/** Timeout a aplicar, ou a recusa quando o pedido passa do teto. */
export function decide(timeout: unknown): { timeout: number } | { deny: string } {
  if (typeof timeout !== 'number' || !Number.isFinite(timeout) || timeout <= 0) return { timeout: DEFAULT_S }
  if (timeout > MAX_S)
    return {
      deny: `bash: timeout de ${Math.round(timeout)}s acima do teto de ${MAX_S}s. Rode em segundo plano (nohup cmd >/tmp/x.log 2>&1 &) e consulte o log em chamadas curtas.`,
    }
  return { timeout }
}

export default function (pi: ExtensionAPI) {
  pi.on('tool_call', (event) => {
    if (event.toolName !== 'bash') return undefined
    const input = event.input as { timeout?: number }
    const d = decide(input.timeout)
    if ('deny' in d) return { block: true, reason: d.deny }
    input.timeout = d.timeout
    return undefined
  })
}

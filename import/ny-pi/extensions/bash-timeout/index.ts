/**
 * Teto e piso de tempo no `bash`: sem `timeout` explícito o comando ganha 600 s; acima de 1800 s vira 1800 s.
 *
 * Até 2026-11-15 o pedido acima do teto era recusado; no Terminal-Bench (`feal-linear-cryptanalysis`) a recusa
 * descartou a chamada inteira, inclusive o heredoc que criava o código, e a sessão perdeu o trabalho dela. Limitar
 * mantém o limite e roda o comando (followup-A 2026-11-15, candidato T1).
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
 * `PI_BASH_TIMEOUT_BG=1` (opt-in, candidato O4, spec 0008): o comando que estoura o tempo não é morto; segue em
 * segundo plano e o modelo recebe pid e log. Feito reescrevendo o comando no `tool_call`, sem tocar no pi.
 *
 * Reverter: apagar este diretório.
 */
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

export const DEFAULT_S = 600
export const MAX_S = 1800

/** Timeout a aplicar: o padrão quando falta ou é inválido, o teto quando passa dele. */
export function decide(timeout: unknown): { timeout: number } {
  if (typeof timeout !== 'number' || !Number.isFinite(timeout) || timeout <= 0) return { timeout: DEFAULT_S }
  return { timeout: Math.min(timeout, MAX_S) }
}

/**
 * O pi só diz quanto esperou (`bash.js:299`); com o teto silencioso o modelo não sabe que pedir mais não adianta.
 * Dica do OpenCode (changelog 2.2.7: timeout "suggest a larger timeout"), adaptada ao teto (varredura 2, O2).
 */
export const TIMEOUT_HINT = `\n\n[bash-timeout] Timeouts are capped at ${MAX_S} s. For longer work run it in the background (nohup <cmd> > log 2>&1 & echo $!) and wait with: while kill -0 PID 2>/dev/null; do sleep 5; done (returns as soon as it ends; no fixed sleep), then read the log.`

// biome-ignore lint/suspicious/noTemplateCurlyInString: expansão do shell, não do JS
const BG_DIR = '${TMPDIR:-/tmp}/pi-bg'

/**
 * Script POSIX sh: roda `command` em segundo plano com a saída num log; um vigia manda USR1 ao shell após `seconds`
 * e o trap imprime o fim do log e sai com 0 sem matar o comando. Fim normal: saída inteira e exit code originais.
 * O comando vai em linhas próprias (heredoc e comentário final funcionam); o vigia é morto com o `sleep` filho.
 */
export function wrapForBackground(command: string, seconds: number, id: string, dir = BG_DIR): string {
  const msg = `[bash-timeout] Still running after ${seconds} s: left running in the background (pid $__pibg_p, log $__pibg_l). Do not start another copy. To wait for it, use: while kill -0 $__pibg_p 2>/dev/null; do sleep 2; done (returns as soon as it ends; prefer this to a fixed sleep). Then read: tail -n 50 $__pibg_l`
  return `mkdir -p "${dir}"; __pibg_l="${dir}/${id}.log"
{
${command}
} >"$__pibg_l" 2>&1 &
__pibg_p=$!
trap 'tail -c 4000 "$__pibg_l"; echo; echo "${msg}"; exit 0' USR1
( sleep ${seconds}; kill -0 $__pibg_p 2>/dev/null && kill -USR1 $$ ) >/dev/null 2>&1 &
__pibg_w=$!
wait $__pibg_p; __pibg_rc=$?
pkill -P $__pibg_w 2>/dev/null; kill $__pibg_w 2>/dev/null
cat "$__pibg_l"; exit $__pibg_rc
`
}

export default function (pi: ExtensionAPI) {
  pi.on('tool_call', (event) => {
    if (event.toolName !== 'bash') return undefined
    const input = event.input as { timeout?: number }
    const t = decide(input.timeout).timeout
    input.timeout = t
    const cmd = (input as { command?: string }).command
    if (process.env.PI_BASH_TIMEOUT_BG === '1' && cmd?.trim() && !/&\s*$/.test(cmd) && !/^\s*sleep /.test(cmd)) {
      const id = String((event as { toolCallId?: string }).toolCallId ?? Date.now()).replace(/[^A-Za-z0-9_-]/g, '_')
      ;(input as { command: string }).command = wrapForBackground(cmd, t, id)
      input.timeout = t + 60 // folga para o pi não matar antes do trap
    }
    return undefined
  })
  pi.on('tool_result', (event) => {
    if (event.toolName !== 'bash' || !event.isError) return undefined
    const timedOut = event.content.some((c) => c.type === 'text' && c.text.includes('Command timed out after'))
    if (!timedOut) return undefined
    return { content: [...event.content, { type: 'text' as const, text: TIMEOUT_HINT }] }
  })
}

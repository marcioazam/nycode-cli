/**
 * Seta ↑ também restaura as mensagens enfileiradas (steering/follow-up) para o editor, pedido do usuário
 * 2026-11-12. Só age com o editor vazio e fila não vazia: aí reescreve ↑ como Alt+↑ (app.message.dequeue).
 * Fora disso ↑ segue normal (cursor e histórico). Alt+↑ continua funcionando.
 * Reverter: apagar este diretório.
 */
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

const UP = new Set(['\x1b[A', '\x1bOA'])
const ALT_UP = '\x1b[1;3A'

export function rewrite(data: string, editorEmpty: boolean, pending: boolean): string | undefined {
  return UP.has(data) && editorEmpty && pending ? ALT_UP : undefined
}

export default function (pi: ExtensionAPI) {
  pi.on('session_start', (_event, ctx) => {
    if (!ctx.hasUI) return
    ctx.ui.onTerminalInput((data) => {
      const out = rewrite(data, ctx.ui.getEditorText().trim() === '', ctx.hasPendingMessages())
      return out ? { data: out } : undefined
    })
  })
}

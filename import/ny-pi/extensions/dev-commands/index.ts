/** Comandos de desenvolvimento: /copy-code [N] e /keybindings. */

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { copyCode } from './copy-code.ts'
import { editKeybindings } from './keybindings.ts'

export default function (pi: ExtensionAPI) {
  pi.registerCommand('copy-code', {
    description: 'Copia um bloco de código da última resposta: /copy-code [N]',
    handler: async (args, ctx) => copyCode(args ?? '', ctx),
  })
  pi.registerCommand('keybindings', {
    description: 'Edita, valida e recarrega keybindings.json',
    handler: async (_args, ctx) => editKeybindings(ctx),
  })
}

/** Controle visual do pi: indicador de trabalho, cabeçalho e renderizadores de ferramentas. */

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import header from './header.ts'
import tools from './tools.ts'
import working from './working.ts'

export default function (pi: ExtensionAPI) {
  for (const part of [working, header, tools]) part(pi)
}

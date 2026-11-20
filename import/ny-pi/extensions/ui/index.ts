/** UI do pi: editor (nome, ?, vim), acessibilidade, título/foco, /diff e /btw. Painel de subagentes: pi-code fleet-ui. */

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import a11y from './a11y.ts'
import btw from './btw.ts'
import diff from './diff.ts'
import editor from './editor.ts'
import terminal from './terminal.ts'

export default function (pi: ExtensionAPI) {
  for (const part of [editor, a11y, terminal, diff, btw]) part(pi)
}

/** /keybindings: edita keybindings.json no editor do pi, valida, grava com .bak e recarrega. */

import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ExtensionCommandContext } from '@earendil-works/pi-coding-agent'
import { getAgentDir } from '@earendil-works/pi-coding-agent'

export interface Validation {
  errors: string[]
  warnings: string[]
}

// ponytail: o pacote não exporta a lista de ids em valor; vale só o formato app.x / tui.x.
const ID_SHAPE = /^(app|tui)\.[A-Za-z][\w.]*$/

export function validateKeybindings(text: string): Validation {
  const errors: string[] = []
  const warnings: string[] = []
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch (e) {
    return { errors: [`JSON inválido: ${e instanceof Error ? e.message : String(e)}`], warnings }
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return { errors: ['O JSON deve ser um objeto.'], warnings }
  for (const [id, v] of Object.entries(data)) {
    if (!(typeof v === 'string' || (Array.isArray(v) && v.every((x) => typeof x === 'string')))) errors.push(`"${id}": o valor deve ser texto ou lista de textos.`)
    if (!ID_SHAPE.test(id)) warnings.push(`Id desconhecido: "${id}" (esperado app.* ou tui.*).`)
  }
  return { errors, warnings }
}

export async function editKeybindings(ctx: ExtensionCommandContext, path: string = join(getAgentDir(), 'keybindings.json')): Promise<void> {
  if (!ctx.hasUI) return ctx.ui.notify(`Arquivo de atalhos: ${path}`, 'info')
  const existed = existsSync(path)
  const edited = await ctx.ui.editor('keybindings.json', existed ? readFileSync(path, 'utf8') : '{\n}\n')
  if (edited === undefined) return ctx.ui.notify('Edição cancelada; nada foi gravado.', 'info')
  const { errors, warnings } = validateKeybindings(edited)
  if (errors.length) return ctx.ui.notify(`keybindings.json não gravado:\n${errors.join('\n')}`, 'error')
  if (existed) copyFileSync(path, `${path}.bak`)
  writeFileSync(path, edited)
  ctx.ui.notify(`keybindings.json gravado${existed ? ' (backup em .bak)' : ''}.${warnings.length ? `\n${warnings.join('\n')}` : ''}`, warnings.length ? 'warning' : 'info')
  await ctx.reload()
}

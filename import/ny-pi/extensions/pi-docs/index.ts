/**
 * Troca a seção `docs` do prompt (~1,3 KB) por um ponteiro de uma linha fora de trabalho no próprio pi.
 *
 * O pi monta a seção `docs` (caminhos + guia de leitura) em todo prompt sem prompt customizado. Fora do trabalho
 * com o pi isso é ruído; `systemPromptOptions.sections.docs` sobrescreve a seção sem quebrar o cache do prefixo.
 * Modo `auto` (padrão): completa quando o cwd é $HOME, está sob ~/.pi, ou o package.json do cwd cita
 * `pi-coding-agent`/`pi-package`; compacta nos demais. `/pi-docs on|off|auto` troca na sessão (`on` = completa).
 * Spec: ~/.pi/agent/claude-home/docs/context-economy-extensions-2026-11-12.md.
 *
 * Reverter: apagar este diretório.
 */
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, sep } from 'node:path'
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

export type Mode = 'auto' | 'on' | 'off'

let mode: Mode = 'auto'
let weSet = false // só apagamos a seção que nós mesmos pusemos
let text: string | undefined // memo: depois da 1ª troca o prompt não traz mais os caminhos

export function wantFull(m: Mode, cwd: string, home: string): boolean {
  if (m !== 'auto') return m === 'on'
  if (cwd === home || cwd.startsWith(join(home, '.pi') + sep) || cwd === join(home, '.pi')) return true
  try {
    const pkg = join(cwd, 'package.json')
    if (!existsSync(pkg)) return false
    const text = readFileSync(pkg, 'utf8')
    return text.includes('pi-coding-agent') || text.includes('"pi-package"')
  } catch {
    return false
  }
}

/** Texto compacto a partir dos caminhos do prompt atual; undefined se não achar os três. */
export function compact(systemPrompt: string): string | undefined {
  const pick = (label: string) => new RegExp(`${label}: (\\S+)`).exec(systemPrompt)?.[1]
  const [docs, readme, examples] = [pick('Additional docs'), pick('Main documentation'), pick('Examples')]
  if (!docs || !readme || !examples) return undefined
  return `Pi docs live in ${docs} (README at ${readme}, examples at ${examples}); read them only when the task is about pi itself.`
}

type Sections = Record<string, string | undefined>
type Ev = { systemPrompt: string; systemPromptOptions: { customPrompt?: string; sections?: Sections } }

/** Aplica o modo atual ao evento; devolve true quando a seção ficou compacta. */
export function apply(event: Ev, cwd: string, home: string): boolean {
  const o = event.systemPromptOptions
  if (o.customPrompt) return false
  if (wantFull(mode, cwd, home)) {
    if (weSet && o.sections) delete o.sections.docs
    weSet = false
    return false
  }
  text ??= compact(event.systemPrompt)
  if (!text) return false
  o.sections ??= {}
  o.sections.docs = text
  weSet = true
  return true
}

export const getMode = () => mode
export const setMode = (m: Mode) => {
  mode = m
}

export default function (pi: ExtensionAPI) {
  pi.on('before_agent_start', (event, ctx) => {
    apply(event as unknown as Ev, ctx.cwd, homedir())
    return undefined
  })

  pi.registerCommand('pi-docs', {
    description: 'Pi docs in the system prompt: on (full) | off (compact) | auto',
    handler: async (args, ctx) => {
      const a = args.trim()
      if (a === 'on' || a === 'off' || a === 'auto') mode = a
      else if (a) return ctx.ui.notify('Usage: /pi-docs on|off|auto', 'warning')
      const full = wantFull(mode, ctx.cwd, homedir())
      ctx.ui.notify(`pi-docs: ${mode} (${full ? 'full docs section' : 'compact pointer'})`, 'info')
    },
  })
}

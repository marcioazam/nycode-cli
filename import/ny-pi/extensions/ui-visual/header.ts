/** Cabeçalho: logo + identidade (versão, modelo, raciocínio, contexto), lugar (pasta, branch) e atalhos; sem NO_COLOR. */

import { execFileSync } from 'node:child_process'
import { homedir } from 'node:os'
import { sep } from 'node:path'
import { VERSION } from '@earendil-works/pi-coding-agent'
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { backgroundAnsi, foregroundAnsi, isAppleTerminalSession, rgbColor, truncateToWidth, visibleWidth } from '@earendil-works/pi-tui'
import type { TerminalColorMode } from '@earendil-works/pi-tui'
import { noColor } from '../ui/a11y.ts'
import { icon } from './icons.ts'

type Style = { fg: (key: string, text: string) => string; bold: (text: string) => string; getColorMode?: () => TerminalColorMode }
export type HeaderParts = { version: string; model: string; cwd: string; branch: string; thinking?: string; context?: string }

export const HINTS: [string, string][] = [['?', 'atalhos'], ['/', 'comandos'], ['!', 'shell'], ['esc', 'interrompe']]

// Logo oficial do pi (cópia de pi-coding-agent components/pi-logo.js, não exportado): 4 colunas × 2 linhas.
const CORAL = rgbColor(228, 138, 122)
const BLUE = rgbColor(79, 142, 179)
const YELLOW = rgbColor(234, 182, 93)
const RESET = '\x1b[0m'

export function logoLines(mode: TerminalColorMode): [string, string] {
  if (isAppleTerminalSession()) return [`${foregroundAnsi(CORAL, mode)}P${RESET}${foregroundAnsi(YELLOW, mode)}i${RESET}  `, '    ']
  const fg = (c: typeof CORAL) => foregroundAnsi(c, mode)
  return [`${fg(CORAL)}${backgroundAnsi(BLUE, mode)}▀${RESET}${fg(CORAL)}▀█${RESET} `, `${fg(BLUE)}█▀${RESET} ${fg(YELLOW)}█${RESET}`]
}

/** Contexto em tokens legível: 200000 → 200k, 1000000 → 1M. */
export function formatTokens(n: number): string {
  if (!(n > 0)) return ''
  if (n >= 1e6) return `${+(n / 1e6).toFixed(1)}M`
  return `${Math.round(n / 1e3)}k`
}

/** Caminho com ~ no lugar da home. */
export function tildePath(cwd: string, home = homedir()): string {
  return cwd === home ? '~' : cwd.startsWith(home + sep) ? `~${cwd.slice(home.length)}` : cwd
}

/** Junta segmentos e descarta os de menor prioridade (os últimos) até caber; trunca só o que sobrar. */
function fit(prefix: string, segs: string[], gap: string, width: number): string {
  const s = [...segs]
  while (s.length > 1 && visibleWidth(prefix + s.join(gap)) > width) s.pop()
  return truncateToWidth(prefix + s.join(gap), Math.max(0, width))
}

/** Duas linhas: identidade (pi, modelo, raciocínio, contexto) + lugar (pasta, branch), e atalhos. */
export function buildHeaderLines(p: HeaderParts, theme: Style, width: number): string[] {
  const dim = (s: string) => theme.fg('dim', s)
  const [top, bottom] = logoLines(theme.getColorMode?.() ?? 'truecolor')
  const id = [`${theme.fg('accent', theme.bold('pi'))} ${dim(p.version)}`]
  if (p.model) id.push(theme.bold(theme.fg('text', p.model)))
  if (p.thinking) id.push(`${theme.fg('muted', icon('think'))} ${theme.fg('muted', p.thinking)}`)
  if (p.context) id.push(`${theme.fg('muted', p.context)} ${dim('ctx')}`)
  const branch = p.branch ? `  ${dim(icon('branch'))} ${theme.fg('mdLink', p.branch)}` : ''
  id.push(theme.fg('muted', tildePath(p.cwd)) + branch)
  const hints = HINTS.map(([k, label]) => `${theme.fg('accent', k)} ${dim(label)}`)
  return [
    fit(` ${top}  `, id, dim('  ·  '), width),
    fit(` ${bottom}  `, hints, '   ', width),
  ]
}

export function gitBranch(cwd: string): string {
  try {
    return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd, timeout: 500, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    return ''
  }
}

export default function (pi: ExtensionAPI) {
  pi.on('session_start', (_e, ctx) => {
    if (!ctx.hasUI || process.env.PI_CODE_SUBAGENT === '1' || noColor()) return
    const branch = gitBranch(ctx.cwd)
    ctx.ui.setHeader((_tui, theme) => ({
      render: (width: number) => {
        const thinking = ctx.model?.reasoning ? pi.getThinkingLevel() : ''
        const context = formatTokens(ctx.model?.contextWindow ?? 0)
        return buildHeaderLines({ version: VERSION, model: ctx.model?.id ?? '', cwd: ctx.cwd, branch, thinking, context }, theme, width)
      },
      invalidate() {},
    }))
  })
}

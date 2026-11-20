/**
 * Acessibilidade: NO_COLOR (no-color.org) → tema mono e cabeçalho sem cor; PI_REDUCED_MOTION=1 ou NO_PROGRESS não vazio (no-progress.org) → indicador estático.
 * O logo do cabeçalho embutido usa cores fixas da marca, fora do tema (pi-logo.js no 1.5.2), por isso o wrapper.
 */

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

type Env = Record<string, string | undefined>

export const noColor = (env: Env = process.env): boolean => (env.NO_COLOR ?? '') !== ''
export const reducedMotion = (env: Env = process.env): boolean => env.PI_REDUCED_MOTION === '1' || (env.NO_PROGRESS ?? '') !== ''

type Part = { children?: Part[]; render?: (w: number) => string[]; setExpanded?: (e: boolean) => void; invalidate?: () => void; onLogoClick?: unknown; plainInner?: Part }

// O BuiltInHeader é o único componente com o campo `onLogoClick`; no /reload ele está atrás do wrapper anterior.
function findBuiltIn(node: Part, depth = 0): Part | undefined {
  if (node.plainInner) return node.plainInner
  if ('onLogoClick' in node) return node
  if (depth > 3) return undefined
  for (const c of node.children ?? []) {
    const hit = findBuiltIn(c, depth + 1)
    if (hit) return hit
  }
  return undefined
}

/** Cabeçalho embutido sem SGR; sem handleMouse, então o clique no logo (easter egg 3D colorido) fica desligado. */
export function plainHeader(tui: unknown) {
  const inner = findBuiltIn(tui as Part)
  return {
    plainInner: inner,
    render: (w: number) => (inner?.render?.(w) ?? []).map((l) => l.replace(/\x1b\[[0-9;:]*m/g, '')),
    setExpanded: (e: boolean) => inner?.setExpanded?.(e),
    invalidate: () => inner?.invalidate?.(),
  }
}

export default function (pi: ExtensionAPI) {
  pi.on('session_start', (_event, ctx) => {
    if (!ctx.hasUI) return
    if (noColor()) {
      // Objeto, não nome: setTheme(nome) grava `theme` em settings.json e tira a cor de todas as sessões seguintes.
      const mono = ctx.ui.getTheme('mono')
      const r = mono ? ctx.ui.setTheme(mono) : { success: false, error: 'tema não encontrado' }
      if (!r.success) ctx.ui.notify(`NO_COLOR: tema mono indisponível (${r.error ?? 'erro'})`, 'warning')
      ctx.ui.setHeader((tui) => plainHeader(tui))
    }
    if (reducedMotion()) ctx.ui.setWorkingIndicator({ frames: ['●'] })
  })
}

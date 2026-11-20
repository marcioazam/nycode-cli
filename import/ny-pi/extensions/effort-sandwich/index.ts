/**
 * Esforço no plano: na sessão headless de topo (`pi -p`), raciocínio `high` só nos primeiros N turnos (ler a tarefa e
 * planejar) e o nível da sessão depois. Opt-in: PI_EFFORT_SANDWICH=1 liga. PI_EFFORT_SANDWICH_TURNS=N
 * (padrão 1). Nível inicial >= high: nada muda. Medição e contrato: docs/specs/0009-effort-sandwich.md.
 * Reverter: apagar este diretório (e as linhas dele em publish.list e docs/specs/0005-core-scope.md).
 */
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { isTopLevelHeadless } from '../headless-lean/index.ts'

export const DEFAULT_TURNS = 1
const ORDER = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']

export function turnsFromEnv(v: string | undefined): number {
  return v && /^[1-9]\d*$/.test(v) ? Number(v) : DEFAULT_TURNS
}

/** Nível desejado no turno `turn` (0-based). */
export function levelFor(turn: number, initial: string, turns: number): string {
  if (ORDER.indexOf(initial) >= ORDER.indexOf('high')) return initial
  return turn < turns ? 'high' : initial
}

export default function (pi: ExtensionAPI) {
  if (process.env.PI_EFFORT_SANDWICH !== '1') return
  const turns = turnsFromEnv(process.env.PI_EFFORT_SANDWICH_TURNS)
  let initial: string | undefined
  pi.on('turn_start', (event, ctx) => {
    if (!isTopLevelHeadless(ctx.hasUI, process.env.PI_CODE_SUBAGENT_DEPTH)) return
    initial ??= pi.getThinkingLevel()
    const want = levelFor(event.turnIndex, initial, turns)
    if (want !== pi.getThinkingLevel()) pi.setThinkingLevel(want as ReturnType<typeof pi.getThinkingLevel>)
  })
}

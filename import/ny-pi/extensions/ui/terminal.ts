/**
 * Título dinâmico do terminal (spinner enquanto trabalha, ✓ ao terminar fora de foco) e rastreio de foco (DEC 1004).
 * No fullscreen o viewport do pi-tui (tui-alt-screen.js) consome \x1b[I / \x1b[O antes dos listeners das extensões,
 * então o foco é lido de um observador extra em process.stdin 'data' (não consome nada); onTerminalInput só
 * engole as sequências no modo regular, onde a extensão liga o 1004 e o editor as receberia.
 */

import { basename } from 'node:path'
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import { reducedMotion } from './a11y.ts'

export const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
export type TitleState = 'idle' | 'working' | 'done'

/** Mesmo formato do título nativo do pi (updateTerminalTitle). */
export const baseTitle = (sessionName: string | undefined, cwd: string): string =>
  sessionName ? `pi - ${sessionName} - ${basename(cwd)}` : `pi - ${basename(cwd)}`

export const titleFor = (base: string, state: TitleState, frame: string): string =>
  state === 'working' ? `${frame} ${base}` : state === 'done' ? `✓ ${base}` : base

/** Relato de foco: só a sequência exata (o terminal a envia como escrita própria); outra entrada → undefined. */
export const parseFocus = (data: string): boolean | undefined =>
  data === '\x1b[I' ? true : data === '\x1b[O' ? false : undefined

/** Último relato de foco num bloco cru do stdin (pode vir junto de outros bytes). */
export const lastFocus = (chunk: string): boolean | undefined => {
  const i = chunk.lastIndexOf('\x1b[I')
  const o = chunk.lastIndexOf('\x1b[O')
  return i < 0 && o < 0 ? undefined : i > o
}

export default function (pi: ExtensionAPI) {
  let timer: ReturnType<typeof setInterval> | undefined
  let unsub: (() => void) | undefined
  let working = false
  let done = false
  let focused: boolean | undefined
  let regular = false
  let frame = 0
  let ctxRef: ExtensionContext | undefined

  const stopTimer = () => {
    if (timer) clearInterval(timer)
    timer = undefined
  }
  const apply = () => {
    if (!ctxRef) return
    const state: TitleState = working ? 'working' : done ? 'done' : 'idle'
    const glyph = reducedMotion() ? '●' : FRAMES[frame % FRAMES.length]!
    ctxRef.ui.setTitle(titleFor(baseTitle(pi.getSessionName(), ctxRef.cwd), state, glyph))
  }
  const active = () => ctxRef !== undefined

  pi.on('session_start', (_event, ctx) => {
    if (!ctx.hasUI || process.env.PI_CODE_SUBAGENT === '1') return
    ctxRef = ctx
    regular = (pi.getSettings() as { tuiMode?: string }).tuiMode === 'regular'
    if (regular) process.stdout.write('\x1b[?1004h')
    unsub?.()
    const onData = (d: Buffer | string) => {
      const f = lastFocus(String(d))
      if (f === undefined || f === focused) return
      focused = f
      if (f) done = false
      pi.events.emit('pi-ui:terminal-focus', { focused: f })
      apply()
    }
    process.stdin.on('data', onData)
    const off = ctx.ui.onTerminalInput((data) => (regular && parseFocus(data) !== undefined ? { consume: true } : undefined))
    unsub = () => {
      process.stdin.off('data', onData)
      off()
    }
  })

  pi.on('agent_start', () => {
    if (!active()) return
    working = true
    done = false
    frame = 0
    stopTimer()
    if (!reducedMotion()) timer = setInterval(() => { frame++; apply() }, 90)
    apply()
  })

  pi.on('agent_settled', () => {
    if (!active()) return
    working = false
    stopTimer()
    done = focused === false
    apply()
  })

  pi.on('session_info_changed', () => apply())

  pi.on('session_shutdown', () => {
    stopTimer()
    unsub?.()
    unsub = undefined
    if (regular) process.stdout.write('\x1b[?1004l')
    regular = false
    ctxRef = undefined
  })
}

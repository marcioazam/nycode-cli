/**
 * Última mensagem do usuário fixa no topo do transcript (como no Claude Code), pedido do usuário 2026-11-12.
 * Só no modo fullscreen: quando o início do prompt mais recente acima da janela some ao rolar, uma linha flutuante
 * mostra o texto; clicar nela rola até o prompt. Lê o layout do TUI (campos internos do pi-tui 1.5.2); se mudarem,
 * a extensão vira no-op em vez de quebrar.
 * Reverter: apagar este diretório.
 */
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { stripTerminalSequences, truncateToWidth, visibleWidth } from '@earendil-works/pi-tui'
import { findSticky, selecting, stickyLine, stickyStyle, userMatcher, type Sticky } from './sticky.ts'

function attach(tui: any, style: (s: string) => string, isUser: () => (zone: string) => boolean): () => void {
  if (typeof tui.getPrimaryScrollView !== 'function' || typeof tui.showOverlay !== 'function') return () => {}
  const opts: any = { row: 0, col: 0, width: 1, nonCapturing: true }
  let current: Sticky | undefined
  let scrollView: any
  opts.visible = () => {
    current = undefined
    if (selecting(tui)) return false // some durante a seleção para o arraste rolar o transcript
    scrollView = tui.getPrimaryScrollView()
    const root = tui.currentLayout?.root
    if (!root || !scrollView) return false
    const box = findBox(root, scrollView)
    if (!box?.scrollContentLines) return false
    current = findSticky(box.scrollContentLines, scrollView.scrollTop, isUser(), stripTerminalSequences)
    opts.row = box.rect.y
    opts.col = box.rect.x
    opts.width = Math.max(1, box.rect.width - 1) // deixa a coluna da barra de rolagem livre
    return current !== undefined
  }
  const component = {
    render: (width: number) => current
      ? [stickyLine(current.text, width, truncateToWidth, visibleWidth, style)]
      : [],
    invalidate: () => {},
    handleMouse: (e: any) => {
      if (e.button !== 'left') return undefined
      if (e.type === 'click' && current) {
        scrollView.scrollTo(current.row, { disableFollow: true })
        tui.requestRender()
      }
      return { handled: true }
    },
  }
  const handle = tui.showOverlay(component, opts)
  return () => handle.hide()
}

function findBox(box: any, scrollView: any): any {
  if (box.scrollView === scrollView) return box
  for (const child of box.children ?? []) {
    const hit = findBox(child, scrollView)
    if (hit) return hit
  }
  return undefined
}

function userTexts(ctx: any): string[] {
  const out: string[] = []
  for (const e of ctx.sessionManager.getBranch()) {
    const m = e.type === 'message' ? e.message : undefined
    if (m?.role !== 'user') continue
    out.push(typeof m.content === 'string' ? m.content
      : m.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join(' '))
  }
  return out
}

export default function (pi: ExtensionAPI) {
  let matcher = userMatcher([])
  const refresh = (_e: unknown, ctx: any) => { matcher = userMatcher(userTexts(ctx)) }
  pi.on('message_end', refresh)
  pi.on('session_tree', refresh)
  pi.on('session_start', (e, ctx) => {
    refresh(e, ctx)
    if (!ctx.hasUI) return
    ctx.ui.setWidget('sticky-prompt', (tui, theme) => {
      const dispose = attach(tui, stickyStyle(theme), () => matcher)
      return { render: () => [], invalidate: () => {}, dispose }
    })
  })
}

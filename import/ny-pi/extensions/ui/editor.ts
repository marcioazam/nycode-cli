/**
 * Editor do pi: /rename e nome da sessão na borda (antes em rename.ts), `?` com editor vazio abre /hotkeys
 * Ctrl+R histórico de prompts, Ctrl+S rascunho guardado, Ctrl+C com texto o põe no histórico (↑),
 * e /vim alterna edição modal (normal/insert), persistida em ~/.pi/agent/ui-state.json.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { CustomEditor, type ExtensionAPI } from '@earendil-works/pi-coding-agent'
import type { TUI } from '@earendil-works/pi-tui'
import { matchesKey, truncateToWidth, visibleWidth } from '@earendil-works/pi-tui'
import { loadScope, PromptHistory, stashStep } from './history.ts'

export const STATE_PATH = join(homedir(), '.pi', 'agent', 'ui-state.json')
const statePath = () => process.env.PI_UI_STATE || STATE_PATH // override só para testes

/** Lê o estado; arquivo ausente, corrompido ou que não seja objeto → {}. */
export function readState(path = STATE_PATH): Record<string, unknown> {
  try {
    const v: unknown = JSON.parse(readFileSync(path, 'utf8'))
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/** Mescla `patch` no estado preservando as outras chaves. */
export function mergeState(patch: Record<string, unknown>, path = STATE_PATH): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify({ ...readState(path), ...patch }, null, 2)}\n`)
}

/** Rótulo do nome na borda e a largura que sobra para a borda nativa; undefined quando não cabe. */
export function nameLabel(name: string | undefined, width: number): { label: string; rest: number } | undefined {
  if (!name) return undefined
  const label = ` ${truncateToWidth(name, Math.max(0, Math.floor(width / 2) - 2), '…')} `
  const rest = width - visibleWidth(label) - 3
  return label.trim() && rest >= 12 ? { label, rest } : undefined
}

export type Mode = 'normal' | 'insert'

// Modo normal: tecla → sequência enviada ao editor nativo (w/b = alt+f/alt+b, palavra).
export const NORMAL_KEYS: Record<string, string> = {
  h: '\x1b[D', j: '\x1b[B', k: '\x1b[A', l: '\x1b[C', '0': '\x01', $: '\x05', x: '\x1b[3~', w: '\x1bf', b: '\x1bb',
}

/** Transição vim pura: novo modo e as sequências a repassar ao editor nativo. */
export function vimStep(mode: Mode, data: string): { mode: Mode; send: string[] } {
  if (matchesKey(data, 'escape')) return mode === 'insert' ? { mode: 'normal', send: [] } : { mode, send: [data] }
  if (mode === 'insert') return { mode, send: [data] }
  if (data === 'i') return { mode: 'insert', send: [] }
  if (data === 'a') return { mode: 'insert', send: [NORMAL_KEYS.l!] }
  const seq = NORMAL_KEYS[data]
  if (seq) return { mode, send: [seq] }
  // Controles (ctrl+c...) passam; caracteres imprimíveis são ignorados.
  return { mode, send: data.length === 1 && data.charCodeAt(0) >= 32 ? [] : [data] }
}

export class UiEditor extends CustomEditor {
  mode: Mode = 'insert'
  stash: string | undefined
  openHistory: (() => void) | undefined
  private readonly vim: { enabled: boolean }
  private readonly sessionName: () => string | undefined

  constructor(tui: TUI, theme: any, kb: any, vim: { enabled: boolean }, sessionName: () => string | undefined) {
    super(tui, theme, kb, { embedWorkingStatus: true })
    this.vim = vim
    this.sessionName = sessionName
  }

  handleInput(data: string): void {
    if (!this.vim.enabled) this.mode = 'insert'
    // Ctrl+R/S/C valem em qualquer modo vim (sem registerShortcut: colidiriam com seletores do pi).
    if (matchesKey(data, 'ctrl+r')) return this.openHistory?.()
    if (matchesKey(data, 'ctrl+s')) {
      const next = stashStep(this.getText(), this.stash)
      this.stash = next.stash
      this.setText(next.text)
      return
    }
    if (matchesKey(data, 'ctrl+c') && this.getText() !== '') this.addToHistory(this.getText()) // ↑ devolve; o fluxo nativo limpa
    // `?` com editor vazio: o submit do app trata '/hotkeys' como comando nativo.
    if (data === '?' && this.mode === 'insert' && this.getText() === '') {
      this.onSubmit?.('/hotkeys')
      return
    }
    if (!this.vim.enabled) return super.handleInput(data)
    const step = vimStep(this.mode, data)
    this.mode = step.mode
    for (const s of step.send) super.handleInput(s)
  }

  protected renderTopBorder(width: number, hiddenLineCount: number): string {
    const marker = ' ✎ rascunho '
    const tail = this.stash !== undefined && width - marker.length - 3 >= 12 ? marker + this.borderColor('───') : ''
    const w = width - visibleWidth(tail)
    const fit = nameLabel(this.sessionName(), w)
    if (!fit) return super.renderTopBorder(w, hiddenLineCount) + tail
    return super.renderTopBorder(fit.rest, hiddenLineCount) + fit.label + this.borderColor('───') + tail
  }

  render(width: number): string[] {
    const lines = super.render(width)
    if (!this.vim.enabled || lines.length === 0) return lines
    const label = this.mode === 'normal' ? ' NORMAL ' : ' INSERT '
    const last = lines.length - 1
    if (visibleWidth(lines[last]!) >= label.length) lines[last] = truncateToWidth(lines[last]!, width - label.length, '') + label
    return lines
  }
}

export default function (pi: ExtensionAPI) {
  let tui: TUI | undefined
  let installed = false
  let current: any // último ctx: o editor sobrevive a /new e /resume
  let historyOpen = false
  const vim = { enabled: false }

  pi.registerCommand('rename', {
    description: 'Renomeia a sessão atual (alias de /name) [novo nome]',
    handler: async (args, ctx) => {
      const name = args.trim()
      if (name) {
        pi.setSessionName(name)
        ctx.ui.notify(`Sessão renomeada: ${name}`, 'info')
      } else {
        const current = pi.getSessionName()
        ctx.ui.notify(current ? `Sessão: ${current}` : 'Sessão sem nome (uso: /rename <nome>)', 'info')
      }
    },
  })

  pi.registerCommand('vim', {
    description: 'Alterna a edição modal vim (normal/insert) no editor',
    handler: async (_args, ctx) => {
      if (!installed) return ctx.ui.notify('/vim indisponível: outro editor customizado está ativo', 'warning')
      vim.enabled = !vim.enabled
      try {
        mergeState({ vim: vim.enabled }, statePath())
      } catch (e) {
        ctx.ui.notify(`ui-state.json não gravado: ${e instanceof Error ? e.message : e}`, 'warning')
      }
      ctx.ui.notify(`Modo vim ${vim.enabled ? 'ligado (Esc = normal, i = insert)' : 'desligado'}`, 'info')
      tui?.requestRender()
    },
  })

  pi.on('session_info_changed', () => tui?.requestRender())

  const openHistory = async (editor: UiEditor) => {
    const ctx = current
    if (!ctx || historyOpen) return
    historyOpen = true
    try {
      const sm = ctx.sessionManager
      const src = () => ({ branch: sm.getBranch(), sessionDir: sm.getSessionDir() })
      // ctx aqui é `any` (sobrevive a /new): sem argumento de tipo, o retorno é anotado na const.
      const chosen: string | undefined = await ctx.ui.custom(
        (t: TUI, theme: any, _kb: unknown, done: (v: string | undefined) => void) =>
          new PromptHistory(theme, (scope) => loadScope(scope, src()), done, () => t.requestRender()),
        { overlay: true, overlayOptions: { anchor: 'center', width: '80%', maxHeight: '70%' } },
      )
      if (chosen !== undefined) editor.setText(chosen)
    } catch (e) {
      ctx.ui.notify(`Histórico indisponível: ${e instanceof Error ? e.message : e}`, 'warning')
    } finally {
      historyOpen = false
    }
  }

  pi.on('session_start', (_event, ctx) => {
    current = ctx
    if (!ctx.hasUI) return
    if (ctx.ui.getEditorComponent()) return // outro editor customizado já assumiu; não sobrepor
    vim.enabled = readState(statePath()).vim === true
    installed = true
    ctx.ui.setEditorComponent((t, theme, keybindings) => {
      tui = t
      const ed = new UiEditor(t, theme, keybindings, vim, () => pi.getSessionName())
      ed.openHistory = () => void openHistory(ed)
      return ed
    })
  })
}

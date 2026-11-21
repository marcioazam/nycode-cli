/**
 * Bypass Permissions (estilo Claude Code) para o guard de permissões do pi.
 *
 * Padrão: LIGADO (modo autônomo). O wrapper ~/.local/bin/pi exporta
 * PI_BYPASS_PERMISSIONS=1 a menos que você rode `pi --safe` (ou PI_BYPASS_PERMISSIONS=0).
 *
 * O guard (~/.pi/agent/claude-home/hooks/guard.py, hook PreToolUse via pi-code) lê
 * PI_BYPASS_PERMISSIONS do ambiente; os hooks herdam o process.env do pi, então
 * alternar a variável aqui vale imediatamente para esta sessão (e subagents iniciados depois).
 *
 *   /bypass          alterna
 *   /bypass on|off   define      /bypass status   mostra
 *   Ctrl+Shift+B     alterna
 *
 * Plan mode (pi-code): ao sair do plan mode para executar o plano, o bypass é
 * religado automaticamente (mesmo que você o tenha desligado antes). Enquanto o
 * plan mode está ativo, o próprio plan mode já restringe as ferramentas.
 *
 * Com bypass ON as confirmações ("ask") somem; os bloqueios catastróficos ("deny") continuam.
 */

import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import { Key } from '@earendil-works/pi-tui'

const VAR = 'PI_BYPASS_PERMISSIONS'
const STATUS_KEY = 'bypass-permissions'
const PLAN_MODE_CHANNEL = 'pi-code:plan-mode' // pi-code/extensions/internal/plan-mode-state.ts

function isOn(): boolean {
  return ['1', 'true', 'on', 'yes'].includes((process.env[VAR] ?? '').toLowerCase())
}

function render(ctx: ExtensionContext | undefined): void {
  if (!ctx?.hasUI) return
  // NO_COLOR: o texto fica pronto antes de ui/a11y.ts trocar para o tema mono, então sem cor aqui mesmo.
  const warn = process.env.NO_COLOR ? '⚠ BYPASS PERMISSIONS ON' : ctx.ui.theme.fg('error', '⚠ BYPASS PERMISSIONS ON')
  ctx.ui.setStatus(STATUS_KEY, isOn() ? warn : '🔒 permissions: ask')
}

function set(ctx: ExtensionContext | undefined, on: boolean, why?: string): void {
  process.env[VAR] = on ? '1' : '0'
  render(ctx)
  if (ctx?.hasUI) {
    const base = on ? 'Bypass Permissions ON: confirmações desligadas (bloqueios catastróficos continuam)' : 'Bypass Permissions OFF: confirmações reativadas'
    ctx.ui.notify(why ? `${base} (${why})` : base, on ? 'warning' : 'info')
  }
}

export default function (pi: ExtensionAPI) {
  let lastCtx: ExtensionContext | undefined
  let planActive = false

  pi.on('session_start', async (_event, ctx) => {
    lastCtx = ctx
    render(ctx)
  })

  // pi-code publica { active } no bus ao entrar/sair do plan mode.
  // Transição active -> inativo = plano sendo executado (ou plan mode encerrado): bypass ON.
  pi.events.on(PLAN_MODE_CHANNEL, (data: unknown) => {
    const active = (data as { active?: unknown } | undefined)?.active
    if (typeof active !== 'boolean') return
    const leaving = planActive && !active
    planActive = active
    if (leaving && !isOn()) set(lastCtx, true, 'execução do plano')
  })

  pi.registerCommand('bypass', {
    description: 'Bypass Permissions: alterna (ou on/off/status) as confirmações do guard',
    handler: async (args, ctx) => {
      lastCtx = ctx
      const arg = (args ?? '').trim().toLowerCase()
      if (arg === 'on') set(ctx, true)
      else if (arg === 'off') set(ctx, false)
      else if (arg === 'status') ctx.ui.notify(`Bypass Permissions: ${isOn() ? 'ON' : 'OFF'}`, 'info')
      else set(ctx, !isOn())
    },
  })

  pi.registerShortcut(Key.ctrlShift('b'), {
    description: 'Alternar Bypass Permissions',
    handler: async (ctx) => {
      lastCtx = ctx
      set(ctx, !isOn())
    },
  })
}

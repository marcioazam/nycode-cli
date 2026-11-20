/**
 * /puxar <perfil> [N|session-id]: importa a sessão mais recente (ou a N-ésima, ou uma por id) deste
 * diretório de um perfil do Claude Code para o pi e abre a sessão importada.
 *
 * Porte do ~/.claude/commands/puxar.md. Lá o command rodava ~/.claude/bin/puxar.py por `!` e gastava um
 * turno de Haiku só para repetir a saída; aqui é uma extensão: zero tokens, e a sessão já abre no fim
 * (no Claude o usuário ainda digitava /resume <id>). A conversão para o formato do pi fica em
 * ~/.pi/agent/claude-home/bin/puxar/puxar.py (testes em claude-home/bin/puxar/test_puxar.py).
 *
 * perfil: 1|claude = ~/.claude, N = ~/.claude-N, nome = ~/.claude-nome, ou caminho absoluto.
 */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

const SCRIPT = path.join(os.homedir(), '.pi', 'agent', 'claude-home', 'bin', 'puxar', 'puxar.py')
const USAGE = 'uso: /puxar <perfil> [N|session-id]  (perfil: 1=~/.claude, 2=~/.claude-2, glm=~/.claude-glm ou caminho; N: 1=mais recente, 2=penúltima...)'

/** Os perfis do Claude Code que existem em ~, no formato que o argumento aceita. */
function profiles(): string[] {
  let names: string[] = []
  try {
    names = fs.readdirSync(os.homedir())
  } catch {
    return []
  }
  const out: string[] = []
  for (const name of names.sort()) {
    if (name === '.claude') out.push('1')
    else if (name.startsWith('.claude-') && fs.existsSync(path.join(os.homedir(), name, 'projects'))) out.push(name.slice('.claude-'.length))
  }
  return out
}

export default function (pi: ExtensionAPI) {
  pi.registerCommand('puxar', {
    description: 'Importa a sessão mais recente (ou a N-ésima) deste diretório de um perfil do Claude Code e abre no pi <perfil> [N|session-id]',
    getArgumentCompletions: (prefix: string) => {
      if (prefix.includes(' ')) return null
      const items = profiles()
        .filter((p) => p.startsWith(prefix))
        .map((p) => ({ value: p, label: p, description: p === '1' ? '~/.claude' : `~/.claude-${p}` }))
      return items.length > 0 ? items : null
    },
    handler: async (args, ctx) => {
      const argLine = args.trim()
      if (!argLine) {
        ctx.ui.notify(USAGE, 'warning')
        return
      }
      // A pasta de sessões da sessão aberta respeita --session-dir, PI_CODING_AGENT_SESSION_DIR e sessionDir;
      // o script só calcula a padrão quando ela falta.
      let sessionDir = ''
      try {
        sessionDir = ctx.sessionManager.getSessionDir()
      } catch {
        // sessão efêmera: fica a pasta padrão
      }
      const result = await pi.exec('python3', [SCRIPT, argLine, ctx.cwd, sessionDir], { timeout: 120_000 })
      if (result.code !== 0) {
        ctx.ui.notify((result.stderr || result.stdout || `puxar.py saiu com ${result.code}`).trim(), 'error')
        return
      }
      const lines = result.stdout.trim().split('\n')
      const fileLine = lines.find((line) => line.startsWith('PI_SESSION_FILE='))
      const report = lines.filter((line) => !line.startsWith('PI_SESSION_FILE=')).join('\n')
      const file = fileLine?.slice('PI_SESSION_FILE='.length)
      if (!file || !fs.existsSync(file)) {
        ctx.ui.notify(`${report}\n(puxar.py não informou o arquivo da sessão)`, 'error')
        return
      }
      if (ctx.sessionManager.getSessionFile() === file) {
        ctx.ui.notify(`${report}\nEssa já é a sessão aberta.`, 'info')
        return
      }
      // Trocar de sessão no meio de uma resposta cortaria o turno; espera o agente assentar.
      await ctx.waitForIdle()
      const switched = await ctx.switchSession(file, {
        withSession: async (next) => {
          next.ui.notify(`${report}\nSessão importada aberta.`, 'info')
        },
      })
      if (switched.cancelled) ctx.ui.notify(`${report}\nA troca de sessão foi cancelada; abra pelo /resume.`, 'warning')
    },
  })
}

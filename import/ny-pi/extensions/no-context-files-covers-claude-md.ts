/**
 * Quando o CLAUDE.md de usuário e as rules do pi-code ficam fora do contexto (paridade com o Claude Code).
 *
 * O pi-code injeta `claude-home/CLAUDE.md` e `claude-home/rules/*.md` por conta própria; o único interruptor dele é
 * CLAUDE_CODE_DISABLE_CLAUDE_MDS=1, lido em session_start/before_agent_start, depois do carregamento das
 * extensões. Esta extensão o liga em dois casos:
 *
 * 1. `--no-context-files` / `-nc`: a flag do pi promete desligar a descoberta de CLAUDE.md, mas só cobria os context
 *    files nativos. É também a flag que o pi-code passa aos builtins `Explore` e `Plan` ("Explore and Plan start
 *    without your CLAUDE.md files", code.claude.com/docs/en/sub-agents).
 * 2. `omitClaudeMd: true` no frontmatter de um agente (campo do Claude Code v2.1.271+, mesma página: "Set to true to
 *    start this subagent without the user, project, and local CLAUDE.md files"), que o pi-code não implementa. Um
 *    agente do usuário com o nome `Explore` ou `Plan` substitui o builtin e, como no Claude, carregaria o CLAUDE.md;
 *    os de claude-home/agents declaram o campo para manter o desenho rápido e barato do builtin.
 *    O filho do `subagent` recebe `--system-prompt <tmp>/prompt-<nome>.md` (pi-code subagent/run.ts) e
 *    PI_CODE_SUBAGENT=1; o nome sai do arquivo.
 *
 * Fora do pacote pi-code de propósito: sobrevive a `pi update`. Docs: ~/.pi/agent/claude-home/docs/pi-instructions.md.
 */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

function agentDirs(): string[] {
  const configDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')
  return [path.join(configDir, 'agents'), path.join(os.homedir(), '.pi', 'agent', 'agents')]
}

/** O nome (sanitizado como no pi-code) do agente que este processo filho roda, ou undefined. */
function childAgentSafeName(argv: string[]): string | undefined {
  if (process.env.PI_CODE_SUBAGENT !== '1') return undefined
  const i = argv.indexOf('--system-prompt')
  const match = i >= 0 ? /^prompt-(.+)\.md$/.exec(path.basename(argv[i + 1] ?? '')) : null
  return match?.[1]
}

export function agentOmitsClaudeMd(safeName: string, dirs: string[] = agentDirs()): boolean {
  for (const dir of dirs) {
    let files: string[]
    try {
      files = fs.readdirSync(dir).filter((f) => f.endsWith('.md'))
    } catch {
      continue
    }
    for (const file of files) {
      const text = fs.readFileSync(path.join(dir, file), 'utf-8')
      const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1]
      if (fm === undefined) continue
      const name = /^name:\s*["']?([^"'\r\n]+?)["']?\s*$/m.exec(fm)?.[1] ?? file.slice(0, -3)
      if (name.replace(/[^\w.-]+/g, '_') !== safeName) continue
      return /^omitClaudeMd:\s*true\s*$/m.test(fm)
    }
  }
  return false
}

export function shouldOmitClaudeMd(argv: string[]): boolean {
  if (argv.includes('--no-context-files') || argv.includes('-nc')) return true
  const safeName = childAgentSafeName(argv)
  return safeName !== undefined && agentOmitsClaudeMd(safeName)
}

export default function (_pi: ExtensionAPI) {
  if (shouldOmitClaudeMd(process.argv.slice(2))) process.env.CLAUDE_CODE_DISABLE_CLAUDE_MDS = '1'
}

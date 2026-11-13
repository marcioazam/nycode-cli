/**
 * Gate de conclusão (2026-11-13, docs/preamble-diet-completion-gate-2026-11-13.md): se o turno editou código e
 * nenhuma checagem executada passou depois da última edição, o fim do turno é bloqueado uma vez, pedindo a
 * checagem ou a declaração explícita de que ela fica para depois (regra "verify once" do CLAUDE.md).
 *
 * Evidência: um type checker bloqueando a entrega levou os resultados corretos aceitos de 1 para 11 em 12, e o
 * diagnóstico a cada edição foi neutro (github.com/ianbarber/lsps-for-llms); LangChain +13,7 pp no Terminal-Bench 2
 * com um checklist antes de concluir.
 *
 * Escopo: desde a última mensagem do usuário. Edição = `edit`/`write` num arquivo de código (`bash` não conta, como
 * no plan-gate). Checagem = `bash` cujo comando casa com CHECK e terminou sem erro, ou `subagent` do `gate-runner`.
 * Limites: o sucesso vem do `isError` do resultado, então
 * `cmd | tail` vale o status do `tail` e um `gate-runner` conta mesmo se reportar check vermelho. Bloqueia no máximo 1 vez por turno (entrada `custom` `completion-gate`). Fica fora dos workers do `subagent`,
 * cujo orquestrador roda o gate, e do plan mode. `PI_COMPLETION_GATE=0` desliga. Em caso de falha, libera.
 * Testes: ~/.pi/agent/claude-home/bin/tests/gates/completion-gate.test.ts.
 */

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

type Entry = Record<string, any>
export interface CompletionDecision {
  action: 'none' | 'block'
  files?: string[]
  message?: string
}

const CODE = /\.(py|pyi|ts|tsx|mts|cts|js|jsx|mjs|cjs|go|rs|java|kt|kts|scala|rb|php|c|h|cc|cpp|hpp|cs|swift|dart|lua|sh|bash|zsh|sql|tf|proto|vue|svelte|astro|zig|ex|exs|erl|hs|ml|r|jl|nim)$/i
// Ancorado no início de cada segmento do comando (depois de wrappers), para `rg pytest` ou `cat eslint.config.js`
// não contarem como checagem.
const CHECK = new RegExp(
  '^(' +
    [
      'pytest', 'unittest', 'py_compile', 'mypy', 'pyright', 'ruff', 'flake8', 'pylint', 'tox', 'nox',
      'go\\s+(test|vet|build)', 'golangci-lint', 'staticcheck',
      'cargo\\s+(test|check|clippy|build|nextest)',
      '(npm|pnpm|yarn|bun)\\s+(run\\s+)?[\\w:-]*(test|lint|build|check|type)[\\w:-]*', 'npm\\s+t\\b',
      'vitest', 'jest', 'playwright\\s+test', 'tsc', 'tsgo', 'eslint', 'biome', 'oxlint', 'prettier\\s+--check',
      '(make|just|task)\\s+[\\w:-]*(test|check|lint|build|verify)[\\w:-]*',
      'gradlew?\\s+[\\w:-]*(test|check|build)', 'mvnw?\\s+[\\w:-]*(test|verify)', 'dotnet\\s+(test|build)',
      'terraform\\s+validate', 'tofu\\s+validate', 'tflint', 'shellcheck', '(ba)?sh\\s+-n', 'node(\\s+--?[\\w-]+(=\\S+)?)*\\s+--(test|check)\\b',
      'deno\\s+(test|check|lint)', 'php\\s+-l', 'phpunit', 'rspec', 'swift\\s+(test|build)', 'buf\\s+(lint|build)',
      '\\S*git-deliver', 'python3?\\s+\\S*(structure|check-[\\w-]+|test_[\\w-]+)\\.py',
    ].join('|') +
    ')(\\s|$)',
  'i',
)
// Prefixos que só embrulham o comando real.
const WRAP = /^(\w+=\S*|env|time|nice|sudo|timeout\s+\S+|npx|bunx|pnpm\s+(exec|dlx)|yarn\s+dlx|poetry\s+run|pipenv\s+run|python3?\s+-m|systemd-run(\s+\S+)*?\s+--|uv\s+run(\s+(--(with|python|project|directory|package|extra|group)\s+\S+|-p\s+\S+|-\S+))*)\s+/i

export function isCheckCommand(command: string): boolean {
  return command.split(/&&|\|\||[;|\n(]/).some((segment) => {
    let s = segment.trim().replace(/^\.\//, '')
    for (let prev = ''; prev !== s; ) {
      prev = s
      s = s.replace(WRAP, '').replace(/^\.\//, '')
    }
    return CHECK.test(s)
  })
}

const role = (e: Entry): string | undefined => (e.type === 'message' ? e.message?.role : undefined)
const calls = (e: Entry): Entry[] =>
  role(e) === 'assistant' && Array.isArray(e.message?.content) ? e.message.content.filter((b: Entry) => b?.type === 'toolCall') : []

function isCheckCall(b: Entry): boolean {
  if (b.name === 'bash') return isCheckCommand(String(b.arguments?.command ?? ''))
  if (b.name !== 'subagent') return false
  const a = b.arguments ?? {}
  const many = [...(Array.isArray(a.tasks) ? a.tasks : []), ...(Array.isArray(a.chain) ? a.chain : [])]
  return a.agent === 'gate-runner' || many.some((t: Entry) => t?.agent === 'gate-runner')
}

export function decideCompletionGate(entries: Entry[], env: Record<string, string | undefined> = process.env): CompletionDecision {
  if (env.PI_COMPLETION_GATE === '0') return { action: 'none' }
  let start = 0
  let planMode = false
  for (let i = 0; i < entries.length; i++) {
    if (role(entries[i]) === 'user') start = i + 1
    if (entries[i].type === 'custom' && entries[i].customType === 'plan-mode') planMode = entries[i].data?.enabled === true
  }
  if (planMode) return { action: 'none' }

  let lastEdit = -1
  let lastPass = -1
  const edited = new Set<string>()
  const pending = new Map<string, number>()
  for (let i = start; i < entries.length; i++) {
    const e = entries[i]
    if (e.type === 'custom' && e.customType === 'completion-gate') return { action: 'none' } // já bloqueou neste turno
    for (const b of calls(e)) {
      const file = String(b.arguments?.path ?? b.arguments?.file_path ?? '')
      if ((b.name === 'edit' || b.name === 'write') && CODE.test(file)) {
        lastEdit = i
        edited.add(file)
      } else if (isCheckCall(b)) pending.set(String(b.id), i)
    }
    if (role(e) === 'toolResult' && pending.has(String(e.message?.toolCallId)) && e.message?.isError !== true) {
      lastPass = Math.max(lastPass, pending.get(String(e.message.toolCallId)) ?? -1)
    }
  }
  if (lastEdit < 0 || lastPass > lastEdit) return { action: 'none' }

  const files = [...edited].slice(-5)
  const message =
    `Completion gate: code was edited this turn (${files.join(', ')}) and no check passed after the last edit. ` +
    'If this ends the task, run the relevant checks now (tests, type check, lint, build, or the gate-runner) and ' +
    'report their result. If the work is not finished or verification is deferred on purpose (verify-once before ' +
    'the commit), say so in one line and stop. This gate blocks once per turn.'
  return { action: 'block', files, message }
}

export default function (pi: ExtensionAPI) {
  if (process.env.PI_CODE_SUBAGENT === '1') return // workers: o orquestrador verifica
  pi.on('agent_before_settle', async (event: any, ctx: any) => {
    try {
      const decision = decideCompletionGate(ctx.sessionManager.getBranch() as Entry[])
      if (decision.action !== 'block') return
      return {
        entries: [
          ...event.entries,
          { type: 'custom', customType: 'completion-gate', data: { files: decision.files } },
          { type: 'custom_message', customType: 'completion-gate', content: decision.message, display: true },
        ],
        continue: true,
      }
    } catch {
      return // falha aberta: nunca prende a sessão
    }
  })
}

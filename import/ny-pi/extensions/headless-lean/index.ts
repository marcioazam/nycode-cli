/**
 * Menos custo e menos becos sem saída quando não há ninguém na frente do terminal (`pi -p`, modo JSON).
 *
 * 1. `<cwd>` sai do bloco de sistema em cache e vira um bloco final sem marcador: o prefixo fica byte-idêntico entre
 *    diretórios e é lido do cache (0,1×) em vez de regravado (1,25×). Vale para toda sessão no Anthropic; não cria
 *    ponto de cache. Payload fora do formato esperado fica como está (PI_HEADLESS_LEAN_DEBUG=1 diz o motivo no stderr).
 * 2. Sem UI, `question` e `plan_mode_complete` ficam inativas: nenhuma das duas tem quem responda, e o modelo parava
 *    esperando aprovação ou relatava "não consegui perguntar". `--plan` ou um prompt `/plan` mantêm a segunda.
 * 3. Rede para todos os modos: o "Not in plan mode; tool ignored." e o "UI not available" chegam ao modelo como uma
 *    instrução do que fazer agora (executar no mesmo turno; perguntar na resposta final).
 * 4. Sem UI não há título de sessão a mostrar: a chamada extra ao modelo é desligada
 *    (CLAUDE_CODE_DISABLE_TERMINAL_TITLE, lida pelo session-title do pi-code; um valor já definido vence).
 * 5. Sem UI, o prompt de sistema ganha o bloco `<headless>`: ninguém responde e a sessão acaba neste turno, então um
 *    pedido de plano é plano mais execução, sem "posso implementar?". Contradição real continua virando pergunta.
 * 6. Piso de prefixo, só na sessão headless de topo (sem UI e PI_CODE_SUBAGENT_DEPTH ausente ou 0; subagentes do pi-code
 *    precisam do contrato completo e das skills): o contrato de `$CLAUDE_CONFIG_DIR/CLAUDE.md` vira o texto de
 *    `$CLAUDE_CONFIG_DIR/CLAUDE.headless.md` e a seção `<skills>` sai do prompt. Arquivo ausente ou formato inesperado
 *    deixa o payload como está. PI_HEADLESS_FLOOR=0 desliga só este item.
 *
 * 7. Na sessão headless de topo (mesmo critério do item 6), `memory` e `lsp_*` ficam inativas: 0 de 2.091 chamadas em
 *    263 sessões guardadas do ny-pi (Terminal-Bench e gates, 2026-11-16) e os esquemas pesam no prefixo fixo.
 *    `subagent` fica ativa (usuários de `pi -p` podem orquestrar; decisão 2026-11-18). PI_HEADLESS_TOOLS=all mantém
 *    as duas; subagentes do pi-code (depth 1 ou mais) também rodam sem UI e ficam fora do corte.
 *
 * Medição e contrato: docs/specs/0002-headless-lean.md. PI_HEADLESS_LEAN=0 desliga. Reverter: apagar este diretório.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

type Block = { type?: string; text?: string; cache_control?: unknown }
type Debug = (message: string) => void

const CWD = /<cwd>\n[^\n]*\n<\/cwd>\n\n?/
// pi monta cada contrato como <project_instructions path="..."> ...conteúdo... </project_instructions> e a lista de
// skills como seção <skills> (introdução + <available_skills>); ver system-prompt.js e skills.js do pi.
const CONTRACT =
  /(<project_instructions path="[^"]*">\n)# Working contract \(pi\)\n[\s\S]*?(\n<\/project_instructions>)/
const SKILLS =
  /<skills>\n\s*The following skills provide[\s\S]*?<available_skills>[\s\S]*?<\/available_skills>\n<\/skills>\n*/

export const NO_PLAN_MODE =
  'Not in plan mode: nothing was submitted and there is no approval to wait for. Execute the plan now, in this same turn, and do not call plan_mode_complete again.'
export const NO_UI_QUESTION =
  'No UI in this run: nobody can answer this tool. Write your questions, each ending in "?", in the final reply and end the turn without changing any file.'

const stderrDebug: Debug = (message) => {
  if (process.env.PI_HEADLESS_LEAN_DEBUG === '1') console.error(`headless-lean: ${message}`)
}
/** Bloco só em modo não interativo; fontes e medição em docs/specs/0002-headless-lean.md. */
export const HEADLESS_PROMPT = `<headless>
Nobody can reply in this run. First decide whether the request is clear. If it contradicts itself or the code, or leaves open a choice that changes the result (which behavior to keep, which data to delete, which format), change no file and end with your questions. Otherwise never ask for permission or confirmation to start: a request for a plan is fulfilled by stating the plan and implementing it in this same turn.
Before the final reply, check the result against the request line by line: run one assertion for each rule and example it states, and for each list of accepted forms one input just outside the list, which must be rejected.
</headless>`

/** Tira `<cwd>` do bloco de sistema em cache e o põe num bloco final sem marcador; devolve o payload só se mudou. */
export function splitCwd(payload: unknown, debug: Debug = stderrDebug): unknown {
  if (!payload || typeof payload !== 'object' || !('system' in payload)) return undefined // continuação de thread
  const system = (payload as { system: unknown }).system
  if (!Array.isArray(system)) {
    debug('system is not a block list; payload left unchanged')
    return undefined
  }
  for (const b of system as Array<Block | null>) {
    if (!b || typeof b !== 'object' || typeof b.text !== 'string' || !b.cache_control) continue
    const m = CWD.exec(b.text)
    if (!m) continue
    b.text = b.text.replace(CWD, '')
    system.push({ type: 'text', text: m[0].trimEnd() })
    return payload
  }
  debug('no cached system block holds a <cwd> section; payload left unchanged')
  return undefined
}

/** Troca o contrato longo por `contract` e tira a seção de skills; sem os dois pontos de corte, nada muda. */
export function headlessFloor(payload: unknown, contract: string, debug: Debug = stderrDebug): unknown {
  if (!payload || typeof payload !== 'object' || !('system' in payload)) return undefined // continuação de thread
  const system = (payload as { system: unknown }).system
  if (!Array.isArray(system)) {
    debug('floor: system is not a block list; payload left unchanged')
    return undefined
  }
  const blocks = (system as Array<Block | null>).filter(
    (b): b is Block & { text: string } => typeof b?.text === 'string',
  )
  const withContract = blocks.find((b) => CONTRACT.test(b.text))
  const withSkills = blocks.find((b) => SKILLS.test(b.text))
  if (!withContract || !withSkills) {
    debug(`floor: ${withContract ? 'skills section' : 'contract block'} not found; payload left unchanged`)
    return undefined
  }
  // função como substituto: `$&` e afins no conteúdo não são padrões
  withContract.text = withContract.text.replace(
    CONTRACT,
    (_m, open: string, close: string) => `${open}${contract}${close}`,
  )
  withSkills.text = withSkills.text.replace(SKILLS, '')
  return payload
}

/** Texto de CLAUDE.headless.md, ou undefined (com motivo no debug) se faltar ou estiver vazio. */
function floorContract(debug: Debug): string | undefined {
  const dir = process.env.CLAUDE_CONFIG_DIR
  if (!dir) return void debug('floor: CLAUDE_CONFIG_DIR unset; payload left unchanged')
  try {
    const text = readFileSync(join(dir, 'CLAUDE.headless.md'), 'utf8').trim()
    return text || void debug('floor: CLAUDE.headless.md is empty; payload left unchanged')
  } catch {
    return void debug('floor: CLAUDE.headless.md unreadable; payload left unchanged')
  }
}

/** Ferramentas ativas sem as que dependem de alguém na frente do terminal. */
export function headlessTools(active: string[], argv: string[]): string[] {
  // ponytail: o modo plano é lido do argv (a flag `plan` é do pi-code e getFlag só enxerga as da própria extensão);
  // um `/plan` vindo por stdin não é visto. Ler o estado pelo barramento do plan-mode se isso passar a importar.
  const plan = argv.some((a) => a === '--plan' || /^\/plan(\s|$)/.test(a))
  return active.filter((t) => t !== 'question' && (plan || t !== 'plan_mode_complete'))
}

/** Ferramentas sem uso medido na sessão headless de topo (item 7); `subagent` fica de fora de propósito. */
const UNUSED_HEADLESS = /^(memory|lsp_[a-z]+)$/

/** Sessão headless de topo: sem UI e fora de subagente do pi-code (itens 6 e 7). */
export function isTopLevelHeadless(hasUI: boolean, depth: string | undefined): boolean {
  return !hasUI && (depth === undefined || depth === '0')
}

export function dropUnused(active: string[]): string[] {
  return active.filter((t) => !UNUSED_HEADLESS.test(t))
}

/** Texto que substitui o resultado sem saída de `plan_mode_complete` ou `question`; undefined mantém o original. */
export function rewriteResult(toolName: string, content: unknown): string | undefined {
  if (!Array.isArray(content)) return undefined
  const text = content.map((c: Block | null) => (typeof c?.text === 'string' ? c.text : '')).join('\n')
  if (toolName === 'plan_mode_complete' && text.includes('Not in plan mode; tool ignored.')) return NO_PLAN_MODE
  if (toolName === 'question' && text.includes('Error: UI not available')) return NO_UI_QUESTION
  return undefined
}

export default function (pi: ExtensionAPI) {
  if (process.env.PI_HEADLESS_LEAN === '0') return
  pi.on('before_provider_request', (event, ctx) => {
    const api = ctx.model?.api
    if (api !== undefined && api !== 'anthropic-messages') return undefined
    let floored: unknown
    if (isTopLevelHeadless(ctx.hasUI, process.env.PI_CODE_SUBAGENT_DEPTH) && process.env.PI_HEADLESS_FLOOR !== '0') {
      const contract = floorContract(stderrDebug)
      if (contract) floored = headlessFloor(event.payload, contract)
    }
    return splitCwd(event.payload) ?? floored
  })
  pi.on('tool_result', (event) => {
    const text = rewriteResult(event.toolName, event.content)
    return text ? { content: [{ type: 'text' as const, text }] } : undefined
  })
  pi.on('before_agent_start', (event, ctx) =>
    ctx.hasUI || event.systemPrompt.includes('<headless>')
      ? undefined
      : { systemPrompt: `${event.systemPrompt}\n\n${HEADLESS_PROMPT}` },
  )
  pi.on('session_start', (_event, ctx) => {
    if (ctx.hasUI) return
    process.env.CLAUDE_CODE_DISABLE_TERMINAL_TITLE ??= '1'
    const active = pi.getActiveTools()
    const kept = headlessTools(active, process.argv)
    // subagente (depth >= 1) também roda sem UI e precisa de memory/lsp_*: fica fora do corte
    const keepAll =
      process.env.PI_HEADLESS_TOOLS === 'all' || !isTopLevelHeadless(false, process.env.PI_CODE_SUBAGENT_DEPTH)
    const next = keepAll ? kept : dropUnused(kept)
    if (next.length !== active.length) pi.setActiveTools(next)
  })
}

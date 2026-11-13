/**
 * Avisa erro de sintaxe logo após `edit`/`write`, com tree-sitter (@vscode/tree-sitter-wasm 0.3.1, MIT).
 *
 * O pi-lsp falha quando o servidor não acha o projeto (ex.: TypeScript fora de repositório) ou demora; o parse
 * local custa milissegundos e vê o erro na mesma volta. Só reporta quando o arquivo novo tem erro e o anterior não
 * tinha (ou não existia). Linguagem sem gramática, falha de carga/parse ou arquivo > 2 MB: silêncio.
 * O wasm (~22 MB) é carregado sob demanda: o runtime uma vez, cada gramática na primeira vez que aparece.
 * Spec: ~/.pi/agent/claude-home/docs/context-economy-extensions-2026-11-12.md.
 *
 * Reverter: apagar este diretório.
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, extname, join, resolve } from 'node:path'
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

const MAX_SIZE = 2 * 1024 * 1024
const LANGS: Record<string, string> = {
  '.py': 'python', '.js': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript', '.jsx': 'javascript',
  '.ts': 'typescript', '.mts': 'typescript', '.cts': 'typescript', '.tsx': 'tsx', '.rs': 'rust', '.go': 'go',
  '.sh': 'bash', '.bash': 'bash', '.java': 'java', '.cs': 'c-sharp', '.rb': 'ruby', '.php': 'php', '.css': 'css',
  '.cpp': 'cpp', '.cc': 'cpp', '.cxx': 'cpp', '.hpp': 'cpp', '.hh': 'cpp',
}

type Pt = { row: number; column: number }
type TsNode = { isError: boolean; isMissing: boolean; hasError: boolean; type: string; text: string; startPosition: Pt; children: Array<TsNode | null> }
type TsParser = { setLanguage(l: unknown): void; parse(s: string): { rootNode: TsNode } | null }
type Ts = { Parser: { init(): Promise<void>; new (): TsParser }; Language: { load(p: string): Promise<unknown> } }

let tsPromise: Promise<{ ts: Ts; dir: string }> | undefined
const langs = new Map<string, Promise<unknown>>()

function loadTs() {
  tsPromise ??= (async () => {
    const req = createRequire(import.meta.url)
    const ts = req('@vscode/tree-sitter-wasm') as Ts
    await ts.Parser.init()
    return { ts, dir: join(dirname(req.resolve('@vscode/tree-sitter-wasm/package.json')), 'wasm') }
  })()
  return tsPromise
}

export const langOf = (path: string): string | undefined => LANGS[extname(path).toLowerCase()]

export type SyntaxError = { line: number; column: number; text: string }

/** Primeiro nó de erro/ausente (profundidade), 1-based; null se o código parseia limpo. Lança se a gramática não carrega. */
export async function firstError(source: string, lang: string): Promise<SyntaxError | null> {
  const { ts, dir } = await loadTs()
  let l = langs.get(lang)
  if (!l) langs.set(lang, (l = ts.Language.load(join(dir, `tree-sitter-${lang}.wasm`))))
  const parser = new ts.Parser()
  parser.setLanguage(await l)
  const root = parser.parse(source)?.rootNode
  if (!root?.hasError) return null
  const walk = (n: TsNode): TsNode | null => {
    if (n.isError || n.isMissing) return n
    for (const c of n.children) if (c && (c.hasError || c.isMissing)) return walk(c)
    return null
  }
  const n = walk(root) ?? root
  const snippet = n.text.replace(/\s+/g, ' ').trim().slice(0, 40)
  return {
    line: n.startPosition.row + 1,
    column: n.startPosition.column + 1,
    text: n.isMissing ? `missing ${n.type}` : `unexpected ${snippet || 'token'}`,
  }
}

const readSmall = (p: string): string | null => {
  try {
    const st = statSync(p)
    return st.isFile() && st.size <= MAX_SIZE ? readFileSync(p, 'utf8') : null
  } catch {
    return null
  }
}

export function message(e: SyntaxError, isNew: boolean): string {
  const tail = isNew ? 'in the new file.' : 'The file parsed cleanly before this change.'
  return `Syntax check (tree-sitter): parse error at ${e.line}:${e.column} — ${e.text}. ${tail}`
}

export default function (pi: ExtensionAPI) {
  const before = new Map<string, string | null>()
  const target = (event: { toolName: string; input?: unknown }, cwd: string): string | undefined => {
    if (event.toolName !== 'edit' && event.toolName !== 'write') return undefined
    const p = (event.input as { path?: unknown } | undefined)?.path
    return typeof p === 'string' && langOf(p) ? resolve(cwd, p) : undefined
  }

  pi.on('tool_call', (event, ctx) => {
    const path = target(event, ctx.cwd)
    if (path) before.set(event.toolCallId, existsSync(path) ? readSmall(path) : null)
    return undefined
  })

  pi.on('tool_result', async (event, ctx) => {
    const old = before.get(event.toolCallId)
    before.delete(event.toolCallId)
    if (old === undefined || event.isError) return undefined
    try {
      const path = target(event as { toolName: string; input?: unknown }, ctx.cwd)
      const source = path && readSmall(path)
      if (!path || source === null || source === undefined) return undefined
      const lang = langOf(path)!
      const err = await firstError(source, lang)
      if (!err) return undefined
      if (old !== null && (await firstError(old, lang))) return undefined
      return { content: [...event.content, { type: 'text' as const, text: message(err, old === null) }] }
    } catch {
      return undefined
    }
  })
}

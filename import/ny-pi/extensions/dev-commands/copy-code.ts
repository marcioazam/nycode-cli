/** /copy-code [N]: copia um bloco de código da última resposta do assistente. */

import type { ExtensionCommandContext } from '@earendil-works/pi-coding-agent'
import { copyToClipboard } from '@earendil-works/pi-coding-agent'

export interface CodeBlock {
  lang: string
  code: string
}

/** Blocos cercados (``` ou ~~~, >=3); o fecho repete o caractere e tem ao menos o mesmo tamanho; sem fecho vai até o fim. */
export function extractCodeBlocks(text: string): CodeBlock[] {
  const blocks: CodeBlock[] = []
  let open: { ch: string; len: number; lang: string; lines: string[] } | undefined
  for (const line of text.split('\n')) {
    if (!open) {
      const m = /^ {0,3}(`{3,}|~{3,})\s*([^\s`]*)/.exec(line)
      if (m) open = { ch: m[1][0], len: m[1].length, lang: m[2], lines: [] }
      continue
    }
    const c = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(line)
    if (c && c[1][0] === open.ch && c[1].length >= open.len) {
      blocks.push({ lang: open.lang, code: open.lines.join('\n') })
      open = undefined
    } else open.lines.push(line)
  }
  if (open) blocks.push({ lang: open.lang, code: open.lines.join('\n') })
  return blocks
}

const lineCount = (b: CodeBlock): string => {
  const n = b.code.split('\n').length
  return `${n} linha${n === 1 ? '' : 's'}`
}

export function describeBlock(b: CodeBlock, i: number): string {
  const first = b.code.split('\n')[0].slice(0, 40)
  return `${i + 1} · ${b.lang || 'texto'} · ${first}… (${lineCount(b)})`
}

/** Texto da última mensagem do assistente no ramo atual, ou undefined. */
export function lastAssistantText(branch: any[]): string | undefined {
  for (let i = branch.length - 1; i >= 0; i--) {
    const e = branch[i]
    if (e?.type !== 'message' || e.message?.role !== 'assistant') continue
    const c = e.message.content
    if (typeof c === 'string') return c
    return Array.isArray(c) ? c.filter((p: any) => p?.type === 'text').map((p: any) => p.text ?? '').join('\n') : ''
  }
  return undefined
}

export async function copyCode(args: string, ctx: ExtensionCommandContext, copy: (t: string) => Promise<void> = copyToClipboard): Promise<void> {
  const text = lastAssistantText(ctx.sessionManager.getBranch())
  if (text === undefined) return ctx.ui.notify('Nenhuma resposta do assistente nesta conversa.', 'info')
  const blocks = extractCodeBlocks(text)
  if (!blocks.length) return ctx.ui.notify('A última resposta não tem blocos de código.', 'info')
  const labels = blocks.map(describeBlock)
  let n: number
  const arg = args.trim()
  if (arg) {
    n = Number(arg)
    if (!Number.isInteger(n) || n < 1 || n > blocks.length) return ctx.ui.notify(`Bloco inválido "${arg}". Use um número de 1 a ${blocks.length}.`, 'warning')
  } else if (blocks.length === 1) n = 1
  else if (!ctx.hasUI) return ctx.ui.notify(`Vários blocos; use /copy-code N:\n${labels.join('\n')}`, 'info')
  else {
    const pick = await ctx.ui.select('Copiar qual bloco?', labels)
    if (pick === undefined) return
    n = labels.indexOf(pick) + 1
  }
  const block = blocks[n - 1]
  try {
    await copy(block.code)
  } catch (e) {
    return ctx.ui.notify(`Falha ao copiar: ${e instanceof Error ? e.message : String(e)}`, 'error')
  }
  ctx.ui.notify(`Bloco ${n} copiado (${lineCount(block)})`, 'info')
}

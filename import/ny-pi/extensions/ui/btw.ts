/**
 * /btw <pergunta>: pergunta lateral como no Claude Code. Responde com o modelo atual, usando a conversa do ramo
 * atual como contexto, sem ferramentas, num overlay e sem gravar nada na sessão.
 * Comandos de extensão rodam na hora, mesmo durante o streaming (agent-session.js prompt()).
 */

import type { ExtensionAPI, ExtensionCommandContext } from '@earendil-works/pi-coding-agent'
import { BorderedLoader, DynamicBorder, getMarkdownTheme } from '@earendil-works/pi-coding-agent'
import { Container, Markdown, matchesKey, Text } from '@earendil-works/pi-tui'

// ponytail: teto de ~200k caracteres (≈50k tokens) de contexto; mantém só o fim da conversa. Sem contagem real de tokens.
export const MAX_CONTEXT_CHARS = 200_000
const MAX_TOOL_RESULT_CHARS = 500

const SYSTEM = 'Você responde uma pergunta lateral sobre a conversa abaixo. Responda de forma breve e direta. Você não pode usar ferramentas nem alterar nada.'

interface Msg {
  role?: string
  content?: unknown
}

const textOf = (content: unknown): string => {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((c: { type?: string; text?: string; name?: string }) => (c?.type === 'text' ? (c.text ?? '') : c?.type === 'toolCall' ? `[ferramenta ${c.name}]` : ''))
    .filter(Boolean)
    .join('\n')
}

/** Transcrição em texto das mensagens (usuário, assistente, resultados de ferramenta truncados). */
export function transcript(messages: Msg[]): string[] {
  const parts: string[] = []
  for (const m of messages) {
    const text = textOf(m.content).trim()
    if (!text) continue
    if (m.role === 'user') parts.push(`Usuário: ${text}`)
    else if (m.role === 'assistant') parts.push(`Assistente: ${text}`)
    else if (m.role === 'toolResult') parts.push(`Resultado de ferramenta: ${text.slice(0, MAX_TOOL_RESULT_CHARS)}`)
  }
  return parts
}

/** Mantém as partes mais recentes que cabem no orçamento. */
export function trimContext(parts: string[], budget = MAX_CONTEXT_CHARS): string[] {
  let used = 0
  let start = parts.length
  while (start > 0 && used + parts[start - 1].length <= budget) used += parts[--start].length
  return parts.slice(start)
}

export function buildPrompt(parts: string[], question: string): string {
  return `<conversa>\n${trimContext(parts).join('\n\n')}\n</conversa>\n\nPergunta lateral (responda brevemente, sem ferramentas): ${question}`
}

export default function (pi: ExtensionAPI): void {
  pi.registerCommand('btw', {
    description: 'Pergunta lateral sobre a conversa, sem gravar na sessão e sem ferramentas <pergunta>',
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      const question = args.trim()
      if (!question) return ctx.ui.notify('Uso: /btw <pergunta>', 'warning')
      const model = ctx.model
      if (!model) return ctx.ui.notify('Nenhum modelo selecionado', 'warning')
      if (!ctx.modelRegistry.hasConfiguredAuth(model)) return ctx.ui.notify(`Sem autenticação para ${model.provider}/${model.id}`, 'warning')
      try {
        // ctx.sessionManager é tipado como ReadonlySessionManager, que não declara buildSessionContext();
        // em runtime é a própria SessionManager (session-manager.d.ts:329).
        const sm = ctx.sessionManager as unknown as { buildSessionContext(): { messages: Msg[] } }
        const parts = transcript(sm.buildSessionContext().messages)
        const answer = await ctx.ui.custom<string | undefined>((tui, theme, _kb, done) => {
          const loader = new BorderedLoader(tui, theme, `/btw com ${model.id}… (Esc cancela)`)
          loader.onAbort = () => done(undefined)
          ctx.modelRegistry
            .complete(model, { systemPrompt: SYSTEM, messages: [{ role: 'user', content: [{ type: 'text', text: buildPrompt(parts, question) }], timestamp: Date.now() }] }, { signal: loader.signal, cacheRetention: 'none' })
            .then((r) => {
              if (loader.signal.aborted) return
              if (r.stopReason === 'error') throw new Error(r.errorMessage ?? 'erro do modelo')
              done(r.content.map((c) => (c.type === 'text' ? c.text : '')).join('\n').trim() || '(sem resposta)')
            })
            .catch((e) => {
              if (loader.signal.aborted) return
              ctx.ui.notify(`/btw falhou: ${e instanceof Error ? e.message : String(e)}`, 'error')
              done(undefined)
            })
          return loader
        })
        if (answer === undefined) return
        await ctx.ui.custom<void>(
          (_tui, theme, _kb, done) => {
            const border = new DynamicBorder((s: string) => theme.fg('accent', s))
            const box = new Container()
            box.addChild(border)
            box.addChild(new Text(theme.fg('accent', theme.bold(`/btw ${question}`)), 1, 0))
            box.addChild(new Markdown(answer, 1, 1, getMarkdownTheme()))
            box.addChild(new Text(theme.fg('dim', 'Enter ou Esc para fechar'), 1, 0))
            box.addChild(border)
            return {
              render: (w: number) => box.render(w),
              invalidate: () => box.invalidate(),
              handleInput: (d: string) => {
                if (matchesKey(d, 'enter') || matchesKey(d, 'escape')) done()
              },
            }
          },
          { overlay: true },
        )
      } catch (e) {
        ctx.ui.notify(`/btw falhou: ${e instanceof Error ? e.message : String(e)}`, 'error')
      }
    },
  })
}

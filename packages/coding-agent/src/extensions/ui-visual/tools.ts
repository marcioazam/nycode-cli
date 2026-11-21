// Desenho compacto das chamadas read/bash/edit/write/grep/find/ls: `status ícone verbo alvo  tempo` + resumo.
// Só troca renderCall/renderResult via pi.registerToolRenderer; execução, schema e prompt ficam nativos
// (nunca chamamos registerTool, então não colide com ferramentas-sombra de outras extensões).
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { truncateToWidth, visibleWidth } from '@earendil-works/pi-tui'
import { isAbsolute, relative } from 'node:path'
import { icon } from './icons.ts'
import type { IconName } from './icons.ts'

type Theme = { fg: (color: string, text: string) => string; bold: (text: string) => string }
type Component = { render: (width: number) => string[]; invalidate: () => void }
// Contexto/resultado do pi 1.5.2 (core/extensions/types.d.ts ToolRenderContext); só o que lemos.
type Ctx = {
  args?: Record<string, unknown>
  cwd?: string
  argsComplete?: boolean
  isError?: boolean
  isPartial?: boolean
  durationMs?: number
}
type Block = { type: string; text?: string }
type Result = { content?: Block[]; details?: { truncation?: { truncated?: boolean }; diff?: string } }
type Options = { expanded?: boolean; isPartial?: boolean }
type Renderers = {
  renderCall?: (args: unknown, theme: Theme, context: Ctx) => Component
  renderResult?: (result: Result, options: Options, theme: Theme, context: Ctx) => Component
  [key: string]: unknown
}

const TOOLS = ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls'] as const
type ToolName = (typeof TOOLS)[number]
const PREVIEW_LINES = 5

// Componente de linhas fixas: toda linha é cortada na largura (nunca quebra o cabeçalho).
const lines = (rows: string[]): Component => ({
  render: (w) => rows.map((r) => truncateToWidth(r, Math.max(1, w), '…')),
  invalidate() {},
})
const empty = (): Component => lines([])

/** Duração curta: `0.4s`, `3.2s`, `12s`, `1m 05s`. Trunca (nunca arredonda para cima). */
export const formatDuration = (ms: number): string => {
  if (!Number.isFinite(ms) || ms < 0) return '0.0s'
  if (ms < 10_000) return `${(Math.floor(ms / 100) / 10).toFixed(1)}s`
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined)

const relPath = (p: string, cwd?: string): string => {
  if (cwd && isAbsolute(p)) {
    const r = relative(cwd, p)
    if (r === '') return '.'
    if (!r.startsWith('..') && !isAbsolute(r)) return r
  }
  return p
}

const argPath = (args: Record<string, unknown>) => str(args.file_path) ?? str(args.path)

/** Alvo (muted) e meta (dim) do cabeçalho; '…' quando os args ainda não estão completos ou faltam. */
const describe = (name: ToolName, ctx: Ctx, theme: Theme): { target: string; meta: string } => {
  const args = ctx.args ?? {}
  const ellipsis = { target: theme.fg('muted', '…'), meta: '' }
  if (ctx.argsComplete === false) return ellipsis
  if (name === 'bash') {
    const command = str(args.command)
    if (!command) return ellipsis
    const [first, ...rest] = command.split('\n')
    const timeout = typeof args.timeout === 'number' ? theme.fg('dim', ` (timeout ${args.timeout}s)`) : ''
    return { target: theme.fg('muted', rest.length ? `${first}…` : first), meta: timeout }
  }
  if (name === 'grep' || name === 'find') {
    const pattern = str(args.pattern)
    if (!pattern) return ellipsis
    const where = str(args.path)
    return { target: theme.fg('muted', pattern), meta: where ? theme.fg('dim', ` in ${relPath(where, ctx.cwd)}`) : '' }
  }
  const raw = argPath(args) ?? (name === 'ls' ? '.' : undefined)
  if (!raw) return ellipsis
  let meta = ''
  if (name === 'read') {
    const { offset, limit } = args
    if (typeof limit === 'number') meta = ` :${typeof offset === 'number' ? offset : 1}-${(typeof offset === 'number' ? offset : 1) + limit}`
    else if (typeof offset === 'number') meta = ` :${offset}`
  }
  return { target: theme.fg('muted', relPath(raw, ctx.cwd)), meta: meta ? theme.fg('dim', meta) : '' }
}

const statusGlyph = (ctx: Ctx, theme: Theme): string =>
  ctx.isError ? theme.fg('error', icon('err')) : ctx.isPartial === false ? theme.fg('success', icon('ok')) : theme.fg('dim', icon('pending'))

const callComponent = (name: ToolName, theme: Theme, ctx: Ctx): Component => {
  const { target, meta } = describe(name, ctx, theme)
  const head = `${statusGlyph(ctx, theme)} ${icon(name as IconName)} ${theme.fg('toolTitle', theme.bold(name))} ${target}${meta}`
  const dur = ctx.durationMs !== undefined ? theme.fg('dim', ` ${formatDuration(ctx.durationMs)}`) : ''
  return {
    // A duração fica sempre visível: corta só a parte da esquerda.
    render: (w) => [truncateToWidth(head, Math.max(1, w - visibleWidth(dur)), '…') + dur],
    invalidate() {},
  }
}

const textOf = (result: Result): string =>
  (result.content ?? [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('\n')
const nonEmpty = (text: string): string[] => text.split('\n').map((l) => l.replace(/\s+$/, '')).filter((l) => l.trim() !== '')
const STATUS_LINE = /^Command (exited with code \d+|timed out|aborted)/i
// Marcador nativo de saída vazia do bash: não é saída, não entra no preview.
const NO_OUTPUT = /^\s*\(no output\)\s*$/

const errorComponent = (name: ToolName, result: Result, theme: Theme): Component => {
  const all = nonEmpty(textOf(result)).filter((l) => !NO_OUTPUT.test(l))
  if (all.length === 0) return lines([theme.fg('error', '  erro')])
  if (name !== 'bash') return lines([theme.fg('error', `  ${all[0]}`)])
  // bash: o status final ("Command exited with code N") é a manchete; a saída anterior vem em dim.
  const status = all.findLast((l) => STATUS_LINE.test(l))
  const output = all.filter((l) => l !== status)
  const head = status ?? output.shift() ?? 'erro'
  return lines([theme.fg('error', `  ${head}`), ...output.slice(-PREVIEW_LINES).map((l) => theme.fg('dim', `  ${l}`))])
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

const summaryOf = (name: ToolName, result: Result, ctx: Ctx, theme: Theme): Component => {
  const text = textOf(result)
  if (name === 'bash') {
    const out = nonEmpty(text).filter((l) => !STATUS_LINE.test(l) && !NO_OUTPUT.test(l))
    return lines(out.slice(-PREVIEW_LINES).map((l) => theme.fg('toolOutput', `  ${l}`)))
  }
  let summary: string
  if (name === 'read') {
    summary = (result.content ?? []).some((b) => b.type === 'image') ? 'imagem' : count(text === '' ? 0 : text.replace(/\n+$/, '').split('\n').length, 'linha', 'linhas')
  } else if (name === 'write') {
    const content = typeof ctx.args?.content === 'string' ? ctx.args.content : ''
    summary = count(content === '' ? 0 : content.replace(/\n+$/, '').split('\n').length, 'linha', 'linhas')
  } else if (name === 'edit') {
    const diff = (result.details?.diff ?? '').split('\n')
    summary = `+${diff.filter((l) => l.startsWith('+')).length} −${diff.filter((l) => l.startsWith('-')).length}`
  } else {
    // grep/find/ls: ignora avisos entre colchetes e as mensagens de vazio nativas.
    const n = nonEmpty(text).filter((l) => !/^\[.*\]$/.test(l) && !/^(no .*(found|match)|\(empty directory\))/i.test(l.trim())).length
    summary = n === 0 ? 'nenhum resultado' : count(n, 'resultado', 'resultados')
  }
  const warn = result.details?.truncation?.truncated ? theme.fg('warning', ' · truncado') : ''
  return lines([theme.fg('dim', `  ${summary}`) + warn])
}

const wrap = (name: ToolName, base: Renderers): Renderers => ({
  ...base,
  renderCall(args, theme, context) {
    try {
      return callComponent(name, theme, context)
    } catch {
      return base.renderCall ? base.renderCall(args, theme, context) : empty()
    }
  },
  renderResult(result, options, theme, context) {
    const native = () => (base.renderResult ? base.renderResult(result, options, theme, context) : empty())
    try {
      if (options.expanded) return native()
      if (options.isPartial) return name === 'bash' ? native() : empty()
      if (context.isError) return errorComponent(name, result, theme)
      if (name === 'edit' && base.renderResult) return native()
      return summaryOf(name, result, context, theme)
    } catch {
      return native()
    }
  },
})

export default function (pi: ExtensionAPI): void {
  if (process.env.PI_CODE_SUBAGENT === '1') return
  pi.registerToolRenderer((toolName: string, next: () => Renderers | undefined) => {
    if (!(TOOLS as readonly string[]).includes(toolName)) return next()
    const base = next()
    return base ? wrap(toolName as ToolName, base) : undefined
  })
}

/**
 * /diff: revisão das mudanças da sessão (working tree vs HEAD, mais não rastreados), como o /diff do Claude Code.
 * Lista de arquivos (+N/−M) e visão rolável do diff unificado.
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ExtensionAPI, ExtensionCommandContext, Theme } from '@earendil-works/pi-coding-agent'
import { matchesKey, truncateToWidth } from '@earendil-works/pi-tui'

export interface FileChange {
  path: string
  added: number
  removed: number
  binary: boolean
  untracked: boolean
}

type Exec = ExtensionAPI['exec']

const MAX_LINES = 2000

/** `git diff --numstat`: "add\tdel\tpath"; binários vêm como "-\t-\tpath". */
export function parseNumstat(out: string): FileChange[] {
  const files: FileChange[] = []
  for (const line of out.split('\n')) {
    const m = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line)
    if (m) files.push({ path: m[3], added: Number(m[1]) || 0, removed: Number(m[2]) || 0, binary: m[1] === '-', untracked: false })
  }
  return files
}

/** Arquivo novo como diff: todas as linhas viram adições, com teto de linhas e aviso. */
export function untrackedAsDiff(path: string, content: string): string {
  const lines = content.split('\n')
  if (lines.at(-1) === '') lines.pop()
  const head = [`diff --git a/${path} b/${path}`, 'new file', '--- /dev/null', `+++ b/${path}`, `@@ -0,0 +1,${lines.length} @@`]
  const body = lines.slice(0, MAX_LINES).map((l) => `+${l}`)
  if (lines.length > MAX_LINES) body.push(`… truncado: ${lines.length - MAX_LINES} linhas a mais`)
  return [...head, ...body].join('\n')
}

export function clampScroll(scroll: number, total: number, rows: number): number {
  return Math.max(0, Math.min(scroll, total - rows))
}

const isBinary = (text: string): boolean => text.slice(0, 8000).includes('\0')

/** Lista as mudanças; `undefined` fora de um repositório git. */
export async function collectChanges(exec: Exec, cwd: string): Promise<{ files: FileChange[]; hasHead: boolean } | undefined> {
  const git = (...args: string[]) => exec('git', ['-c', 'core.quotepath=off', ...args], { cwd })
  if ((await git('rev-parse', '--is-inside-work-tree')).stdout.trim() !== 'true') return undefined
  const hasHead = (await git('rev-parse', '--verify', '-q', 'HEAD')).code === 0
  const files = parseNumstat((await git('diff', hasHead ? 'HEAD' : '--cached', '--numstat')).stdout)
  for (const path of (await git('ls-files', '--others', '--exclude-standard')).stdout.split('\n').filter(Boolean)) {
    const text = await readFile(join(cwd, path), 'utf8').catch(() => '')
    const binary = isBinary(text)
    files.push({ path, added: binary ? 0 : text.split('\n').length - (text.endsWith('\n') || !text ? 1 : 0), removed: 0, binary, untracked: true })
  }
  return { files, hasHead }
}

export async function loadDiff(exec: Exec, cwd: string, hasHead: boolean, f: FileChange): Promise<string> {
  if (f.binary) return 'Arquivo binário'
  if (f.untracked) return untrackedAsDiff(f.path, await readFile(join(cwd, f.path), 'utf8').catch(() => ''))
  const out = (await exec('git', ['diff', hasHead ? 'HEAD' : '--cached', '--', f.path], { cwd })).stdout
  const lines = out.split('\n')
  return lines.length > MAX_LINES ? [...lines.slice(0, MAX_LINES), `… truncado: ${lines.length - MAX_LINES} linhas a mais`].join('\n') : out
}

export interface LineRef {
  line: number
  removed: boolean
}

export interface DiffComment extends LineRef {
  path: string
  text: string
  source: string
}

/** Número de linha por linha do diff unificado (cabeçalhos `@@ -a,b +c,d @@`): `+`/contexto = novo, `-` = antigo (removed). Cabeçalhos: undefined. */
export function lineRefs(lines: string[]): (LineRef | undefined)[] {
  let oldN = 0
  let newN = 0
  let inHunk = false
  return lines.map((l) => {
    const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(l)
    if (m) {
      ;[oldN, newN, inHunk] = [Number(m[1]), Number(m[2]), true]
      return undefined
    }
    if (!inHunk || !l || l.startsWith('\\') || l.startsWith('…')) return undefined
    if (l.startsWith('-')) return { line: oldN++, removed: true }
    if (l.startsWith('diff ')) return void (inHunk = false)
    if (l.startsWith(' ')) oldN++ // contexto avança os dois lados
    return { line: newN++, removed: false } // '+' e contexto
  })
}

/** Texto para o editor: uma entrada por comentário, com a linha-fonte como citação curta. */
export function formatComments(comments: DiffComment[]): string {
  const items = comments.map((c) => `- \`${c.path}:${c.line}${c.removed ? ' (removida)' : ''}\` — ${c.text}\n  > ${c.source.trim().slice(0, 80)}`)
  return ['Comentários da revisão (/diff):', ...items].join('\n')
}

export class DiffView {
  private cur = 0 // linha-cursor no diff aberto
  private input: string | undefined // texto do comentário em edição; undefined = fora do modo
  private comments = new Map<string, DiffComment>()
  private refs: (LineRef | undefined)[] = []
  private sel = 0
  private scroll = 0
  private lines: string[] | undefined // diff aberto; undefined = lista
  private files: FileChange[]
  private load: (f: FileChange) => Promise<string>
  private theme: Theme
  private rows: () => number
  private requestRender: () => void
  private done: (comments: DiffComment[]) => void
  constructor(files: FileChange[], load: (f: FileChange) => Promise<string>, theme: Theme, rows: () => number, requestRender: () => void, done: (comments: DiffComment[]) => void) {
    Object.assign(this, { files, load, theme, rows, requestRender, done })
  }

  private body(): number {
    return Math.max(3, this.rows() - 3)
  }

  render(width: number): string[] {
    const t = this.theme
    const h = this.body()
    const out: string[] = []
    if (!this.lines) {
      out.push(t.fg('accent', t.bold(`Mudanças: ${this.files.length} arquivo${this.files.length > 1 ? 's' : ''}`)))
      const start = Math.max(0, Math.min(this.sel - Math.floor(h / 2), this.files.length - h))
      this.files.slice(start, start + h).forEach((f, i) => {
        const stat = f.binary ? t.fg('dim', 'binário') : `${t.fg('toolDiffAdded', `+${f.added}`)} ${t.fg('toolDiffRemoved', `−${f.removed}`)}`
        const row = `${start + i === this.sel ? '› ' : '  '}${f.path}${f.untracked ? t.fg('dim', ' (novo)') : ''}  ${stat}`
        out.push(start + i === this.sel ? t.bold(row) : row)
      })
      out.push(t.fg('dim', '↑↓ navegar · Enter abrir · Esc fechar'))
    } else {
      const f = this.files[this.sel]
      this.scroll = clampScroll(this.scroll, this.lines.length, h)
      out.push(t.fg('accent', t.bold(f.path)))
      this.lines.slice(this.scroll, this.scroll + h).forEach((l, i) => {
        const n = this.scroll + i
        const ref = this.refs[n]
        const mark = ref && this.comments.has(this.key(f.path, ref)) ? t.fg('warning', '●') : ' '
        const row = `${mark} ${this.color(l.replaceAll('\t', '   '))}`
        out.push(n === this.cur ? t.bg('selectedBg', row) : row)
      })
      const ref = this.refs[this.cur]
      out.push(
        this.input !== undefined
          ? t.fg('accent', `comentar ${f.path}:${ref?.line} › `) + `${this.input}▏ ` + t.fg('dim', '(Enter salva · Esc cancela)')
          : t.fg('dim', `↑↓ linha · c comentar · PgUp/PgDn · Esc voltar · ${this.cur + 1}/${this.lines.length}`),
      )
    }
    return out.map((l) => truncateToWidth(l, width, '…'))
  }

  private color(l: string): string {
    const t = this.theme
    if (l.startsWith('+++') || l.startsWith('---') || l.startsWith('diff ') || l.startsWith('index ')) return t.fg('dim', l)
    if (l.startsWith('@@')) return t.fg('accent', l)
    if (l.startsWith('+')) return t.fg('toolDiffAdded', l)
    if (l.startsWith('-')) return t.fg('toolDiffRemoved', l)
    return t.fg('toolDiffContext', l)
  }

  private key(path: string, r: LineRef): string {
    return `${path}:${r.line}:${r.removed}`
  }

  /** Entrada do comentário: Enter salva (vazio apaga), Esc cancela, imprimíveis acrescentam. */
  private editComment(data: string): void {
    const f = this.files[this.sel]
    const ref = this.refs[this.cur]
    if (matchesKey(data, 'escape')) this.input = undefined
    else if (matchesKey(data, 'enter')) {
      const text = (this.input ?? '').trim()
      if (ref) {
        const k = this.key(f.path, ref)
        if (text) this.comments.set(k, { path: f.path, ...ref, text, source: (this.lines?.[this.cur] ?? '').slice(1) })
        else this.comments.delete(k)
      }
      this.input = undefined
    } else if (matchesKey(data, 'backspace')) this.input = (this.input ?? '').slice(0, -1)
    else {
      const d = data.replaceAll('\x1b[200~', '').replaceAll('\x1b[201~', '')
      if (!/[\x00-\x1f\x7f]/.test(d)) this.input = (this.input ?? '') + d
    }
  }

  private moveCursor(delta: number, h: number): void {
    this.cur = Math.max(0, Math.min(this.cur + delta, (this.lines?.length ?? 1) - 1))
    if (this.cur < this.scroll) this.scroll = this.cur
    else if (this.cur >= this.scroll + h) this.scroll = this.cur - h + 1
  }

  handleInput(data: string): void {
    if (this.lines && this.input !== undefined) this.editComment(data)
    else if (matchesKey(data, 'escape')) {
      if (!this.lines) return this.done([...this.comments.values()])
      this.lines = undefined
    } else if (!this.lines) {
      if (matchesKey(data, 'up')) this.sel = Math.max(0, this.sel - 1)
      else if (matchesKey(data, 'down')) this.sel = Math.min(this.files.length - 1, this.sel + 1)
      else if (matchesKey(data, 'enter')) {
        const f = this.files[this.sel]
        this.lines = ['Carregando…']
        this.scroll = this.cur = 0
        this.refs = []
        const show = (lines: string[]) => {
          this.lines = lines
          this.refs = lineRefs(lines)
        }
        this.load(f).then(
          (d) => show(d.split('\n')),
          (e) => show([`Erro: ${e instanceof Error ? e.message : String(e)}`]),
        ).finally(() => this.requestRender())
      }
    } else if (matchesKey(data, 'up')) this.moveCursor(-1, this.body())
    else if (matchesKey(data, 'down')) this.moveCursor(1, this.body())
    else if (matchesKey(data, 'pageUp')) this.moveCursor(-this.body(), this.body())
    else if (matchesKey(data, 'pageDown')) this.moveCursor(this.body(), this.body())
    else if (data === 'c' && this.refs[this.cur]) {
      const f = this.files[this.sel]
      this.input = this.comments.get(this.key(f.path, this.refs[this.cur]!))?.text ?? ''
    }
    this.scroll = Math.max(0, this.scroll)
    this.requestRender()
  }

  invalidate(): void {}
}

export default function (pi: ExtensionAPI): void {
  pi.registerCommand('diff', {
    description: 'Revisa as mudanças do repositório (vs HEAD) por arquivo',
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      try {
        const res = await collectChanges(pi.exec.bind(pi), ctx.cwd)
        if (!res) return ctx.ui.notify('Fora de um repositório git', 'warning')
        if (!res.files.length) return ctx.ui.notify('Sem mudanças', 'info')
        if (!ctx.hasUI) {
          return ctx.ui.notify(res.files.map((f) => `${f.path} ${f.binary ? 'binário' : `+${f.added} −${f.removed}`}`).join('\n'), 'info')
        }
        const comments = await ctx.ui.custom<DiffComment[]>((tui, theme, _kb, done) =>
          new DiffView(res.files, (f) => loadDiff(pi.exec.bind(pi), ctx.cwd, res.hasHead, f), theme, () => tui.terminal.rows, () => tui.requestRender(), done),
        )
        if (comments?.length) {
          const cur = ctx.ui.getEditorText()
          ctx.ui.setEditorText(cur.trim() ? `${cur}\n\n${formatComments(comments)}` : formatComments(comments))
          ctx.ui.notify(`${comments.length} comentário${comments.length > 1 ? 's' : ''} foram para o editor; Enter envia (durante um turno, Enter direciona o agente)`, 'info')
        }
      } catch (e) {
        ctx.ui.notify(`/diff falhou: ${e instanceof Error ? e.message : String(e)}`, 'error')
      }
    },
  })
}

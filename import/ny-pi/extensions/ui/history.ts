/**
 * Ferramentas de prompt do editor: histórico pesquisável (Ctrl+R) com leitura limitada dos JSONL de sessão
 * e rascunho guardado (Ctrl+S). Funções puras + componente do overlay.
 */

import { readdir, readFile, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { matchesKey, truncateToWidth } from '@earendil-works/pi-tui'

export const MAX_FILES = 300
export const MAX_FILE_BYTES = 128 * 1024 * 1024
export const MAX_PROMPTS = 5000

export type Scope = 'sessão' | 'projeto' | 'todas'
export const SCOPES: Scope[] = ['sessão', 'projeto', 'todas']

/** Texto de uma mensagem de usuário (string ou blocos text); undefined se não for de usuário. */
export function messageText(m: any): string | undefined {
  if (m?.role !== 'user') return undefined
  if (typeof m.content === 'string') return m.content
  if (!Array.isArray(m.content)) return undefined
  return m.content.filter((c: any) => c?.type === 'text').map((c: any) => c.text).join(' ')
}

/** Prompts de usuário de um JSONL de sessão, na ordem do arquivo; linhas corrompidas são ignoradas. */
export function parseUserPrompts(jsonl: string): string[] {
  const out: string[] = []
  for (const line of jsonl.split('\n')) {
    if (!line.includes('"role":"user"')) continue
    try {
      const o = JSON.parse(line)
      const t = o?.type === 'message' ? messageText(o.message) : undefined
      if (t?.trim()) out.push(t)
    } catch {
      /* linha corrompida: pula */
    }
  }
  return out
}

/** Mais recentes primeiro (entrada em ordem cronológica), sem repetidos. */
export function dedupeNewestFirst(chronological: string[]): string[] {
  return [...new Set([...chronological].reverse())]
}

/** Todas as palavras da consulta (sem caixa) precisam aparecer no prompt. */
export function filterPrompts(prompts: string[], query: string): string[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return prompts
  return prompts.filter((p) => {
    const low = p.toLowerCase()
    return words.every((w) => low.includes(w))
  })
}

/** Uma linha para a lista: quebras de linha viram `⏎`. */
export const oneLine = (p: string): string => p.trim().replace(/\s*\r?\n\s*/g, ' ⏎ ')

/** Ctrl+S: texto → guarda e limpa; vazio com guardado → devolve; os dois → troca. */
export function stashStep(text: string, stash: string | undefined): { text: string; stash: string | undefined } {
  if (text !== '') return { text: stash ?? '', stash: text }
  if (stash !== undefined) return { text: stash, stash: undefined }
  return { text, stash }
}

interface CacheEntry { mtimeMs: number; size: number; prompts: string[] }
export type PromptCache = Map<string, CacheEntry>
export const defaultCache: PromptCache = new Map()

interface FileInfo { path: string; mtimeMs: number; size: number }

/** *.jsonl dos diretórios, mais novos primeiro, no máximo MAX_FILES; erros de leitura contam em `skipped`. */
export async function listSessionFiles(dirs: string[]): Promise<{ files: FileInfo[]; skipped: number }> {
  let skipped = 0
  const all: FileInfo[] = []
  for (const dir of dirs) {
    let names: string[]
    try {
      names = (await readdir(dir)).filter((n) => n.endsWith('.jsonl'))
    } catch {
      skipped++
      continue
    }
    for (const n of names) {
      const path = join(dir, n)
      try {
        const s = await stat(path)
        if (s.isFile()) all.push({ path, mtimeMs: s.mtimeMs, size: s.size })
      } catch {
        skipped++
      }
    }
  }
  all.sort((a, b) => b.mtimeMs - a.mtimeMs)
  return { files: all.slice(0, MAX_FILES), skipped }
}

/** Prompts (mais recentes primeiro, sem repetidos, ≤MAX_PROMPTS) dos arquivos; cache por caminho, mtime e tamanho. */
export async function loadFromDirs(dirs: string[], cache: PromptCache = defaultCache): Promise<{ prompts: string[]; skipped: number }> {
  const { files, skipped: listSkipped } = await listSessionFiles(dirs)
  let skipped = listSkipped
  const seen = new Set<string>()
  const prompts: string[] = []
  for (const f of files) {
    if (prompts.length >= MAX_PROMPTS) break
    if (f.size > MAX_FILE_BYTES) {
      skipped++
      continue
    }
    let list: string[]
    const hit = cache.get(f.path)
    if (hit && hit.mtimeMs === f.mtimeMs && hit.size === f.size) list = hit.prompts
    else {
      try {
        list = parseUserPrompts(await readFile(f.path, 'utf8'))
        cache.set(f.path, { mtimeMs: f.mtimeMs, size: f.size, prompts: list })
      } catch {
        skipped++
        continue
      }
    }
    for (let i = list.length - 1; i >= 0 && prompts.length < MAX_PROMPTS; i--) {
      if (!seen.has(list[i]!)) {
        seen.add(list[i]!)
        prompts.push(list[i]!)
      }
    }
  }
  return { prompts, skipped }
}

export interface HistorySource { branch: any[]; sessionDir: string }

/** Prompts de um escopo: sessão = ramo atual; projeto = diretório da sessão; todas = irmãos desse diretório. */
export async function loadScope(scope: Scope, src: HistorySource, cache: PromptCache = defaultCache): Promise<{ prompts: string[]; skipped: number }> {
  if (scope === 'sessão') {
    const chrono = src.branch.flatMap((e) => (e?.type === 'message' ? [messageText(e.message)] : [])).filter((t): t is string => !!t?.trim())
    return { prompts: dedupeNewestFirst(chrono).slice(0, MAX_PROMPTS), skipped: 0 }
  }
  if (scope === 'projeto') return loadFromDirs([src.sessionDir], cache)
  const parent = dirname(src.sessionDir)
  try {
    const dirs = (await readdir(parent, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => join(parent, d.name))
    return loadFromDirs(dirs, cache)
  } catch {
    return { prompts: [], skipped: 1 }
  }
}

interface ThemeLike { fg(c: string, s: string): string; bg(c: string, s: string): string }
const MAX_ROWS = 10

/** Overlay "Histórico de prompts": filtro, ↑↓, Enter escolhe, Esc fecha, Tab troca o escopo. */
export class PromptHistory {
  scope: Scope = 'sessão'
  query = ''
  index = 0
  loading = true
  items: string[] = []
  skipped = 0
  private token = 0
  private readonly theme: ThemeLike
  private readonly load: (scope: Scope) => Promise<{ prompts: string[]; skipped: number }>
  private readonly done: (v: string | undefined) => void
  private readonly redraw: () => void

  constructor(theme: ThemeLike, load: (scope: Scope) => Promise<{ prompts: string[]; skipped: number }>, done: (v: string | undefined) => void, redraw: () => void) {
    this.theme = theme
    this.load = load
    this.done = done
    this.redraw = redraw
    void this.reload()
  }

  async reload(): Promise<void> {
    const mine = ++this.token
    this.loading = true
    this.redraw()
    let r: { prompts: string[]; skipped: number }
    try {
      r = await this.load(this.scope)
    } catch {
      r = { prompts: [], skipped: 1 }
    }
    if (mine !== this.token) return // escopo mudou durante a leitura
    this.items = r.prompts
    this.skipped = r.skipped
    this.loading = false
    this.index = 0
    this.redraw()
  }

  visible(): string[] {
    return filterPrompts(this.items, this.query)
  }

  handleInput(data: string): void {
    const list = this.visible()
    if (matchesKey(data, 'escape') || matchesKey(data, 'ctrl+c')) return this.done(undefined)
    if (matchesKey(data, 'enter')) return list[this.index] === undefined ? undefined : this.done(list[this.index])
    if (matchesKey(data, 'tab')) {
      this.scope = SCOPES[(SCOPES.indexOf(this.scope) + 1) % SCOPES.length]!
      void this.reload()
      return
    }
    if (matchesKey(data, 'up')) this.index = Math.max(0, this.index - 1)
    else if (matchesKey(data, 'down')) this.index = Math.min(Math.max(0, list.length - 1), this.index + 1)
    else if (matchesKey(data, 'backspace')) {
      this.query = this.query.slice(0, -1)
      this.index = 0
    } else if (data.length > 0 && !/[\x00-\x1f\x7f]/.test(data) && !data.startsWith('\x1b')) {
      this.query += data
      this.index = 0
    } else return
    this.redraw()
  }

  render(width: number): string[] {
    const t = this.theme
    const fit = (s: string) => truncateToWidth(s, width, '…')
    const tabs = SCOPES.map((s) => (s === this.scope ? t.fg('accent', `[${s}]`) : t.fg('dim', ` ${s} `))).join(' ')
    const out = [fit(t.fg('accent', 'Histórico de prompts') + '  ' + tabs), fit(`> ${this.query}`)]
    if (this.loading) out.push(fit(t.fg('dim', 'Carregando…')))
    else {
      const list = this.visible()
      if (!list.length) out.push(fit(t.fg('dim', 'Nenhum prompt encontrado')))
      const start = Math.max(0, Math.min(this.index - Math.floor(MAX_ROWS / 2), list.length - MAX_ROWS))
      for (let i = start; i < Math.min(list.length, start + MAX_ROWS); i++) {
        const row = fit(`${i === this.index ? '→' : ' '} ${oneLine(list[i]!)}`)
        out.push(i === this.index ? t.bg('selectedBg', row) : row)
      }
      if (this.skipped) out.push(fit(t.fg('dim', `${this.skipped} arquivo(s) ignorado(s)`)))
    }
    out.push(fit(t.fg('dim', '↑↓ escolhe · Enter usa · Tab escopo · Esc fecha')))
    return out
  }

  invalidate(): void {}
}

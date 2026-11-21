import * as path from 'node:path'
import { stripBlockComments } from '../_shared/shell/strip-comments.ts'
import { type ImportBudget, type ImportedFile, isUnder } from './imports.ts'
import { budgetNotice } from './prompt-blocks.ts'
import { MANAGED_CLAUDE_MD_PATH, managedClaudeMdPath } from './sources.ts'

interface ContextFile {
  path: string
  content: string
}

/** The prompt options this extension edits. pi sets `forceSystemPrompt` from 0.86, where
 * a handler that returned a prompt forced it for the run. */
interface PromptOptions {
  contextFiles?: ContextFile[]
  appendSystemPrompt?: string
  forceSystemPrompt?: string
}

/** A file's rank among its directory's context files, in the order Claude loads them. */
const RANK = { memory: 0, sibling: 1, alternate: 2, rule: 3, local: 4 } as const

/** A context file with its place in Claude's load order: the user's own files, then each
 * directory from the filesystem root down to cwd. */
interface Placed {
  file: ContextFile
  /** How deep the file's directory sits on the way to cwd; 0 for the user's own files. */
  depth: number
  rank: number
}

export function place(file: ContextFile, directory: string, rank: number, where: { config: string; cwd: string }): Placed {
  const onTheWayToCwd = where.cwd === directory || where.cwd.startsWith(directory + path.sep)
  // The user's rules only: a checkout under the config directory is still a project.
  const own = isUnder(file.path, [path.join(where.config, 'rules')]) || !onTheWayToCwd
  return { file, depth: own ? 0 : directory.length, rank }
}

/** A file pi or another extension handed over, placed by the shape of its path. */
function placeByPath(file: ContextFile, where: { config: string; cwd: string }): Placed {
  const rules = file.path.lastIndexOf(`${path.sep}.claude${path.sep}rules${path.sep}`)
  if (rules !== -1) return place(file, file.path.slice(0, rules), RANK.rule, where)
  const directory = path.dirname(file.path)
  if (path.basename(file.path) === 'CLAUDE.local.md') return place(file, directory, RANK.local, where)
  if (path.basename(directory) === '.claude') return place(file, path.dirname(directory), RANK.alternate, where)
  return place(file, directory, RANK.memory, where)
}

function inClaudeOrder(placed: Placed[]): ContextFile[] {
  return placed
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => a.entry.depth - b.entry.depth || a.entry.rank - b.entry.rank || a.index - b.index)
    .map(({ entry }) => entry.file)
}

/** Each file followed by what it imports, an import's own imports right after it: Claude
 * loads an import "alongside the CLAUDE.md that references" it. */
function withImports(files: ContextFile[], imported: ImportedFile[]): ContextFile[] {
  const result: ContextFile[] = []
  const add = (file: ContextFile): void => {
    result.push(file)
    for (const entry of imported) {
      if (entry.parent === file.path) add({ path: entry.path, content: stripBlockComments(entry.body) })
    }
  }
  for (const file of files) add(file)
  return result
}

/** A body the prompt has room for: trimmed, and absent when nothing is left. */
function entryFor(file: ContextFile | undefined): ContextFile[] {
  const content = file?.content.trim() ?? ''
  return file === undefined || content.length === 0 ? [] : [{ path: file.path, content }]
}

/** What one turn loaded, by source. */
interface LoadedMemory {
  managedFile: string
  /** The managed-settings `claudeMd` value, as found there. */
  managedKey: unknown
  user: ContextFile | undefined
  native: ContextFile[]
  siblings: ContextFile[]
  alternate: ContextFile | undefined
  locals: ContextFile[]
  extras: ContextFile[]
  imported: ImportedFile[]
}

/** The memory as context files in Claude's order, for a runtime that builds the prompt
 * from its options. */
export function memoryEntries(memory: LoadedMemory, where: { config: string; cwd: string }): ContextFile[] {
  const managedKey = typeof memory.managedKey === 'string' ? stripBlockComments(memory.managedKey) : ''
  const ordered = inClaudeOrder([
    ...memory.native.map((file) => placeByPath(file, where)),
    ...memory.siblings.flatMap(entryFor).map((file) => place(file, path.dirname(file.path), RANK.sibling, where)),
    ...entryFor(memory.alternate).map((file) => place(file, path.dirname(path.dirname(file.path)), RANK.alternate, where)),
    ...memory.locals.flatMap(entryFor).map((file) => place(file, path.dirname(file.path), RANK.local, where)),
  ])
  const extras = memory.extras.map((extra) => ({ path: extra.path, content: extra.content }))
  return [...entryFor({ path: managedClaudeMdPath(), content: memory.managedFile }), ...entryFor({ path: MANAGED_CLAUDE_MD_PATH, content: managedKey }), ...withImports([...entryFor(memory.user), ...ordered, ...extras], memory.imported)]
}

/** What is said about the imports that did not load. Not a file, so it travels as
 * appended instructions, not as one of pi's custom prompt sections: a provider that
 * rebuilds the prompt forwards the appended instructions and drops those sections. */
export function memoryNotices(budget: ImportBudget, refusedNotice: string): string {
  return [budgetNotice(budget), refusedNotice.trim()].filter((notice) => notice.length > 0).join('\n\n')
}

/** Hand the memory over as the context files the prompt is built from, and say whether
 * that reached the prompt. pi >= 0.86 re-renders the prompt from the options, so there
 * the memory is in, in Claude's order, and a provider that rebuilds the prompt from the
 * options receives it too. A prompt an earlier handler forced stays fixed, but the options
 * are that run's own copy, so they keep the memory. An older pi reuses the options object
 * next turn, so there they are left as found. */
export function deliverThroughOptions(event: { systemPrompt: string; systemPromptOptions?: PromptOptions }, entries: ContextFile[], notices: string): boolean {
  const options = event.systemPromptOptions
  const contextFiles = options?.contextFiles
  if (options === undefined || contextFiles === undefined) return false
  const before = event.systemPrompt
  const found = [...contextFiles]
  const append = options.appendSystemPrompt
  contextFiles.splice(0, contextFiles.length, ...entries)
  if (notices.length > 0) options.appendSystemPrompt = append ? `${append}\n\n${notices}` : notices
  if (event.systemPrompt !== before) return true
  if (options.forceSystemPrompt !== undefined) return false
  contextFiles.splice(0, contextFiles.length, ...found)
  if (notices.length > 0) options.appendSystemPrompt = append
  return false
}

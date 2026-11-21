import * as path from 'node:path'
import { type InstructionLoadEvent, memoryTypeForPath } from '../_shared/events/instruction-events.ts'
import { stripBlockComments } from '../_shared/shell/strip-comments.ts'
import { isExcludedPath } from './excludes.ts'
import { collectImports, createImportBudget, isUnder, realRoots, rootsForImporter } from './imports.ts'
import { instructionsBlock, refusedImportsAddition } from './prompt-blocks.ts'
import { readContextFile } from './sources.ts'

/** Every context file that could load on demand for a touched directory, shallowest
 * first, so the deepest instructions are read last as they are at launch. */
function* nestedCandidates(touchedDir: string, realCwd: string): Generator<{ file: string; dir: string; name: string }> {
  for (const dir of nestedContextDirs(touchedDir, realCwd)) {
    for (const name of NESTED_CONTEXT_NAMES) yield { file: path.join(dir, name), dir, name }
  }
}

/** Everything the on-demand load needs from the session and the tool call, grouped so
 * the per-file worker stays a three-argument function. */
export interface NestedLoadContext {
  home: string
  cwd: string
  realCwd: string
  projectRoot: string
  excludeGlobs: string[]
  /** The file whose access triggered the load, for trigger_file_path. */
  touched: string
  /** Paths already in the system prompt, so a nested @import does not repeat one. */
  launchLoaded: string[]
}

/** One nested context file's block and the instruction loads it should announce, or
 * nothing to attach: absent, excluded, empty, or reaching outside the project. `read`
 * reports whether the file was there at all, so a file that exists is only ever
 * attached once while a missing one can still appear later in the session. */
function nestedContextBlock(file: string, dir: string, load: NestedLoadContext): { read: boolean; text?: string; events?: InstructionLoadEvent[] } {
  if (isExcludedPath(file, load.excludeGlobs, load.home)) return { read: false }
  // The file itself may be a link out of the project, whatever its directory is.
  const [real] = realRoots([file])
  if (real === undefined || !isUnder(real, [load.realCwd])) return { read: false }
  const content = readContextFile(real)
  if (content === undefined) return { read: false }
  const body = stripBlockComments(content).trim()
  if (body.length === 0) return { read: true }
  // Its own @imports resolve at project roots, on a budget of their own: this load is
  // outside the launch-time expansion the shared budget covers. The launch-time paths
  // seed the seen set, so a nested file importing the root CLAUDE.md does not pay for
  // a body already in the system prompt.
  const seen = new Set([...load.launchLoaded, real])
  const budget = createImportBudget()
  // The stripped body, as at launch: a commented-out @import never expands.
  const imports = collectImports(body, dir, load.home, rootsForImporter(real, load.home, load.cwd), seen, {
    importer: real,
    isExcluded: (absPath) => isExcludedPath(absPath, load.excludeGlobs, load.home),
    budget,
  })
  return {
    read: true,
    // The refusal notice rides along, so an import this file names and does not get is
    // as visible here as it is at launch.
    text: [instructionsBlock(file, body), ...imports.map((entry) => `### ${entry.path}\n\n${stripBlockComments(entry.body)}`)].join('\n\n') + refusedImportsAddition(budget.refused),
    events: [
      { file_path: file, memory_type: memoryTypeForPath(file, load.home, load.projectRoot), load_reason: 'nested_traversal', trigger_file_path: load.touched },
      ...imports.map((entry) => ({
        file_path: entry.path,
        memory_type: memoryTypeForPath(entry.path, load.home, load.projectRoot),
        load_reason: 'include',
        parent_file_path: file,
      })),
    ],
  }
}

/** The context files Claude loads on demand rather than at launch, in the order it
 * reads them within a directory. */
const NESTED_CONTEXT_NAMES = ['CLAUDE.md', 'CLAUDE.local.md'] as const

/** The directories between a touched file and cwd, nearest cwd first.
 *
 * Claude loads CLAUDE.md from cwd and every directory above it at launch, and the
 * ones below "are included when Claude reads files in those directories"
 * (memory.md). Only the strictly-below range belongs here; cwd's own file is
 * already in the prompt. A file outside cwd contributes nothing.
 */
function nestedContextDirs(from: string, cwd: string): string[] {
  const dirs: string[] = []
  let current = from
  while (current !== cwd && current !== path.dirname(current)) {
    dirs.unshift(current)
    current = path.dirname(current)
  }
  // The walk reached the filesystem root without meeting cwd, so the file is outside
  // it: nothing below cwd to load. A file in cwd itself ends the loop with no dirs.
  return current === cwd ? dirs : []
}

/** The blocks and instruction loads for one touched directory. `loaded` is the
 * session's set of already-attached files and is updated in place, so a file that
 * exists is attached once and a missing one can still appear later. */
export function nestedContextAttachments(touchedDir: string, load: NestedLoadContext, loaded: Set<string>, localsApproved: boolean): { bodies: string[]; events: InstructionLoadEvent[] } {
  const bodies: string[] = []
  const events: InstructionLoadEvent[] = []
  for (const { file, dir, name } of nestedCandidates(touchedDir, load.realCwd)) {
    if (loaded.has(file)) continue
    // A CLAUDE.local.md needs a decision, never the "nothing here to gate" shortcut:
    // the approval walk only looks at or above cwd, so this is the one door it cannot
    // see (see isGatedFileApproved).
    if (name === 'CLAUDE.local.md' && !localsApproved) continue
    const block = nestedContextBlock(file, dir, load)
    if (block.read) loaded.add(file)
    if (block.text === undefined) continue
    bodies.push(block.text)
    events.push(...(block.events ?? []))
  }
  return { bodies, events }
}

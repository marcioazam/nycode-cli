import * as fs from 'node:fs'
import * as path from 'node:path'
import { globToRegExpSource } from '../_shared/rules/path-rules.ts'
import { claudeSettingsChain, readSettingsChain } from '../_shared/settings/settings-chain.ts'
import { expandHome } from './imports.ts'

/** Settings files whose `claudeMdExcludes` merge, following the hooks/memory
 * chain: user settings always, the project's settings.json and
 * settings.local.json (nearest at or above cwd) only when the project is
 * approved. Managed settings are read separately by the caller. */
export function claudeMdExcludeFiles(cwd: string, home: string, approved: boolean): string[] {
  return claudeSettingsChain(cwd, home, approved)
}

/** Merged `claudeMdExcludes` globs across the settings chain plus managed
 * settings. Exclusion lists union rather than override: any scope may add
 * exclusions, none may remove another's. */
export function readClaudeMdExcludes(files: string[], managed: Record<string, unknown>): string[] {
  const globs: string[] = []
  const collect = (value: unknown) => {
    if (!Array.isArray(value)) return
    for (const entry of value) {
      if (typeof entry === 'string' && entry.trim().length > 0) globs.push(entry)
    }
  }
  for (const settings of readSettingsChain(files)) collect(settings.claudeMdExcludes)
  collect(managed.claudeMdExcludes)
  return globs
}

/** Whether an absolute context-file path matches one of the exclude globs. Globs
 * match absolute paths: `~/` expands to home, a leading `/` anchors at the
 * filesystem root, and a relative glob matches at any depth (gitignore-style).
 * Matching runs on the path without its leading slash so `**` and `**\/`, which
 * span whole segments, can reach a root-anchored path. */
export function isExcludedPath(absPath: string, globs: string[], home: string): boolean {
  if (globs.length === 0) return false
  // A symlink is excluded by a glob naming either spelling, as the rules loader does.
  let real = absPath
  try {
    real = fs.realpathSync(absPath)
  } catch {
    // not on disk: only the given spelling exists
  }
  return matchesExcludeGlob(absPath, globs, home) || (real !== absPath && matchesExcludeGlob(real, globs, home))
}

function matchesExcludeGlob(absPath: string, globs: string[], home: string): boolean {
  const target = absPath.split(path.sep).join('/').replace(/^\//, '')
  return globs.some((raw) => {
    let glob = expandHome(raw.trim(), home).split(path.sep).join('/')
    if (glob.length === 0) return false
    if (glob.startsWith('/')) glob = glob.slice(1)
    else if (!glob.startsWith('**/')) glob = `**/${glob}`
    return new RegExp(`^${globToRegExpSource(glob)}$`).test(target)
  })
}

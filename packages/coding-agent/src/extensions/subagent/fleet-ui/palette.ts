/**
 * HUD palette for the agent panel, viewer and /tasks browser: reads `colors` from the claude-hud
 * config once and maps the UI's color roles to them with truecolor ANSI. Falls back to the pi
 * theme when the file or a field is missing; NO_COLOR emits no color codes.
 * Record: docs/pi-agents-ui-teams-sota-2026-11-13.md (A4).
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import type { UiTheme } from './panel.ts'

export type Colors = Record<string, [number, number, number]>

/** UI color role (pi theme token, plus `task` and `cost`) → HUD `colors` key. */
const ROLE_TO_HUD: Record<string, string> = {
  text: 'model',
  muted: 'context',
  success: 'context',
  dim: 'label',
  borderAccent: 'label',
  accent: 'git',
  warning: 'warning',
  error: 'critical',
  task: 'project',
  cost: 'custom',
}
/** Roles the pi theme does not know: the token to use when the HUD palette is unavailable. */
const BASE_ROLE: Record<string, string> = { task: 'accent', cost: 'dim' }

/** Running mark: one green dot that swells and shrinks (one cell wide, no emoji presentation). */
export const SPINNER = ['·', '•', '●', '●', '•', '·']
export const SPINNER_MS = 200

const CONFIG = join(homedir(), '.pi', 'agent', 'claude-home', 'plugins', 'claude-hud', 'config.json')
const A11Y = join(homedir(), '.pi', 'agent', 'extensions', 'ui', 'a11y.ts')

type A11y = { noColor(): boolean; reducedMotion(): boolean }
let a11y: A11y | undefined
/** Resolves once the shared a11y helpers are loaded (or known missing); the env check covers the gap. */
export const ready: Promise<void> = import(A11Y).then(
  (m: A11y) => {
    a11y = m
  },
  () => undefined,
)

export const noColor = (): boolean => (a11y ? a11y.noColor() : (process.env.NO_COLOR ?? '') !== '')
export const motionEnabled = (): boolean => !noColor() && !(a11y ? a11y.reducedMotion() : process.env.PI_REDUCED_MOTION === '1')
export const spinnerAt = (now: number): number => Math.floor(now / SPINNER_MS) % SPINNER.length

/** Valid `#rrggbb` entries of the config's `colors`; anything else is ignored. */
export function parseColors(text: string): Colors {
  const out: Colors = {}
  try {
    const colors = (JSON.parse(text) as { colors?: Record<string, unknown> } | null)?.colors
    if (!colors || typeof colors !== 'object') return out
    for (const [key, value] of Object.entries(colors)) {
      const m = typeof value === 'string' ? /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(value) : null
      if (m) out[key] = [parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16)]
    }
  } catch {
    // missing or invalid config: no HUD colors
  }
  return out
}

let cached: Colors | undefined
/** HUD colors, read once per process. */
export function hudColors(): Colors {
  if (!cached) {
    try {
      cached = parseColors(readFileSync(CONFIG, 'utf8'))
    } catch {
      cached = {}
    }
  }
  return cached
}

/** Theme that paints the UI roles with the HUD palette, else with `base`. */
export function hudTheme(base: UiTheme, colors: Colors = hudColors()): UiTheme {
  return {
    bold: (text) => (noColor() ? text : base.bold(text)),
    fg(role, text) {
      if (noColor()) return text
      const rgb = colors[ROLE_TO_HUD[role] ?? '']
      if (!rgb) return base.fg(BASE_ROLE[role] ?? role, text)
      return `\x1b[38;2;${rgb[0]};${rgb[1]};${rgb[2]}m${text}\x1b[39m`
    },
  }
}

/** Ícones: Nerd Font (kitty ou PI_NERD_FONT=1) com fallback Unicode de largura simples. Contrato usado por tools.ts. */

export type IconName = 'read' | 'bash' | 'edit' | 'write' | 'grep' | 'find' | 'ls' | 'ok' | 'err' | 'pending' | 'branch' | 'clock' | 'think'
export type Env = Record<string, string | undefined>

// Nerd Fonts 3.5.1 (glyphnames.json).
const NERD: Record<IconName, string> = {
  read: '\uf4a5',
  bash: '\uf489',
  edit: '\uf448',
  write: '\uf4d0',
  grep: '\uf422',
  find: '\uf413',
  ls: '\uf451',
  ok: '\uf42e',
  err: '\uf467',
  pending: '\uf444',
  branch: '\uf418',
  clock: '\uf43a',
  think: '\u{f09d1}',
}

const UNICODE: Record<IconName, string> = {
  read: '▤',
  bash: '$',
  edit: '✎',
  write: '+',
  grep: '⌕',
  find: '⌕',
  ls: '≡',
  ok: '✓',
  err: '✗',
  pending: '●',
  branch: '⎇',
  clock: '◷',
  think: '◇',
}

const set = (v: string | undefined): boolean => (v ?? '') !== ''

/** PI_ASCII_ICONS e NO_COLOR forçam o fallback; terminal desconhecido também (sem sondar fontes). */
export const nerdFont = (env: Env = process.env): boolean => {
  if (set(env.PI_ASCII_ICONS) || set(env.NO_COLOR)) return false
  return env.PI_NERD_FONT === '1' || env.TERM === 'xterm-kitty' || set(env.KITTY_WINDOW_ID)
}

export const icon = (name: IconName, env: Env = process.env): string => (nerdFont(env) ? NERD[name] : UNICODE[name])

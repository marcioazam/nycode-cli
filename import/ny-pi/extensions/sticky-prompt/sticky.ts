// Funções puras do sticky-prompt (sem import do pi-tui, para testar com node:test).
const ZONE_START = /^\x1b\]133;A(?:\x07|\x1b\\)/
const ZONE_END = /\x1b\]133;B(?:\x07|\x1b\\)/

export interface Sticky { row: number, text: string }

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')

// Prompt do usuário = zona OSC 133 (user e assistente marcam) cujo texto começa como uma mensagem do usuário da sessão.
// Não usa a cor de fundo: no tema mono userMessageBg é vazio.
export function userMatcher(texts: readonly string[]): (zone: string) => boolean {
  const keys = texts.map((t) => norm(t).slice(0, 30)).filter(Boolean)
  return (zone) => {
    const z = norm(zone)
    return keys.some((k) => z.startsWith(k))
  }
}

export function findSticky(
  lines: readonly string[], scrollTop: number, isUser: (zone: string) => boolean, strip: (s: string) => string,
): Sticky | undefined {
  for (let row = Math.min(scrollTop, lines.length) - 1; row >= 0; row--) {
    if (!ZONE_START.test(lines[row] ?? '')) continue
    const parts: string[] = []
    for (let r = row; r < lines.length; r++) {
      const t = strip(lines[r] ?? '').trim()
      if (t) parts.push(t)
      if (ZONE_END.test(lines[r] ?? '')) break
    }
    const text = parts.join(' ')
    if (isUser(text)) return { row, text }
  }
  return undefined
}

export function stickyLine(
  text: string, width: number,
  truncate: (s: string, w: number, e: string) => string, measure: (s: string) => number,
  style: (s: string) => string): string {
  const body = truncate(`❯ ${text}`, Math.max(1, width - 2), '…')
  return style(` ${body}${' '.repeat(Math.max(0, width - 1 - measure(body)))}`)
}

export interface StickyTheme { getFgAnsi(c: 'text'): string, getBgAnsi(c: 'selectedBg'): string }

// Estilo do tema ativo (selectedBg/text). Lido a cada chamada: o tema muda em runtime.
// Cor vazia (tema mono, NO_COLOR) vira o reset padrão (39/49) no pi: sem cor própria, não emite SGR.
export function stickyStyle(theme: StickyTheme): (s: string) => string {
  return (s) => {
    const fg = theme.getFgAnsi('text'), bg = theme.getBgAnsi('selectedBg')
    const hasFg = fg !== '' && fg !== '\x1b[39m', hasBg = bg !== '' && bg !== '\x1b[49m'
    return `${hasBg ? bg : ''}${hasFg ? fg : ''}${s}${hasFg ? '\x1b[39m' : ''}${hasBg ? '\x1b[49m' : ''}`
  }
}

// Com um overlay visível o pi-tui 1.5.2 não ancora a seleção no transcript: ela vira seleção de tela (pega o
// status line) e não rola ao arrastar para fora. O pi-tui marca selectionPressActive antes dessa checagem.
export const selecting = (tui: { selectionPressActive?: boolean }) => tui.selectionPressActive === true

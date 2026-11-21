// Portão de contraste da Onda 7: node docs/designs/onda7-tokens/contraste.mjs
// Lê as paletas e os pares de proposta.html (fonte única) e o tema real themes/tokyo-night.json.
// Exit 1 se alguma paleta proposta (não "atual") reprovar; o tema real só é relatado.
import { readFileSync } from 'node:fs'

const here = new URL('.', import.meta.url)
const html = readFileSync(new URL('proposta.html', here), 'utf8')
const block = (id) => JSON.parse(html.match(new RegExp(`<script type="application/json" id="${id}">([\\s\\S]*?)</script>`))[1])
const P = block('paletas'), PAIRS = block('pares')

// WCAG 2.x; limiares sem arredondar (4,499 reprova).
const lum = (h) => { const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] }
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05) }
const get = (p, k) => { const v = /^think\d$/.test(k) ? p.think[+k[5]] : p[k]; return v === 'transparent' ? p.bg : v }

let failed = 0
for (const [name, p] of Object.entries(P)) {
  const bad = PAIRS.map(([f, b, min]) => [f, b, min, ratio(get(p, f), get(p, b))]).filter(([, , min, r]) => r < min)
  console.log(`${name.padEnd(7)} ${PAIRS.length - bad.length}/${PAIRS.length}${bad.map(([f, b, , r]) => `  ${f}/${b}=${r.toFixed(2)}`).join('')}`)
  if (name !== 'atual') failed += bad.length
}

// Tema real: tokens de texto sobre o fundo do kitty (#1a1b26), independente do mock.
const t = JSON.parse(readFileSync(new URL('../../../themes/tokyo-night.json', here), 'utf8'))
const col = Object.fromEntries(Object.entries(t.colors).map(([k, v]) => [k, t.vars[v] ?? v]))
const TEXT = ['text', 'muted', 'dim', 'accent', 'success', 'error', 'warning', 'thinkingText', 'toolOutput', 'mdHeading', 'mdLink', 'mdLinkUrl', 'mdCode', 'mdQuote', 'toolDiffContext', 'syntaxComment', 'thinkingOff', 'thinkingMinimal']
const real = TEXT.map((k) => [k, ratio(col[k], '#1a1b26')]).filter(([, r]) => r < 4.5)
console.log(`tokyo-night.json (real) abaixo de 4,5:1: ${real.map(([k, r]) => `${k}=${r.toFixed(2)}`).join(' ') || 'nenhum'}`)
process.exit(failed ? 1 : 0)

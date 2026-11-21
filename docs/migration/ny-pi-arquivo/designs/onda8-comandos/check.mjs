// Evidência da Onda 8: node docs/designs/onda8-comandos/check.mjs → real-*.png nesta pasta (kitty real, provider fake)
// HOME e PI_CODING_AGENT_DIR são temporários (lib.mjs); keybindings.json real só é lido e copiado para lá: a gravação nunca o toca.
import { startX, stopX, session, DEMO_ENTRY, HX } from '../../ui-ux-gallery/capture/lib.mjs'
const OUTREL = '../../designs/onda8-comandos/'
const IMPORTS = ['comandos', 'claude-compat', 'folha'].map((n, i) => `import h${i} from '${HX}/${n}/index.ts'`).join('\n')
const ENTRY = IMPORTS + DEMO_ENTRY.replace('export default function (pi) {', `export default function (pi) {
  for (const m of [h0, h1, h2]) m(pi)`)
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
// Cópia (só leitura do original) da configuração real do dono no agent dir temporário: as capturas refletem as teclas dele.
const files = { 'agent/keybindings.json': readFileSync(`${homedir()}/.pi/agent/keybindings.json`, 'utf8') }
await startX()
try {
  const s = await session('o8', { rows: 40, entry: ENTRY, files })
  const shot = async (name) => { await s.sleep(900); console.log(`--- ${name}\n${s.pane().split('\n').slice(-26).join('\n')}`); await s.shot(`${OUTREL}real-${name}.png`, {}) }
  try {
    await s.wait(/atalhos/, 40000); await s.sleep(2000)
    s.type('/'); await shot('paleta'); s.keys('C-u'); await s.sleep(300)
    s.type('/ren'); await shot('paleta-filtro'); s.keys('C-u'); await s.sleep(300)
    s.type('?'); await shot('painel'); s.type('x'); await shot('painel-fecha'); s.keys('C-u'); await s.sleep(300)
    s.type('/atalhos'); await s.sleep(400); s.keys('Enter'); await s.sleep(1200); await shot('atalhos')
    s.keys('Enter'); await shot('atalhos-detalhe')
    s.type('r'); await s.sleep(500); s.keys('C-o'); await shot('atalhos-captura'); s.keys('Escape'); await s.sleep(400); s.keys('Escape'); await s.sleep(400); s.keys('Escape'); await s.sleep(400)
    s.type('/rename teste'); await s.sleep(400); s.keys('Enter'); await s.sleep(1500)
    s.type('/'); await shot('recentes')
  } finally { console.log('requests', await s.close()) }
} finally { stopX() }

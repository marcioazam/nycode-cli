// Evidência da Onda 2: node docs/designs/onda2-editor/check.mjs → real-*.png nesta pasta (kitty real, provider fake)
import { startX, stopX, session, DEMO_ENTRY, HX } from '../../ui-ux-gallery/capture/lib.mjs'
const OUTREL = '../../designs/onda2-editor/'
const ENTRY = `import queue from '${HX}/up-dequeue/index.ts'\n` + DEMO_ENTRY.replace('export default function (pi) {', 'export default function (pi) {\n  queue(pi)')
await startX()
try {
  const s = await session('o2', { rows: 30, entry: ENTRY, tmuxExtra: 'set -g extended-keys on\nset -ga terminal-features "*:extkeys"\n' })
  const shot = async (name) => { await s.sleep(700); console.log(`--- ${name}\n${s.pane().split('\n').slice(-16).join('\n')}`); await s.shot(`${OUTREL}real-${name}.png`, {}) }
  try {
    await s.wait(/atalhos/, 40000); await s.sleep(2000)
    for (const p of ['refatora o parser de datas', 'adiciona teste do parser com fuso', 'atualiza o changelog']) { s.type(p); s.keys('Enter'); await s.sleep(2500) }
    s.keys('C-r'); await s.sleep(900); s.type('parser'); await shot('historico')
    s.type('zz'); await shot('historico-vazio')
    s.keys('Escape'); await s.sleep(500)
    s.type('rascunho importante'); s.keys('C-s'); await shot('rascunho')
    s.keys('C-s'); await s.sleep(300); s.keys('C-c'); await shot('apagado')
    s.type('!!cat notas.txt'); await shot('shell')
    s.keys('C-u'); await s.sleep(300)
    s.type('@@SLOW primeira'); s.keys('Enter'); await s.sleep(2500)
    s.type('roda também os testes'); s.keys('Enter'); await s.sleep(700)
    s.type('atualiza o changelog'); s.keys('Enter'); await s.sleep(700)
    s.type('mais uma'); await shot('fila')
  } finally { console.log('requests', await s.close()) }
} finally { stopX() }

// Evidência da Onda 6: node docs/designs/onda6-avisos/check.mjs → real-*.png nesta pasta (kitty real, provider fake)
import { startX, stopX, session, DEMO_ENTRY, HX } from '../../ui-ux-gallery/capture/lib.mjs'
const OUTREL = '../../designs/onda6-avisos/'
const ENTRY = `import avisos from '${HX}/avisos/index.ts'\n` + DEMO_ENTRY.replace('export default function (pi) {', 'export default function (pi) {\n  avisos(pi)')
await startX()
try {
  const s = await session('o6', { rows: 34, entry: ENTRY, extra: { notify: true } })
  const shot = async (name) => { await s.sleep(700); console.log(`--- ${name}\n${s.pane().split('\n').slice(-20).join('\n')}`); await s.shot(`${OUTREL}real-${name}.png`, {}) }
  try {
    await s.wait(/atalhos/, 40000); await s.sleep(2000)
    await s.prompt('@@ERR falhe', /recusou|400/); await shot('erro')
    await s.prompt('@@RETRY tente', /nova tentativa|Retrying/); await shot('retry')
    s.keys('Escape'); await s.sleep(1200); await shot('retry-cancelado')
    await s.prompt('@@RETRY tente', /nova tentativa|Retrying/); await s.wait(/Tentei|Retry failed/, 90000); await shot('retry-esgotado')
    s.type('@@SLOW resposta lenta'); s.keys('Enter'); await s.sleep(2500); s.keys('Escape'); await s.sleep(1200); await shot('interrompido')
    await s.prompt('/demo-notify', /Aviso de demonstra/); await shot('canal')
    await s.prompt('/avisos', /Avisos/); await shot('painel-recentes')
    s.keys('Tab'); await shot('painel-ajustes')
    s.keys('Escape'); await s.sleep(400)
  } finally { console.log('requests', await s.close()) }
} finally { stopX() }

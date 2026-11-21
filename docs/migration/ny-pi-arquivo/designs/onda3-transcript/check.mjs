// Evidência da Onda 3: node docs/designs/onda3-transcript/check.mjs → real-*.png nesta pasta (kitty real, provider fake)
import { startX, stopX, session, DEMO_ENTRY, HX } from '../../ui-ux-gallery/capture/lib.mjs'
const OUTREL = '../../designs/onda3-transcript/'
const ENTRY = `import clamp from '${HX}/bash-clamp/index.ts'\n` + DEMO_ENTRY.replace('export default function (pi) {', 'export default function (pi) {\n  clamp(pi)')
await startX()
try {
  const s = await session('o3', { rows: 34, entry: ENTRY })
  const shot = async (name) => { await s.sleep(900); console.log(`--- ${name}\n${s.pane()}`); await s.shot(`${OUTREL}real-${name}.png`, {}) }
  try {
    await s.wait(/atalhos/, 40000); await s.sleep(2000)
    await s.prompt('@@TOOLS rode as ferramentas', /Pronto: todas/)
    await shot('tools')
    s.keys('C-o'); await shot('tools-expandidas')
    s.keys('C-o'); await s.sleep(500)
    await s.prompt('@@CLAMP saida longa', /Saída longa de demonstração concluída/)
    await shot('clamp')
  } finally { console.log('requests', await s.close()) }
} finally { stopX() }

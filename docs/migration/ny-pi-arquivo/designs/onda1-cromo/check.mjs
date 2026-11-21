// Evidência da Onda 1 : node docs/designs/onda1-cromo/check.mjs → real-*.png nesta pasta (kitty real, provider fake)
import { startX, stopX, session, DEMO_ENTRY, HX } from '../../ui-ux-gallery/capture/lib.mjs'
const OUTREL = '../../designs/onda1-cromo/'
const ENTRY = `import bypass from '${HX}/bypass-permissions/index.ts'\n` + DEMO_ENTRY.replace('export default function (pi) {', 'export default function (pi) {\n  if (c.bypass) bypass(pi)')
await startX()
try {
  for (const theme of ['tokyo-night']) {
    const s = await session(`o1${theme.replace(/\W/g, '')}`, { rows: 30, theme, entry: ENTRY, env: { PI_BYPASS_PERMISSIONS: '1' }, extra: { bypass: true } })
    try {
      await s.wait(/atalhos/, 40000); await s.sleep(2500)
      console.log(s.pane())
      await s.shot(`${OUTREL}real-${theme}-inicial.png`, {})
      s.type('/bypass off'); await s.sleep(400); s.keys('Enter'); await s.sleep(1500)
      console.log(s.pane().split('\n').slice(-8).join('\n'))
      await s.shot(`${OUTREL}real-${theme}-bypass-off.png`, {})
      await s.prompt('@@SLOW aguarde', /interrompe/).catch((e) => console.log('sem indicador', String(e).slice(0, 300)))
      await s.shot(`${OUTREL}real-${theme}-trabalhando.png`, {})
    } finally { console.log('requests', await s.close()) }
  }
} finally { stopX() }

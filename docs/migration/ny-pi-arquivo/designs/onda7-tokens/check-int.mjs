// Evidência: linha de interrupção em vermelho com faixa toolErrorBg (kitty real). node docs/designs/onda7-tokens/check-int.mjs
import { startX, stopX, session, DEMO_ENTRY } from '../../ui-ux-gallery/capture/lib.mjs'
const OUTREL = '../../designs/onda7-tokens/'
const CASES = [['escuro', ['-o', 'background=#1a1b26', '-o', 'foreground=#c0caf5']], ['claro', ['-o', 'background=#ffffff', '-o', 'foreground=#1d1d1f']]]
await startX()
try {
  for (const [name, kittyExtra] of CASES) {
    const s = await session(`o7int${name}`, { rows: 20, theme: 'pi-claro/pi-escuro', settings: { editorPaddingX: 1 }, entry: DEMO_ENTRY, kittyExtra, env: { PI_NERD_FONT: '1' } })
    try {
      await s.wait(/atalhos/, 40000); await s.sleep(2500)
      await s.prompt('@@SLOW aguarde', /interrompe/).catch((e) => console.log('slow', String(e).slice(0, 200)))
      await s.sleep(1500); s.keys('Escape')
      await s.wait(/interrompido/, 15000).catch((e) => console.log('esc', String(e).slice(0, 300)))
      await s.sleep(800); await s.shot(`${OUTREL}real-${name}-interrompido.png`, {})
    } finally { await s.close() }
  }
} finally { stopX() }

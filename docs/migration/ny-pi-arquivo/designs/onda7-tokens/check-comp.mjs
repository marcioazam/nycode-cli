// Evidência: fundo azul das mensagens do usuário + caixa da compactação em pt-BR (kitty real). node docs/designs/onda7-tokens/check-comp.mjs
import { startX, stopX, session, DEMO_ENTRY } from '../../ui-ux-gallery/capture/lib.mjs'
const OUTREL = '../../designs/onda7-tokens/'
const CASES = [['escuro', ['-o', 'background=#1a1b26', '-o', 'foreground=#c0caf5']], ['claro', ['-o', 'background=#ffffff', '-o', 'foreground=#1d1d1f']]]
await startX()
try {
  for (const [name, kittyExtra] of CASES) {
    const s = await session(`o7comp${name}`, { rows: 34, theme: 'pi-claro/pi-escuro', settings: { editorPaddingX: 1, compaction: { enabled: true, keepRecentTokens: 10, reserveTokens: 16384 } }, entry: DEMO_ENTRY, kittyExtra, env: { PI_NERD_FONT: '1' } })
    try {
      await s.wait(/atalhos/, 40000); await s.sleep(2500)
      for (const t of ['me explique o tema escuro', 'e o tema claro?', 'compare os dois']) { await s.prompt(t); await s.sleep(3000) }
      await s.prompt('/compact', /Contexto resumido|compaction|Compacted/).catch((e) => console.log('compact', String(e).slice(-600)))
      await s.prompt('e agora aplique o fundo'); await s.sleep(3000); await s.shot(`${OUTREL}real-${name}-compactacao.png`, {})
      s.keys('C-o'); await s.sleep(1200); await s.shot(`${OUTREL}real-${name}-compactacao-aberta.png`, {})
    } finally { await s.close() }
  }
} finally { stopX() }

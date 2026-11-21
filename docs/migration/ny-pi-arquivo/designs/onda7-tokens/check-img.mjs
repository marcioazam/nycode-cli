// Evidência: moldura da imagem e barra de rolagem sem buraco, no kitty real SEM tmux (o tmux não repassa gráficos kitty).
// node docs/designs/onda7-tokens/check-img.mjs → real-escuro-imagem.png
import { homedir } from 'node:os'
import { startX, stopX, session, DEMO_ENTRY } from '../../ui-ux-gallery/capture/lib.mjs'
const OUTREL = '../../designs/onda7-tokens/'
process.env.IMG = new URL('./diff-ex1.png', import.meta.url).pathname // imagem real 2000x720
await startX()
try {
  const s = await session('o7img', {
    rows: 40, direct: true, theme: 'pi-claro/pi-escuro', entry: DEMO_ENTRY, pre: 'cp "$IMG" logo.png',
    settings: { editorPaddingX: 1, fullscreenScrollbar: 'always' },
    kittyExtra: ['-o', 'background=#1a1b26', '-o', 'foreground=#c0caf5'],
    env: { PI_NERD_FONT: '1', TERM: 'xterm-kitty', KITTY_WINDOW_ID: '1' },
    flags: `--no-extensions --no-context-files --no-skills --no-prompt-templates -e ../../entry.ts -e ${homedir()}/.pi/agent/extensions/image-open/index.ts --model fake/m1 --tools read,bash,edit,write,grep,find,ls`,
  })
  try {
    await s.sleep(9000)
    for (const msg of ['@@TOOLS rode as ferramentas', '@@IMG leia a imagem']) {
      await s.xdo('type', '--delay', '20', msg); await s.xdo('key', 'Return'); await s.sleep(7000)
    }
    await s.shot(`${OUTREL}real-escuro-imagem.png`, {})
  } finally { console.log('requests', await s.close()) }
} finally { stopX() }

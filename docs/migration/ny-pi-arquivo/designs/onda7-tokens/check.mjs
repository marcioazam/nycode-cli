// Evidência da Onda 7: node docs/designs/onda7-tokens/check.mjs → real-*.png nesta pasta (kitty real, provider fake)
// Setting "pi-claro/pi-escuro": o pi escolhe pelo fundo que o kitty reporta; aqui o fundo escuro do dono e um fundo claro.
import { startX, stopX, session, DEMO_ENTRY } from '../../ui-ux-gallery/capture/lib.mjs'
const OUTREL = '../../designs/onda7-tokens/'
const CASES = [
  ['escuro', ['-o', 'background=#1a1b26', '-o', 'foreground=#c0caf5']],
  ['claro', ['-o', 'background=#ffffff', '-o', 'foreground=#1d1d1f']],
]
await startX()
try {
  for (const [name, kittyExtra] of CASES) {
    const s = await session(`o7${name}`, { rows: 40, theme: 'pi-claro/pi-escuro', settings: { editorPaddingX: 1 }, entry: DEMO_ENTRY, kittyExtra, env: { PI_NERD_FONT: '1' } }) // env -i do lib apaga TERM=xterm-kitty; no kitty real a detecção é automática
    try {
      await s.wait(/atalhos/, 40000); await s.sleep(2500)
      await s.prompt('@@TOOLS rode as ferramentas', /Pronto/).catch((e) => console.log('tools', String(e).slice(0, 200)))
      await s.sleep(800); await s.shot(`${OUTREL}real-${name}-tools.png`, {})
      await s.prompt('@@TODO planeje', /Lista de tarefas atualizada/).catch((e) => console.log('todo', String(e).slice(0, 200)))
      await s.sleep(800); await s.shot(`${OUTREL}real-${name}-todo.png`, {})
      await s.prompt('@@MD mostre markdown', /segundo/).catch((e) => console.log('md', String(e).slice(0, 200)))
      await s.sleep(800); await s.shot(`${OUTREL}real-${name}-markdown.png`, {})
      await s.prompt('@@SLOW aguarde', /interrompe/).catch((e) => console.log('slow', String(e).slice(0, 200)))
      await s.shot(`${OUTREL}real-${name}-trabalhando.png`, {})
      console.log(`--- ${name}\n${s.pane().split('\n').slice(-6).join('\n')}`)
    } finally { console.log('requests', await s.close()) }
  }
} finally { stopX() }

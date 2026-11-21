// Evidência da status line "Calmo": node docs/designs/statusline/check.mjs → real-calm.png (kitty real, provider fake).
// HOME isolado e sem credenciais: os limites de 5h/semana não aparecem; só a integração com o pi-code é provada aqui.
import { fileURLToPath } from 'node:url'
import { startX, stopX, session } from '../../ui-ux-gallery/capture/lib.mjs'
const launcher = fileURLToPath(new URL('../../../claude-home/bin/hud/claude-hud-statusline.mjs', import.meta.url))
const files = {
  'claude/settings.json': JSON.stringify({ statusLine: { type: 'command', command: `${process.execPath} ${launcher}` } }),
  'claude/plugins/claude-hud/config.json': JSON.stringify({ renderer: 'calm' }),
}
await startX()
try {
  const s = await session('calm', { rows: 24, files })
  try {
    await s.wait(/Modelo Demo/, 40000); await s.prompt('oi', /ctx/); await s.sleep(1500)
    console.log(s.pane())
    await s.shot('../../designs/statusline/real-calm.png', {})
  } finally { await s.close() }
} finally { stopX() }

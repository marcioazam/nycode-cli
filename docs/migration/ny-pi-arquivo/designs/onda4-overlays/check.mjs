// Evidência da Onda 4: node docs/designs/onda4-overlays/check.mjs → real-*.png nesta pasta (kitty real, provider fake)
import { startX, stopX, session, DEMO_ENTRY, EXT, HX } from '../../ui-ux-gallery/capture/lib.mjs'
const OUTREL = '../../designs/onda4-overlays/'
const IMPORTS = ['folha', 'bypass-permissions'].map((n, i) => `import h${i} from '${HX}/${n}/index.ts'`).join('\n') + '\n' +
  ['context-usage.ts', 'memory.ts', 'hooks/index.ts', 'subagent/index.ts'].map((n, i) => `import p${i} from '${EXT}/${n}'`).join('\n')
// /demo-confirm chama o ui.confirm real com o título e o corpo do pi-code (subagent/modes.ts:82)
const ENTRY = IMPORTS + DEMO_ENTRY.replace('export default function (pi) {', `export default function (pi) {
  for (const m of [h0, h1, p0, p1, p2, p3]) m(pi)
  pi.registerCommand('demo-confirm', { description: 'demo: confirmação', handler: async (_a, ctx) => {
    const ok = await ctx.ui.confirm('Run project-local agents?', 'Agents: projeto-agente\\nSource: .claude/agents\\n\\nProject agents are repo-controlled. Only continue for trusted repositories.')
    ctx.ui.notify('resposta: ' + ok, 'info') } })`)
const hooks = { hooks: { PostToolUse: [{ matcher: '.*', hooks: [{ type: 'command', command: 'echo "Hook de demonstração"' }] }] } }
await startX()
try {
  const s = await session('o4', { rows: 34, entry: ENTRY, claude: hooks })
  const shot = async (name) => { await s.sleep(900); console.log(`--- ${name}\n${s.pane().split('\n').filter((l) => /resposta:|Bypass/.test(l)).join('\n')}\n${s.pane().split('\n').slice(-20).join('\n')}`); await s.shot(`${OUTREL}real-${name}.png`, {}) }
  const slash = async (cmd) => { s.type(cmd); await s.sleep(400); s.keys('Enter'); await s.sleep(1200) }
  try {
    await s.wait(/atalhos/, 40000); await s.sleep(2000)
    s.type('@@PLAIN primeira mensagem'); s.keys('Enter'); await s.sleep(2500)
    await slash('/painel'); await shot('painel'); s.keys('Down'); s.keys('Enter'); await shot('painel-enter'); s.keys('C-u')
    for (const c of ['context', 'memory', 'agents', 'hooks']) { await slash('/' + c); await shot(c); s.keys('Escape'); await s.sleep(500) }
    await slash('/demo-confirm'); await shot('confirmar'); s.keys('Enter'); await shot('confirmar-enter')
    await slash('/demo-confirm'); s.keys('Down'); s.keys('Enter'); await shot('confirmar-acao')
    await slash('/bypass status'); await shot('bypass-status')
  } finally { console.log('requests', await s.close()) }
} finally { stopX() }

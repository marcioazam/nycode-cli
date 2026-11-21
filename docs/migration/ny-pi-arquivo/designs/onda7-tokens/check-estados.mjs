// Evidência do vocabulário de estado (● ciano, ▲ amarelo, ✓ verde, ✕ vermelho, com o fundo do estado) no kitty real.
// node docs/designs/onda7-tokens/check-estados.mjs → real-{escuro,claro}-estados.png e -estados-aberto.png
import { startX, stopX, session, DEMO_ENTRY, HX } from '../../ui-ux-gallery/capture/lib.mjs'
const OUTREL = '../../designs/onda7-tokens/'
const CASES = [['escuro', ['-o', 'background=#1a1b26', '-o', 'foreground=#c0caf5']], ['claro', ['-o', 'background=#ffffff', '-o', 'foreground=#1d1d1f']]]
const IMP = `[impeccable@1] Findings marked attribution unknown may predate this session; do not treat them as regressions.\\n\\n[impeccable@1] Design hook findings requiring review in code/pi-harness/docs/designs/onda7-tokens/exemplos/sinais-variantes.html (4 issue(s)):\\n- [low-contrast] [attribution unknown] Low contrast text. Text does not meet WCAG AA.\\n- [low-contrast] [attribution unknown] Low contrast text.\\n- [low-contrast] [attribution unknown] Low contrast text.\\n- [cramped-padding] [attribution unknown] Cramped padding. Text is too close.\\n\\nTriage per the session policy: persist ignores via impeccable hooks ignore-value.`
const ENTRY = DEMO_ENTRY.replace('export default function (pi) {', `import hookMsgs from '${HX}/hook-msgs/index.ts'
export default function (pi) {
  hookMsgs(pi)
  pi.registerCommand('demo-hook', { description: 'demo: mensagens de hook', handler: async () => {
    pi.sendMessage({ customType: 'claude-stop-hook', content: \`${IMP}\`, display: true })
    pi.sendMessage({ customType: 'claude-async-hook', content: 'gate terminou: 3 checks verdes\\nlint ok\\ntestes ok', display: true })
    pi.sendMessage({ customType: 'claude-stop-hook', content: 'Error: o hook de formatação falhou\\nexit 1: prettier não encontrado', display: true })
  } })`)
await startX()
try {
  for (const [name, kittyExtra] of CASES) {
    const s = await session(`o7est${name}`, { rows: 44, theme: 'pi-claro/pi-escuro', settings: { editorPaddingX: 1 }, entry: ENTRY, kittyExtra, env: { PI_NERD_FONT: '1' } })
    try {
      await s.wait(/atalhos/, 40000); await s.sleep(2500)
      await s.prompt('@@TOOLS rode as ferramentas', /Pronto/).catch((e) => console.log('tools', String(e).slice(0, 200)))
      await s.prompt('/demo-hook', /hook/).catch((e) => console.log('hook', String(e).slice(0, 200)))
      await s.sleep(1000); await s.shot(`${OUTREL}real-${name}-estados.png`, {})
      s.keys('C-o'); await s.sleep(1200); await s.shot(`${OUTREL}real-${name}-estados-aberto.png`, {}); s.keys('C-o'); await s.sleep(600)
      await s.prompt('@@SLOW aguarde', /interrompe/).catch((e) => console.log('slow', String(e).slice(0, 200)))
      await s.shot(`${OUTREL}real-${name}-estados-executando.png`, {})
      console.log(`--- ${name}\n${s.pane().split('\n').slice(-14).join('\n')}`)
    } finally { await s.close() }
  }
} finally { stopX() }

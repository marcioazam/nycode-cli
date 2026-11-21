// Evidência da Onda 5: node docs/designs/onda5-gestao/check.mjs [cena...] → real-*.png nesta pasta (kitty real, provider fake).
// Não escreve em docs/ui-ux-gallery (usa só session/ENTRY, nunca saveShots).
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { startX, stopX, session } from '../../ui-ux-gallery/capture/lib.mjs'
import { ENTRY } from '../../ui-ux-gallery/capture/extra/h.mjs'
const OUTREL = '../../designs/onda5-gestao/'
const KB = readFileSync(join(homedir(), '.pi/agent/keybindings.json'), 'utf8')
const EXTK = 'set -g extended-keys on\nset -g extended-keys-format csi-u\nset -as terminal-features ",*:extkeys"\n'
const TF = 'read,bash,edit,write,grep,find,ls'
const hookCfg = { hooks: { PostToolUse: [{ matcher: '.*', hooks: [{ type: 'command', command: `echo '{"systemMessage":"Hook de demonstração: PostToolUse executado"}'` }] }] } }

async function scene(name, opts, fn) {
  let s
  try {
    s = await session(name, { entry: ENTRY, ...opts })
    await s.wait(/\S/, 40000); await s.sleep(2500)
    const shot = async (file, delay = 700) => {
      try { await s.sleep(delay); console.log(`--- ${file}\n${s.pane().split('\n').slice(-16).join('\n')}`); await s.shot(`${OUTREL}real-${file}.png`, {}); console.log('ok', file) }
      catch (e) { console.log('FALHA', file, String(e).slice(0, 200)) }
    }
    const slash = async (cmd, re) => { s.type(cmd); await s.sleep(400); s.keys('Enter'); await s.sleep(400); if (re) { try { await s.wait(re, 8000) } catch { console.log('sem match', cmd) } } await s.sleep(800) }
    await fn({ s, shot, slash })
  } catch (e) { console.log('ERRO', name, String(e).slice(0, 600)) } finally { if (s) console.log('requests', name, await s.close()) }
}

const want = process.argv.slice(2)
const SC = {
  async pergunta() {
    await scene('pergunta', {}, async ({ s, shot }) => {
      s.type('@@Q1 pergunte'); s.keys('Enter'); await s.sleep(5000)
      await shot('pergunta-unica'); s.keys('Enter'); await s.sleep(3000)
      s.type('@@QM pergunte'); s.keys('Enter'); await s.sleep(5000)
      s.keys('Space'); s.keys('Down'); s.keys('Down'); s.keys('Space'); await s.sleep(500)
      await shot('pergunta-multi'); s.keys('Escape'); await s.sleep(1000)
    })
  },
  async objetivo() {
    await scene('objetivo', {}, async ({ s, shot, slash }) => {
      await slash('/goal escrever testes de demonstração', null); await s.sleep(2500)
      await shot('objetivo')
      await slash('/goal', null); await s.sleep(1500)
      await shot('objetivo-painel'); s.keys('Escape'); await s.sleep(500)
    })
  },
  async agente() {
    await scene('agente', { rows: 45, tmuxExtra: EXTK, files: { 'agent/keybindings.json': KB }, extra: { fleet: true } }, async ({ s, shot }) => {
      // Painel em abas: ↓ foca a barra, → abre Agentes, Enter entra no corpo, ↓ escolhe o run, Enter abre o viewer
      for (const k of ['Down', 'Right', 'Enter', 'Down', 'Enter']) { s.keys(k); await s.sleep(1200) }
      await s.sleep(800)
      await shot('agente')
      // x arma por 2 s (ARM_MS): captura sem a espera padrão
      s.keys('x'); await shot('agente-parar', 150); s.keys('Escape'); await s.sleep(500); s.keys('Escape')
    })
  },
  async rewind() {
    await scene('rewind', { rows: 40, toolsFlag: TF, extra: { more: ['gitCheckpoint'] } }, async ({ s, shot, slash }) => {
      await s.prompt('@@WRITE crie um arquivo', /Arquivo de código escrito/); await s.sleep(2500)
      await slash('/rewind', /[Rr]ewind|checkpoint|[Vv]olt/i); await s.sleep(1500)
      await shot('rewind-pontos'); s.keys('Enter'); await s.sleep(2000)
      await shot('rewind-modos'); s.keys('Enter'); await s.sleep(3000)
      await shot('rewind-resultado')
    })
  },
  async hook() {
    await scene('hook', { rows: 45, claude: hookCfg, toolsFlag: TF, env: { PI_BYPASS_PERMISSIONS: '1' }, extra: { more: ['bypass', 'hooks'] } }, async ({ s, shot }) => {
      await s.prompt('@@HOOK dispare hook', /Hook disparado/); await s.sleep(1000)
      await shot('hook')
    })
  },
  async plangate() {
    await scene('plangate', { rows: 40, toolsFlag: TF, env: { PI_COMPLETION_GATE: '0' }, extra: { more: ['planGate'] } }, async ({ s, shot, slash }) => {
      await slash('/demo-aprovar-plano', /Execute the plan/); await s.sleep(500)
      await s.prompt('@@WRITE edite durante a execução do plano', null); await s.sleep(15000)
      await shot('plan-gate')
    })
  },
  async resume() {
    await scene('resume', { rows: 36, settings: { retry: { enabled: true, maxRetries: 1, baseDelayMs: 500 } }, extra: { more: ['autoResume'] } }, async ({ s, shot }) => {
      s.type('@@E503 falha transitória'); s.keys('Enter'); await s.sleep(9000)
      await shot('auto-resume')
    })
  },
}
await startX()
try { for (const n of want.length ? want : Object.keys(SC)) await SC[n]() } finally { stopX() }

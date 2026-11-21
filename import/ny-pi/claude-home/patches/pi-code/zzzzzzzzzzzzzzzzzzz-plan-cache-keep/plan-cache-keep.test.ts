// Testes do zzzzzzzzzzzzzzzzzzz-plan-cache-keep.patch:
//   NO_COLOR=1 node --experimental-strip-types --test ~/.pi/agent/claude-home/patches/pi-code/zzzzzzzzzzzzzzzzzzz-plan-cache-keep/plan-cache-keep.test.ts
// Bug (2026-11-14): ao sair do modo plano um handler `context` removia as notas [PLAN MODE ACTIVE] do
// histórico; o pi então reenviava prompt e ferramentas como cabeçalho novo e o cache de prompt era perdido
// (0 de 35,7k tokens lidos). Agora nada é removido e a saída acrescenta uma nota [PLAN MODE ENDED].
import assert from 'node:assert/strict'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

process.env.NO_COLOR = '1'
const HOME = homedir()
const EXT = process.env.PI_CODE_EXT ?? `${HOME}/.pi/agent/npm/node_modules/pi-code/extensions`
// O Node não tira tipos de .ts dentro de node_modules: testa uma cópia do pacote, com o pi ao lado.
const tmp = mkdtempSync(join(tmpdir(), 'plan-cache-keep-test-'))
const ext = join(tmp, 'extensions')
cpSync(EXT, ext, { recursive: true })
mkdirSync(join(tmp, 'node_modules'))
const modules = `${HOME}/.pi/agent/install/releases/${readFileSync(`${HOME}/.pi/agent/install/current-version`, 'utf8').trim()}/node_modules`
symlinkSync(`${modules}/@earendil-works`, join(tmp, 'node_modules', '@earendil-works'))
symlinkSync(`${modules}/typebox`, join(tmp, 'node_modules', 'typebox'))
const { default: planMode } = await import(`${ext}/plan-mode/index.ts`)

function load() {
  const handlers: Record<string, unknown[]> = {}
  const sent: Array<{ customType: string; content: string }> = []
  const shortcuts: Array<{ handler: (ctx: unknown) => Promise<void> }> = []
  let active = ['read', 'bash', 'edit', 'write']
  const pi: any = {
    on: (name: string, h: unknown) => void (handlers[name] ??= []).push(h),
    events: { on() {}, emit() {} },
    registerFlag() {}, registerCommand() {}, registerTool() {},
    registerShortcut: (_k: unknown, s: { handler: (ctx: unknown) => Promise<void> }) => void shortcuts.push(s),
    getFlag: () => false,
    getActiveTools: () => active,
    getAllTools: () => active.map((name) => ({ name })),
    setActiveTools: (t: string[]) => void (active = t),
    appendEntry() {},
    sendMessage: (m: { customType: string; content: string }) => void sent.push(m),
    sendUserMessage() {},
  }
  planMode(pi)
  const theme = { fg: (_c: string, t: string) => t, bold: (t: string) => t }
  const ctx: any = {
    hasUI: true,
    isIdle: () => true,
    sessionManager: { getSessionId: () => 'abcdef0123456789' },
    ui: { theme, notify() {}, setStatus() {}, setWidget() {} },
  }
  return { handlers, sent, toggle: () => shortcuts[0].handler(ctx), tools: () => active }
}

test('nenhum handler context: o histórico não é reescrito ao sair do modo plano', () => {
  assert.equal(load().handlers.context, undefined)
})

test('sair do modo plano acrescenta a nota [PLAN MODE ENDED] e devolve as ferramentas', async () => {
  const s = load()
  await s.toggle()
  assert.deepEqual(s.tools(), ['read', 'bash', 'write', 'edit'])
  assert.equal(s.sent.length, 0)
  await s.toggle()
  assert.deepEqual(s.tools(), ['read', 'bash', 'edit', 'write'])
  assert.deepEqual(s.sent.map((m) => m.customType), ['plan-mode-ended'])
  assert.match(s.sent[0].content, /^\[PLAN MODE ENDED\].*no longer apply/)
})

// Testes do notify-focus.patch: node --experimental-strip-types --test ~/.pi/agent/claude-home/patches/pi-code/notify-focus.test.ts
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

const HOME = homedir()
const PATCHES = `${HOME}/.pi/agent/claude-home/patches/pi-code`
const EXT = `${HOME}/.pi/agent/npm/node_modules/pi-code/extensions`
// O Node não tira tipos de .ts dentro de node_modules: testa uma cópia do pacote, com o pi ao lado.
const tmp = mkdtempSync(join(tmpdir(), 'notify-focus-test-'))
const ext = join(tmp, 'extensions')
cpSync(EXT, ext, { recursive: true })
mkdirSync(join(tmp, 'node_modules'))
symlinkSync(`${HOME}/.pi/agent/install/releases/${readFileSync(`${HOME}/.pi/agent/install/current-version`, 'utf8').trim()}/node_modules/@earendil-works`, join(tmp, 'node_modules', '@earendil-works'))
const mod = await import(`${ext}/notify.ts`)

test('shouldNotify: foco conhecido decide sozinho; desconhecido usa isAway', () => {
  assert.equal(mod.shouldNotify(true, undefined, 0, 30_000), false)
  assert.equal(mod.shouldNotify(false, 0, 1, 30_000), true)
  assert.equal(mod.shouldNotify(undefined, undefined, 0, 30_000), true)
  assert.equal(mod.shouldNotify(undefined, 1000, 2000, 30_000), false)
  assert.equal(mod.shouldNotify(undefined, 1000, 40_000, 30_000), true)
})

/** Runs one turn through the extension and returns what was written to stdout. */
function harness(withEvents = true) {
  const handlers = new Map<string, (...a: any[]) => any>()
  const bus = new Map<string, (d: unknown) => void>()
  const pi: any = { on: (n: string, h: any) => handlers.set(n, h) }
  if (withEvents) pi.events = { on: (n: string, h: any) => bus.set(n, h) }
  mod.default(pi)
  const written: string[] = []
  const realWrite = process.stdout.write
  const run = (opts: { aborted?: boolean; userInput?: boolean } = {}) => {
    written.length = 0
    process.stdout.write = ((s: string) => (written.push(String(s)), true)) as any
    const wasTty = process.stdout.isTTY
    process.stdout.isTTY = true
    try {
      handlers.get('session_start')!({}, {})
      if (opts.userInput) handlers.get('input')!({ source: 'user' })
      handlers.get('agent_end')!({ messages: [{ role: 'assistant', stopReason: opts.aborted ? 'aborted' : 'stop' }] })
      handlers.get('agent_settled')!({})
    } finally {
      process.stdout.write = realWrite
      process.stdout.isTTY = wasTty
    }
    return written.length > 0
  }
  return { bus, run }
}

test('com foco: não notifica, mesmo sem input recente', () => {
  const h = harness()
  h.bus.get('pi-ui:terminal-focus')!({ focused: true })
  assert.equal(h.run(), false)
})

test('sem foco: notifica mesmo com input recente (turno curto)', () => {
  const h = harness()
  h.bus.get('pi-ui:terminal-focus')!({ focused: false })
  assert.equal(h.run({ userInput: true }), true)
})

test('sem foco mas turno abortado: não notifica', () => {
  const h = harness()
  h.bus.get('pi-ui:terminal-focus')!({ focused: false })
  assert.equal(h.run({ aborted: true }), false)
})

test('foco volta: último evento vence', () => {
  const h = harness()
  h.bus.get('pi-ui:terminal-focus')!({ focused: false })
  h.bus.get('pi-ui:terminal-focus')!({ focused: true })
  assert.equal(h.run(), false)
})

test('sem evento de foco: heurística isAway inalterada', () => {
  const h = harness()
  assert.equal(h.run(), true) // nenhum prompt desde o início da sessão = ausente
  assert.equal(h.run({ userInput: true }), false) // turno curto após input
})

test('stub sem pi.events carrega e cai na heurística', () => {
  assert.equal(harness(false).run(), true)
})

test('patch aplica ao original e reverte no instalado', () => {
  const d = mkdtempSync(join(tmpdir(), 'notify-orig-'))
  copyFileSync(`${PATCHES}/orig/notify.ts`, join(d, 'notify.ts'))
  execFileSync('patch', ['-d', d, '-p1', '-N', '--dry-run', '-i', `${PATCHES}/notify-focus.patch`])
  execFileSync('patch', ['-d', EXT, '-p1', '-R', '--dry-run', '-i', `${PATCHES}/notify-focus.patch`])
})

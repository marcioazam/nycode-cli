// Testes do permission-control: node --experimental-strip-types --test claude-home/patches/pi-code/permission-control/apply.test.ts
// Usa cópias temporárias sintéticas; o pacote instalado só é lido (--check), nunca alterado.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { ANCHOR, apply, BEGIN, END, preflight, revert, TARGET } from './apply.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const tmp = mkdtempSync(join(tmpdir(), 'perm-control-test-'))
after(() => rmSync(tmp, { recursive: true }))

const SOURCE = `export default function (pi: any) {
  let planModeEnabled = false
  const planSection = { shutdown(_ctx: unknown) {} }
  function togglePlanMode(ctx: any) {
    if (ctx.boom) throw new Error('boom')
    planModeEnabled = !planModeEnabled
  }
  pi.on('session_start', () => { planModeEnabled = false })
  pi.on('session_shutdown', (_event, ctx) => planSection.shutdown(ctx))
}
`

let n = 0
function fake(version = '1.7.0', source = SOURCE): string {
  const root = join(tmp, `pkg${n++}`)
  mkdirSync(join(root, 'extensions/plan-mode'), { recursive: true })
  writeFileSync(join(root, 'package.json'), JSON.stringify({ version }))
  writeFileSync(join(root, TARGET), source)
  return root
}

test('aplica uma vez, idempotente, e reverte exatamente ao original', () => {
  const root = fake()
  assert.equal(preflight(root).state, 'pending')
  assert.equal(apply(root), 'applied')
  const once = readFileSync(join(root, TARGET), 'utf8')
  assert.equal(once.split(BEGIN).length - 1, 1)
  assert.equal(apply(root), 'already')
  assert.equal(readFileSync(join(root, TARGET), 'utf8'), once)
  assert.equal(revert(root), 'reverted')
  assert.equal(readFileSync(join(root, TARGET), 'utf8'), SOURCE)
  assert.equal(revert(root), 'absent')
})

test('recusa versão diferente, âncora ausente/duplicada, marcadores quebrados e slot alheio sem gravar', () => {
  const cases: Array<[string, string]> = [
    [fake('1.8.0'), 'versão fixada'],
    [fake('1.7.0', 'export default function () {}\n'), 'âncora'],
    [fake('1.7.0', SOURCE + ANCHOR), 'âncora'],
    [fake('1.7.0', `${BEGIN}\n${SOURCE}`), 'inconsistentes'],
    [fake('1.7.0', SOURCE.replace('let planModeEnabled', '// Symbol.for("pi-code.plan-controller") pi-code.plan-controller\n  let planModeEnabled')), 'outro registro'],
  ]
  for (const [root, msg] of cases) {
    const before = readFileSync(join(root, TARGET), 'utf8')
    assert.throws(() => apply(root), new RegExp(msg))
    assert.equal(readFileSync(join(root, TARGET), 'utf8'), before)
  }
})

test('bloco alterado à mão é recusado, nada some no revert', () => {
  const root = fake()
  apply(root)
  const file = join(root, TARGET)
  writeFileSync(file, readFileSync(file, 'utf8').replace('typeof enabled', 'typeof  enabled'))
  assert.throws(() => revert(root), /diferente do esperado/)
  assert.throws(() => apply(root), /diferente do esperado/)
})

test('CLI: códigos de saída 0 e 2, --check não grava', () => {
  const root = fake()
  const run = (...a: string[]) => spawnSync(process.execPath, [join(here, 'apply.mjs'), ...a], { encoding: 'utf8' })
  assert.equal(run(root, '--check').stdout.trim(), 'ok:pending')
  assert.equal(readFileSync(join(root, TARGET), 'utf8'), SOURCE)
  assert.equal(run(root).status, 0)
  assert.equal(run(root, '--revert').stdout.trim(), 'reverted')
  assert.equal(run(fake('9.9.9')).status, 2)
  assert.equal(run().status, 2)
})

test('CLI linkado: instalação por symlink executa o applier, sem sucesso silencioso', () => {
  const root = fake()
  const link = join(tmp, 'apply-link.mjs')
  symlinkSync(join(here, 'apply.mjs'), link)
  const run = (...args: string[]) => spawnSync(process.execPath, [link, ...args], { encoding: 'utf8' })
  assert.equal(run(root, '--check').stdout.trim(), 'ok:pending')
  assert.equal(run(root).stdout.trim(), 'applied')
  assert.equal(preflight(root).state, 'applied')
  assert.equal(run(root, '--revert').stdout.trim(), 'reverted')
  assert.equal(readFileSync(join(root, TARGET), 'utf8'), SOURCE)
})

test('comportamento: slot semântico, toggle só quando difere, ctx fresco, limpeza só do próprio slot', async () => {
  const root = fake()
  apply(root)
  const mod = (await import(join(root, TARGET))).default
  const handlers: Record<string, Array<(...a: any[]) => void>> = {}
  const pi = { on: (e: string, f: (...a: any[]) => void) => (handlers[e] ??= []).push(f) }
  mod(pi)
  const slot = Symbol.for('pi-code.plan-controller')
  const g = globalThis as Record<symbol, any>
  delete g[slot]
  const fire = (e: string, ctx: unknown) => handlers[e].forEach((f) => f({}, ctx))
  fire('session_start', { id: 1 })
  const c = g[slot]
  assert.equal(c.active(), false)
  assert.equal(c.set('sim'), false)
  assert.equal(c.set(false), true)
  assert.equal(c.set(true), true)
  assert.equal(c.active(), true)
  assert.equal(c.set(true), true)
  assert.equal(c.set(false), true)
  assert.equal(c.active(), false)
  fire('session_start', { boom: true })
  assert.equal(c.set(true), false)
  assert.equal(c.active(), false)
  const other = {}
  g[slot] = other
  fire('session_shutdown', {})
  assert.equal(g[slot], other)
  g[slot] = c
  fire('session_shutdown', {})
  assert.equal(slot in g, false)
  assert.equal(c.set(true), false) // sem ctx depois do shutdown
})

test('pacote instalado: --check somente leitura (pula sem pi-code)', { skip: !existsSync(`${homedir()}/.pi/agent/npm/node_modules/pi-code/package.json`) }, () => {
  const root = `${homedir()}/.pi/agent/npm/node_modules/pi-code`
  const r = spawnSync(process.execPath, [join(here, 'apply.mjs'), root, '--check'], { encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /^ok:(pending|applied)/)
  assert.equal(END.length > 0, true)
})

// Replay dos patches (docs/subagent-model-effort.md): reverte a pilha numa cópia temporária da árvore instalada (original), reaplica em ordem e compara; idempotência e dry-run reverso.
// node --experimental-strip-types --test ~/.pi/agent/claude-home/patches/pi-code/zzzzzzz-subagent-model-effort/replay.test.ts
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, test } from 'node:test'
import { fileURLToPath } from 'node:url'

const patches = join(dirname(fileURLToPath(import.meta.url)), '..')
const installed = process.env.FLEET_TEST_PKG ? join(process.env.FLEET_TEST_PKG, 'extensions') : `${homedir()}/.pi/agent/npm/node_modules/pi-code/extensions`
const stack = readdirSync(patches).filter((f) => f.endsWith('.patch')).sort((a, b) => a.localeCompare(b)).map((f) => join(patches, f))
const MINE = ['zzzzzzz-subagent-model-effort.patch', 'zzzzzzzz-statusline-provider.patch'].map((f) => join(patches, f))
const tmp = mkdtempSync(join(tmpdir(), 'model-effort-replay-'))
after(() => rmSync(tmp, { recursive: true }))

const patch = (dir: string, file: string, ...flags: string[]) => spawnSync('patch', ['-p1', '-s', '-f', '--no-backup-if-mismatch', '-d', dir, ...flags], { input: readFileSync(file) })
function files(dir: string, base = dir): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? files(p, base) : [p.slice(base.length)]
  })
}

test('meus patches estão na pilha e depois do send, em ordem de glob', () => {
  for (const m of MINE) assert.ok(stack.includes(m), m)
  assert.ok(stack.indexOf(MINE[0]!) > stack.findIndex((f) => f.endsWith('zzzzzz-subagent-send.patch')))
})

test('reverter a pilha inteira dá o original; reaplicar reconstrói a árvore instalada; segunda aplicação é recusada', () => {
  const work = join(tmp, 'e')
  cpSync(installed, work, { recursive: true })
  for (const p of [...stack].reverse()) assert.equal(patch(work, p, '-R').status, 0, `reverter ${p}`)
  // fleet/tracker.ts is created by an older patch of the stack: the pristine package has no such file.
  assert.ok(!files(work).includes('/subagent/fleet/tracker.ts'), 'pacote original não tem o tracker')
  for (const p of stack) assert.equal(patch(work, p).status, 0, `aplicar ${p}`)
  const after = files(work)
  assert.deepEqual(after.sort(), files(installed).sort())
  for (const f of after) assert.equal(readFileSync(join(work, f), 'utf8'), readFileSync(join(installed, f), 'utf8'), f)
  for (const m of MINE) {
    assert.equal(patch(work, m, '-R', '--dry-run').status, 0, `visto como aplicado: ${m}`)
    assert.notEqual(patch(work, m, '-N', '--dry-run').status, 0, `não reaplica: ${m}`)
  }
})

test('reverter só os meus patches deixa o tracker da pilha anterior, sem o rastreio de modelo/esforço', () => {
  const work = join(tmp, 'mine-only')
  cpSync(installed, work, { recursive: true })
  const tracker = join(work, 'subagent/fleet/tracker.ts')
  assert.ok(readFileSync(tracker, 'utf8').includes('configuredRuntime'), 'instalado tem o patch')
  for (const m of [...MINE].reverse()) assert.equal(patch(work, m, '-R').status, 0, `reverter ${m}`)
  assert.ok(!readFileSync(tracker, 'utf8').includes('configuredRuntime'), 'anterior ao patch')
  assert.ok(!files(work).includes('/subagent/fleet-ui/runtime-label.ts'), 'arquivo novo some junto')
})

test('o patch do modelo/esforço aplica só sobre a pilha anterior e toca apenas arquivos de subagent/', () => {
  const text = readFileSync(MINE[0]!, 'utf8')
  const targets = [...text.matchAll(/^\+\+\+ b\/(\S+)/gm)].map((m) => m[1]!)
  assert.ok(targets.length >= 6)
  assert.ok(targets.every((t) => t.startsWith('subagent/')), targets.join())
  const sl = readFileSync(MINE[1]!, 'utf8')
  assert.deepEqual([...sl.matchAll(/^\+\+\+ b\/(\S+)/gm)].map((m) => m[1]), ['status-line.ts'])
})

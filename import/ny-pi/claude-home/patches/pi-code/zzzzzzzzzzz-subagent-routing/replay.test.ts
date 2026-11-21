// Replay do patch de roteamento na pilha (docs/subagent-routing-2026-11-13.md, P3): reverte a pilha numa cópia, reaplica em ordem e compara; node --experimental-strip-types --test ~/.pi/agent/claude-home/patches/pi-code/zzzzzzzzzzz-subagent-routing/replay.test.ts
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, test } from 'node:test'
import { fileURLToPath } from 'node:url'

// A pilha instalada é a que o wrapper bin/pi aplica; a cópia ao lado do teste cobre quem não a tem.
const here = join(dirname(fileURLToPath(import.meta.url)), '..')
const live = `${homedir()}/.pi/agent/claude-home/patches/pi-code`
const patches = existsSync(live) ? live : here
const pkg = process.env.FLEET_TEST_PKG ? join(process.env.FLEET_TEST_PKG, 'extensions') : `${homedir()}/.pi/agent/npm/node_modules/pi-code/extensions`
const stack = readdirSync(patches).filter((f) => f.endsWith('.patch')).sort((a, b) => a.localeCompare(b)).map((f) => join(patches, f))
const MINE = join(patches, 'zzzzzzzzzzz-subagent-routing.patch')
const later = stack.slice(stack.indexOf(MINE) + 1) // posteriores ao meu: revertem antes (ordem reversa)
const tmp = mkdtempSync(join(tmpdir(), 'routing-replay-'))
after(() => rmSync(tmp, { recursive: true }))
// O bloco permission-control é inserido pelo bin/pi depois da pilha e não faz parte dos patches: a referência é a árvore instalada sem ele (mesmo corte do awk de pi_patch_stack_applied).
const installed = join(tmp, 'installed')
cpSync(pkg, installed, { recursive: true })
const planIndex = join(installed, 'plan-mode/index.ts')
if (existsSync(planIndex)) writeFileSync(planIndex, readFileSync(planIndex, 'utf8').replace(/^.*pi-harness permission-control BEGIN[\s\S]*?permission-control END.*\n\n?/m, ''))

const patch = (dir: string, file: string, ...flags: string[]) => spawnSync('patch', ['-p1', '-s', '-f', '--no-backup-if-mismatch', '-d', dir, ...flags], { input: readFileSync(file) })
function files(dir: string, base = dir): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? files(p, base) : [p.slice(base.length)]
  })
}

test('o patch está na pilha, depois dos de modelo/esforço e de plan-section', () => {
  assert.ok(stack.includes(MINE))
  for (const dep of ['zzzzzzz-subagent-model-effort.patch', 'zzzzzzzzzz-plan-section.patch'])
    assert.ok(stack.indexOf(MINE) > stack.findIndex((f) => f.endsWith(dep)), dep)
})

test('reverter a pilha dá o original; reaplicar reconstrói a árvore instalada; segunda aplicação é recusada', () => {
  const work = join(tmp, 'e')
  cpSync(installed, work, { recursive: true })
  for (const p of [...stack].reverse()) assert.equal(patch(work, p, '-R').status, 0, `reverter ${p}`)
  assert.ok(!existsSync(join(work, 'subagent/routing')), 'o pacote original não tem o diretório de roteamento')
  for (const p of stack) assert.equal(patch(work, p).status, 0, `aplicar ${p}`)
  const after = files(work)
  assert.deepEqual(after.sort(), files(installed).sort())
  for (const f of after) assert.equal(readFileSync(join(work, f), 'utf8'), readFileSync(join(installed, f), 'utf8'), f)
  assert.equal(patch(work, MINE, '-R', '--dry-run').status, 0, 'visto como aplicado')
  assert.notEqual(patch(work, MINE, '-N', '--dry-run').status, 0, 'não reaplica')
})

test('reverter só o roteamento remove os arquivos novos e as fiações, sem tocar o resto da pilha', () => {
  const work = join(tmp, 'mine-only')
  cpSync(installed, work, { recursive: true })
  for (const l of [...later].reverse()) assert.equal(patch(work, l, '-R').status, 0, `reverter ${l}`)
  assert.equal(patch(work, MINE, '-R').status, 0)
  assert.ok(!existsSync(join(work, 'subagent/routing')))
  for (const [file, marker] of [['subagent/run.ts', 'resolveSpawn'], ['subagent/modes.ts', 'resolveSpawn'], ['subagent/index.ts', 'registerRoutingCommand'], ['subagent/params.ts', 'withRouting'], ['skills.ts', 'PI_CODE_SUBAGENT_NO_SKILLS'], ['subagent/agents.ts', 'parseAgentsField']] as const)
    assert.ok(!readFileSync(join(work, file), 'utf8').includes(marker), `${file} sem ${marker}`)
  assert.ok(readFileSync(join(work, 'subagent/fleet/tracker.ts'), 'utf8').length > 0, 'a pilha anterior continua')
})

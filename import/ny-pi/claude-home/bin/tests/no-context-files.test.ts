// Testes de ~/.pi/agent/extensions/no-context-files-covers-claude-md.ts.
// Rodar: node --experimental-strip-types --test ~/.pi/agent/claude-home/bin/tests/no-context-files.test.ts
import { strict as assert } from 'node:assert'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { after, test } from 'node:test'
import { agentOmitsClaudeMd, shouldOmitClaudeMd } from '../../../extensions/no-context-files-covers-claude-md.ts'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nocf-'))
fs.writeFileSync(path.join(dir, 'Explore.md'), '---\nname: Explore\nomitClaudeMd: true\n---\nbody\n')
fs.writeFileSync(path.join(dir, 'worker.md'), '---\nname: swarm-worker\nmodel: x\n---\nbody\n')
after(() => fs.rmSync(dir, { recursive: true, force: true }))
fs.writeFileSync(path.join(dir, 'off.md'), '---\nname: off\nomitClaudeMd: false\n---\n')

test('omitClaudeMd: true omite; ausente ou false não', () => {
  assert.equal(agentOmitsClaudeMd('Explore', [dir]), true)
  assert.equal(agentOmitsClaudeMd('swarm-worker', [dir]), false)
  assert.equal(agentOmitsClaudeMd('off', [dir]), false)
  assert.equal(agentOmitsClaudeMd('inexistente', [dir, '/nao/existe']), false)
})

test('-nc e --no-context-files sempre omitem', () => {
  assert.equal(shouldOmitClaudeMd(['-p', '--no-context-files']), true)
  assert.equal(shouldOmitClaudeMd(['-nc']), true)
  assert.equal(shouldOmitClaudeMd(['-p', 'oi']), false)
})

test('filho de subagent: nome vem do --system-prompt; fora de subagent não', () => {
  const saved = { sub: process.env.PI_CODE_SUBAGENT, cfg: process.env.CLAUDE_CONFIG_DIR }
  fs.mkdirSync(path.join(dir, 'cfg', 'agents'), { recursive: true })
  fs.copyFileSync(path.join(dir, 'Explore.md'), path.join(dir, 'cfg', 'agents', 'Explore.md'))
  fs.copyFileSync(path.join(dir, 'worker.md'), path.join(dir, 'cfg', 'agents', 'worker.md'))
  process.env.CLAUDE_CONFIG_DIR = path.join(dir, 'cfg')
  try {
    const args = (n: string) => ['--mode', 'json', '-p', '--system-prompt', `/tmp/pi-subagent-x/prompt-${n}.md`]
    process.env.PI_CODE_SUBAGENT = '1'
    assert.equal(shouldOmitClaudeMd(args('Explore')), true)
    assert.equal(shouldOmitClaudeMd(args('swarm-worker')), false)
    delete process.env.PI_CODE_SUBAGENT
    assert.equal(shouldOmitClaudeMd(args('Explore')), false)
  } finally {
    if (saved.sub === undefined) delete process.env.PI_CODE_SUBAGENT
    else process.env.PI_CODE_SUBAGENT = saved.sub
    if (saved.cfg === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = saved.cfg
  }
})

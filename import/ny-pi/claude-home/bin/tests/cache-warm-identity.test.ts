// Regressão do aquecimento de cache do pi (claude-home/docs/pi-memory-cache-sota-2026-11-13.md, passo 2).
// O aquecedor parava com "conversation context changed" porque o isCurrent exigia identidade de objeto, e a projeção
// da sessão recria custom_message (claude-hook-context) com outro timestamp. Conserto:
// claude-home/patches/pi-core/cache-warm-identity.mjs, aplicado pelo wrapper.
// Rodar: node --test ~/.pi/agent/claude-home/bin/tests/cache-warm-identity.test.ts
import { strict as assert } from 'node:assert'
import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { apply, MARK, SAME_FN } from '../../patches/pi-core/cache-warm-identity.mjs'

const version = readFileSync(join(homedir(), '.pi/agent/install/current-version'), 'utf8').trim()
const dist = join(homedir(), '.pi/agent/install/releases', version, 'node_modules/@earendil-works/pi-coding-agent/dist')
const same = new Function(`${SAME_FN}; return ${MARK}`)() as (a: unknown, b: unknown) => boolean

test('equivalência: só o timestamp pode mudar', () => {
  const content = 'contexto'
  const live = { role: 'custom', customType: 'claude-hook-context', content, display: false, timestamp: 1 }
  const projected = { role: 'custom', customType: 'claude-hook-context', content, display: false, details: undefined, timestamp: 2 }
  assert.equal(same(live, live), true)
  assert.equal(same(live, projected), true)
  assert.equal(same(live, { ...projected, content: [{ type: 'text', text: 'contexto' }] }), false)
  assert.equal(same(live, { ...projected, content: 'outro' }), false)
  assert.equal(same(live, { ...projected, role: 'user' }), false)
  assert.equal(same(live, { ...projected, details: { x: 1 } }), false)
  assert.equal(same(live, undefined), false)
  // conteúdo igual por valor, objeto recriado (sessão relida do disco)
  assert.equal(same({ role: 'user', content: [{ type: 'text', text: 'a' }], timestamp: 1 },
    { role: 'user', content: [{ type: 'text', text: 'a' }], timestamp: 9 }), true)
})

test('a release instalada está consertada (bundle e core)', () => {
  const chunks = readdirSync(join(dist, 'bundle/chunks')).filter((f) => readFileSync(join(dist, 'bundle/chunks', f), 'utf8').includes(MARK))
  assert.equal(chunks.length, 1, 'bundle sem o conserto: rodar o wrapper pi ou o .mjs')
  assert.ok(readFileSync(join(dist, 'core/sdk.js'), 'utf8').includes(MARK), 'core/sdk.js sem o conserto')
})

test('apply é idempotente e o código consertado continua válido', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'cwi-'))
  try {
    mkdirSync(join(tmp, 'core'))
    cpSync(join(dist, 'bundle/chunks'), join(tmp, 'bundle/chunks'), { recursive: true })
    cpSync(join(dist, 'core/sdk.js'), join(tmp, 'core/sdk.js'))
    assert.equal(apply(tmp), 2)
    const before = readFileSync(join(tmp, 'core/sdk.js'), 'utf8')
    assert.equal(apply(tmp), 2)
    assert.equal(readFileSync(join(tmp, 'core/sdk.js'), 'utf8'), before)
    for (const f of readdirSync(join(tmp, 'bundle/chunks')).filter((x) => readFileSync(join(tmp, 'bundle/chunks', x), 'utf8').includes(MARK))) {
      execFileSync(process.execPath, ['--check', join(tmp, 'bundle/chunks', f)])
    }
    execFileSync(process.execPath, ['--check', join(tmp, 'core/sdk.js')])
  } finally {
    rmSync(tmp, { recursive: true })
  }
})

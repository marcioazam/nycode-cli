// Testes de ~/.pi/agent/extensions/prefix-cache-1h/index.ts.
// Rodar: node --experimental-strip-types --test ~/.pi/agent/claude-home/bin/tests/prefix-cache-1h.test.ts
import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { enabled, prefixTtl1h } from '../../../extensions/prefix-cache-1h/index.ts'

const eph = () => ({ type: 'ephemeral' })
const payload = () => ({
  tools: [{ name: 'a' }, { name: 'b', cache_control: eph() }],
  system: [{ type: 'text', text: 'x', cache_control: eph() }, { type: 'text', text: 'y', cache_control: eph() }],
  messages: [{ role: 'user', content: [{ type: 'text', text: 'oi', cache_control: eph() }] }],
})

test('marca 1h só em tools e system; mensagens ficam em 5 min', () => {
  const p = payload()
  assert.equal(prefixTtl1h(p), p)
  assert.deepEqual(p.tools[1].cache_control, { type: 'ephemeral', ttl: '1h' })
  assert.equal((p.tools[0] as { cache_control?: unknown }).cache_control, undefined)
  for (const b of p.system) assert.deepEqual(b.cache_control, { type: 'ephemeral', ttl: '1h' })
  assert.deepEqual(p.messages[0].content[0].cache_control, { type: 'ephemeral' })
})

test('não mexe quando não há o que marcar', () => {
  assert.equal(prefixTtl1h({ messages: [] }), undefined) // continuação de thread: sem system/tools
  assert.equal(prefixTtl1h({ system: 'texto', tools: [{ name: 'a' }] }), undefined) // cache desligado
  const long = { system: [{ type: 'text', text: 'x', cache_control: { type: 'ephemeral', ttl: '1h' } }] }
  assert.equal(prefixTtl1h(long), undefined) // PI_CACHE_RETENTION=long já marcou
  assert.equal(prefixTtl1h(null), undefined)
  assert.equal(prefixTtl1h('x'), undefined)
})

test('liga só na sessão interativa principal; env força ou desliga', () => {
  assert.equal(enabled(true, {}), true)
  assert.equal(enabled(false, {}), false) // pi -p: prefixo raramente reusado em 5-60 min
  assert.equal(enabled(true, { PI_CODE_SUBAGENT: '1' }), false)
  assert.equal(enabled(true, { PI_PREFIX_CACHE_1H: '0' }), false)
  assert.equal(enabled(false, { PI_PREFIX_CACHE_1H: '1' }), true)
})

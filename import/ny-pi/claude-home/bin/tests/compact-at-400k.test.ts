// Testes de ~/.pi/agent/extensions/compact-at-400k.ts.
// Rodar: node --experimental-strip-types --test ~/.pi/agent/claude-home/bin/tests/compact-at-400k.test.ts
import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { compactLimit, reportCompactError } from '../../../extensions/compact-at-400k.ts'

test('limite: inteiro positivo vale; ausente usa 250000 sem avisar', () => {
  const warns: string[] = []
  assert.equal(
    compactLimit({ PI_COMPACT_AT: '300000' }, (m) => warns.push(m)),
    300000,
  )
  assert.equal(
    compactLimit({}, (m) => warns.push(m)),
    250000,
  )
  assert.deepEqual(warns, [])
})

test('limite: valor inválido cai no padrão e avisa uma vez', () => {
  for (const bad of ['250k', '0', '-5', '1.5', '', 'abc']) {
    const warns: string[] = []
    assert.equal(
      compactLimit({ PI_COMPACT_AT: bad }, (m) => warns.push(m)),
      250000,
      bad,
    )
    assert.equal(warns.length, 1, bad)
    assert.match(warns[0], new RegExp(`"${bad}".*250000`))
  }
})

test('falha da compactação: com UI notifica; sem UI escreve no stderr', () => {
  const notes: string[] = []
  const errs: string[] = []
  reportCompactError({ hasUI: true, ui: { notify: (m: string) => notes.push(m) } }, new Error('boom'), (m) =>
    errs.push(m),
  )
  assert.equal(notes.length, 1)
  assert.deepEqual(errs, [])
  reportCompactError({ hasUI: false, ui: { notify: () => assert.fail('sem UI') } }, new Error('boom'), (m) =>
    errs.push(m),
  )
  assert.equal(errs.length, 1)
  assert.match(errs[0], /boom/)
})

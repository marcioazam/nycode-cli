// node --experimental-strip-types --test ~/.pi/agent/extensions/ui-visual/test/icons.test.ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { icon, nerdFont } from '../icons.ts'
import type { IconName } from '../icons.ts'

const NAMES: IconName[] = ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls', 'ok', 'err', 'pending', 'branch', 'clock', 'think']

test('nerdFont: kitty ou PI_NERD_FONT=1 ligam; resto desliga', () => {
  assert.equal(nerdFont({}), false)
  assert.equal(nerdFont({ TERM: 'xterm-256color' }), false)
  assert.equal(nerdFont({ TERM: 'xterm-kitty' }), true)
  assert.equal(nerdFont({ KITTY_WINDOW_ID: '3' }), true)
  assert.equal(nerdFont({ PI_NERD_FONT: '1' }), true)
  assert.equal(nerdFont({ PI_NERD_FONT: '0' }), false)
})

test('nerdFont: PI_ASCII_ICONS e NO_COLOR vencem o kitty', () => {
  assert.equal(nerdFont({ TERM: 'xterm-kitty', PI_ASCII_ICONS: '1' }), false)
  assert.equal(nerdFont({ TERM: 'xterm-kitty', NO_COLOR: '1' }), false)
  assert.equal(nerdFont({ TERM: 'xterm-kitty', NO_COLOR: '' }), true)
})

test('todo IconName existe nos dois conjuntos e o fallback tem largura 1', () => {
  for (const n of NAMES) {
    const nerd = icon(n, { PI_NERD_FONT: '1' })
    const plain = icon(n, {})
    assert.ok(nerd.length > 0, n)
    assert.ok(plain.length > 0, n)
    assert.equal([...plain].length, 1, n)
    assert.notEqual(nerd, plain, n)
  }
})

test('glifos conhecidos', () => {
  assert.equal(icon('think', { PI_NERD_FONT: '1' }), '\u{f09d1}')
  assert.equal(icon('ok', { PI_NERD_FONT: '1' }), '\uf42e')
  assert.equal(icon('ok', {}), '✓')
  assert.equal(icon('pending', { PI_ASCII_ICONS: '1' }), '●')
})

test('sem env usa process.env', () => {
  assert.equal(typeof icon('bash'), 'string')
  assert.equal(typeof nerdFont(), 'boolean')
})

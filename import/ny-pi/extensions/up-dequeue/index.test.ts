import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
const agent = process.env.PI_AGENT_DIR ?? path.join(homedir(), '.pi/agent')
const tui = `${agent}/install/releases/${readFileSync(`${agent}/install/current-version`, 'utf8').trim()}/node_modules/@earendil-works/pi-tui/dist`
const { matchesKey } = await import(`${tui}/keys.js`)
import register, { rewrite } from './index.ts'

test('↑ vira Alt+↑ só com editor vazio e fila pendente', () => {
  assert.equal(rewrite('\x1b[A', true, true), '\x1b[1;3A')
  assert.equal(rewrite('\x1bOA', true, true), '\x1b[1;3A')
  assert.equal(rewrite('\x1b[A', false, true), undefined)
  assert.equal(rewrite('\x1b[A', true, false), undefined)
  assert.equal(rewrite('a', true, true), undefined)
})

test('a sequência gerada é Alt+↑ para o pi-tui', () => {
  assert.equal(matchesKey('\x1b[1;3A', 'alt+up'), true)
})

test('extensão registra o handler e consulta editor e fila', () => {
  let onStart: any, handler: any
  const ctx = (hasUI: boolean, text: string, pending: boolean) => ({
    hasUI, hasPendingMessages: () => pending,
    ui: { getEditorText: () => text, onTerminalInput: (h: any) => { handler = h } },
  })
  register({ on: (_e: string, fn: any) => { onStart = fn } } as any)
  handler = undefined
  onStart({}, ctx(false, '', true))
  assert.equal(handler, undefined)
  onStart({}, ctx(true, '  ', true))
  assert.deepEqual(handler('\x1b[A'), { data: '\x1b[1;3A' })
  onStart({}, ctx(true, 'texto', true))
  assert.equal(handler('\x1b[A'), undefined)
})

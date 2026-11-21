// Componente do modal /subagents-setup (docs/subagent-routing-2026-11-13.md, AC1): node --experimental-strip-types --test ~/.pi/agent/claude-home/patches/pi-code/zzzzzzzzzzz-subagent-routing/setup-ui.test.ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fleetTestEnv } from '../subagent-panel/setup.ts'

const { ext } = fleetTestEnv('routing-ui-')
const { SetupComponent } = await import(`${ext}/subagent/routing/setup-ui.ts`)

const UP = '\x1b[A'
const DOWN = '\x1b[B'
const ENTER = '\r'
const ESC = '\x1b'
const models = [
  { key: 'a/haiku', levels: ['low', 'medium'] },
  { key: 'a/sonnet', levels: ['low', 'medium', 'high', 'xhigh'] },
  { key: 'a/odd', levels: ['xhigh'] },
]
function open(current?: unknown) {
  const results: unknown[] = []
  let renders = 0
  const c = new SetupComponent({ models, current, done: (p: unknown) => results.push(p), requestRender: () => void renders++ })
  const press = (...keys: string[]) => keys.forEach((k) => c.handleInput(k))
  return { c, results, press, renders: () => renders }
}

test('passo 1 sem marcação recusa; marcar, navegar e confirmar leva ao passo 2 com os esforços padrão', () => {
  const { c, press, results } = open()
  press(ENTER)
  assert.match(c.render(80).join('\n'), /Mark at least one model/)
  press(DOWN, ' ', DOWN, DOWN, UP, UP, ' ', ' ') // marca sonnet, depois marca e desmarca haiku
  assert.match(c.render(80)[2]!, /^> \[ \] a\/haiku/)
  press(ENTER)
  assert.match(c.render(80)[0]!, /Efforts for a\/sonnet \(1\/1\)/)
  assert.match(c.render(80).join('\n'), /\[x\] low[\s\S]*\[x\] medium[\s\S]*\[x\] high[\s\S]*\[ \] xhigh/)
  press(ENTER)
  assert.deepEqual(results, [{ version: 1, models: { 'a/sonnet': ['low', 'medium', 'high'] } }])
})

test('passo 2: um modelo por página, política atual pré-marcada, ao menos um esforço, modelo sem níveis padrão leva todos', () => {
  const { c, press, results } = open({ version: 1, models: { 'a/haiku': ['medium'] } })
  press(DOWN, DOWN, ' ', ENTER) // marca também a/odd
  assert.match(c.render(80)[0]!, /a\/haiku \(1\/2\)/)
  assert.match(c.render(80).join('\n'), /\[ \] low[\s\S]*\[x\] medium/)
  press(DOWN, ' ', ' ') // medium continua marcado, low desmarcado
  press(UP, ' ', ' ')
  press(' ') // low marcado
  press(DOWN, ' ') // desmarca medium
  press(UP, ' ') // desmarca low: nenhum
  press(ENTER)
  assert.match(c.render(80).join('\n'), /Mark at least one effort/)
  press(' ', ENTER)
  assert.match(c.render(80)[0]!, /a\/odd \(2\/2\)/)
  assert.match(c.render(80).join('\n'), /\[x\] xhigh/)
  press(ENTER)
  assert.deepEqual(results, [{ version: 1, models: { 'a/haiku': ['low'], 'a/odd': ['xhigh'] } }])
})

test('esc cancela sem gravar; liberação de tecla e tecla desconhecida são ignoradas; renderiza truncado', () => {
  const { c, press, results, renders } = open()
  const before = renders()
  c.handleInput('\x1b[32;1:3u') // release (kitty)
  press('z')
  assert.equal(renders(), before)
  press(ESC)
  assert.deepEqual(results, [undefined])
  // eslint-disable-next-line no-control-regex
  assert.ok(c.render(10).every((l: string) => l.replace(/\x1b\[[0-9;]*m/g, '').length <= 10))
  c.invalidate()
})

// Testes de ~/.pi/agent/extensions/pi-docs/index.ts.
// Rodar: node --experimental-strip-types --test ~/.pi/agent/extensions/pi-docs/index.test.ts
import { strict as assert } from 'node:assert'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { apply, setMode, wantFull } from './index.ts'

const home = mkdtempSync(join(tmpdir(), 'pi-docs-home-'))
const dir = (name: string, pkg?: string) => {
  const d = join(home, name)
  mkdirSync(d, { recursive: true })
  if (pkg) writeFileSync(join(d, 'package.json'), pkg)
  return d
}
const other = mkdtempSync(join(tmpdir(), 'pi-docs-other-'))

test('wantFull: on/off e auto', () => {
  assert.equal(wantFull('on', other, home), true)
  assert.equal(wantFull('off', home, home), false)
  assert.equal(wantFull('auto', home, home), true)
  assert.equal(wantFull('auto', join(home, '.pi', 'agent', 'x'), home), true)
  assert.equal(wantFull('auto', dir('p1', '{"keywords":["pi-package"]}'), home), true)
  assert.equal(wantFull('auto', dir('p2', '{"dependencies":{"@earendil-works/pi-coding-agent":"1"}}'), home), true)
  assert.equal(wantFull('auto', dir('p3', '{"name":"x"}'), home), false)
  assert.equal(wantFull('auto', other, home), false)
})

const prompt = 'x\n- Main documentation: /pi/README.md\n- Additional docs: /pi/docs\n- Examples: /pi/examples (ext)\n'
const ev = (extra = {}) => ({ systemPrompt: prompt, systemPromptOptions: { sections: {} as Record<string, string | undefined>, ...extra } })

test('handler: compacta fora do pi e restaura quando completo', () => {
  setMode('auto')
  const e = ev()
  assert.equal(apply(e, other, home), true)
  assert.equal(e.systemPromptOptions.sections.docs, 'Pi docs live in /pi/docs (README at /pi/README.md, examples at /pi/examples); read them only when the task is about pi itself.')
  assert.equal(apply(e, home, home), false) // cwd = home: completa, apaga a nossa seção
  assert.equal('docs' in e.systemPromptOptions.sections, false)
})

test('handler: customPrompt intacto; turno seguinte (prompt já compacto) continua compacto', () => {
  setMode('off')
  const c = ev({ customPrompt: 'mine' })
  assert.equal(apply(c, other, home), false)
  assert.deepEqual(c.systemPromptOptions.sections, {})
  const n = { systemPrompt: 'prompt sem os caminhos', systemPromptOptions: { sections: {} as Record<string, string | undefined> } }
  assert.equal(apply(n, other, home), true) // memo: sem isso a seção alternaria entre turnos
  assert.match(n.systemPromptOptions.sections.docs ?? '', /^Pi docs live in \/pi\/docs/)
  setMode('auto')
})

test('extensão: before_agent_start e /pi-docs', async () => {
  const { default: ext, getMode } = await import('./index.ts')
  const h: Record<string, Function> = {}
  let cmd: { handler: Function } | undefined
  ext({ on: (n: string, f: Function) => (h[n] = f), registerCommand: (_: string, c: { handler: Function }) => (cmd = c) } as never)
  const notes: string[] = []
  const ctx = { cwd: other, ui: { notify: (m: string) => notes.push(m) } }
  const e = ev()
  assert.equal(h.before_agent_start(e, ctx), undefined)
  assert.match(e.systemPromptOptions.sections.docs ?? '', /^Pi docs live in/)
  await cmd!.handler('on', ctx)
  assert.equal(getMode(), 'on')
  await cmd!.handler('bogus', ctx)
  await cmd!.handler('', ctx)
  assert.deepEqual(notes, ['pi-docs: on (full docs section)', 'Usage: /pi-docs on|off|auto', 'pi-docs: on (full docs section)'])
  setMode('auto')
})

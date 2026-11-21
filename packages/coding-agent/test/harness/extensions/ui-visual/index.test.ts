// node --experimental-strip-types --test ~/.pi/agent/extensions/ui-visual/test/index.test.ts
import assert from 'node:assert/strict'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

// Cópia com o pi ao lado: o Node não resolve @earendil-works a partir de extensions/.
const tmp = mkdtempSync(join(tmpdir(), 'ui-visual-index-'))
for (const d of ['node_modules', 'ui-visual', 'ui']) mkdirSync(join(tmp, d))
symlinkSync(`${homedir()}/.pi/agent/install/releases/${readFileSync(`${homedir()}/.pi/agent/install/current-version`, 'utf8').trim()}/node_modules/@earendil-works`, join(tmp, 'node_modules', '@earendil-works'))
for (const f of ['index.ts', 'header.ts', 'icons.ts', 'tools.ts', 'working.ts']) cpSync(join(import.meta.dirname, '..', f), join(tmp, 'ui-visual', f))
cpSync(join(import.meta.dirname, '..', '..', 'ui', 'a11y.ts'), join(tmp, 'ui', 'a11y.ts'))
const { default: index } = await import(join(tmp, 'ui-visual', 'index.ts'))

test('index liga indicador, cabeçalho e renderizadores, sem registerTool', () => {
  const saved = process.env.PI_CODE_SUBAGENT
  delete process.env.PI_CODE_SUBAGENT
  const events: string[] = []
  const calls: string[] = []
  index({
    on: (name: string) => events.push(name),
    registerToolRenderer: () => calls.push('registerToolRenderer'),
    registerTool: () => calls.push('registerTool'),
  })
  if (saved !== undefined) process.env.PI_CODE_SUBAGENT = saved
  assert.deepEqual(calls, ['registerToolRenderer'])
  for (const e of ['session_start', 'agent_start', 'agent_settled', 'tool_execution_start', 'tool_execution_end']) assert.ok(events.includes(e), e)
})

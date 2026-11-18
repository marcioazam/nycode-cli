// node --experimental-strip-types --test ~/.pi/agent/extensions/bash-timeout/index.test.ts
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import ext, { DEFAULT_S, decide, MAX_S, wrapForBackground } from './index.ts'

test('sem timeout, inválido ou não-número vira o padrão', () => {
  for (const v of [undefined, 0, -5, Number.NaN, Number.POSITIVE_INFINITY, '30', null]) {
    assert.deepEqual(decide(v), { timeout: DEFAULT_S })
  }
})

test('timeout dentro do teto passa intacto', () => {
  assert.deepEqual(decide(5), { timeout: 5 })
  assert.deepEqual(decide(MAX_S), { timeout: MAX_S })
})

test('acima do teto vira o teto (o comando roda; recusar descartava a chamada inteira)', () => {
  assert.deepEqual(decide(MAX_S + 1), { timeout: MAX_S })
  assert.deepEqual(decide(9000), { timeout: MAX_S })
})

function run(toolName: string, input: Record<string, unknown>) {
  let handler = (_e: unknown): unknown => undefined
  ext({
    on: (name: string, h: typeof handler) => {
      if (name === 'tool_call') handler = h
    },
  } as never)
  const out = handler({ toolName, input })
  return { out, input }
}

test('só mexe no bash', () => {
  const { out, input } = run('read', { path: 'x' })
  assert.equal(out, undefined)
  assert.deepEqual(input, { path: 'x' })
})

test('bash sem timeout recebe o padrão', () => {
  const { out, input } = run('bash', { command: 'ls' })
  assert.equal(out, undefined)
  assert.equal(input.timeout, DEFAULT_S)
})

test('bash acima do teto roda com o teto', () => {
  const { out, input } = run('bash', { command: 'sleep 9000', timeout: 9000 })
  assert.equal(out, undefined)
  assert.equal(input.timeout, MAX_S)
})

function result(event: Record<string, unknown>) {
  let handler = (_e: unknown): { content: { text: string }[] } | undefined => undefined
  ext({
    on: (name: string, h: typeof handler) => {
      if (name === 'tool_result') handler = h
    },
  } as never)
  return handler(event)
}

test('timeout do bash ganha a dica de rodar em segundo plano (o pi só diz quanto esperou)', () => {
  const out = result({
    toolName: 'bash',
    isError: true,
    content: [{ type: 'text', text: 'parcial\n\nCommand timed out after 1800 seconds' }],
  })
  const text = (out?.content ?? []).map((c) => c.text).join('')
  assert.match(text, /Command timed out after 1800 seconds/)
  assert.match(text, new RegExp(`${MAX_S} s`))
  assert.match(text, /nohup/)
  assert.match(text, /while kill -0 \S+ 2>\/dev\/null; do sleep \d+; done/) // espera que volta quando o job acaba
  assert.doesNotMatch(text, /\bpoll\b/)
})

test('resultado sem timeout, de outra ferramenta ou sem erro fica intacto', () => {
  const text = [{ type: 'text', text: 'Command timed out after 5 seconds' }]
  assert.equal(result({ toolName: 'bash', isError: true, content: [{ type: 'text', text: 'exit 1' }] }), undefined)
  assert.equal(result({ toolName: 'read', isError: true, content: text }), undefined)
  assert.equal(result({ toolName: 'bash', isError: false, content: text }), undefined)
})

// --- O4: PI_BASH_TIMEOUT_BG (segundo plano no timeout) ---

const bgDir = mkdtempSync(join(tmpdir(), 'pibg-test-'))
const wrap = (cmd: string, secs: number, id: string) => wrapForBackground(cmd, secs, id, bgDir)
const sh = (shell: string, script: string) => spawnSync(shell, ['-c', script], { encoding: 'utf8', timeout: 20000 })
const sleepMs = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
const shells = ['sh', 'dash', 'bash'].filter((s) => spawnSync('sh', ['-c', `command -v ${s}`]).status === 0)

for (const shell of shells) {
  test(`bg[${shell}]: comando rápido mantém saída e exit code (0 e 3)`, () => {
    for (const code of [0, 3]) {
      const cmd = `echo out; echo err >&2; exit ${code}`
      const plain = sh(shell, cmd)
      const wrapped = sh(shell, wrap(cmd, 5, `fast${code}`))
      assert.equal(wrapped.status, code)
      assert.equal(wrapped.status, plain.status)
      assert.equal(wrapped.stdout, 'out\nerr\n') // stderr entra na saída (4)
      assert.equal(wrapped.stderr, '')
    }
  })

  test(`bg[${shell}]: heredoc e aspas simples/duplas`, () => {
    const cmd = `cat <<'EOF'\n$HOME "dq" 'sq'\nEOF\necho "a b" 'c d'`
    const r = sh(shell, wrap(cmd, 5, 'quotes'))
    assert.equal(r.stdout, `$HOME "dq" 'sq'\na b c d\n`)
    assert.equal(r.status, 0)
  })

  test(`bg[${shell}]: estouro do tempo deixa o comando vivo e informa pid e log`, () => {
    const t0 = Date.now()
    const r = sh(shell, wrap('echo start; sleep 2; echo done', 1, `slow-${shell}`))
    const dt = Date.now() - t0
    assert.equal(r.status, 0)
    assert.ok(dt >= 900 && dt < 1900, `voltou em ${dt} ms`)
    const m = /pid (\d+), log ([^)]+)\)/.exec(r.stdout)
    assert.ok(m, r.stdout)
    assert.match(r.stdout, /start/)
    assert.match(r.stdout, /Still running after 1 s/)
    const pid = Number(m[1])
    try {
      process.kill(pid, 0) // ainda vivo depois que o shell saiu
      // a espera sugerida na mensagem volta quando o job acaba, sem sono fixo longo
      const w = /To wait for it, use: (.+?) \(returns/.exec(r.stdout)
      assert.ok(w, r.stdout)
      const t1 = Date.now()
      assert.equal(sh(shell, w[1]).status, 0)
      assert.ok(Date.now() - t1 < 4000, `espera levou ${Date.now() - t1} ms`)
      assert.match(readFileSync(m[2], 'utf8'), /start\ndone\n/)
    } finally {
      try {
        process.kill(pid)
      } catch {}
    }
  })
}

test('bg: sem as shells de teste, registro', (t) => {
  if (!shells.includes('dash')) t.diagnostic('dash ausente: casos 1 e 3 só com sh')
})

function hook(input: Record<string, unknown>, id = 'call:1/x') {
  let handler = (_e: unknown): unknown => undefined
  ext({
    on: (name: string, h: typeof handler) => {
      if (name === 'tool_call') handler = h
    },
  } as never)
  handler({ toolName: 'bash', toolCallId: id, input })
  return input
}

test('bg: env desligada não altera o comando', () => {
  delete process.env.PI_BASH_TIMEOUT_BG
  const input = hook({ command: 'ls', timeout: 30 })
  assert.deepEqual(input, { command: 'ls', timeout: 30 })
})

test('bg: env ligada embrulha, soma 60 s e respeita & final e sleep', () => {
  process.env.PI_BASH_TIMEOUT_BG = '1'
  try {
    const a = hook({ command: 'make all', timeout: 30 })
    assert.match(String(a.command), /make all/)
    assert.match(String(a.command), /pi-bg\/call_1_x\.log/)
    assert.equal(a.timeout, 90)
    assert.equal(hook({}).command, undefined)
    assert.equal(hook({ command: 'srv &' }).command, 'srv &')
    assert.equal(hook({ command: 'sleep 5; echo' }).command, 'sleep 5; echo')
    assert.equal(hook({ command: 'make' }).timeout, DEFAULT_S + 60)
  } finally {
    delete process.env.PI_BASH_TIMEOUT_BG
  }
})

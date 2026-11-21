// Testes do zzzzzzzzzzzzzz-onda5-viewer.patch: node --experimental-strip-types --test ~/.pi/agent/claude-home/patches/pi-code/zzzzzzzzzzzzzz-onda5-viewer.test.ts
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

const HOME = homedir()
const PATCH = new URL('../zzzzzzzzzzzzzz-onda5-viewer.patch', import.meta.url).pathname
const EXT = `${HOME}/.pi/agent/npm/node_modules/pi-code/extensions`
// O Node não tira tipos de .ts dentro de node_modules: testa uma cópia do pacote (pilha atual) com o patch por cima.
const tmp = mkdtempSync(join(tmpdir(), 'onda5-viewer-test-'))
const ext = join(tmp, 'extensions')
cpSync(EXT, ext, { recursive: true })
mkdirSync(join(tmp, 'node_modules'))
symlinkSync(`${HOME}/.pi/agent/install/releases/${readFileSync(`${HOME}/.pi/agent/install/current-version`, 'utf8').trim()}/node_modules/@earendil-works`, join(tmp, 'node_modules', '@earendil-works'))

const applied = (() => {
  try {
    execFileSync('patch', ['-d', ext, '-p1', '-R', '-s', '--dry-run', '-i', PATCH], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()
if (!applied) {
  execFileSync('patch', ['-d', ext, '-p1', '-N', '-s', '--dry-run', '-i', PATCH])
  execFileSync('patch', ['-d', ext, '-p1', '-N', '-s', '--no-backup-if-mismatch', '-i', PATCH])
}

test('patch aplica sobre a pilha atual (ou já está aplicado) e reverte', () => {
  execFileSync('patch', ['-d', ext, '-p1', '-R', '-s', '--dry-run', '-i', PATCH])
})

const viewer = await import(`${ext}/subagent/fleet-ui/viewer.ts`)
const label = await import(`${ext}/subagent/fleet-ui/runtime-label.ts`)
const { visibleWidth } = await import(`${tmp}/node_modules/@earendil-works/pi-tui/dist/index.js`)

const NOW = 1_000_000
const theme = { fg: (_c: string, s: string) => s, bold: (s: string) => s }
const tag = { fg: (c: string, s: string) => `<${c}>${s}</${c}>`, bold: (s: string) => `*${s}*` }
const rec = (id: string, parentId: string | null, depth: number, over: Record<string, unknown> = {}) =>
  ({
    v: 1, id, parentId, depth, agent: id, task: 't', background: false, state: 'running', startedAt: NOW - 73_000, updatedAt: NOW, turns: 1, toolCalls: 1,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, context: 1000 }, cost: 0.004, ownerPid: 1, model: 'm1', provider: 'fake', effort: 'medium', modelSeen: true, effortSeen: true, ...over,
  }) as any

test('cabeçalho: rodando, com irmãos e filhos', () => {
  const rs = [rec('worker', null, 1), rec('gate', null, 1, { startedAt: NOW }), rec('kid', 'worker', 2)]
  const [l1, l2] = viewer.headerLines(rs, 'worker', NOW, theme, 100)
  assert.match(l1, /^main › worker +● rodando · 1m 13s · 1\.0k tok · \S*0[.,]00?4?/)
  assert.equal(visibleWidth(l1), 100)
  assert.equal(l2, 'fake/m1 · medium · ao lado: gate · filhos: kid')
  assert.ok(!/observed|children:|\(observed\)/.test(l1 + l2))
  const [t1] = viewer.headerLines(rs, 'worker', NOW, tag, 100)
  assert.ok(t1.startsWith('*main › worker*') && t1.includes('<accent>● rodando</accent><dim> · '))
})

test('cabeçalho: concluído, sem irmãos nem filhos, valores configurados e desconhecidos', () => {
  const [l1, l2] = viewer.headerLines([rec('solo', null, 1, { state: 'done', endedAt: NOW - 3000, modelSeen: false })], 'solo', NOW, theme, 90)
  assert.match(l1, /✓ concluído · 1m 10s · /)
  assert.equal(l2, 'fake/m1 (configurado) · medium')
  const [, u] = viewer.headerLines([rec('u', null, 1, { model: undefined, provider: undefined, effort: undefined })], 'u', NOW, theme, 90)
  assert.equal(u, 'ainda não informado · ainda não informado')
  assert.equal(viewer.stateLabel('failed'), '✗ falhou')
  assert.equal(viewer.stateLabel('cancelled'), '■ parado')
  assert.equal(label.runtimeSummary(rec('x', null, 1, { effortSeen: false })), 'fake/m1 · medium (configurado)')
})

test('cabeçalho: largura estreita corta o caminho com reticências, nunca o estado', () => {
  const rs = [rec('a-very-long-agent-name', null, 1)]
  for (const w of [60, 45, 40, 30]) {
    const [l1, l2] = viewer.headerLines(rs, 'a-very-long-agent-name', NOW, theme, w)
    assert.ok(visibleWidth(l1) <= w && visibleWidth(l2) <= w, `largura ${w}`)
    assert.ok(l1.includes('● rodando'), `estado visível em ${w}: ${l1}`)
  }
  assert.ok(viewer.headerLines(rs, 'a-very-long-agent-name', NOW, theme, 45)[0].includes('…'))
  const [gone] = viewer.headerLines([], 'nope', NOW, theme, 60)
  assert.equal(gone, 'main › (agente não encontrado)')
})

test('dicas condicionais', () => {
  const alone = [rec('a', null, 1)]
  assert.equal(viewer.hintLine(alone, 'a', false).text, '↑↓ rolar · ⏎ enviar · x x parar · esc fechar')
  const tree = [rec('a', null, 1), rec('b', null, 1, { startedAt: NOW }), rec('k', 'a', 2)]
  assert.equal(viewer.hintLine(tree, 'a', false).text, '↑↓ rolar · ←→ outro agente · tab filho · ⏎ enviar · x x parar · esc fechar')
  assert.equal(viewer.hintLine(tree, 'k', false).text, '↑↓ rolar · ⇧tab pai · ⏎ enviar · x x parar · esc fechar')
  const done = [rec('a', null, 1, { state: 'done' })]
  assert.equal(viewer.hintLine(done, 'a', false).text, '↑↓ rolar · esc fechar')
  const bg = [rec('a', null, 1, { state: 'done', background: true })]
  assert.equal(viewer.hintLine(bg, 'a', false).text, '↑↓ rolar · ⏎ enviar · esc fechar', 'pai pode retomar')
  const armed = viewer.hintLine(alone, 'a', true)
  assert.deepEqual(armed, { text: '▲ x de novo para parar a · o trabalho em andamento se perde · esc fecha', warn: true })
})

function viewerOf(records: any[], clock = { now: NOW }) {
  const src = { list: () => records, readTranscript: () => ({ items: [], next: 0 }), onChange: () => () => {}, send: () => 'queued', stop: () => 'stopping' }
  const v = new viewer.ViewerComponent({ source: src, theme: tag, id: records[0].id, done: () => {}, requestRender: () => {}, rows: () => 20, now: () => clock.now, poll: false })
  return { v, clock }
}

test('render: ❯ accent, placeholder em dim, estado armado na linha de dicas', () => {
  const { v, clock } = viewerOf([rec('a', null, 1)])
  let lines = v.render(80)
  assert.equal(lines.at(-2), '<accent>❯</accent> <dim>Mensagem para este agente</dim>')
  assert.ok(lines.at(-1)!.startsWith('<dim>↑↓ rolar'))
  v.input = 'oi'
  assert.equal(v.render(80).at(-2), '<accent>❯</accent> oi')
  v.input = ''
  v.handleInput('x')
  assert.equal(v.outcome, '')
  lines = v.render(120)
  assert.equal(lines.at(-1), '<warning>▲ x de novo para parar a · o trabalho em andamento se perde · esc fecha</warning>')
  clock.now += 5000
  assert.ok(v.render(120).at(-1)!.startsWith('<dim>↑↓ rolar'), 'o armado expira')
})

test('render: terminado fica somente leitura, com o motivo em português e sem placeholder', () => {
  const { v } = viewerOf([rec('a', null, 1, { state: 'done' })])
  const lines = v.render(80)
  assert.equal(lines.at(-3), '<dim>somente leitura: o agente já terminou</dim>')
  assert.equal(lines.at(-2), '<accent>❯</accent> ')
  v.handleInput('x')
  assert.equal(v.outcome, 'o agente já terminou; nada a parar')
})

test('textos de envio e do navegador em português; a lógica não muda', async () => {
  assert.equal(viewer.sendOutcomeText('queued'), '↪ enviada; o agente lê depois do passo atual')
  assert.equal(viewer.sendOutcomeText('unknown'), 'agente não encontrado')
  const notes: unknown[][] = []
  await viewer.openTasksBrowser({ hasUI: true, ui: { notify: (...a: unknown[]) => notes.push(a) } }, { list: () => [] })
  assert.deepEqual(notes, [['Nenhum agente nesta sessão.', 'info']])
})

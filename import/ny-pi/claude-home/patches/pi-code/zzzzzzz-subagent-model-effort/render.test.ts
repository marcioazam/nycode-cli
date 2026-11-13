// Modelo e esforço na lista e no viewer (docs/subagent-model-effort.md, AC1-AC3, AC6): node --experimental-strip-types --test ~/.pi/agent/claude-home/patches/pi-code/zzzzzzz-subagent-model-effort/render.test.ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fleetTestEnv } from '../subagent-panel/setup.ts'

const { ext } = fleetTestEnv('fleet-model-effort-render-')
const vm = await import(`${ext}/subagent/fleet-ui/view-model.ts`)
const panel = await import(`${ext}/subagent/fleet-ui/panel.ts`)
const viewer = await import(`${ext}/subagent/fleet-ui/viewer.ts`)
const label = await import(`${ext}/subagent/fleet-ui/runtime-label.ts`)
const palette = await import(`${ext}/subagent/fleet-ui/palette.ts`)
await palette.ready
const { visibleWidth } = await import(`${ext}/../node_modules/@earendil-works/pi-tui/dist/index.js`)

const NOW = 1_000_000
const theme = { fg: (_c: string, s: string) => s, bold: (s: string) => s }
const ansiTheme = { fg: (c: string, s: string) => `\u001b[3${c.length % 8}m${s}\u001b[0m`, bold: (s: string) => `\u001b[1m${s}\u001b[22m` }
const strip = (s: string): string => s.replace(/\u001b\[[0-9;]*m/g, '')
const WIDTHS = [20, 40, 80, 160]

const rec = (over: Record<string, unknown> = {}) =>
  ({
    v: 1, id: 'a', parentId: null, depth: 1, agent: 'swarm-worker', task: 'implement the feature', background: false, state: 'running',
    startedAt: NOW - 60_000, updatedAt: NOW, turns: 1, toolCalls: 1,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, context: 114_400 }, cost: 1.234, ownerPid: 1, activity: 'Reading files', ...over,
  }) as any
// /tasks mode (panel:false) lists finished runs too; panel mode hides `done`.
const rowOf = (r: any) => vm.buildRows([r], { now: NOW, panel: false })[0]
const render = (r: any, width: number, t: any = theme) => panel.renderRow(rowOf(r), false, t, width)

const OBSERVED = { provider: 'anthropic', model: 'claude-sonnet-5-5', effort: 'medium', modelSeen: true, effortSeen: true }

test('lista a 160 colunas: provedor/modelo completo e esforço, antes da tarefa', () => {
  const out = render(rec(OBSERVED), 160)
  assert.ok(out.includes('swarm-worker [anthropic/claude-sonnet-5-5 · medium]'), out)
  assert.ok(out.indexOf('[anthropic') < out.indexOf('implement the feature'))
  assert.ok(out.includes('114.4k tok') && out.includes('$1.23'))
})

test('lista a 80 colunas mantém modelo e esforço; tarefa longa não engole a metadado', () => {
  const out = render(rec({ ...OBSERVED, task: 'x'.repeat(300) }), 80)
  assert.ok(/\[(anthropic\/)?claude-sonnet-5-5 ?· ?medium\]/.test(out), out)
  assert.ok(visibleWidth(out) <= 80)
})

test('configurado: model com provedor no id e esforço off aparecem', () => {
  const out = render(rec({ model: 'anthropic/claude-sonnet-5-5', effort: 'off' }), 160)
  assert.ok(out.includes('[anthropic/claude-sonnet-5-5 · off]'), out)
})

test('sem metadado (registro antigo ou esforço ausente): ? explícito, sem inventar medium', () => {
  for (const r of [rec(), rec({ model: 'a/b' })]) {
    const out = render(r, 160)
    assert.ok(out.includes('?'), out)
    assert.ok(!/medium|high/.test(out))
  }
  assert.ok(render(rec(), 160).includes('[? · ?]'))
  assert.ok(render(rec({ model: 'a/b' }), 160).includes('[a/b · ?]'))
})

test('larguras 20/40/80/160 com ANSI e com tema simples: nunca passa da largura, nenhum crash', () => {
  const variants = [rec(), rec(OBSERVED), rec({ ...OBSERVED, task: 'tarefa \u001b[31mvermelha\u001b[0m '.repeat(20), state: 'done' }), rec({ model: 'a'.repeat(200), effort: 'off', task: '' , activity: ''})]
  for (const r of variants) {
    for (const w of WIDTHS) {
      for (const t of [theme, ansiTheme]) {
        const out = render(r, w, t)
        assert.ok(visibleWidth(out) <= w, `${w}: ${strip(out)}`)
      }
    }
  }
})

test('candidatos: do mais largo ao mais curto, sempre entre colchetes', () => {
  const c = label.listMeta(OBSERVED)
  assert.equal(c[0], '[anthropic/claude-sonnet-5-5 · medium]')
  assert.equal(c[1], '[claude-sonnet-5-5 · medium]')
  assert.ok(c.length >= 3 && c.every((s: string) => s.startsWith('[') && s.endsWith(']')))
  assert.ok(c.every((s: string, i: number) => i === 0 || visibleWidth(s) <= visibleWidth(c[i - 1])))
  assert.deepEqual(label.listMeta({}).at(0), '[? · ?]')
  assert.equal(label.listMeta({ provider: 'openrouter', model: 'anthropic/x', effort: 'low' })[0], '[openrouter/anthropic/x · low]')
})

test('metadado fica na lista de /tasks (buildRows com panel:false) e na linha de cada grau', () => {
  const child = rec({ id: 'b', parentId: 'a', depth: 2, agent: 'child', ...OBSERVED, effort: 'high' })
  const rows = vm.buildRows([rec(), child], { now: NOW, panel: false })
  assert.equal(rows.length, 2)
  assert.ok(panel.renderRow(rows[1], false, theme, 160).includes('· high]'))
})

function viewerOf(r: any) {
  const records = [r]
  const src = { list: () => records, readTranscript: () => ({ items: [], next: 0 }), stop: () => 'stopping', send: () => 'queued', hasForeground: () => false, detachForeground: () => 0, onChange: () => () => {} }
  return new viewer.ViewerComponent({ source: src, theme, id: r.id, done() {}, requestRender() {}, rows: () => 30, now: () => NOW, poll: false })
}

const lineWith = (lines: string[], label: string) => lines.find((s: string) => s.startsWith(label))

test('viewer: linhas Model e Effort separadas, com origem observed', () => {
  const lines = viewerOf(rec(OBSERVED)).render(120)
  assert.equal(lineWith(lines, 'Model:'), 'Model: anthropic/claude-sonnet-5-5 (observed)')
  assert.equal(lineWith(lines, 'Effort:'), 'Effort: medium (observed)')
  assert.match(lines[2], /^● running · /, 'status intacto')
  assert.deepEqual([lines.findIndex((s: string) => s.startsWith('Model:')), lines.findIndex((s: string) => s.startsWith('Effort:'))], [4, 5], 'logo após a nav')
})

test('viewer: configurado, off, e desconhecido', () => {
  const both = (r: any) => {
    const lines = viewerOf(r).render(120)
    return [lineWith(lines, 'Model:'), lineWith(lines, 'Effort:')]
  }
  assert.deepEqual(both(rec({ model: 'a/b', effort: 'off' })), ['Model: a/b (configured)', 'Effort: off (configured)'])
  assert.deepEqual(both(rec({ model: 'a/b' })), ['Model: a/b (configured)', 'Effort: unknown (not set, child default; not reported yet)'])
  assert.deepEqual(both(rec()), ['Model: unknown (not reported yet)', 'Effort: unknown (not set, child default; not reported yet)'])
})

test('viewer: a 20/40/80 as duas linhas rotuladas continuam presentes, com o valor do esforço, mesmo com modelo longo', () => {
  const long = { provider: 'p'.repeat(60), model: 'm'.repeat(80) }
  for (const w of WIDTHS) {
    for (const effort of ['off', 'high']) {
      for (const meta of [OBSERVED, long]) {
        const lines = viewerOf(rec({ ...meta, effort, modelSeen: true, effortSeen: true })).render(w)
        assert.ok(lines.every((s: string) => visibleWidth(s) <= w), String(w))
        assert.ok(lineWith(lines, 'Model:'), `Model@${w}`)
        // The label and the value come first on the line, before the origin note that truncation cuts.
        const eff = lineWith(lines, 'Effort:')
        assert.ok(eff && eff.startsWith(`Effort: ${effort.slice(0, Math.max(0, w - 'Effort: '.length))}`), `Effort@${w}: ${eff}`)
        if (w >= 40) assert.ok(eff!.includes(`Effort: ${effort}`), `${w} ${effort}: ${eff}`)
      }
    }
  }
  assert.ok(viewerOf(rec({ ...OBSERVED, provider: 'p'.repeat(40) })).render(160).some((s: string) => s.includes('p'.repeat(40) + '/claude-sonnet-5-5')))
})

test('viewer: a altura total acompanha as linhas (CHROME_ROWS) com a linha nova', () => {
  const lines = viewerOf(rec(OBSERVED)).render(80)
  const h = Math.max(3, Math.floor(30 * 0.85) - 9)
  assert.equal(lines.length, 9 + h)
})

test('painel a 60 colunas: modelo+esforço mais curto cabe com o tempo; a tarefa trunca e as estatísticas caem', () => {
  const out = render(rec({ ...OBSERVED, effort: 'high', task: 'x'.repeat(100) }), 60)
  assert.ok(out.includes('[claude-sonnet-5-5 · high]'), out)
  assert.ok(out.includes('1m 0s') && out.includes('…'), out)
  assert.ok(!out.includes('tok') && !out.includes('$'), out)
  assert.ok(visibleWidth(out) <= 60)
})

test('painel: sempre que cabe cabeça + menor candidato + tempo, o esforço aparece (nenhum modelo de tamanho algum o perde)', () => {
  const tasks = ['', 'short', 'x'.repeat(200)]
  for (const model of ['m', 'claude-sonnet-5-5', 'z'.repeat(150)]) {
    for (const effort of ['off', 'high']) {
      for (const task of tasks) {
        const r = rec({ model, effort, task, activity: 'Reading files' })
        const shortest = label.listMeta(r).at(-1)!
        for (let w = 20; w <= 170; w++) {
          const out = render(r, w)
          assert.ok(visibleWidth(out) <= w, `${w}: ${out}`)
          if (w >= visibleWidth('○ swarm-worker') + 1 + visibleWidth(shortest) + 1 + 7) assert.ok(out.includes(`·${effort}]`) || out.includes(` ${effort}]`), `${w}/${model.length}/${task.length}: ${out}`)
        }
      }
    }
  }
})

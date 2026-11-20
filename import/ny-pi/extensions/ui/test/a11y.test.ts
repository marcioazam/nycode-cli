// node --experimental-strip-types --test ~/.pi/agent/extensions/ui/test/a11y.test.ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import a11y, { noColor, plainHeader, reducedMotion } from '../a11y.ts'

test('noColor: só valor não vazio liga', () => {
  assert.equal(noColor({}), false)
  assert.equal(noColor({ NO_COLOR: '' }), false)
  assert.equal(noColor({ NO_COLOR: '1' }), true)
})

test('reducedMotion: só "1"', () => {
  assert.equal(reducedMotion({}), false)
  assert.equal(reducedMotion({ PI_REDUCED_MOTION: '0' }), false)
  assert.equal(reducedMotion({ PI_REDUCED_MOTION: '1' }), true)
})

test('reducedMotion: NO_PROGRESS não vazio também liga', () => {
  assert.equal(reducedMotion({ NO_PROGRESS: '' }), false)
  assert.equal(reducedMotion({ NO_PROGRESS: '1' }), true)
})

function run(env: Record<string, string>, hasUI: boolean, themeResult = { success: true } as { success: boolean; error?: string }) {
  const saved = { NO_COLOR: process.env.NO_COLOR, PI_REDUCED_MOTION: process.env.PI_REDUCED_MOTION }
  delete process.env.NO_COLOR
  delete process.env.PI_REDUCED_MOTION
  Object.assign(process.env, env)
  const calls: unknown[][] = []
  let handler: any
  a11y({ on: (_n: string, h: unknown) => { handler = h } } as any)
  handler({}, {
    hasUI,
    ui: {
      getTheme: (n: string) => (themeResult.success ? { themeObject: n } : undefined),
      setTheme: (t: unknown) => (calls.push(['theme', t]), themeResult),
      setHeader: (f: unknown) => calls.push(['header', typeof f]),
      setWorkingIndicator: (o: unknown) => calls.push(['indicator', o]),
      notify: (m: string, l: string) => calls.push(['notify', l, m]),
    },
  })
  for (const [k, v] of Object.entries(saved)) v === undefined ? delete process.env[k] : (process.env[k] = v)
  return calls
}

// O pi grava em settings.json o tema trocado por nome (interactive-mode.js: setTheme(name) chama
// settingsManager.setTheme); por objeto (setThemeInstance) vale só para a sessão. Antes do conserto, uma única
// sessão com NO_COLOR deixou "theme": "mono" salvo e todas as sessões seguintes ficaram sem cor.
test('NO_COLOR aplica o tema mono só nesta sessão (objeto, não nome); falha vira aviso', () => {
  assert.deepEqual(run({ NO_COLOR: '1' }, true), [['theme', { themeObject: 'mono' }], ['header', 'function']])
  const c = run({ NO_COLOR: '1' }, true, { success: false, error: 'x' })
  assert.deepEqual(c[0], ['notify', 'warning', 'NO_COLOR: tema mono indisponível (tema não encontrado)'])
  assert.ok(!c.some((x) => x[0] === 'theme'), 'sem tema, nada é trocado nem gravado')
})

// Imita o BuiltInHeader do pi 1.5.2: logo com cores fixas da marca, expansível com ctrl+o, marca `onLogoClick`.
function builtIn() {
  const h = {
    onLogoClick: undefined, expanded: false, invalidated: 0,
    render: (w: number) => [`\x1b[38;2;228;138;122m\x1b[48;2;79;142;179m▀\x1b[0m v1.5.2 ${w}`, h.expanded ? 'full' : 'short'],
    setExpanded(e: boolean) { h.expanded = e },
    invalidate() { h.invalidated++ },
  }
  return h
}
const tuiWith = (header: unknown) => ({ children: [{ children: [{ render: () => [] }, header] }, { render: () => [] }] })

test('plainHeader: tira as cores do cabeçalho embutido e repassa expandir/invalidar', () => {
  const inner = builtIn()
  const h = plainHeader(tuiWith(inner))
  assert.deepEqual(h.render(80), ['▀ v1.5.2 80', 'short'])
  h.setExpanded(true)
  assert.deepEqual(h.render(80), ['▀ v1.5.2 80', 'full'])
  h.invalidate()
  assert.equal(inner.invalidated, 1)
  assert.equal('handleMouse' in h, false) // sem easter egg 3D colorido
})

test('plainHeader: no /reload acha o embutido atrás do wrapper anterior', () => {
  const inner = builtIn()
  const again = plainHeader(tuiWith(plainHeader(tuiWith(inner))))
  again.setExpanded(true)
  assert.equal(inner.expanded, true)
  assert.deepEqual(again.render(10), ['▀ v1.5.2 10', 'full'])
})

test('plainHeader: sem cabeçalho embutido (startup silenciado) não desenha nada', () => {
  const h = plainHeader({ children: [{ children: [] }] })
  assert.deepEqual(h.render(80), [])
  h.setExpanded(true)
  h.invalidate()
})

test('PI_REDUCED_MOTION troca o indicador por um quadro estático', () => {
  assert.deepEqual(run({ PI_REDUCED_MOTION: '1' }, true), [['indicator', { frames: ['●'] }]])
})

test('sem UI ou sem env não faz nada', () => {
  assert.deepEqual(run({ NO_COLOR: '1' }, false), [])
  assert.deepEqual(run({}, true), [])
})

// node --experimental-strip-types --test ~/.pi/agent/extensions/ui/test/editor.test.ts
import assert from 'node:assert/strict'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

// O Node não tira tipos de .ts dentro de node_modules: testa uma cópia do módulo, com o pi ao lado.
const tmp = mkdtempSync(join(tmpdir(), 'ui-editor-test-'))
mkdirSync(join(tmp, 'node_modules'))
const version = readFileSync(`${homedir()}/.pi/agent/install/current-version`, 'utf8').trim()
symlinkSync(`${homedir()}/.pi/agent/install/releases/${version}/node_modules/@earendil-works`, join(tmp, 'node_modules', '@earendil-works'))
cpSync(new URL('../editor.ts', import.meta.url), join(tmp, 'editor.ts'))
cpSync(new URL('../history.ts', import.meta.url), join(tmp, 'history.ts'))
const m = await import(join(tmp, 'editor.ts'))

test('readState tolera ausente, corrompido e não-objeto; mergeState preserva chaves', () => {
  const p = join(tmp, 'state', 'ui-state.json')
  assert.deepEqual(m.readState(p), {})
  m.mergeState({ vim: true }, p)
  writeFileSync(p, JSON.stringify({ vim: true, outra: 1 }))
  m.mergeState({ vim: false }, p)
  assert.deepEqual(m.readState(p), { vim: false, outra: 1 })
  writeFileSync(p, '{corrompido')
  assert.deepEqual(m.readState(p), {})
  writeFileSync(p, '[1]')
  assert.deepEqual(m.readState(p), {})
})

test('nameLabel', () => {
  assert.equal(m.nameLabel(undefined, 80), undefined)
  assert.equal(m.nameLabel('nome', 10), undefined)
  const fit = m.nameLabel('nome', 80)
  assert.equal(fit.label, ' nome ')
  assert.equal(fit.rest, 80 - 6 - 3)
})

test('vimStep: transições', () => {
  assert.deepEqual(m.vimStep('insert', '\x1b'), { mode: 'normal', send: [] })
  assert.deepEqual(m.vimStep('normal', '\x1b'), { mode: 'normal', send: ['\x1b'] })
  assert.deepEqual(m.vimStep('insert', 'a'), { mode: 'insert', send: ['a'] })
  assert.deepEqual(m.vimStep('normal', 'i'), { mode: 'insert', send: [] })
  assert.deepEqual(m.vimStep('normal', 'a'), { mode: 'insert', send: ['\x1b[C'] })
  for (const [k, seq] of Object.entries(m.NORMAL_KEYS)) assert.deepEqual(m.vimStep('normal', k), { mode: 'normal', send: [seq] })
  assert.deepEqual(m.vimStep('normal', 'z'), { mode: 'normal', send: [] })
  assert.deepEqual(m.vimStep('normal', '\x03'), { mode: 'normal', send: ['\x03'] })
})

const theme = { borderColor: (s: string) => s, selectList: {} }
const kb = { matches: () => false }
const tui = { requestRender() {}, terminal: { rows: 24, columns: 80 } }
function editor(vim: { enabled: boolean }, name?: string) {
  const e = new m.UiEditor(tui, theme, kb, vim, () => name)
  const submitted: string[] = []
  e.onSubmit = (t: string) => submitted.push(t)
  return { e, submitted }
}

test('? com editor vazio abre /hotkeys; com texto digita', () => {
  const { e, submitted } = editor({ enabled: false })
  e.handleInput('?')
  assert.deepEqual(submitted, ['/hotkeys'])
  e.handleInput('x')
  e.handleInput('?')
  assert.equal(e.getText(), 'x?')
  assert.deepEqual(submitted, ['/hotkeys'])
})

test('vim: Esc → normal, x apaga, i volta, indicador na borda; desligado sem indicador', () => {
  const vim = { enabled: true }
  const { e } = editor(vim)
  for (const c of 'abc') e.handleInput(c)
  e.handleInput('\x1b')
  assert.equal(e.mode, 'normal')
  assert.ok(e.render(40).at(-1).includes('NORMAL'))
  e.handleInput('0')
  e.handleInput('x')
  assert.equal(e.getText(), 'bc')
  e.handleInput('z')
  assert.equal(e.getText(), 'bc')
  e.handleInput('?') // em normal, ? não abre hotkeys
  e.handleInput('i')
  assert.ok(e.render(40).at(-1).includes('INSERT'))
  vim.enabled = false
  e.handleInput('\x1b')
  assert.equal(e.mode, 'insert')
  assert.ok(!e.render(40).at(-1).includes('INSERT'))
})

test('borda superior mostra o nome da sessão quando cabe', () => {
  assert.ok(editor({ enabled: false }, 'minha-sessao').e.render(60)[0].includes('minha-sessao'))
  assert.ok(!editor({ enabled: false }).e.render(60)[0].includes('minha-sessao'))
})

function setup(opts: { hasUI?: boolean; other?: boolean } = {}) {
  const handlers: Record<string, any> = {}
  const cmds: Record<string, any> = {}
  const notes: string[] = []
  let factory: any
  let renders = 0
  let named: string | undefined
  m.default({
    on: (n: string, h: unknown) => { handlers[n] = h },
    registerCommand: (n: string, c: unknown) => { cmds[n] = c },
    setSessionName: (n: string) => { named = n },
    getSessionName: () => named,
  })
  const ctx = {
    hasUI: opts.hasUI ?? true,
    ui: {
      getEditorComponent: () => (opts.other ? () => ({}) : undefined),
      setEditorComponent: (f: unknown) => { factory = f },
      notify: (msg: string, l: string) => notes.push(`${l}:${msg}`),
    },
  }
  return { handlers, cmds, notes, ctx, factory: () => factory, renders: () => renders, named: () => named }
}

test('/rename define e mostra o nome', async () => {
  const s = setup()
  await s.cmds.rename.handler(' novo ', s.ctx)
  assert.equal(s.named(), 'novo')
  await s.cmds.rename.handler('', s.ctx)
  assert.deepEqual(s.notes, ['info:Sessão renomeada: novo', 'info:Sessão: novo'])
  const t = setup()
  await t.cmds.rename.handler('', t.ctx)
  assert.match(t.notes[0], /sem nome/)
})

test('/vim: indisponível sem editor próprio; alterna, persiste e instala o editor', async () => {
  const file = join(tmp, 'vim-state.json')
  process.env.PI_UI_STATE = file
  try {
    const noEd = setup({ other: true })
    noEd.handlers.session_start({}, noEd.ctx)
    await noEd.cmds.vim.handler('', noEd.ctx)
    assert.match(noEd.notes[0], /^warning:/)
    const off = setup({ hasUI: false })
    off.handlers.session_start({}, off.ctx)
    assert.equal(off.factory(), undefined)

    writeFileSync(file, JSON.stringify({ outra: 1 }))
    const s = setup()
    s.handlers.session_start({}, s.ctx)
    const ed = s.factory()(tui, theme, kb)
    assert.ok(ed instanceof m.UiEditor)
    s.handlers.session_info_changed()
    await s.cmds.vim.handler('', s.ctx)
    assert.deepEqual(m.readState(file), { outra: 1, vim: true })
    assert.match(s.notes[0], /ligado/)
    // novo session_start lê o flag persistido
    const s2 = setup()
    s2.handlers.session_start({}, s2.ctx)
    s2.factory()(tui, theme, kb).handleInput('\x1b')
    await s2.cmds.vim.handler('', s2.ctx)
    assert.equal(m.readState(file).vim, false)
    assert.match(s2.notes[0], /desligado/)
    // falha de gravação vira aviso
    process.env.PI_UI_STATE = join(file, 'x', 'y.json')
    await s2.cmds.vim.handler('', s2.ctx)
    assert.match(s2.notes[1], /^warning:ui-state/)
  } finally {
    delete process.env.PI_UI_STATE
  }
})

test('Ctrl+S: guarda, devolve e troca; borda mostra o rascunho; vale no modo normal do vim', () => {
  const vim = { enabled: true }
  const { e } = editor(vim)
  e.handleInput('\x13') // vazio sem guardado: nada
  assert.equal(e.stash, undefined)
  for (const c of 'abc') e.handleInput(c)
  e.handleInput('\x13')
  assert.equal(e.getText(), '')
  assert.equal(e.stash, 'abc')
  assert.ok(e.render(60)[0].includes('rascunho'))
  e.handleInput('\x13')
  assert.equal(e.getText(), 'abc')
  assert.equal(e.stash, undefined)
  assert.ok(!e.render(60)[0].includes('rascunho'))
  e.handleInput('\x13') // guarda
  for (const c of 'xy') e.handleInput(c)
  e.handleInput('\x1b') // modo normal
  e.handleInput('\x13') // troca
  assert.equal(e.getText(), 'abc')
  assert.equal(e.stash, 'xy')
})

test('borda: rascunho junto do nome da sessão e sem espaço em borda estreita', () => {
  const { e } = editor({ enabled: false }, 'minha-sessao')
  e.handleInput('a')
  e.handleInput('\x13')
  const top = e.render(70)[0]
  assert.ok(top.includes('minha-sessao') && top.includes('rascunho'))
  assert.ok(!e.render(14)[0].includes('rascunho'))
})

test('Ctrl+C com texto vai ao histórico (↑ devolve); vazio não adiciona', () => {
  const { e } = editor({ enabled: false })
  e.handleInput('\x03') // vazio: nada no histórico
  for (const c of 'rascunho') e.handleInput(c)
  e.handleInput('\x03') // o editor nativo do app é quem limpa; aqui o histórico já tem o texto
  e.setText('')
  e.handleInput('\x1b[A')
  assert.equal(e.getText(), 'rascunho')
})

test('Ctrl+R chama openHistory (também no vim normal); sem callback é ignorado', () => {
  const { e } = editor({ enabled: true })
  e.handleInput('\x12')
  let n = 0
  e.openHistory = () => { n++ }
  e.handleInput('\x12')
  e.handleInput('\x1b')
  e.handleInput('\x12')
  assert.equal(n, 2)
})

const flush = () => new Promise((r) => setImmediate(r))
const hist = { fg: (_c: string, s: string) => s, bg: (_c: string, s: string) => s }

function historyCtx(s: ReturnType<typeof setup>, branchText: string, sessionDir = tmp) {
  let comp: any
  let opts: any
  let finish: ((v: unknown) => void) | undefined
  s.ctx.sessionManager = {
    getBranch: () => [{ type: 'message', message: { role: 'user', content: branchText } }],
    getSessionDir: () => sessionDir,
  }
  s.ctx.ui.custom = (f: any, o: any) => new Promise((res) => {
    finish = res
    opts = o
    comp = f(tui, hist, kb, res)
  })
  return { comp: () => comp, opts: () => opts, finish: () => finish }
}

test('Ctrl+R abre o overlay com o ctx mais novo; Enter põe o prompt sem enviar; Esc não muda', async () => {
  const s = setup()
  s.handlers.session_start({}, s.ctx)
  const ed = s.factory()(tui, theme, kb)
  const submitted: string[] = []
  ed.onSubmit = (t: string) => submitted.push(t)
  const stale = historyCtx(s, 'antigo')
  s.handlers.session_start({}, s.ctx) // /new: editor já existe, ctx novo
  const h = historyCtx(s, 'do ramo atual')
  ed.handleInput('\x12')
  ed.handleInput('\x12') // reentrada ignorada
  await flush()
  assert.equal(h.opts().overlay, true)
  assert.equal(stale.comp(), undefined)
  assert.ok(h.comp().render(60).join('\n').includes('do ramo atual'))
  h.comp().handleInput('\r')
  await flush()
  assert.equal(ed.getText(), 'do ramo atual')
  assert.deepEqual(submitted, [])
  ed.setText('mantido')
  ed.handleInput('\x12')
  await flush()
  h.comp().handleInput('\x1b')
  await flush()
  assert.equal(ed.getText(), 'mantido')
})

test('Ctrl+R: falha do overlay vira aviso e libera nova abertura; sem ctx não faz nada', async () => {
  const s = setup()
  const ed0 = new m.UiEditor(tui, theme, kb, { enabled: false }, () => undefined)
  s.handlers.session_start({}, s.ctx)
  const ed = s.factory()(tui, theme, kb)
  ed.handleInput('\x12') // sem sessionManager/custom: custom lança
  await flush()
  assert.match(s.notes.at(-1), /^warning:Histórico indisponível/)
  const h = historyCtx(s, 'ok')
  ed.handleInput('\x12')
  await flush()
  assert.ok(h.comp())
  h.finish()?.(undefined)
  const bare = setup()
  bare.handlers.session_start({}, { hasUI: false })
  assert.equal(ed0.openHistory, undefined)
})

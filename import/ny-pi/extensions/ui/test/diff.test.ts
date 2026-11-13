// node --experimental-strip-types --test ~/.pi/agent/extensions/ui/test/diff.test.ts
import assert from 'node:assert/strict'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

// O Node não resolve @earendil-works a partir de extensions/: testa uma cópia com o pi ao lado.
const tmp = mkdtempSync(join(tmpdir(), 'ui-test-'))
mkdirSync(join(tmp, 'node_modules'))
symlinkSync(`${homedir()}/.pi/agent/install/releases/${readFileSync(`${homedir()}/.pi/agent/install/current-version`, 'utf8').trim()}/node_modules/@earendil-works`, join(tmp, 'node_modules', '@earendil-works'))
const load = async (name: string) => {
  cpSync(join(import.meta.dirname, '..', name), join(tmp, name))
  return import(join(tmp, name))
}
const theme = { fg: (c: string, t: string) => `<${c}>${t}`, bold: (t: string) => t, bg: (c: string, t: string) => `[${c}]${t}` }
import { execFileSync, spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'

const mod = await load('diff.ts')

const exec = async (cmd: string, args: string[], o: { cwd: string }) => {
  const r = spawnSync(cmd, args, { cwd: o.cwd, encoding: 'utf8' })
  return { stdout: r.stdout, stderr: r.stderr, code: r.status ?? 1, killed: false, truncated: false }
}
const git = (cwd: string, ...a: string[]) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { cwd, stdio: 'pipe' })

const repo = mkdtempSync(join(tmpdir(), 'ui-diff-repo-'))
git(repo, 'init', '-q')
writeFileSync(join(repo, 'a.txt'), 'um\ndois\ntres\n')
writeFileSync(join(repo, 'bin.dat'), Buffer.from([0, 1, 2]))
git(repo, 'add', '.')
git(repo, 'commit', '-qm', 'init')
writeFileSync(join(repo, 'a.txt'), 'um\nDOIS\ntres\nquatro\n')
writeFileSync(join(repo, 'bin.dat'), Buffer.from([0, 9, 9, 9]))
writeFileSync(join(repo, 'novo.txt'), 'x\ny\n')
writeFileSync(join(repo, 'novo.bin'), Buffer.from([0, 0]))

test('parseNumstat', () => {
  assert.deepEqual(mod.parseNumstat('3\t1\ta.txt\n-\t-\tb.bin\nlixo\n'), [
    { path: 'a.txt', added: 3, removed: 1, binary: false, untracked: false },
    { path: 'b.bin', added: 0, removed: 0, binary: true, untracked: false },
  ])
})

test('untrackedAsDiff e teto de linhas', () => {
  assert.match(mod.untrackedAsDiff('f', 'a\nb\n'), /@@ -0,0 \+1,2 @@\n\+a\n\+b$/)
  const big = mod.untrackedAsDiff('f', 'x\n'.repeat(2005)).split('\n')
  assert.equal(big.length, 5 + 2000 + 1)
  assert.match(big.at(-1), /truncado: 5 linhas/)
})

test('clampScroll', () => {
  assert.equal(mod.clampScroll(-3, 100, 10), 0)
  assert.equal(mod.clampScroll(95, 100, 10), 90)
  assert.equal(mod.clampScroll(5, 3, 10), 0)
})

test('collectChanges em repositório real e loadDiff', async () => {
  const res = await mod.collectChanges(exec, repo)
  assert.equal(res.hasHead, true)
  const by = Object.fromEntries(res.files.map((f: any) => [f.path, f]))
  assert.deepEqual([by['a.txt'].added, by['a.txt'].removed, by['a.txt'].untracked], [2, 1, false])
  assert.equal(by['bin.dat'].binary, true)
  assert.deepEqual([by['novo.txt'].added, by['novo.txt'].untracked, by['novo.bin'].binary], [2, true, true])
  assert.match(await mod.loadDiff(exec, repo, true, by['a.txt']), /\n-dois\n\+DOIS/)
  assert.match(await mod.loadDiff(exec, repo, true, by['novo.txt']), /\+x\n\+y/)
  assert.equal(await mod.loadDiff(exec, repo, true, by['bin.dat']), 'Arquivo binário')
  const long = { path: 'l.txt', added: 0, removed: 0, binary: false, untracked: false }
  writeFileSync(join(repo, 'l.txt'), '')
  git(repo, 'add', 'l.txt')
  git(repo, 'commit', '-qm', 'l')
  writeFileSync(join(repo, 'l.txt'), 'z\n'.repeat(2100))
  const out = (await mod.loadDiff(exec, repo, true, long)).split('\n')
  assert.match(out.at(-1), /truncado/)
})

test('repo sem HEAD usa o índice', async () => {
  const r = mkdtempSync(join(tmpdir(), 'ui-diff-nohead-'))
  git(r, 'init', '-q')
  writeFileSync(join(r, 's.txt'), 'a\n')
  git(r, 'add', 's.txt')
  writeFileSync(join(r, 'u.txt'), 'b\n')
  const res = await mod.collectChanges(exec, r)
  assert.equal(res.hasHead, false)
  assert.deepEqual(res.files.map((f: any) => f.path), ['s.txt', 'u.txt'])
  assert.match(await mod.loadDiff(exec, r, false, res.files[0]), /\+a/)
})

test('fora de git: collectChanges e comando avisam', async () => {
  const plain = mkdtempSync(join(tmpdir(), 'ui-diff-plain-'))
  assert.equal(await mod.collectChanges(exec, plain), undefined)
  const notes: any[] = []
  const cmd = register()
  await cmd.handler('', { cwd: plain, hasUI: true, ui: { notify: (...a: any[]) => notes.push(a) } })
  assert.deepEqual(notes, [['Fora de um repositório git', 'warning']])
})

function register() {
  let cmd: any
  mod.default({ exec, registerCommand: (_n: string, c: any) => (cmd = c) })
  return cmd
}

test('comando: sem mudanças, sem UI e erro', async () => {
  const clean = mkdtempSync(join(tmpdir(), 'ui-diff-clean-'))
  git(clean, 'init', '-q')
  writeFileSync(join(clean, 'f'), '1\n')
  git(clean, 'add', 'f')
  git(clean, 'commit', '-qm', 'c')
  const notes: any[] = []
  const ui = { notify: (...a: any[]) => notes.push(a) }
  const cmd = register()
  await cmd.handler('', { cwd: clean, hasUI: true, ui })
  assert.deepEqual(notes.pop(), ['Sem mudanças', 'info'])
  await cmd.handler('', { cwd: repo, hasUI: false, ui })
  assert.match(notes.pop()[0], /a\.txt \+2 −1\n/)
  await cmd.handler('', { cwd: join(clean, 'nao-existe'), hasUI: true, ui })
  assert.match(notes.pop()[0], /^\/diff falhou/)
})

test('comando abre o componente e navega', async () => {
  const cmd = register()
  let comp: any
  let renders = 0
  const ctx = {
    cwd: repo,
    hasUI: true,
    ui: {
      notify() {},
      custom: async (f: any) => {
        let finish: () => void = () => {}
        const closed = new Promise<void>((r) => (finish = r))
        comp = f({ terminal: { rows: 12 }, requestRender: () => renders++ }, theme, undefined, finish)
        await closed
      },
    },
  }
  const p = cmd.handler('', ctx)
  await new Promise((r) => setTimeout(r, 50))
  const list = comp.render(80)
  assert.match(list[0], /Mudanças: 5 arquivos/)
  assert.match(list[1], /^<accent>|› /)
  comp.handleInput('\x1b[B') // down
  comp.handleInput('\x1b[A') // up
  comp.handleInput('\x1b[A') // up no topo: fica
  assert.match(comp.render(80)[1], /^› a\.txt/)
  comp.handleInput('\r')
  assert.match(comp.render(80)[1], /Carregando/)
  await new Promise((r) => setTimeout(r, 200))
  const view = comp.render(80)
  assert.ok(view.some((l: string) => l.includes('<toolDiffAdded>+DOIS')))
  assert.ok(view.some((l: string) => l.includes('<toolDiffRemoved>-dois')))
  assert.ok(view.some((l: string) => l.includes('<accent>@@')))
  assert.ok(view.some((l: string) => l.includes('<dim>+++')))
  assert.ok(view.some((l: string) => l.includes('<toolDiffContext> um')))
  comp.handleInput('\x1b[6~')
  comp.handleInput('\x1b[5~')
  comp.handleInput('\x1b[B')
  comp.handleInput('\x1b[A')
  comp.handleInput('\x1b') // volta à lista
  assert.match(comp.render(80)[0], /Mudanças/)
  for (let i = 0; i < 9; i++) comp.handleInput('\x1b[B')
  assert.match(comp.render(80).join('\n'), /›/)
  comp.invalidate()
  comp.handleInput('\x1b') // fecha
  await p
  assert.ok(renders > 0)
})

test('erro ao carregar o diff aparece na visão', async () => {
  const files = [{ path: 'x', added: 0, removed: 0, binary: false, untracked: false }]
  const { DiffView } = mod
  const v = new DiffView(files, async () => Promise.reject(new Error('boom')), theme, () => 10, () => {}, () => {})
  v.handleInput('\r')
  await new Promise((r) => setTimeout(r, 20))
  // largura folgada: as marcas do tema falso ocupam colunas (ANSI real tem largura zero)
  assert.ok(v.render(80).some((l: string) => l.includes('Erro: boom')))
})

test('lineRefs: números novo/antigo e cabeçalhos sem linha', () => {
  const d = ['diff --git a/f b/f', '--- a/f', '+++ b/f', '@@ -10,3 +20,3 @@', ' ctx', '-velha', '+nova', ' fim', '\\ No newline', '']
  assert.deepEqual(mod.lineRefs(d), [
    undefined, undefined, undefined, undefined,
    { line: 20, removed: false }, { line: 11, removed: true }, { line: 21, removed: false }, { line: 22, removed: false },
    undefined, undefined,
  ])
  assert.deepEqual(mod.lineRefs(['Arquivo binário', '… truncado']), [undefined, undefined])
  // novo cabeçalho de arquivo zera o hunk: '--- ' não conta como remoção
  assert.equal(mod.lineRefs(['@@ -1 +1 @@', '+a', 'diff --git x y', '--- a/y'])[3], undefined)
})

test('formatComments', () => {
  const out = mod.formatComments([
    { path: 'a.txt', line: 2, removed: false, text: 'ok?', source: '+DOIS' },
    { path: 'b.txt', line: 7, removed: true, text: 'volte', source: '-  velha ' },
  ])
  assert.equal(out, 'Comentários da revisão (/diff):\n- `a.txt:2` — ok?\n  > +DOIS\n- `b.txt:7 (removida)` — volte\n  > -  velha')
})

const files2 = [
  { path: 'a', added: 1, removed: 1, binary: false, untracked: false },
  { path: 'b', added: 1, removed: 0, binary: false, untracked: false },
]
const diffs: Record<string, string> = {
  a: ['diff --git a/a b/a', '@@ -1,2 +1,2 @@', ' um', '-dois', '+DOIS'].join('\n'),
  b: ['@@ -0,0 +1 @@', '+novo'].join('\n'),
}
const open = async (view: any) => {
  view.handleInput('\r')
  await new Promise((r) => setTimeout(r, 20))
}
const type = (view: any, s: string) => [...s].forEach((ch) => view.handleInput(ch))
const mk = (closed: any[][] = []) => new mod.DiffView(files2, async (f: any) => diffs[f.path], theme, () => 12, () => {}, (c: any) => closed.push(c))

test('comentar: marca, cursor, edição, Esc cancela e vazio apaga', async () => {
  const closed: any[][] = []
  const v = mk(closed)
  await open(v)
  assert.ok(v.render(60).some((l: string) => l.startsWith('[selectedBg]')))
  v.handleInput('c') // cabeçalho: nada acontece
  assert.doesNotMatch(v.render(60).at(-1), /comentar a:/)
  v.handleInput('\x1b[B') // @@ ainda cabeçalho
  v.handleInput('c')
  assert.doesNotMatch(v.render(60).at(-1), /comentar a:/)
  v.handleInput('\x1b[B') // ' um' -> linha nova 1
  v.handleInput('c')
  assert.match(v.render(60).at(-1), /comentar a:1/)
  type(v, 'rascunho')
  v.handleInput('\x1b') // Esc cancela, sem marca
  assert.ok(!v.render(60).some((l: string) => l.includes('●')))
  v.handleInput('c')
  v.handleInput('\x1b[200~oi\x1b[201~')
  v.handleInput('\x1b[A') // sequência de controle ignorada
  v.handleInput('x')
  v.handleInput('\x7f') // backspace
  v.handleInput('\r')
  assert.ok(v.render(60).some((l: string) => l.includes('●')))
  v.handleInput('c') // reabre pré-preenchido
  assert.match(v.render(60).at(-1), /› oi▏/)
  for (let i = 0; i < 2; i++) v.handleInput('\x7f')
  v.handleInput('\r') // vazio apaga
  assert.ok(!v.render(60).some((l: string) => l.includes('●')))
  v.handleInput('\x1b') // volta à lista
  v.handleInput('\x1b') // fecha sem comentários
  assert.deepEqual(closed, [[]])
})

test('comentários de vários arquivos, linha removida e PgUp/PgDn', async () => {
  const closed: any[][] = []
  const v = mk(closed)
  await open(v)
  v.handleInput('\x1b[6~') // PgDn: última linha (+DOIS)
  v.handleInput('\x1b[A') // -dois
  v.handleInput('c')
  type(v, 'por quê?')
  v.handleInput('\r')
  v.handleInput('\x1b[5~') // PgUp: topo
  v.handleInput('\x1b') // lista
  v.handleInput('\x1b[B')
  await open(v)
  v.handleInput('\x1b[B')
  v.handleInput('c')
  type(v, 'ok')
  v.handleInput('\r')
  v.handleInput('\x1b')
  v.handleInput('\x1b')
  assert.deepEqual(closed[0].map((c) => [c.path, c.line, c.removed, c.text, c.source]), [
    ['a', 2, true, 'por quê?', 'dois'],
    ['b', 1, false, 'ok', 'novo'],
  ])
})

test('erro ao carregar: comentar não faz nada', async () => {
  const v = new mod.DiffView(files2, async () => Promise.reject(new Error('x')), theme, () => 12, () => {}, () => {})
  await open(v)
  v.handleInput('c')
  assert.doesNotMatch(v.render(60).at(-1), /comentar a:/) // a dica fixa "c comentar" não conta
})

test('comando: comentários vão ao editor, acrescentados, e avisam', async () => {
  const cmd = register()
  const run = async (editor: string, send: any[] | undefined) => {
    const notes: any[] = []
    let text = editor
    const ctx = {
      cwd: repo,
      hasUI: true,
      ui: {
        notify: (...a: any[]) => notes.push(a),
        getEditorText: () => text,
        setEditorText: (t: string) => (text = t),
        custom: async (f: any) => {
          let result: any
          f({ terminal: { rows: 12 }, requestRender() {} }, theme, undefined, (r: any) => (result = r))
          return send ?? result
        },
      },
    }
    await cmd.handler('', ctx)
    return { text, notes }
  }
  const c = [{ path: 'a.txt', line: 2, removed: false, text: 'revisar', source: '+DOIS' }]
  let r = await run('antes', c)
  assert.match(r.text, /^antes\n\nComentários da revisão \(\/diff\):\n- `a\.txt:2` — revisar/)
  assert.match(r.notes[0][0], /1 comentário foram para o editor; Enter envia/)
  r = await run('', c)
  assert.match(r.text, /^Comentários/)
  r = await run('intacto', [])
  assert.deepEqual([r.text, r.notes], ['intacto', []])
})

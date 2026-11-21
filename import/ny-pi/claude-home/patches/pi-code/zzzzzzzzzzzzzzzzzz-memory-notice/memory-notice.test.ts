// Testes do zzzzzzzzzzzzzzzzzz-memory-notice.patch: node --experimental-strip-types --test ~/.pi/agent/claude-home/patches/pi-code/zzzzzzzzzzzzzzzzzz-memory-notice/memory-notice.test.ts
// Pedido do dono (2026-11-14, variante C): "Memory: 11 memories loaded" vira `◆ memória  11 notas · 7 projeto · … · /memory`.
import assert from 'node:assert/strict'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

// O Node não tira tipos de .ts dentro de node_modules: testa uma cópia do pacote, com o pi ao lado.
const tmp = mkdtempSync(join(tmpdir(), 'memory-notice-test-'))
after(() => rmSync(tmp, { recursive: true }))
cpSync(`${homedir()}/.pi/agent/npm/node_modules/pi-code/extensions`, join(tmp, 'extensions'), { recursive: true })
const rel = `${homedir()}/.pi/agent/install/releases/${readFileSync(`${homedir()}/.pi/agent/install/current-version`, 'utf8').trim()}/node_modules`
mkdirSync(join(tmp, 'node_modules'))
for (const m of ['@earendil-works', 'typebox']) symlinkSync(join(rel, m), join(tmp, 'node_modules', m))
const { memoryNotice } = await import(join(tmp, 'extensions', 'memory.ts'))

const dir = join(tmp, 'mem')
mkdirSync(dir)
const note = (name: string, type?: string) => writeFileSync(join(dir, `${name}.md`), type ? `---\ntype: ${type}\n---\n# ${name}\n` : `# ${name}\n`)
note('a', 'project'); note('b', 'project'); note('c', 'feedback'); note('d', 'user'); note('e', 'reference'); note('f'); note('g', 'coisa-estranha')
const index = ['# Memory index', ...'abcdefg'.split('').map((n) => `- [${n}](${n}.md): resumo`), '- [sumiu](sumiu.md): arquivo ausente', 'texto solto'].join('\n')
const fg = (c: string, s: string) => `<${c}>${s}</>`
const theme = { fg, bold: (s: string) => `*${s}*` }

test('conta por tipo, em português, do mais comum ao menos; sem tipo, tipo desconhecido e arquivo ausente caem em "sem tipo"', () => {
  assert.equal(
    memoryNotice(dir, index, theme, {}),
    '<accent>◆</> <text>*memória*</>  <muted>8 notas</> <dim>·</> <muted>3 sem tipo · 2 projeto · 1 orientação · 1 usuário · 1 referência</> <dim>· /memory</>',
  )
})

test('uma nota: singular; tudo de um tipo só; sem tema sai sem cor', () => {
  assert.equal(memoryNotice(dir, '- [a](a.md): x', undefined, {}), '◆ memória  1 nota · 1 projeto · /memory')
})

test('índice vazio: sem aviso', () => {
  assert.equal(memoryNotice(dir, '# Memory index\n'), undefined)
})

test('link que sai do diretório de memória não é lido', () => {
  writeFileSync(join(tmp, 'fora.md'), '---\ntype: project\n---\n')
  assert.equal(memoryNotice(dir, '- [x](../fora.md): y', undefined, {}), '◆ memória  1 nota · 1 sem tipo · /memory')
})

// Pedido do dono (2026-11-14): ícone de cérebro minimalista na memória. Só onde há Nerd Font (kitty ou PI_NERD_FONT=1, mesma
// regra de extensions/ui-visual/icons.ts); ASCII pedido ou terminal desconhecido ficam com o losango.
test('ícone: cérebro com Nerd Font, losango sem', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mem-icone-'))
  writeFileSync(join(dir, 'a.md'), '---\ntype: project\n---\nx')
  const de = (env: Record<string, string>) => memoryNotice(dir, '- [a](a.md): x', undefined, env)!.split(' ')[0]
  assert.equal(de({ TERM: 'xterm-kitty' }), '\uee9c')
  assert.equal(de({ KITTY_WINDOW_ID: '3' }), '\uee9c')
  assert.equal(de({ PI_NERD_FONT: '1' }), '\uee9c')
  assert.equal(de({ TERM: 'xterm-kitty', PI_ASCII_ICONS: '1' }), '◆')
  assert.equal(de({ TERM: 'xterm-256color' }), '◆')
})

// Pedido do dono (2026-11-14): aviso de memória em caixa de fundo neutro. O notify sai marcado com U+2063 (invisível) e o core
// (patches/pi-core/avisos, caixaNeutra) desenha a caixa; sem o patch do core a marca não ocupa coluna.
test('o aviso de início sai marcado para a caixa neutra', () => {
  const src = readFileSync(join(tmp, 'extensions', 'memory.ts'), 'utf8')
  assert.ok(src.includes("ctx.ui.notify(`\\u2063${notice}`, 'info')"))
})

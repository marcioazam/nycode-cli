// Testes do zzzzzzzzzzzzzz-onda5-question.patch: node --experimental-strip-types --test ~/.pi/agent/claude-home/patches/pi-code/zzzzzzzzzzzzzz-onda5-question.test.ts
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

const HOME = homedir()
const PATCH = new URL('../zzzzzzzzzzzzzz-onda5-question.patch', import.meta.url).pathname
const EXT = `${HOME}/.pi/agent/npm/node_modules/pi-code/extensions`
// O Node não tira tipos de .ts dentro de node_modules: testa uma cópia do pacote (pilha atual) com o patch por cima.
const tmp = mkdtempSync(join(tmpdir(), 'onda5-question-test-'))
const ext = join(tmp, 'extensions')
cpSync(EXT, ext, { recursive: true })
mkdirSync(join(tmp, 'node_modules'))
const rel = `${HOME}/.pi/agent/install/releases/${readFileSync(`${HOME}/.pi/agent/install/current-version`, 'utf8').trim()}/node_modules`
for (const dep of ['@earendil-works', 'typebox']) symlinkSync(`${rel}/${dep}`, join(tmp, 'node_modules', dep))

// Patches posteriores que mexem nos mesmos trechos de question.ts saem da cópia primeiro (ordem inversa), como o bin/pi faz ao
// reverter a pilha; estes testes cobrem o estado deste patch, e cada patch posterior tem o próprio teste.
// Ordem inversa da pilha (bin/pi); todo patch posterior que toca question.ts.
for (const later of [
  'zzzzzzzzzzzzzzzzzzzzzzzzzzzz-question-rec-cyan.patch',
  'zzzzzzzzzzzzzzzzzzzzzzzzzzz-question-title-only.patch',
  'zzzzzzzzzzzzzzzzzzzzzzzzzz-icon-gap.patch',
  'zzzzzzzzzzzzzzzzzzzzzzzzz-status-names.patch',
  'zzzzzzzzzzzzzzzzzzzzzzzzz-question-nav.patch',
  'zzzzzzzzzzzzzzzzzzzz-question-dialog.patch',
  'zzzzzzzzzzzzzzzzz-question-view.patch',
]) {
  try {
    execFileSync('patch', ['-d', ext, '-p1', '-R', '-s', '--no-backup-if-mismatch', '-i', new URL(`../${later}`, import.meta.url).pathname], { stdio: 'ignore' })
  } catch {
    // ainda não aplicado nesta instalação
  }
}

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

const mod = await import(`${ext}/question.ts`)

const theme = { fg: (c: string, s: string) => `<${c}>${s}</${c}>`, bold: (s: string) => `<b>${s}</b>` }
const editor = { render: () => ['[editor]'] }
const strip = (l: string[]) => l.join('\n').replace(/<\/?[a-z]+>/g, '')
const opts = [{ label: 'alpha', description: 'primeira' }, { label: 'beta' }]
const other = { label: 'Type something.', isOther: true }

function lines(over: Record<string, unknown>) {
  return mod.buildQuestionLines({ width: 80, question: 'Qual?', header: 'Abordagem', options: [...opts, other], optionIndex: 1, editMode: false, multiSelect: false, checked: [], editor, theme, ...over })
}

test('seleção única: título, ❯ ativo em negrito, Outra resposta…, dicas', () => {
  const l = lines({})
  assert.equal(l[1], ' <b>Abordagem</b> <dim>escolha uma</dim>')
  assert.ok(l.includes('<accent>❯ </accent><accent><b>beta</b></accent>'))
  assert.ok(l.includes('  <text>alpha</text>'))
  assert.ok(l.includes('  <text>Outra resposta…</text>'))
  const t = strip(l)
  assert.ok(!t.includes('Type something.') && !t.includes('[Abordagem]') && !/\d\. /.test(t))
  assert.equal(l.at(-2), '<dim> ↑↓ escolher · ⏎ confirma · esc cancela</dim>')
})

test('multi: checkboxes, tipo e dicas com espaço', () => {
  const l = lines({ options: opts, multiSelect: true, checked: [true, false] })
  assert.equal(l[1], ' <b>Abordagem</b> <dim>escolha um ou mais</dim>')
  const t = strip(l)
  assert.ok(t.includes('  [x] alpha') && t.includes('❯ [ ] beta'))
  assert.equal(l.at(-2), '<dim> ↑↓ escolher · espaço marca · ⏎ confirma · esc cancela</dim>')
})

test('sem header o título leva só o tipo; texto livre mostra Sua resposta:', () => {
  assert.equal(lines({ header: undefined })[1], ' <dim>escolha uma</dim>')
  const l = lines({ optionIndex: 2, editMode: true })
  assert.ok(l.includes('<accent>❯ </accent><accent><b>Outra resposta… ✎</b></accent>'))
  assert.ok(l.includes('<muted> Sua resposta:</muted>'))
  assert.equal(l.at(-2), '<dim> ⏎ envia · esc volta</dim>')
})

/** Abre o overlay, manda as teclas e devolve o valor que a tool recebe. */
async function drive(options: any[], multiSelect: boolean, keys: string[]) {
  let handler: any
  const ctx = { ui: { custom: (f: any) => new Promise((resolve) => { handler = f({ requestRender() {}, terminal: { rows: 24, columns: 80 } }, theme, null, resolve) }) } }
  const p = mod.askViaOverlay({ question: 'Qual?', options: opts, multiSelect }, ctx, options, multiSelect)
  for (const k of keys) handler.handleInput(k)
  return p
}

test('valor devolvido ao modelo não mudou', async () => {
  assert.deepEqual(await drive([...opts, other], false, ['\x1b[B', '\r']), { answer: 'beta', wasCustom: false, index: 2 })
  assert.deepEqual(await drive(opts, true, [' ', '\x1b[B', ' ', '\r']), { answer: 'alpha, beta', wasCustom: false })
  assert.deepEqual(await drive([...opts, other], false, ['\x1b[B', '\x1b[B', '\r', 'o', 'i', '\r']), { answer: 'oi', wasCustom: true })
  assert.equal(await drive([...opts, other], false, ['\x1b']), null)
})

test('o rótulo de lógica do texto livre continua Type something. na tool', () => {
  assert.ok(readFileSync(`${ext}/question.ts`, 'utf8').includes("{ label: 'Type something.', isOther: true }"))
})

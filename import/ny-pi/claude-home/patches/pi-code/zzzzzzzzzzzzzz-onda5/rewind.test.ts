// Testes do zzzzzzzzzzzzzz-onda5-rewind.patch: node --experimental-strip-types --test ~/.pi/agent/claude-home/patches/pi-code/zzzzzzzzzzzzzz-onda5-rewind.test.ts
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

const HOME = homedir()
const PATCH = new URL('../zzzzzzzzzzzzzz-onda5-rewind.patch', import.meta.url).pathname
const EXT = `${HOME}/.pi/agent/npm/node_modules/pi-code/extensions`
// O Node não tira tipos de .ts dentro de node_modules: testa uma cópia do pacote (pilha atual) com o patch por cima.
const tmp = mkdtempSync(join(tmpdir(), 'onda5-rewind-test-'))
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

const mod = await import(`${ext}/git-checkpoint.ts`)
const source = readFileSync(join(ext, 'git-checkpoint.ts'), 'utf8')

test('(a) cada rótulo novo mapeia para o mesmo modo de antes, na mesma ordem', () => {
  const byLabel = Object.fromEntries(mod.RESTORE_CHOICES.map((c: { label: string; mode: string }) => [c.label.split(' · ')[0], c.mode]))
  assert.deepEqual(byLabel, {
    'Código e conversa': 'code-and-conversation', // antes 'Code and conversation'
    'Só a conversa': 'conversation', // antes 'Conversation only'
    'Só o código': 'code', // antes 'Code only'
    'Resumir daqui em diante': 'summary', // antes 'Summarize from here'
  })
  assert.deepEqual(mod.RESTORE_CHOICES.map((c: { mode: string }) => c.mode), ['code-and-conversation', 'conversation', 'code', 'summary'])
  for (const c of mod.RESTORE_CHOICES) assert.match(c.label, / · /)
})

test('(a) a decisão continua nos mesmos ramos, agora sobre o valor do modo', () => {
  assert.match(source, /mode !== 'conversation' && mode !== 'summary' && !\(await restoreCode\(ctx, checkpoint\)\)\) return/)
  assert.match(source, /if \(mode !== 'code'\) \{/)
  assert.match(source, /restoreConversation\(ctx, checkpoint\.entryId, mode === 'summary'\)/)
  assert.doesNotMatch(source, /Code and conversation|Summarize from here|Rewind complete|Restore mode/)
})

test('(b) hora 24h e idade com relógio fixo', () => {
  const at = new Date(2026, 10, 14, 1, 26, 12) // local, sem depender do fuso
  const iso = at.toISOString()
  const t = at.getTime()
  assert.equal(mod.checkpointWhen(iso, t), '01:26 · agora')
  assert.equal(mod.checkpointWhen(iso, t + 59_000), '01:26 · agora')
  assert.equal(mod.checkpointWhen(iso, t + 2 * 60_000), '01:26 · há 2 min')
  assert.equal(mod.checkpointWhen(iso, t + 59 * 60_000), '01:26 · há 59 min')
  assert.equal(mod.checkpointWhen(iso, t + 60 * 60_000), '01:26 · há 1 h')
  assert.equal(mod.checkpointWhen(iso, t + 5 * 3_600_000 + 1_000), '01:26 · há 5 h')
  assert.equal(mod.checkpointWhen(iso, t + 25 * 3_600_000), '01:26 · há 1 d')
  assert.equal(mod.checkpointWhen(iso, t - 60_000), '01:26 · agora') // relógio atrás: não negativo
  assert.equal(mod.checkpointWhen(new Date(2026, 10, 14, 13, 5).toISOString(), new Date(2026, 10, 14, 13, 6).getTime()), '13:05 · há 1 min')
  assert.equal(mod.checkpointWhen('lixo', t), '--:--')
})

test('(c) texto do resultado por modo; "prompt no campo" só quando o editor foi preenchido', () => {
  assert.equal(mod.rewindResult('crie um arquivo', 'code-and-conversation', true), '✓ Voltou para “crie um arquivo” · código e conversa · o prompt está no campo')
  assert.equal(mod.rewindResult('crie um arquivo', 'code-and-conversation', false), '✓ Voltou para “crie um arquivo” · código e conversa')
  assert.equal(mod.rewindResult('x', 'conversation', true), '✓ Voltou para “x” · só a conversa · o prompt está no campo')
  assert.equal(mod.rewindResult('x', 'summary', true), '✓ Voltou para “x” · resumido · o prompt está no campo')
  assert.equal(mod.rewindResult('x', 'code', true), '✓ Voltou para “x” · só o código')
  assert.equal(mod.rewindResult('', 'code', false), '✓ Voltou para “(prompt vazio)” · só o código')
})

test('(d) avisos de falha em português, no mesmo nível de antes', () => {
  assert.match(source, /notify\(`Checkpoints desligados: \$\{init\.stderr\.trim\(\) \|\| 'git init failed'\}`, 'warning'\)/)
  assert.match(source, /notify\('Este ponto não tem arquivos · o código não foi alterado', 'warning'\)/)
  assert.match(source, /notify\(`Não foi possível restaurar o código: \$\{result\.stderr\.trim\(\)\}`, 'warning'\)/)
  assert.match(source, /notify\(`Não foi possível restaurar a conversa: \$\{message\}`, 'error'\)/)
  assert.doesNotMatch(source, /Checkpoints disabled|has no files|restore failed|Restore failed/i)
})

test('seletores e confirmação: títulos novos, mesmas respostas', () => {
  assert.match(source, /select\('Voltar para:', labels\)/)
  assert.match(source, /Voltar para “\$\{checkpoint\.prompt \|\| '\(prompt vazio\)'\}” · o que desfazer:/)
  assert.match(source, /choice !== YES_RESTORE_CODE\) return/)
  assert.match(source, /Restaurar os arquivos para este ponto\? As mudanças feitas depois dele se perdem\./)
})

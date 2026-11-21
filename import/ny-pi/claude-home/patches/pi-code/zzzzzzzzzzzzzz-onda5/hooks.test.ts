// Testes do zzzzzzzzzzzzzz-onda5-hooks.patch: node --experimental-strip-types --test ~/.pi/agent/claude-home/patches/pi-code/zzzzzzzzzzzzzz-onda5-hooks.test.ts
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

const HOME = homedir()
const PATCH = new URL('../zzzzzzzzzzzzzz-onda5-hooks.patch', import.meta.url).pathname
const EXT = `${HOME}/.pi/agent/npm/node_modules/pi-code/extensions`
// O Node não tira tipos de .ts dentro de node_modules: testa uma cópia do pacote (pilha atual) com o patch por cima.
const tmp = mkdtempSync(join(tmpdir(), 'onda5-hooks-test-'))
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
// `before` = fonte sem o patch (reverte numa cópia se a pilha viva já o tem).
const before = join(tmp, 'before')
cpSync(ext, before, { recursive: true })
if (applied) execFileSync('patch', ['-d', before, '-p1', '-R', '-s', '-i', PATCH])
else {
  execFileSync('patch', ['-d', ext, '-p1', '-N', '-s', '--dry-run', '-i', PATCH])
  execFileSync('patch', ['-d', ext, '-p1', '-N', '-s', '--no-backup-if-mismatch', '-i', PATCH])
}

const mod = await import(`${ext}/hooks/index.ts`)

test('hook informativo: info com ◇', () => {
  assert.deepEqual(mod.hookNotice('PostToolUse', 'Hook de demonstração executado'), { text: '◇ hook PostToolUse · Hook de demonstração executado', level: 'info' })
})

test('falha de execução: error com ✗ só em sink que carrega falhas; vazio/normal segue info', () => {
  assert.deepEqual(mod.hookNotice('PreToolUse', 'Hook failed to run: x.sh: boom', true), { text: '✗ Hook PreToolUse falhou · Hook failed to run: x.sh: boom', level: 'error' })
  assert.equal(mod.hookNotice('PreToolUse', 'x.sh hook error: invalid JSON', true).level, 'error')
  assert.equal(mod.hookNotice('PostToolUse', 'x.sh hook error: não é falha', false).level, 'info')
  assert.equal(mod.hookNotice('PreToolUse', 'systemMessage comum', true).level, 'info')
})

test('bloqueio: texto ▲ em português', () => {
  assert.equal(mod.hookAttention('bloqueou a compactação', 'motivo'), '▲ Hook bloqueou a compactação · motivo')
  assert.equal(mod.hookAttention('Stop bloqueou 3 vezes seguidas', 'encerrando o turno'), '▲ Hook Stop bloqueou 3 vezes seguidas · encerrando o turno')
})

test('fonte: avisos de bloqueio usam warning; nada do que vai ao modelo mudou', () => {
  const src = readFileSync(`${ext}/hooks/index.ts`, 'utf8')
  assert.match(src, /notify\(hookAttention\('PreToolUse reescreveu o comando', `rodando: \$\{rewritten\}`\), 'warning'\)/)
  assert.match(src, /notify\(hookAttention\(`Stop bloqueou \$\{cap\} vezes seguidas`, 'encerrando o turno'\), 'warning'\)/)
  assert.match(src, /notify\(hookAttention\('bloqueou a compactação', blocked\.reason\), 'warning'\)/)
  // Toda linha removida pelo patch é só de tela (notify); sendMessage, blockedToolCall, reason, permissões ficam byte a byte.
  const diff = spawnSync('diff', ['-u', `${before}/hooks/index.ts`, `${ext}/hooks/index.ts`], { encoding: 'utf8' }).stdout.split('\n') // diff sai 1 quando difere
  const removed = diff.filter((l) => l.startsWith('-') && !l.startsWith('---'))
  assert.ok(removed.length > 0)
  for (const l of removed) assert.match(l, /notify|surfaceSystemMessages|runPreToolUse|runUserPromptSubmit/, l)
  for (const l of removed) assert.doesNotMatch(l, /sendMessage|blockedToolCall|confirm\(|output:/, l)
  // O motivo devolvido ao modelo continua o mesmo.
  for (const keep of ["pi.sendMessage({ customType: 'claude-stop-hook', content: reason, display: true }, { triggerTurn: true })", 'return blockedToolCall(decision.reason, decision.stop === true || decision.defer === true || (decision.ask === true && ctx.hasUI))', 'output: `Blocked by hook: ${reason}`']) assert.ok(src.includes(keep), keep)
})

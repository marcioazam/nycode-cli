// Testes do zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz-plan-bloco-hook.patch (lab /progplano, desenho 10 "Trilho" + "Pulso"): o gancho opcional
// `globalThis.__nyPlanoBloco` do plan-mode/done-view.ts. Sem gancho a saída é idêntica, byte a byte, à do pi-code sem o patch.
//   node --experimental-strip-types --test ~/.pi/agent/claude-home/patches/pi-code/zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz-plan-bloco-hook/plan-bloco-hook.test.ts
// O Node não tira tipos de .ts dentro de node_modules: testa cópias do pacote (com e sem o patch), com o pi ao lado.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

const HOME = homedir()
const EXT = process.env.PI_CODE_EXT ?? `${HOME}/.pi/agent/npm/node_modules/pi-code/extensions`
const PATCH = new URL('../zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz-plan-bloco-hook.patch', import.meta.url).pathname
const tmp = mkdtempSync(join(tmpdir(), 'plan-bloco-hook-test-'))
after(() => rmSync(tmp, { recursive: true }))
const rel = `${HOME}/.pi/agent/install/releases/${readFileSync(`${HOME}/.pi/agent/install/current-version`, 'utf8').trim()}/node_modules`
const patch = (ext: string, ...f: string[]) => execFileSync('patch', ['-d', ext, '-p1', '-s', '--no-backup-if-mismatch', '-i', PATCH, ...f], { stdio: 'ignore' })
const aplicado = (ext: string) => { try { patch(ext, '-R', '--dry-run'); return true } catch { return false } }
function copia(nome: string, comPatch: boolean): string {
  const raiz = join(tmp, nome)
  cpSync(EXT, join(raiz, 'extensions'), { recursive: true })
  mkdirSync(join(raiz, 'node_modules'))
  for (const m of ['@earendil-works', 'typebox']) symlinkSync(join(rel, m), join(raiz, 'node_modules', m))
  const ext = join(raiz, 'extensions')
  if (aplicado(ext) !== comPatch) comPatch ? patch(ext, '-N') : patch(ext, '-R')
  return ext
}
const novo = copia('novo', true), orig = copia('orig', false)
const N = await import(join(novo, 'plan-mode', 'done-view.ts'))
const O = await import(join(orig, 'plan-mode', 'done-view.ts'))
const G = globalThis as { __nyPlanoBloco?: unknown }

const steps = [1, 2, 3].map((n) => ({ step: n, text: `Etapa ${n}`, completed: n < 2 }))
const paint = { ok: (s: string) => `<ok>${s}</>`, muted: (s: string) => `<m>${s}</>`, text: (s: string) => `<t>${s}</>`, theme: { id: 'tema' } }
const ENTRADAS: Array<[string, unknown[]]> = [
  ['[DONE:1] [DONE:2]', [steps, paint]],
  ['a [DONE:1] b', [undefined]],
  ['PLAN BLOCKED: falta a classe', [steps, paint, false, 80, true, '20/11 00:27']],
  ['PLANO AGUARDANDO: tarefas em subagentes (bg-1a2b)', [steps, paint, true, 40]],
  ['PLAN CANCELLED', [steps, paint, false, 80, true, '20/11 00:27']],
  ['```\n[DONE:1]\n```\ntexto sem tag', [steps]],
]

test('sem gancho: saída idêntica, byte a byte, à do pi-code sem o patch', () => {
  delete G.__nyPlanoBloco
  for (const [texto, args] of ENTRADAS) assert.equal(N.renderDoneTags(texto, ...args), O.renderDoneTags(texto, ...args), texto)
})

test('gancho que devolve undefined, devolve não-texto ou falha: vale a exibição original', () => {
  for (const h of [() => undefined, () => 42, () => { throw new Error('x') }]) {
    G.__nyPlanoBloco = h
    for (const [texto, args] of ENTRADAS) assert.equal(N.renderDoneTags(texto, ...args), O.renderDoneTags(texto, ...args), texto)
  }
  delete G.__nyPlanoBloco
})

test('gancho consultado: o texto dele entra no lugar do bloco, com os dados estruturados', () => {
  const vistos: any[] = []
  G.__nyPlanoBloco = (s: unknown) => (vistos.push(s), `HOOK:${(s as { kind: string }).kind}`)
  const t = (texto: string, ...a: unknown[]) => N.renderDoneTags(texto, steps, paint, ...a)
  assert.equal(t('antes\n[DONE:1] [DONE:2]\ndepois', true, 70, true, '20/11 00:27'), 'antes\nHOOK:progresso\ndepois')
  assert.deepEqual({ ...vistos[0], steps: undefined }, { kind: 'progresso', steps: undefined, total: 3, nums: [1, 2], reason: '', sentAt: '20/11 00:27', width: 70, streaming: true, theme: paint.theme })
  assert.equal(vistos[0].steps, steps)
  assert.equal(t('PLAN WAITING: tarefas 2 e 3 (bg-1a2b)'), 'HOOK:espera')
  assert.deepEqual([vistos[1].reason, vistos[1].bgId], ['tarefas 2 e 3', 'bg-1a2b'])
  assert.equal(t('PLANO BLOQUEADO: responda'), 'HOOK:bloqueado')
  assert.equal(vistos[2].reason, 'responda')
  assert.equal(t('PLAN CANCELLED'), 'HOOK:cancelado')
  assert.equal(t('```\n[DONE:1]\n```'), '```\n[DONE:1]\n```', 'código cercado fica literal, sem gancho')
  assert.equal(vistos.length, 4)
  delete G.__nyPlanoBloco
})

test('index.ts repassa o tema do pi no paint (é como o gancho recebe as cores)', () => {
  assert.match(readFileSync(join(novo, 'plan-mode', 'index.ts'), 'utf8'), /bold: \(s\) => theme\.bold\(s\),\n\s+theme,\n\s+box:/)
})

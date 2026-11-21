#!/usr/bin/env node
// Instala o controlador semântico do plan mode no pi-code (sem cópia do pacote): registra Symbol.for('pi-code.plan-controller')
// = { active(): boolean, set(enabled: boolean): boolean } em session_start (depois do carregamento do estado) e remove SÓ o
// próprio slot no shutdown. set() usa o togglePlanMode protegido apenas quando o estado difere, com o ctx da sessão atual.
// Não toca a lista de ferramentas do plan mode nem o gate de aprovação. Uso: apply.mjs <raiz do pi-code> [--check|--revert]
// Saída: 0 aplicado / já estava / revertido / --check ok; 2 versão ou âncora inesperada (nada é gravado). Idempotente.
import { existsSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync, chmodSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const PINNED = '1.7.0'
export const TARGET = 'extensions/plan-mode/index.ts'
export const BEGIN = '  // pi-harness permission-control BEGIN'
export const END = '  // pi-harness permission-control END'
export const ANCHOR = "  pi.on('session_shutdown', (_event, ctx) => planSection.shutdown(ctx))\n"

export const BLOCK = `${BEGIN}
  // Controle semântico para Shift+Tab e /permissions plan (claude-compat). Fonte: claude-home/patches/pi-code/permission-control.
  const PLAN_CONTROLLER_SLOT = Symbol.for('pi-code.plan-controller')
  let permissionCtx: ExtensionContext | undefined
  const planController = {
    active: (): boolean => planModeEnabled === true,
    set: (enabled: boolean): boolean => {
      if (typeof enabled !== 'boolean') return false
      if (planModeEnabled === enabled) return true
      if (!permissionCtx) return false
      try {
        togglePlanMode(permissionCtx)
      } catch {
        return false
      }
      return planModeEnabled === enabled
    },
  }
  pi.on('session_start', (_event, ctx) => {
    permissionCtx = ctx
    ;(globalThis as Record<symbol, unknown>)[PLAN_CONTROLLER_SLOT] = planController
  })
  pi.on('session_shutdown', () => {
    permissionCtx = undefined
    const g = globalThis as Record<symbol, unknown>
    if (g[PLAN_CONTROLLER_SLOT] === planController) delete g[PLAN_CONTROLLER_SLOT]
  })
${END}
`

const count = (s, needle) => s.split(needle).length - 1

/** Decide sem gravar: { state: 'pending' | 'applied', file, text } ou lança Error('...') se não for seguro. */
export function preflight(root) {
  const pkg = join(root, 'package.json')
  if (!existsSync(pkg)) throw new Error(`${pkg} não existe`)
  const version = JSON.parse(readFileSync(pkg, 'utf8')).version
  if (version !== PINNED) throw new Error(`pi-code ${version} != ${PINNED} (versão fixada)`)
  const file = join(root, TARGET)
  if (!existsSync(file)) throw new Error(`${file} não existe`)
  const text = readFileSync(file, 'utf8')
  const begins = count(text, BEGIN)
  const ends = count(text, END)
  if (begins !== ends || begins > 1) throw new Error('blocos permission-control inconsistentes (marcadores desbalanceados ou duplicados)')
  if (begins === 1) {
    if (!text.includes(BLOCK)) throw new Error('bloco permission-control presente mas diferente do esperado; reverta antes de reaplicar')
    return { state: 'applied', file, text }
  }
  if (count(text, ANCHOR) !== 1) throw new Error('âncora session_shutdown não casou exatamente uma vez')
  for (const name of ['togglePlanMode', 'planModeEnabled']) if (!text.includes(name)) throw new Error(`símbolo ${name} ausente`)
  if (text.includes('pi-code.plan-controller')) throw new Error('já existe outro registro de pi-code.plan-controller')
  return { state: 'pending', file, text }
}

function write(file, text) {
  const tmp = `${file}.permission-control.tmp`
  writeFileSync(tmp, text)
  chmodSync(tmp, statSync(file).mode)
  renameSync(tmp, file)
}

export function apply(root) {
  const p = preflight(root)
  if (p.state === 'applied') return 'already'
  write(p.file, p.text.replace(ANCHOR, () => `${BLOCK}\n${ANCHOR}`))
  return 'applied'
}

export function revert(root) {
  const p = preflight(root)
  if (p.state === 'pending') return 'absent'
  write(p.file, p.text.replace(`${BLOCK}\n`, ''))
  return 'reverted'
}

if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  const [root, flag] = process.argv.slice(2)
  if (!root || (flag && !['--check', '--revert'].includes(flag))) {
    console.error('uso: apply.mjs <raiz do pi-code> [--check|--revert]')
    process.exit(2)
  }
  try {
    const out = flag === '--check' ? `ok:${preflight(root).state}` : flag === '--revert' ? revert(root) : apply(root)
    console.log(out)
  } catch (e) {
    console.error(`permission-control: ${e.message}`)
    process.exit(2)
  }
}

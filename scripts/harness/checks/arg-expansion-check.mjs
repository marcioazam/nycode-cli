#!/usr/bin/env node
// Detecta `$1`, `$@`, `${1:-x}` acidentais em skills e commands do claude-home: o pi-code expande esses tokens
// quando o arquivo é invocado (/skill:<nome>, /comando), e exemplos de shell em skills (`$1` num script) viram o
// argumento do usuário ou somem. Usa a função real do pi-code (substituteArgs via jiti, o carregador do pi),
// então acompanha mudanças no pacote. Intencional, ignorado: `$ARGUMENTS`, `$ARGUMENTS[N]`, argumentos nomeados
// do frontmatter `arguments` e escapes (`\$1` fica `$1`, como deve). Correção: escapar como `\$1`.
// Saída: JSON [{file, line, text, expanded}] em stdout; exit 0. Chamado por check-instructions.py.
// Uso: arg-expansion-check.mjs [arquivo.md ...]   (sem argumentos: skills/*/SKILL.md e commands/*.md)
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

const HOME = os.homedir()
const CH = path.join(HOME, '.pi/agent/claude-home')
const PI = path.join(HOME, '.pi/agent/install/releases/1.5.2/node_modules')
const CMD_FILE = path.join(HOME, '.pi/agent/npm/node_modules/pi-code/extensions/internal/command-file.ts')

const { createJiti } = await import(path.join(PI, 'jiti/lib/jiti.mjs'))
const jiti = createJiti(import.meta.url, { alias: { '@earendil-works/pi-coding-agent': path.join(PI, '@earendil-works/pi-coding-agent') } })
const { parseCommandFile, substituteArgs } = await jiti.import(CMD_FILE)

const ARGS = Array.from({ length: 10 }, (_, i) => `\u2983A${i}\u2984`).join(' ')
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function files() {
  const out = []
  for (const name of fs.readdirSync(path.join(CH, 'skills'))) {
    const f = path.join(CH, 'skills', name, 'SKILL.md')
    if (fs.existsSync(f)) out.push(f)
  }
  for (const name of fs.readdirSync(path.join(CH, 'commands'))) if (name.endsWith('.md')) out.push(path.join(CH, 'commands', name))
  return out
}

export function findAccidental(content) {
  const parsed = parseCommandFile(content)
  const names = parsed.argumentNames ?? []
  let body = parsed.body.replaceAll('\\\\', '\u0003').replaceAll('\\$', '\u0002')
  body = body.replace(/\$(\{?)ARGUMENTS/g, '\u0001$1ARGUMENTS') // $ARGUMENTS, $ARGUMENTS[N], ${ARGUMENTS:-padrão}
  for (const n of names) body = body.replace(new RegExp(`\\$${esc(n)}(?![A-Za-z0-9_])`, 'g'), `\u0001${n}`)
  const out = substituteArgs(body, ARGS, [])
  const before = body.split('\n')
  const after = out.split('\n')
  const hits = []
  const at = content.indexOf(parsed.body.slice(0, 80))
  const offset = at > 0 ? content.slice(0, at).split('\n').length - 1 : 0 // linhas antes do corpo (frontmatter)
  if (before.length !== after.length) return [{ line: 0, text: '(número de linhas mudou)', expanded: '' }]
  const clean = (s) => s.replaceAll('\u0003', '\\\\').replaceAll('\u0002', '\\$').replaceAll('\u0001', '$')
  for (let i = 0; i < before.length; i++) {
    if (before[i] !== after[i]) hits.push({ line: i + 1 + offset, text: clean(before[i]).trim().slice(0, 160), expanded: clean(after[i]).trim().slice(0, 160) })
  }
  return hits
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const targets = process.argv.length > 2 ? process.argv.slice(2) : files()
  const report = []
  for (const f of targets) {
    for (const hit of findAccidental(fs.readFileSync(f, 'utf8'))) report.push({ file: path.relative(CH, f), ...hit })
  }
  process.stdout.write(JSON.stringify(report) + '\n')
}

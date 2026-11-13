#!/usr/bin/env node
// Conserto local do aquecimento de cache do pi (claude-home/docs/pi-memory-cache-sota-2026-11-13.md).
// Causa: o cacheContextIsCurrent do aquecedor (core/sdk.js) exige que cada mensagem da requisição seja o mesmo objeto
// em agent.state.messages. Toda mensagem ou entrada de extensão roda _refreshFinalizedContext, que troca o array pela
// projeção da sessão; a projeção recria custom_message (ex.: claude-hook-context), resumos de compactação e de ramo
// com outro objeto e outro timestamp. O aquecimento parava com "conversation context changed" logo após o turno.
// Conserto: aceitar a mensagem equivalente (mesmos campos, exceto timestamp, que não vai ao provedor).
// Idempotente; aplicado pelo wrapper ~/.local/bin/pi. Saída 0 = aplicado ou já estava; 2 = não casou (refazer).
// Uso: cache-warm-identity.mjs <dist do pi-coding-agent>. Reverter: reinstalar a release e tirar a chamada do wrapper.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

export const MARK = 'piSameContextMessage'
// Mesma mensagem para o provedor: mesmo objeto, ou mesmo papel e campos iguais fora o timestamp. O JSON só roda na
// mensagem que perdeu a identidade (as reprojetadas são pequenas).
export const SAME_FN = `function ${MARK}(a,b){if(a===b)return!0;if(!a||!b||a.role!==b.role)return!1;` +
  `for(let k of new Set([...Object.keys(a),...Object.keys(b)]))if(k!=="timestamp"&&a[k]!==b[k]&&` +
  `JSON.stringify(a[k])!==JSON.stringify(b[k]))return!1;return!0}`

const FORMS = [
  // bundle minificado (o que a CLI executa)
  ['messages.every((message,index)=>currentMessages[index]===message)',
    `messages.every((message,index)=>${MARK}(currentMessages[index],message))`],
  // dist/core/sdk.js
  ['messages.every((message, index) => currentMessages[index] === message)',
    `messages.every((message, index) => ${MARK}(currentMessages[index], message))`],
]

/** Conserta os arquivos de `dist`; devolve quantos estão consertados (bundle + core = 2). */
export function apply(dist) {
  const files = [
    ...readdirSync(join(dist, 'bundle/chunks')).filter((f) => f.endsWith('.js')).map((f) => join(dist, 'bundle/chunks', f)),
    join(dist, 'core/sdk.js'),
  ]
  let fixed = 0
  for (const file of files) {
    const src = readFileSync(file, 'utf8')
    if (src.includes(MARK)) { fixed++; continue }
    for (const [from, to] of FORMS) {
      if (src.split(from).length !== 2) continue
      // a declaração vai no fim do módulo (hoisting de function); não colide com `export`
      writeFileSync(file, `${src.replace(from, to)}\n${SAME_FN}\n`)
      fixed++
      break
    }
  }
  return fixed
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const dist = process.argv[2]
  if (!dist) { console.error('uso: cache-warm-identity.mjs <dist>'); process.exit(1) }
  const fixed = apply(dist)
  if (fixed < 2) {
    console.error(`pi: patches/pi-core/cache-warm-identity.mjs não casou nesta versão (${fixed}/2); refazer o conserto`)
    process.exit(2)
  }
}

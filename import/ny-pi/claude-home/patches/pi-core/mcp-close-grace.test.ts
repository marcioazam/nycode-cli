// Regressão da saída lenta do pi: o transporte stdio esperava 500 ms antes do SIGTERM num servidor ainda subindo.
// Conserto: claude-home/patches/pi-core/mcp-close-grace.mjs (aplicado pelo wrapper). Registro: docs/specs/0003-boot-exit.md.
// Rodar: node --experimental-strip-types --test claude-home/patches/pi-core/mcp-close-grace.test.ts
import { strict as assert } from 'node:assert'
import { execFileSync, spawnSync } from 'node:child_process'
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { apply, GRACE_MS } from './mcp-close-grace.mjs'

const MIN = 'var DEFAULT_CLOSE_TIMEOUT_MS=2e3,STDIN_CLOSE_GRACE_MS=500,USE_PROCESS_GROUPS=1;'

function fakeDist(chunk: string): string {
  const dist = mkdtempSync(join(tmpdir(), 'grace-dist-'))
  mkdirSync(join(dist, 'bundle/chunks'), { recursive: true })
  writeFileSync(join(dist, 'bundle/chunks/a.js'), chunk)
  return dist
}

test('apply troca 500 por 100 no bundle e é idempotente', () => {
  const dist = fakeDist(MIN)
  assert.equal(apply(dist), 1)
  assert.equal(readFileSync(join(dist, 'bundle/chunks/a.js'), 'utf8'), MIN.replace('=500', `=${GRACE_MS}`))
  assert.equal(apply(dist), 1)
  assert.equal(readFileSync(join(dist, 'bundle/chunks/a.js'), 'utf8'), MIN.replace('=500', `=${GRACE_MS}`))
})

test('apply não casa com outra versão: 0 arquivos e nada reescrito', () => {
  const dist = fakeDist('var other=1;')
  assert.equal(apply(dist), 0)
  assert.equal(readFileSync(join(dist, 'bundle/chunks/a.js'), 'utf8'), 'var other=1;')
})

test('apply reconhece a forma do dist/transports/stdio.js do pi-mcp', () => {
  const root = mkdtempSync(join(tmpdir(), 'grace-rel-'))
  const dist = join(root, 'node_modules/@earendil-works/pi-coding-agent/dist')
  mkdirSync(join(dist, 'bundle/chunks'), { recursive: true })
  mkdirSync(join(root, 'node_modules/@earendil-works/pi-mcp/dist/transports'), { recursive: true })
  const stdio = join(root, 'node_modules/@earendil-works/pi-mcp/dist/transports/stdio.js')
  writeFileSync(stdio, 'const STDIN_CLOSE_GRACE_MS = 500;\n')
  assert.equal(apply(dist), 1)
  assert.equal(readFileSync(stdio, 'utf8'), `const STDIN_CLOSE_GRACE_MS = ${GRACE_MS};\n`)
})

const version = existsSync(join(homedir(), '.pi/agent/install/current-version'))
  ? readFileSync(join(homedir(), '.pi/agent/install/current-version'), 'utf8').trim()
  : ''
const piMcp = join(homedir(), '.pi/agent/install/releases', version, 'node_modules/@earendil-works/pi-mcp')

test('fechar um servidor que ainda sobe leva bem menos que 500 ms (pi-mcp real, cópia)', {
  skip: !version || !existsSync(piMcp),
}, async () => {
  const root = mkdtempSync(join(tmpdir(), 'grace-live-'))
  // Cópia com o dist do pi-coding-agent falso só para o apply achar o pi-mcp irmão.
  const mcp = join(root, 'node_modules/@earendil-works/pi-mcp')
  cpSync(piMcp, mcp, { recursive: true, dereference: true })
  const lib = join(homedir(), '.pi/agent/install/releases', version, 'node_modules')
  for (const name of readdirSync(lib))
    if (name !== '@earendil-works' && !name.startsWith('.'))
      symlinkSync(join(lib, name), join(root, 'node_modules', name))
  const dist = join(root, 'node_modules/@earendil-works/pi-coding-agent/dist')
  mkdirSync(join(dist, 'bundle/chunks'), { recursive: true })
  const timeClose = async (): Promise<number> => {
    const mod = await import(`${pathToFileURL(join(mcp, 'dist/transports/stdio.js')).href}?v=${Math.random()}`)
    // Servidor que ignora o stdin enquanto "sobe" (como o npx a frio) e morre no SIGTERM.
    const transport = new mod.StdioTransport({ command: process.execPath, args: ['-e', 'setTimeout(() => {}, 20000)'] })
    await transport.start()
    const t0 = performance.now()
    await transport.close()
    return performance.now() - t0
  }
  const before = await timeClose()
  assert.equal(apply(dist), 1)
  const after = await timeClose()
  assert.ok(before >= 450, `sem o conserto o fechamento devia levar ~500 ms: ${before.toFixed(0)}`)
  assert.ok(after < 300, `com o conserto devia levar ~${GRACE_MS} ms: ${after.toFixed(0)}`)
})

test('rodar o .mjs por um symlink aplica (install.sh --link)', () => {
  const dist = fakeDist(MIN)
  const link = join(mkdtempSync(join(tmpdir(), 'grace-link-')), 'mcp-close-grace.mjs')
  symlinkSync(fileURLToPath(new URL('./mcp-close-grace.mjs', import.meta.url)), link)
  execFileSync(process.execPath, [link, dist])
  assert.match(readFileSync(join(dist, 'bundle/chunks/a.js'), 'utf8'), new RegExp(`GRACE_MS=${GRACE_MS}`))
})

test('diretório somente-leitura: uma linha em stderr, exit 3, sem stack trace, arquivo intacto', {
  skip: process.getuid?.() === 0,
}, () => {
  const dist = fakeDist(MIN)
  const chunks = join(dist, 'bundle/chunks')
  chmodSync(chunks, 0o555)
  try {
    const r = spawnSync(process.execPath, [fileURLToPath(new URL('./mcp-close-grace.mjs', import.meta.url)), dist], {
      encoding: 'utf8',
    })
    assert.equal(r.status, 3)
    assert.equal(r.stderr.trim().split('\n').length, 1)
    assert.doesNotMatch(r.stderr, /\n\s+at /)
    assert.equal(readFileSync(join(chunks, 'a.js'), 'utf8'), MIN)
    assert.deepEqual(readdirSync(chunks), ['a.js'])
  } finally {
    chmodSync(chunks, 0o755)
  }
})

test('escrita atômica: o arquivo final é trocado por rename, sem temporário sobrando', () => {
  const dist = fakeDist(MIN)
  const file = join(dist, 'bundle/chunks/a.js')
  const ino = statSync(file).ino
  assert.equal(apply(dist), 1)
  assert.notEqual(statSync(file).ino, ino) // novo inode = rename, não escrita sobre o arquivo existente
  assert.deepEqual(readdirSync(join(dist, 'bundle/chunks')), ['a.js'])
})

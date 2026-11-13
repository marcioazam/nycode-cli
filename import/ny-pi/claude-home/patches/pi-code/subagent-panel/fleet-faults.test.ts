// Caminhos de falha da frota (subagent/fleet/*): erros de disco, watcher, listener e kill que os outros arquivos não alcançam: node --experimental-strip-types --test ~/.pi/agent/claude-home/patches/pi-code/subagent-panel/fleet-faults.test.ts
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { join } from 'node:path'
import { test } from 'node:test'
import { fleetTestEnv } from './setup.ts'

const { tmp, ext } = fleetTestEnv('fleet-faults-')
const store = await import(`${ext}/subagent/fleet/store.ts`)
const trackerMod = await import(`${ext}/subagent/fleet/tracker.ts`)
const sourceMod = await import(`${ext}/subagent/fleet/source.ts`)
const fsDefault = (await import('node:fs')).default as any

const id = (n = 1): string => `fg-${n.toString(16).padStart(8, '0')}`
const tempDir = (): string => mkdtempSync(join(tmp, 'faults-dir-'))
const deadPid = (): number => spawnSync(process.execPath, ['-e', '0']).pid as number
// Como root o EACCES não acontece: só esses casos pulam.
const asRoot = { skip: process.getuid?.() === 0 }

function mainFleet(): string {
  delete process.env.PI_CODE_SUBAGENT_DEPTH
  delete process.env.PI_CODE_SUBAGENT
  return store.ensureFleetDir()
}

const baseRecord = (rid: string, over: Record<string, unknown> = {}) => ({
  v: 1, id: rid, parentId: null, depth: 1, agent: 'a', task: 't', background: false, state: 'running',
  startedAt: 1, updatedAt: 1, turns: 0, toolCalls: 0,
  tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, context: 0 }, cost: 0, ownerPid: process.pid, ...over,
})

// Troca fs.watch (o source usa a ligação `fs.watch` do módulo) e devolve o restaurador.
function patchWatch(impl: (orig: Function, args: unknown[]) => unknown): () => void {
  const orig = fsDefault.watch
  fsDefault.watch = (...args: unknown[]) => impl(orig.bind(fsDefault), args)
  syncBuiltinESMExports()
  return () => {
    fsDefault.watch = orig
    syncBuiltinESMExports()
  }
}

test('stopRun: pid com o env da execução mas fora de um grupo próprio (ESRCH) volta not-running, sem agendar SIGKILL', async () => {
  const dir = mainFleet()
  const child = spawn('sleep', ['30'], { stdio: 'ignore', env: { ...process.env, PI_CODE_FLEET_DIR: dir, PI_CODE_FLEET_RUN_ID: id(1) } })
  const exited = new Promise((res) => child.on('exit', res))
  try {
    store.writeRecord(dir, baseRecord(id(1), { pid: child.pid }))
    assert.equal(sourceMod.stopRun(id(1)), 'not-running')
    assert.equal(store.stopOrigin(dir, id(1)), 'user', 'o marcador de parada já tinha sido gravado')
    assert.equal(child.exitCode, null, 'nada foi morto: o filho não lidera grupo')
  } finally {
    child.kill('SIGKILL')
    await exited
    store.removeFleetDir()
  }
})

test('onChange: um listener que lança não impede os demais de receber a mudança', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] })
  mainFleet()
  const src = sourceMod.createFleetSource({ resume: () => false })
  let calls = 0
  const offBad = src.onChange(() => {
    throw new Error('listener ruim')
  })
  const offGood = src.onChange(() => calls++)
  try {
    t.mock.timers.tick(1000)
    t.mock.timers.tick(100)
    assert.equal(calls, 1)
    t.mock.timers.tick(1000)
    t.mock.timers.tick(100)
    assert.equal(calls, 2, 'o feed continua depois do erro')
  } finally {
    offBad()
    offGood()
    store.removeFleetDir()
  }
})

test('onChange: erro no watcher o fecha e o próximo poll cria outro, e as mudanças seguem sendo avisadas', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] })
  const dir = mainFleet()
  const watchers: any[] = []
  const closed = new Set<any>()
  const restore = patchWatch((orig, args) => {
    const w = orig(...args)
    const close = w.close.bind(w)
    w.close = () => {
      closed.add(w)
      close()
    }
    watchers.push(w)
    return w
  })
  const src = sourceMod.createFleetSource({ resume: () => false })
  let calls = 0
  const off = src.onChange(() => calls++)
  try {
    assert.equal(watchers.length, 1)
    watchers[0].emit('error', new Error('boom'))
    assert.equal(closed.has(watchers[0]), true, 'o watcher com erro foi fechado')
    t.mock.timers.tick(1000)
    assert.equal(watchers.length, 2, 'o poll rearmou o watch')
    t.mock.timers.tick(100)
    assert.equal(calls, 1)
    store.writeRecord(dir, baseRecord(id(2)))
    t.mock.timers.tick(1000)
    t.mock.timers.tick(100)
    assert.equal(calls, 2)
    assert.equal(src.list().length, 1)
  } finally {
    off()
    restore()
    for (const w of watchers) w.close()
    store.removeFleetDir()
  }
})

test('onChange: fs.watch lançando não derruba a assinatura: o poll continua avisando', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] })
  mainFleet()
  let attempts = 0
  const restore = patchWatch(() => {
    attempts++
    throw new Error('sem inotify')
  })
  try {
    const src = sourceMod.createFleetSource({ resume: () => false })
    let calls = 0
    const off = src.onChange(() => calls++)
    try {
      assert.equal(attempts, 1)
      t.mock.timers.tick(1000)
      t.mock.timers.tick(100)
      assert.equal(calls, 1)
      assert.equal(attempts, 2, 'cada poll tenta de novo')
    } finally {
      off()
    }
  } finally {
    restore()
    store.removeFleetDir()
  }
})

test('ensureFleetDir: raiz impossível de criar desativa a frota em vez de lançar', () => {
  store.removeFleetDir()
  const saved = process.env.TMPDIR
  const file = join(tmp, 'regular-file')
  writeFileSync(file, 'x')
  process.env.TMPDIR = join(file, 'sub') // mkdir sob um arquivo comum: ENOTDIR
  try {
    assert.equal(store.ensureFleetDir(), undefined)
    assert.equal(store.currentFleetDir(), undefined)
  } finally {
    process.env.TMPDIR = saved
  }
})

test('sweepOrphanFleetDirs: raiz ilegível não lança e o diretório próprio fica', asRoot, () => {
  const dir = mainFleet()
  const root = store.fleetRoot()
  chmodSync(root, 0o300)
  try {
    assert.doesNotThrow(() => store.sweepOrphanFleetDirs())
  } finally {
    chmodSync(root, 0o700)
    store.removeFleetDir()
  }
  assert.equal(existsSync(dir), false)
})

test('sweepOrphanFleetDirs: órfão que não dá para apagar não lança e os outros órfãos saem', asRoot, () => {
  mainFleet()
  const root = store.fleetRoot()
  const stuck = join(root, `${deadPid()}-deadbeef`)
  mkdirSync(join(stuck, 'locked'), { recursive: true })
  writeFileSync(join(stuck, 'locked', 'f'), 'x')
  chmodSync(join(stuck, 'locked'), 0o500) // não dá para desvincular f
  const free = join(root, `${deadPid()}-feedface`)
  mkdirSync(free)
  try {
    assert.doesNotThrow(() => store.sweepOrphanFleetDirs())
    assert.equal(existsSync(free), false, 'o órfão removível saiu')
    assert.equal(existsSync(join(stuck, 'locked', 'f')), true, 'o preso ficou')
  } finally {
    chmodSync(join(stuck, 'locked'), 0o700)
    rmSync(stuck, { recursive: true })
    store.removeFleetDir()
  }
})

test('removeFleetDir: falha ao apagar não lança e o slot é limpo mesmo assim', asRoot, () => {
  const dir = mainFleet()
  const root = store.fleetRoot()
  chmodSync(root, 0o500) // a entrada do dir não pode ser desvinculada
  try {
    assert.doesNotThrow(() => store.removeFleetDir())
    assert.equal(store.currentFleetDir(), undefined)
    assert.equal(existsSync(dir), true, 'o dir ficou, pois o disco recusou')
  } finally {
    chmodSync(root, 0o700)
    rmSync(dir, { recursive: true })
  }
})

test('appendJsonl: diretório inexistente não lança nem cria nada', () => {
  const missing = join(tmp, 'no-such-dir')
  assert.doesNotThrow(() => store.appendJsonl(join(missing, 'x.jsonl'), { a: 1 }))
  assert.equal(existsSync(missing), false)
})

test('resetInbox: inbox somente leitura não lança e o conteúdo fica', asRoot, () => {
  const dir = tempDir()
  const file = join(dir, `${id(3)}.inbox.jsonl`)
  writeFileSync(file, '{"a":1}\n')
  chmodSync(file, 0o400)
  try {
    assert.doesNotThrow(() => store.resetInbox(dir, id(3)))
    assert.equal(readFileSync(file, 'utf8'), '{"a":1}\n')
  } finally {
    chmodSync(file, 0o600)
  }
})

test('requestStop: diretório inexistente não lança e não deixa origem', () => {
  const missing = join(tmp, 'gone-dir')
  assert.doesNotThrow(() => store.requestStop(missing, id(4), 'agent'))
  assert.equal(store.stopOrigin(missing, id(4)), undefined)
  assert.deepEqual(readdirSync(tmp).filter((n) => n === 'gone-dir'), [])
})

test('tracker: evento depois de mais de 250 ms sem escrita grava na hora, sem esperar timer', (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 0 })
  const dir = mainFleet()
  try {
    const tr = trackerMod.startTracking({ id: id(5), agent: 'a', task: 't', background: false })
    t.mock.timers.tick(300)
    tr.onLine(JSON.stringify({ type: 'tool_execution_start', toolName: 'bash', args: { command: 'ls' } }))
    const rec = JSON.parse(readFileSync(join(dir, `${id(5)}.json`), 'utf8'))
    assert.equal(rec.activity, 'bash ls')
    assert.equal(rec.updatedAt, 300)
    assert.equal(rec.toolCalls, 1)
  } finally {
    store.removeFleetDir()
  }
})

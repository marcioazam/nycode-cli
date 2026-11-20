// Integração do ponto de entrada do subagente (subagent/index.ts, a cola do painel) com um pi falso e um filho falso: node --experimental-strip-types --test ~/.pi/agent/claude-home/patches/pi-code/subagent-panel/fleet-entry.test.ts
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { test } from 'node:test'
import { fleetTestEnv } from './setup.ts'

const { tmp, ext } = fleetTestEnv('fleet-entry-')
// A descoberta de agentes lê o HOME e o diretório do pi: ambos apontam para um lar de mentira (depois do setup, que já fixou a origem).
const home = join(tmp, 'home')
const agentDir = join(home, '.pi', 'agent')
mkdirSync(join(agentDir, 'agents'), { recursive: true })
writeFileSync(join(agentDir, 'agents', 'fake.md'), '---\nname: fake\ndescription: agente falso dos testes de entrada\n---\nVoce e falso.\n')
process.env.HOME = home
process.env.PI_CODING_AGENT_DIR = agentDir
delete process.env.CLAUDE_CONFIG_DIR
delete process.env.PI_CODE_SUBAGENT
delete process.env.PI_CODE_SUBAGENT_DEPTH

const store = await import(`${ext}/subagent/fleet/store.ts`)
const sourceMod = await import(`${ext}/subagent/fleet/source.ts`)
const bgMod = await import(`${ext}/subagent/background.ts`)
const trackerMod = await import(`${ext}/subagent/fleet/tracker.ts`)
const { default: subagentExtension } = await import(`${ext}/subagent/index.ts`)

// O filho falso só responde depois que `release-<tarefa>` existe em FAKE_PI_DIR; tarefas `hang-*` nunca respondem (servem a parada).
const fakePi = join(tmp, 'fake-pi-entry.mjs')
writeFileSync(
  fakePi,
  `import { existsSync } from 'node:fs'
import { join } from 'node:path'
const task = (process.argv.at(-1).match(/Task: ([\\s\\S]*)$/) ?? [])[1] ?? ''
const gate = join(process.env.FAKE_PI_DIR, 'release-' + task)
const never = task.startsWith('hang-')
const timer = setInterval(() => {
  if (never || !existsSync(gate)) return
  clearInterval(timer)
  process.stdout.write(JSON.stringify({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'feito:' + task }], stopReason: 'stop' } }) + '\\n')
  process.exit(0)
}, 20)
`,
)
process.env.FAKE_PI_DIR = tmp
const release = (task: string): void => writeFileSync(join(tmp, `release-${task}`), '')

type Rec = { id: string; state: string; pid?: number; stoppedBy?: string; background?: boolean }
type Sent = { msg: { customType: string; content: string }; opts: { triggerTurn?: boolean } }

async function waitFor<T>(what: string, probe: () => T | undefined | false): Promise<T> {
  const end = Date.now() + 5000
  for (;;) {
    const v = probe()
    if (v) return v
    if (Date.now() > end) assert.fail(`timeout waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 50))
  }
}

function gone(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return false
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'ESRCH'
  }
}

// O pi e o contexto falsos: registram tudo o que a extensão faz e guardam o gancho de teclas do painel.
function boot(opts: { hasUI?: boolean; sendThrows?: boolean } = {}) {
  const handlers = new Map<string, Array<(...a: any[]) => any>>()
  const tools: any[] = []
  const commands = new Map<string, any>()
  const sent: Sent[] = []
  const emitted: Array<[string, any]> = []
  const notes: Array<[string, string | undefined]> = []
  const inputs: Array<(data: string) => any> = []
  const widgets: unknown[] = []
  const steered: Array<[string, unknown]> = []
  const refused: Sent['msg'][] = []
  const pi = {
    on: (event: string, h: (...a: any[]) => any) => void handlers.set(event, [...(handlers.get(event) ?? []), h]),
    registerTool: (def: any) => void tools.push(def),
    registerCommand: (name: string, def: any) => void commands.set(name, def),
    events: { emit: (c: string, d: unknown) => void emitted.push([c, d]), on: () => () => {} },
    getActiveTools: () => ['subagent'],
    sendMessage: (msg: Sent['msg'], o: Sent['opts']) => {
      if (opts.sendThrows) {
        refused.push(msg)
        throw new Error('session invalidated') // a sessão trocou: toda chamada ao pi velho lança
      }
      sent.push({ msg, opts: o })
    },
    sendUserMessage: (text: string, o: unknown) => void steered.push([text, o]),
  }
  const ctx = {
    cwd: tmp,
    hasUI: opts.hasUI ?? true,
    ui: {
      setWidget: (...a: unknown[]) => void widgets.push(a),
      onTerminalInput: (h: (data: string) => any) => {
        inputs.push(h)
        return () => {}
      },
      getEditorText: () => '',
      notify: (m: string, t?: string) => void notes.push([t ?? 'info', m]),
      custom: async () => undefined,
    },
    sessionManager: { getBranch: () => [{ type: 'message' }] },
    modelRegistry: { getAvailable: () => [] },
  }
  const savedArgv = process.argv[1]
  process.argv[1] = fakePi
  subagentExtension(pi)
  const fire = async (event: string, payload: unknown = {}): Promise<any[]> => {
    const out: any[] = []
    for (const h of handlers.get(event) ?? []) out.push(await h(payload, ctx))
    return out
  }
  const tool = tools.find((t) => t.name === 'subagent')
  const run = (params: Record<string, unknown>, signal?: AbortSignal): Promise<any> => tool.execute('call', params, signal, undefined, ctx)
  const key = (data: string): any => inputs.at(-1)?.(data)
  const text = (res: any): string => res.content[0].text
  const dirRecords = (): Rec[] => {
    const dir = store.currentFleetDir()
    return dir ? (store.readRecords(dir) as Rec[]) : []
  }
  // Mata só grupos de registros ainda 'running' (o pgid de um filho que já saiu pode ter sido reusado) e limpa o estado global.
  const finish = async (): Promise<void> => {
    try {
      await fire('session_shutdown', { reason: 'reload' })
    } finally {
      for (const r of dirRecords())
        if (r.pid && r.state === 'running')
          try {
            process.kill(-r.pid, 'SIGKILL')
          } catch {
            /* já saiu */
          }
      store.removeFleetDir()
      bgMod.resetBackgroundRuns()
      process.argv[1] = savedArgv
      for (const k of ['PI_CODE_SUBAGENT', 'PI_CODE_SUBAGENT_DEPTH', 'PI_CODE_FLEET_DIR', 'PI_CODE_FLEET_RUN_ID']) delete process.env[k]
    }
  }
  const runningFg = () => dirRecords().find((r) => r.state === 'running' && r.pid && !r.background)
  const delivered = (prefix: string) => () => sent.find((s) => s.msg.content.startsWith(prefix))
  return { handlers, tools, commands, sent, refused, emitted, notes, widgets, steered, pi, ctx, fire, run, key, text, dirRecords, finish, runningFg, delivered }
}

const MOVED = 'moved this subagent call to the background (Ctrl+B)'
const FINISHED = 'Background subagent call finished (moved to the background by the user with Ctrl+B):'

test('Ctrl+B: a chamada em primeiro plano vai para o fundo e o resultado chega como mensagem que acorda o modelo', async () => {
  const h = boot()
  try {
    await h.fire('session_start')
    assert.ok(store.currentFleetDir(), 'a frota existe numa sessão interativa principal')
    const pending = h.run({ agent: 'fake', task: 'c1' }, new AbortController().signal)
    const rec = await waitFor('running fg record', h.runningFg)
    assert.deepEqual(h.key('\x02'), { consume: true })
    const res = await pending
    assert.ok(h.text(res).includes(MOVED), h.text(res))
    assert.equal(h.sent.length, 0, 'nada chega antes de o filho terminar')
    release('c1')
    const msg = await waitFor('completion message', h.delivered(FINISHED))
    assert.ok(msg.msg.content.includes('feito:c1'))
    assert.equal(msg.msg.customType, 'subagent-background')
    assert.equal(msg.opts.triggerTurn, true)
    await waitFor('child gone', () => gone(rec.pid as number))
  } finally {
    await h.finish()
  }
})

test('Ctrl+B: a sessão recusar a mensagem de conclusão não derruba o processo e o registro termina como done', async () => {
  const unhandled: unknown[] = []
  const record = (e: unknown): void => void unhandled.push(e)
  process.on('unhandledRejection', record)
  process.on('uncaughtException', record)
  const h = boot({ sendThrows: true })
  try {
    await h.fire('session_start')
    const pending = h.run({ agent: 'fake', task: 'c-refused' }, new AbortController().signal)
    const rec = await waitFor('running fg record', h.runningFg)
    assert.deepEqual(h.key('\x02'), { consume: true })
    const res = await pending
    assert.ok(h.text(res).includes(MOVED), h.text(res))
    release('c-refused')
    const attempt = await waitFor('refused delivery attempt', () => h.refused[0])
    assert.ok(attempt.content.includes('feito:c-refused'))
    await waitFor('record done', () => h.dirRecords().find((r) => r.id === rec.id && r.state === 'done'))
    await new Promise((r) => setImmediate(r)) // uma rodada para um eventual erro assíncrono aparecer
    assert.deepEqual(unhandled, [])
    assert.equal(h.sent.length, 0)
  } finally {
    process.off('unhandledRejection', record)
    process.off('uncaughtException', record)
    await h.finish()
  }
})

test('Esc antes de Ctrl+B: a chamada abortada não é revivida nem entregue em segundo plano (regressão real)', async () => {
  const h = boot()
  try {
    await h.fire('session_start')
    const ac = new AbortController()
    const pending = h.run({ agent: 'fake', task: 'hang-esc' }, ac.signal).then(
      (r) => r,
      (e) => ({ content: [{ type: 'text', text: `rejeitou: ${e.message}` }] }),
    )
    const rec = await waitFor('running fg record', h.runningFg)
    ac.abort()
    h.key('\x02')
    const res = await pending
    assert.ok(!h.text(res).includes(MOVED), h.text(res))
    await waitFor('child gone', () => gone(rec.pid as number))
    await new Promise((r) => setTimeout(r, 500)) // janela limitada para uma ausência: nada chega
    assert.equal(h.delivered('Background subagent call finished')(), undefined)
    assert.equal(h.sent.length, 0)
  } finally {
    await h.finish()
  }
})

test('retomada pelo painel: o resultado vem sem o prefixo, e o send() do painel retoma com o aviso de relatório', async () => {
  const h = boot()
  try {
    await h.fire('session_start')
    const started = h.text(await h.run({ agent: 'fake', task: 'b1', background: true }))
    const bgId = started.match(/Started background run (bg-[0-9a-f]+)/)?.[1]
    assert.ok(bgId, started)
    release('b1')
    const first = await waitFor('first completion', h.delivered('Background subagent run'))
    assert.ok(first.msg.content.includes('feito:b1'))
    assert.ok(!first.msg.content.includes('Report only'))
    assert.equal(first.opts.triggerTurn, true)
    await waitFor('record done', () => h.dirRecords().find((r) => r.id === bgId && r.state === 'done'))
    assert.equal(sourceMod.fleetSourceForUi().send(bgId, 'again'), 'resumed')
    release('again')
    const second = await waitFor('resume completion', h.delivered('Report only, no action needed'))
    assert.ok(second.msg.content.includes('"again"'))
    assert.ok(second.msg.content.includes('feito:again'))
  } finally {
    await h.finish()
  }
})

test('registro pelo execute: {status}, {resume}, {cancel} de fundo e {cancel} de chamada movida, ambos com origem agent (falhava antes: o {cancel} de fundo não gravava a origem)', async () => {
  const h = boot()
  try {
    await h.fire('session_start')
    const bgId = h.text(await h.run({ agent: 'fake', task: 'hang-bg', background: true })).match(/(bg-[0-9a-f]+)/)?.[1] as string
    assert.ok(bgId)
    assert.ok(h.text(await h.run({ status: true })).includes(bgId), 'status lista a execução')
    assert.match(h.text(await h.run({ resume: bgId, task: 'x' })), /still running/)
    assert.match(h.text(await h.run({ resume: bgId })), /Pass task with resume/)
    const bgRec = await waitFor('bg record', () => h.dirRecords().find((r) => r.id === bgId && r.pid))
    assert.equal(h.text(await h.run({ cancel: bgId })), `Cancelled background run ${bgId}.`)
    await waitFor('bg child gone', () => gone(bgRec.pid as number))
    const bgFin = await waitFor('bg cancelled record', () => h.dirRecords().find((r) => r.id === bgId && r.state === 'cancelled'))
    assert.equal(bgFin.stoppedBy, 'agent', 'o {cancel} do modelo num run de fundo grava a mesma origem que no caminho da frota')
    const bgDone = await waitFor('bg cancel notice', h.delivered(`Background subagent run ${bgId}`))
    assert.ok(bgDone.msg.content.includes(`[${trackerMod.AGENT_STOP_NOTE}]`), bgDone.msg.content)
    assert.match(h.text(await h.run({ cancel: bgId })), /already finished/)
    assert.match(h.text(await h.run({ cancel: 'bg-nope' })), /Unknown background run: bg-nope/)
    // Uma chamada movida para o fundo com Ctrl+B vive fora do registro: {status} a lista e {cancel} a para como 'agent'.
    const pending = h.run({ agent: 'fake', task: 'hang-fg' }, new AbortController().signal)
    const fg = await waitFor('running fg record', h.runningFg)
    h.key('\x02')
    assert.ok(h.text(await pending).includes(MOVED))
    assert.match(h.text(await h.run({ status: true })), new RegExp(`${fg.id} \\(fake\\) running — moved to the background`))
    assert.equal(h.text(await h.run({ cancel: fg.id })), `Stopped run ${fg.id}.`)
    const fin = await waitFor('cancelled record', () => h.dirRecords().find((r) => r.id === fg.id && r.state === 'cancelled'))
    assert.equal(fin.stoppedBy, 'agent')
    await waitFor('fg child gone', () => gone(fg.pid as number))
  } finally {
    await h.finish()
  }
})

test('session_shutdown quit: mata o filho de fundo e remove a frota; new só avisa e não mata', async () => {
  const h = boot()
  try {
    await h.fire('session_start')
    const bgId = h.text(await h.run({ agent: 'fake', task: 'hang-q', background: true })).match(/(bg-[0-9a-f]+)/)?.[1] as string
    const rec = await waitFor('bg record', () => h.dirRecords().find((r) => r.id === bgId && r.pid && r.state === 'running'))
    await h.fire('session_shutdown', { reason: 'new' })
    assert.deepEqual(h.notes, [['warning', '1 background run still active; /tasks to inspect']])
    assert.equal(gone(rec.pid as number), false, 'new não mata nada')
    const dir = store.currentFleetDir()
    assert.ok(dir && existsSync(dir))
    await h.fire('session_shutdown', { reason: 'quit' })
    await waitFor('child gone', () => gone(rec.pid as number))
    assert.equal(existsSync(dir), false, 'a frota é removida no quit')
    assert.equal(store.currentFleetDir(), undefined)
  } finally {
    await h.finish()
  }
})

test('sem UI no nível 0 não cria frota nem painel', async () => {
  // send (padrão ligado desde 2026-11-13) cria a frota headless; com ele desligado vale o contrato antigo.
  process.env.PI_CODE_SUBAGENT_SEND = '0'
  const h = boot({ hasUI: false })
  try {
    await h.fire('session_start')
    assert.equal(store.currentFleetDir(), undefined)
    assert.equal(h.widgets.length, 0)
    assert.equal(h.key('\x02'), undefined, 'sem UI não há gancho de teclas')
  } finally {
    delete process.env.PI_CODE_SUBAGENT_SEND
    await h.finish()
  }
})

test('nível 1: não cria frota própria, o vigia da caixa de entrada anda e para no shutdown', async () => {
  const fleetDir = store.ensureFleetDir() as string
  const rid = 'fg-0000abcd'
  const slot = Symbol.for('pi-code.fleet.inbox')
  const h = boot()
  try {
    Object.assign(process.env, { PI_CODE_SUBAGENT: '1', PI_CODE_SUBAGENT_DEPTH: '1', PI_CODE_FLEET_DIR: fleetDir, PI_CODE_FLEET_RUN_ID: rid })
    await h.fire('session_start')
    assert.equal(h.widgets.length, 0, 'o painel é só da sessão principal')
    assert.deepEqual(readdirSync(dirname(fleetDir)), [basename(fleetDir)], 'o filho não cria outra frota; usa a do pai, pelo ambiente')
    assert.ok((globalThis as Record<symbol, unknown>)[slot], 'o vigia da caixa de entrada começou')
    store.appendInbox(fleetDir, rid, { id: 'm1', t: Date.now(), text: 'olá filho' })
    await waitFor('steered message', () => h.steered.length > 0)
    assert.deepEqual(h.steered[0], ['olá filho', { deliverAs: 'steer' }])
    assert.deepEqual(store.readAcks(fleetDir, rid, 0).items.map((a: { outcome: string }) => a.outcome), ['steered'])
    await h.fire('session_shutdown', { reason: 'reload' })
    assert.equal((globalThis as Record<symbol, unknown>)[slot], undefined, 'o vigia parou')
  } finally {
    await h.finish()
    store.removeFleetDir()
  }
})

test('/tasks: sem execuções avisa; com execuções abre o navegador; sem UI imprime o estado', async () => {
  const h = boot()
  try {
    // Sem fonte criada ainda (nenhuma sessão iniciou a frota): o painel não tem o que listar.
    const holder = globalThis as Record<symbol, unknown>
    const slot = Symbol.for('pi-code.fleet.source')
    const saved = holder[slot]
    holder[slot] = undefined
    try {
      await h.commands.get('tasks').handler('', h.ctx)
    } finally {
      holder[slot] = saved
    }
    assert.deepEqual(h.notes.at(-1), ['info', 'No subagent runs in this session.'])
    await h.fire('session_start')
    await h.commands.get('tasks').handler('', h.ctx)
    assert.deepEqual(h.notes.at(-1), ['info', 'No subagent runs in this session.'], 'frota vazia')
    const custom: unknown[] = []
    h.ctx.ui.custom = async (...a: unknown[]) => void custom.push(a)
    const bgId = h.text(await h.run({ agent: 'fake', task: 'hang-t', background: true })).match(/(bg-[0-9a-f]+)/)?.[1] as string
    await waitFor('bg record', () => h.dirRecords().find((r) => r.id === bgId))
    await h.commands.get('tasks').handler('', h.ctx)
    assert.equal(custom.length, 1, 'o navegador abriu uma vez')
    const headless = boot({ hasUI: false })
    await headless.commands.get('tasks').handler('', headless.ctx)
    assert.match(headless.notes[0][1], new RegExp(`${bgId} fake: running - hang-t`))
    await headless.finish()
  } finally {
    await h.finish()
  }
})

test('roster, /agents, modo inválido e teto de profundidade', async () => {
  const h = boot()
  try {
    await h.fire('session_start')
    const [prompt] = (await h.fire('before_agent_start', { systemPrompt: 'base' })).filter(Boolean)
    assert.match(prompt.systemPrompt, /^base\n\n## Subagents\n\n/)
    assert.match(prompt.systemPrompt, /- fake \(user\): agente falso dos testes de entrada/)
    await h.commands.get('agents').handler('', h.ctx)
    assert.match(h.notes.at(-1)?.[1] ?? '', /fake/)
    const invalid = h.text(await h.run({}))
    assert.match(invalid, /^Invalid parameters\. Provide exactly one mode\.\nAvailable agents: .*fake \(user\)/)
    assert.match(h.text(await h.run({ agent: 'fake', task: 't', tasks: [{ agent: 'fake', task: 'u' }] })), /Invalid parameters/)
    assert.match(h.text(await h.run({ agent: 'nope', task: 't', background: true })), /^Unknown agent: "nope"\. Available agents: .*"fake"/)
    process.env.PI_CODE_SUBAGENT_DEPTH = '3'
    const refused = h.text(await h.run({ agent: 'fake', task: 'c9' }))
    assert.match(refused, /Nested subagent runs are not allowed: this session is at depth 3, the cap is 3/)
    assert.equal(await h.fire('before_agent_start', { systemPrompt: 'base' }).then((r) => r.filter(Boolean).length), 0, 'no teto não há roster')
  } finally {
    await h.finish()
  }
})

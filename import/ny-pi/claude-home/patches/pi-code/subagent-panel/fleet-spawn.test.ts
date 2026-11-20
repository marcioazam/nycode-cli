// Integração dos ganchos de parada da frota atravessando um processo filho real (pi falso): node --experimental-strip-types --test ~/.pi/agent/claude-home/patches/pi-code/subagent-panel/fleet-spawn.test.ts
import assert from 'node:assert/strict'
import { mkdirSync, rmdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fleetTestEnv } from './setup.ts'

const { tmp, ext } = fleetTestEnv('fleet-spawn-')
const store = await import(`${ext}/subagent/fleet/store.ts`)
const trackerMod = await import(`${ext}/subagent/fleet/tracker.ts`)
const sourceMod = await import(`${ext}/subagent/fleet/source.ts`)
const runMod = await import(`${ext}/subagent/run.ts`)
const bgMod = await import(`${ext}/subagent/background.ts`)
const registryText = await import(`${ext}/subagent/registry-text.ts`)

// O filho falso: 'ok' emite uma mensagem do assistente sem '\n' final (o resto do buffer no close) e sai com 0;
// 'alive' emite a mesma linha com '\n' e fica vivo até o SIGTERM.
const fakePi = join(tmp, 'fake-pi.mjs')
writeFileSync(
  fakePi,
  `const msg = { type: 'message_end', message: { role: 'assistant', provider: 'anthropic', model: 'claude-sonnet-5-5', thinkingLevel: 'high', content: [{ type: 'text', text: 'fake done' }], stopReason: 'stop' } }
if (process.env.FAKE_PI_MODE === 'ok') { process.stdout.write(JSON.stringify(msg)); process.exit(0) }
process.stdout.write(JSON.stringify(msg) + '\\n')
setInterval(() => {}, 1000)
`,
)
process.env.FAKE_PI_MODE = 'alive'

const agent = { name: 'fake', description: 'fake', systemPrompt: 'x', source: 'user', filePath: join(tmp, 'fake.md') }
const deadline = 5000

async function waitFor<T>(what: string, probe: () => T | undefined | false): Promise<T> {
  const end = Date.now() + deadline
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

type Rec = { id: string; state: string; pid?: number; stoppedBy?: string; activity?: string; provider?: string; model?: string; effort?: string; modelSeen?: boolean; effortSeen?: boolean }

// Roda `body` com uma frota principal e o argv[1] apontando para o filho falso; limpa grupos órfãos.
async function withFleet(mode: string, body: (dir: string) => Promise<void>): Promise<void> {
  delete process.env.PI_CODE_SUBAGENT_DEPTH
  delete process.env.PI_CODE_SUBAGENT
  const dir: string = store.ensureFleetDir()
  const savedArgv = process.argv[1]
  process.argv[1] = fakePi
  process.env.FAKE_PI_MODE = mode
  try {
    await body(dir)
  } finally {
    process.argv[1] = savedArgv
    for (const r of store.readRecords(dir) as Rec[]) {
      // Só grupos ainda vivos: o pgid de um filho que já saiu pode ter sido reusado.
      if (r.pid && r.state === 'running')
        try {
          process.kill(-r.pid, 'SIGKILL')
        } catch {
          /* já saiu */
        }
    }
    store.removeFleetDir()
  }
}

// runSingleAgent gera o próprio agentId (run.ts:221): o gancho onPhase('start') o revela, ainda de forma síncrona.
function startForeground(): { id: () => string; result: Promise<any> } {
  let id = ''
  const result = runMod.runSingleAgent({ defaultCwd: tmp, agents: [agent], agentName: 'fake', task: 'go', makeDetails: () => ({}), onPhase: (phase: string, _a: string, agentId: string) => phase === 'start' && (id = agentId) })
  return { id: () => id, result }
}

const runningRec = (dir: string, id: string) => (): Rec | undefined => {
  const r = store.readRecord(dir, id) as Rec | undefined
  return r && r.state === 'running' && r.pid ? r : undefined
}

test('foreground: filho que termina com 0 fecha o registro como done, sem stoppedBy; a última linha sem \\n chega ao painel', async () => {
  await withFleet('ok', async (dir) => {
    const { id: getId, result } = startForeground()
    const res = await result
    assert.equal(res.exitCode, 0)
    assert.notEqual(res.stopReason, 'aborted')
    assert.match(JSON.stringify(res.messages), /fake done/)
    const id = getId()
    const rec = (await waitFor('done record', () => (store.readRecord(dir, id)?.state === 'done' ? store.readRecord(dir, id) : undefined))) as Rec
    assert.ok(rec.pid)
    assert.equal(rec.stoppedBy, undefined)
    assert.equal(rec.activity, 'fake done', 'o tracker leu o resto do buffer no close')
  })
})

// Modelo/esforço (docs/subagent-model-effort.md AC4/AC5) pela fiação real de spawn: o argv configura, o que o filho emite vence.
const runtimeOf = (r: Rec) => ({ provider: r.provider, model: r.model, effort: r.effort, modelSeen: r.modelSeen, effortSeen: r.effortSeen })
const OBSERVED_RUNTIME = { provider: 'anthropic', model: 'claude-sonnet-5-5', effort: 'high', modelSeen: true, effortSeen: true }

test('foreground: o modelo/esforço emitidos pelo filho chegam ao registro e vencem o configurado no argv', async () => {
  await withFleet('ok', async (dir) => {
    let id = ''
    await runMod.runSingleAgent({ defaultCwd: tmp, agents: [{ ...agent, model: 'cfg-model' }], agentName: 'fake', task: 'go', makeDetails: () => ({}), onPhase: (phase: string, _a: string, agentId: string) => phase === 'start' && (id = agentId) })
    const rec = (await waitFor('done record', () => (store.readRecord(dir, id)?.state === 'done' ? store.readRecord(dir, id) : undefined))) as Rec
    assert.deepEqual(runtimeOf(rec), OBSERVED_RUNTIME)
  })
})

test('background: o modelo/esforço emitidos pelo filho chegam ao registro; sem eles o configurado fica sem observed', async () => {
  await withFleet('ok', async (dir) => {
    const { id, finished } = startBg({ args: [fakePi, '--model', 'cfg-model', '--thinking', 'low'] })
    await finished
    const rec = (await waitFor('done record', () => (store.readRecord(dir, id)?.state === 'done' ? store.readRecord(dir, id) : undefined))) as Rec
    assert.deepEqual(runtimeOf(rec), OBSERVED_RUNTIME)
  })
  await withFleet('ok', async (dir) => {
    // O filho "rico" não informa provedor nem esforço: o argv segue como configurado e nada vira observed.
    const { id, finished } = startBg({ args: [fakeRich, '--model', 'cfg-model', '--thinking', 'low'] })
    await finished
    const rec = (await waitFor('failed record', () => (store.readRecord(dir, id)?.state === 'failed' ? store.readRecord(dir, id) : undefined))) as Rec
    assert.equal(rec.effort, 'low')
    assert.equal(rec.effortSeen, undefined)
    assert.equal(rec.provider, undefined)
  })
})

for (const [name, stop, note, by] of [
  ['{cancel} (stopOwnRun)', 'stopOwnRun', 'AGENT_STOP_NOTE', 'agent'],
  ['o painel (stopRun)', 'stopRun', 'USER_STOP_NOTE', 'user'],
] as const) {
  test(`foreground: parada por ${name} mata o grupo do filho e marca ${by}`, async () => {
    await withFleet('alive', async (dir) => {
      const { id: getId, result } = startForeground()
      const id = await waitFor('agent id', () => getId())
      const rec = await waitFor('running record', runningRec(dir, id))
      assert.equal(sourceMod[stop](rec.id), 'stopping')
      const res = await result
      assert.equal(res.stopReason, 'aborted')
      assert.equal(res.errorMessage, trackerMod[note])
      const fin = (await waitFor('cancelled record', () => (store.readRecord(dir, id)?.state === 'cancelled' ? store.readRecord(dir, id) : undefined))) as Rec
      assert.equal(fin.stoppedBy, by)
      await waitFor('child gone', () => gone(rec.pid as number))
    })
  })
}

for (const [name, stop, note, by] of [
  ['o painel (stopRun)', 'stopRun', 'USER_STOP_NOTE', 'user'],
  ['{cancel} (stopOwnRun)', 'stopOwnRun', 'AGENT_STOP_NOTE', 'agent'],
] as const) {
  test(`background: parada por ${name} cancela a execução e anota ${by}`, async () => {
    await withFleet('alive', async (dir) => {
      let done: any
      const finished = new Promise((r) => (done = r))
      const id = bgMod.startBackgroundRun('fake', 'go', { command: process.execPath, args: [fakePi], cwd: tmp }, (run: unknown) => done(run))
      assert.ok(id)
      const rec = await waitFor('running record', runningRec(dir, id))
      assert.equal(sourceMod[stop](id), 'stopping')
      const run: any = await finished
      assert.equal(run.state, 'cancelled')
      assert.ok(run.output.endsWith(`[${trackerMod[note]}]`), run.output)
      const fin = (await waitFor('cancelled record', () => (store.readRecord(dir, id)?.state === 'cancelled' ? store.readRecord(dir, id) : undefined))) as Rec
      assert.equal(fin.stoppedBy, by)
      await waitFor('child gone', () => gone(rec.pid as number))
    })
  })
}

// O filho "rico": uso, modelo, erro, evento de ferramenta, ruído, stderr e saída com o código de FAKE_EXIT (3 por padrão).
const fakeRich = join(tmp, 'fake-pi-rich.mjs')
writeFileSync(
  fakeRich,
  `const m = (o) => process.stdout.write(JSON.stringify(o) + '\\n')
m({ type: 'message_end', message: { role: 'assistant', model: 'm-1', stopReason: 'stop', errorMessage: 'oops', usage: { input: 10, output: 5, cacheRead: 2, cacheWrite: 1, cost: { total: 0.5 }, totalTokens: 18 }, content: [{ type: 'text', text: 'rich done' }] } })
m({ type: 'tool_result_end', message: { role: 'toolResult', content: [{ type: 'text', text: 'tool out' }] } })
m({ type: 'noise' })
process.stdout.write('not json\\n')
process.stderr.write('boom on stderr')
process.exit(Number(process.env.FAKE_EXIT ?? 3))
`,
)

const lastText = (res: any): string => res.messages.filter((m: any) => m.role === 'assistant').at(-1)?.content.map((c: any) => c.text).join('\n')
const settle = (id: string, dir: string, state: string) => (): Rec | undefined => (store.readRecord(dir, id)?.state === state ? (store.readRecord(dir, id) as Rec) : undefined)

test('foreground: uso, modelo, erro, stderr e código de saída do filho chegam ao resultado; ruído e evento de ferramenta são tratados', async () => {
  await withFleet('ok', async () => {
    process.argv[1] = fakeRich
    const updates: string[] = []
    // Uma tentativa só: o respawn (zz-subagent-respawn.patch) tem testes próprios e reexecutaria o filho que sai com 3.
    process.env.PI_SUBAGENT_RESPAWN = '0'
    const res = await runMod.runSingleAgent({ defaultCwd: tmp, agents: [agent], agentName: 'fake', task: 'go', makeDetails: () => ({}), onUpdate: (u: any) => updates.push(u.content[0].text) }).finally(() => delete process.env.PI_SUBAGENT_RESPAWN)
    assert.equal(res.exitCode, 3)
    assert.equal(res.stderr, 'boom on stderr')
    assert.deepEqual(res.usage, { input: 10, output: 5, cacheRead: 2, cacheWrite: 1, cost: 0.5, contextTokens: 18, turns: 1 })
    assert.equal(res.model, 'm-1')
    assert.equal(res.errorMessage, 'oops')
    assert.deepEqual(res.messages.map((m: any) => m.role), ['assistant', 'toolResult'], 'ruído e linha inválida não viram mensagem')
    assert.ok(updates.includes('rich done'), `o painel recebeu o texto parcial: ${updates}`)
  })
})

test('foreground: agente desconhecido e ferramentas que não resolvem recusam sem criar filho', async () => {
  await withFleet('ok', async (dir) => {
    const phases: string[] = []
    const onPhase = (phase: string) => phases.push(phase)
    const unknown = await runMod.runSingleAgent({ defaultCwd: tmp, agents: [agent], agentName: 'nope', task: 'go', makeDetails: () => ({}), onPhase })
    assert.equal(unknown.exitCode, 1)
    assert.equal(unknown.agentSource, 'unknown')
    assert.equal(unknown.stderr, 'Unknown agent: "nope". Available agents: "fake".')
    const noTools = await runMod.runSingleAgent({ defaultCwd: tmp, agents: [{ ...agent, tools: ['not_a_tool'] }], agentName: 'fake', task: 'go', makeDetails: () => ({}), onPhase })
    assert.equal(noTools.exitCode, 1)
    assert.match(noTools.stderr, /Agent "fake" would launch with zero tools: no entry in \[not_a_tool\] resolves to a tool\./)
    assert.deepEqual(phases, [], 'recusa não dispara o par start/stop')
    assert.deepEqual(store.readRecords(dir), [], 'nenhum filho foi registrado')
  })
})

test('foreground: isolation worktree fora de um repositório git falha a execução em vez de rodar no diretório real', async () => {
  await withFleet('ok', async (dir) => {
    const res = await runMod.runSingleAgent({ defaultCwd: tmp, agents: [{ ...agent, isolation: 'worktree' }], agentName: 'fake', task: 'go', makeDetails: () => ({}) })
    assert.equal(res.exitCode, 1)
    assert.match(res.stderr, /^isolation: worktree could not be created: .* is not a git repository$/)
    assert.deepEqual(store.readRecords(dir), [])
  })
})

test('foreground: cwd inexistente falha o spawn e deixa o motivo no stderr', async () => {
  await withFleet('ok', async () => {
    const res = await runMod.runSingleAgent({ defaultCwd: tmp, cwd: join(tmp, 'nao-existe'), agents: [agent], agentName: 'fake', task: 'go', makeDetails: () => ({}) })
    assert.equal(res.exitCode, 1)
    assert.match(res.stderr, /ENOENT/)
  })
})

test('foreground: maxTurns encerra o filho após o N-ésimo turno, sem falha, com a saída marcada como parcial', async () => {
  await withFleet('alive', async (dir) => {
    const { id: getId, result } = (() => {
      let id = ''
      const result = runMod.runSingleAgent({ defaultCwd: tmp, agents: [{ ...agent, maxTurns: 1 }], agentName: 'fake', task: 'go', makeDetails: () => ({}), onPhase: (phase: string, _a: string, agentId: string) => phase === 'start' && (id = agentId) })
      return { id: () => id, result }
    })()
    const res = await result
    assert.equal(res.exitCode, 0, 'o SIGTERM do próprio teto não é falha do agente')
    assert.equal(res.partial, true)
    assert.match(lastText(res), /fake done[\s\S]*\[Output is partial: the subagent stopped at its maxTurns limit\.\]/)
    const rec = await waitFor('closed record', () => (store.readRecord(dir, getId())?.state !== 'running' ? (store.readRecord(dir, getId()) as Rec) : undefined))
    await waitFor('child gone', () => gone(rec.pid as number))
  })
})

test('foreground: abortar pelo sinal mata o grupo do filho e a chamada rejeita; sinal já abortado também', async () => {
  await withFleet('alive', async (dir) => {
    const ac = new AbortController()
    const { id: getId, result } = startForegroundWith(ac.signal)
    const rec = await waitFor('running record', runningRec(dir, await waitFor('agent id', () => getId())))
    ac.abort()
    await assert.rejects(result, /Subagent was aborted/)
    await waitFor('child gone', () => gone(rec.pid as number))
    const pre = AbortSignal.abort()
    await assert.rejects(runMod.runSingleAgent({ defaultCwd: tmp, agents: [agent], agentName: 'fake', task: 'go', makeDetails: () => ({}), signal: pre }), /Subagent was aborted/)
  })
})

function startForegroundWith(signal: AbortSignal): { id: () => string; result: Promise<any> } {
  let id = ''
  const result = runMod.runSingleAgent({ defaultCwd: tmp, agents: [agent], agentName: 'fake', task: 'go', makeDetails: () => ({}), signal, onPhase: (phase: string, _a: string, agentId: string) => phase === 'start' && (id = agentId) })
  return { id: () => id, result }
}

test('getPiInvocation: o script do processo, o runtime genérico (pi no PATH) e o binário empacotado', () => {
  const savedArgv = process.argv[1]
  const savedExec = process.execPath
  try {
    process.argv[1] = fakePi
    assert.deepEqual(runMod.getPiInvocation(['-p']), { command: savedExec, args: [fakePi, '-p'] })
    process.argv[1] = '/$bunfs/root/pi'
    assert.deepEqual(runMod.getPiInvocation(['-p']), { command: 'pi', args: ['-p'] }, 'script virtual do bun: cai no pi do PATH')
    process.argv[1] = join(tmp, 'nao-existe.mjs')
    assert.deepEqual(runMod.getPiInvocation(['-p']), { command: 'pi', args: ['-p'] })
    Object.defineProperty(process, 'execPath', { value: '/opt/pi/pi-binario', configurable: true })
    assert.deepEqual(runMod.getPiInvocation(['-p']), { command: '/opt/pi/pi-binario', args: ['-p'] }, 'binário compilado: roda a si mesmo')
  } finally {
    Object.defineProperty(process, 'execPath', { value: savedExec, configurable: true })
    process.argv[1] = savedArgv
  }
})

// Fundo: inicia uma execução e devolve o id e a promessa da execução final.
function startBg(spawn: { command?: string; args: string[]; cwd?: string; maxTurns?: number }) {
  let done: (run: any) => void = () => {}
  const finished = new Promise<any>((r) => (done = r))
  const id = bgMod.startBackgroundRun('fake', 'go', { command: process.execPath, cwd: tmp, ...spawn }, (run: unknown) => done(run))
  return { id: id as string, finished }
}

test('background: spawn que falha (comando inexistente) fecha a execução como failed com o motivo no stderr', async () => {
  await withFleet('ok', async () => {
    const { id, finished } = startBg({ command: join(tmp, 'sem-comando'), args: [] })
    assert.ok(id)
    const run = await finished
    assert.equal(run.state, 'failed')
    assert.equal(run.exitCode, 1)
    assert.match(run.stderr, /ENOENT/)
    assert.match(registryText.tasksStatusText([run]), /failed \(0 turns\) - go\n {2}stderr: .*ENOENT/)
  })
})

test('background: saída não zero fica failed com stderr, turnos e texto; o aviso de conclusão traz a cauda do stderr', async () => {
  await withFleet('ok', async () => {
    const { finished } = startBg({ args: [fakeRich] })
    const run = await finished
    assert.equal(run.state, 'failed')
    assert.equal(run.exitCode, 3)
    assert.equal(run.turns, 1)
    assert.equal(run.output, 'rich done')
    assert.equal(run.stderr, 'boom on stderr')
    const text = registryText.backgroundCompletionText(run)
    assert.match(text, /^Background subagent run bg-[0-9a-f]+ \(fake\) failed after 1 turns\.\n\nrich done\n\nstderr tail:\nboom on stderr$/)
  })
})

test('background: maxTurns encerra no turno limite como done parcial e o aviso ensina a retomar', async () => {
  await withFleet('alive', async () => {
    const { id, finished } = startBg({ args: [fakePi], maxTurns: 1 })
    const run = await finished
    assert.equal(run.state, 'done')
    assert.equal(run.exitCode, 0)
    assert.equal(run.partial, true)
    assert.match(registryText.backgroundCompletionText(run), new RegExp(`Resume it with \\{resume: "${id}", task: "\\.\\.\\."\\} to continue`))
  })
})

test('background: retomar (resume) reexecuta a sessão; unknown, still-running, cwd-gone e cancelar fora de hora respondem certo', async () => {
  await withFleet('ok', async (dir) => {
    const sub = join(tmp, 'sub-cwd')
    mkdirSync(sub, { recursive: true })
    const first = startBg({ args: [fakePi, 'primeira'], cwd: sub }) // a tarefa é sempre o último argumento: é ela que o resume troca
    await first.finished
    assert.equal(bgMod.resumeBackgroundRun('bg-nope', 'x', () => {}), 'unknown')
    assert.equal(bgMod.cancelBackgroundRun('bg-nope'), 'unknown')
    assert.equal(bgMod.cancelBackgroundRun(first.id), 'not-running')
    let done2: (run: any) => void = () => {}
    const second = new Promise<any>((r) => (done2 = r))
    assert.equal(bgMod.resumeBackgroundRun(first.id, 'segunda', done2), 'resumed')
    assert.equal(bgMod.resumeBackgroundRun(first.id, 'terceira', () => {}), 'still-running')
    const run = await second
    assert.equal(run.state, 'done')
    assert.equal(run.task, 'segunda')
    assert.equal(run.output, 'fake done')
    assert.match(bgMod.backgroundStatusText(), new RegExp(`${first.id} fake: done \\(exit 0, 1 turns\\) - segunda`))
    rmdirSync(sub)
    assert.equal(bgMod.resumeBackgroundRun(first.id, 'quarta', () => {}), 'cwd-gone')
    assert.match(registryText.resumeResultText(first.id, 'quarta', () => {}), /no longer exists/)
    assert.match(registryText.resumeResultText('bg-nope', 'x', () => {}), /^Unknown background run: bg-nope\.\n\n/)
    assert.equal(store.readRecords(dir).filter((r: Rec) => r.id === first.id).length, 1)
  })
})

test('background: no teto de execuções simultâneas o início devolve null e retomar responde at-capacity; cancelAll sinaliza todas', async () => {
  await withFleet('alive', async (dir) => {
    process.env.FAKE_PI_MODE = 'ok'
    const done = startBg({ args: [fakePi] })
    await done.finished
    process.env.FAKE_PI_MODE = 'alive'
    const live = Array.from({ length: bgMod.MAX_BACKGROUND_RUNS }, () => startBg({ args: [fakePi] }))
    assert.equal(bgMod.startBackgroundRun('fake', 'extra', { command: process.execPath, args: [fakePi], cwd: tmp }, () => {}), null)
    assert.equal(bgMod.resumeBackgroundRun(done.id, 'x', () => {}), 'at-capacity')
    assert.match(registryText.resumeResultText(done.id, 'x', () => {}), /Background run cap reached \(8 concurrent\)/)
    assert.equal(bgMod.activeBackgroundRuns(), bgMod.MAX_BACKGROUND_RUNS)
    assert.equal(bgMod.cancelAllBackgroundRuns(), bgMod.MAX_BACKGROUND_RUNS)
    for (const run of await Promise.all(live.map((l) => l.finished))) assert.equal(run.state, 'cancelled')
    await waitFor('registry idle', () => bgMod.activeBackgroundRuns() === 0)
    void dir
  })
})

test('registry-text: aviso de conclusão (sem saída, mensagem do usuário longa) e listagem /tasks (plural, corte de tarefa e de cauda)', () => {
  assert.match(registryText.backgroundCompletionText({ id: 'bg-1', agent: 'a', state: 'done', turns: 1 }), /^Background subagent run bg-1 \(a\) done after 1 turns\.\n\n\(no output\)$/)
  const long = 'x'.repeat(600)
  const text = registryText.backgroundCompletionText({ id: 'bg-1', agent: 'a', state: 'done', turns: 2, output: 'ok' }, long)
  assert.ok(text.startsWith('Report only, no action needed'))
  assert.ok(text.includes(`"${'x'.repeat(500)}…"`) && !text.includes('x'.repeat(501)), 'a mensagem do usuário é cortada em 500 caracteres')
  const table = registryText.tasksStatusText([
    { id: 'bg-1', agent: 'a', task: 't'.repeat(80), state: 'done', turns: 1, output: `linha1\n${'y'.repeat(300)}` },
    { id: 'bg-2', agent: 'b', task: 'curta', state: 'running', turns: 0 },
  ])
  const [one, tail, two] = table.split('\n')
  assert.equal(one, `bg-1 a: done (1 turn) - ${'t'.repeat(60)}`)
  assert.equal(tail, `  ${'y'.repeat(200)}...`)
  assert.equal(two, 'bg-2 b: running - curta')
  assert.equal(registryText.tasksStatusText([]), 'No background subagent runs.')
})

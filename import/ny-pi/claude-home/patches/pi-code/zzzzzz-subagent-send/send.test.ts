// Testes do `send` do coordenador (D1-D8 de docs/pi-subagent-send-2026-11-13.md): node --experimental-strip-types --test ~/.pi/agent/claude-home/patches/pi-code/zzzzzz-subagent-send/send.test.ts
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, test } from 'node:test'
import { fleetTestEnv } from '../subagent-panel/setup.ts'

const { tmp, ext } = fleetTestEnv('fleet-send-')
// A descoberta de agentes lê o HOME e o diretório do pi: ambos apontam para um lar de mentira (depois do setup, que já fixou a origem).
const home = join(tmp, 'home')
const agentDir = join(home, '.pi', 'agent')
mkdirSync(join(agentDir, 'agents'), { recursive: true })
writeFileSync(join(agentDir, 'agents', 'fake.md'), '---\nname: fake\ndescription: agente falso dos testes do send\n---\nVoce e falso.\n')
process.env.HOME = home
process.env.PI_CODING_AGENT_DIR = agentDir
delete process.env.CLAUDE_CONFIG_DIR
delete process.env.PI_CODE_SUBAGENT
delete process.env.PI_CODE_SUBAGENT_DEPTH
delete process.env.PI_CODE_TEAMS

const store = await import(`${ext}/subagent/fleet/store.ts`)
const inbox = await import(`${ext}/subagent/fleet/inbox.ts`)
const sourceMod = await import(`${ext}/subagent/fleet/source.ts`)
const registryText = await import(`${ext}/subagent/registry-text.ts`)
const paramsMod = await import(`${ext}/subagent/params.ts`)
const bgMod = await import(`${ext}/subagent/background.ts`)
const { default: subagentExtension } = await import(`${ext}/subagent/index.ts`)

const id = (n = 1): string => `fg-${n.toString(16).padStart(8, '0')}`
const LEAD = '[message from lead (main session), not the user]: '
const SENT_SLOT = Symbol.for('pi-code.fleet.send-count')
const globals = globalThis as Record<symbol, unknown>

afterEach(() => {
  delete process.env.PI_CODE_SUBAGENT_SEND
  delete process.env.PI_CODE_SUBAGENT
  delete process.env.PI_CODE_SUBAGENT_DEPTH
  delete process.env.PI_CODE_FLEET_DIR
  delete process.env.PI_CODE_FLEET_RUN_ID
  globals[SENT_SLOT] = undefined
  store.removeFleetDir()
})

const baseRecord = (rid: string, over: Record<string, unknown> = {}) => ({
  v: 1,
  id: rid,
  parentId: null,
  depth: 1,
  agent: 'a',
  task: 't',
  background: false,
  state: 'running',
  startedAt: 1,
  updatedAt: 1,
  turns: 0,
  toolCalls: 0,
  tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, context: 0 },
  cost: 0,
  ownerPid: process.pid,
  ...over,
})

// Profundidade 0 com um diretório da frota novo; o afterEach o remove.
function mainFleet(): string {
  delete process.env.PI_CODE_SUBAGENT_DEPTH
  delete process.env.PI_CODE_SUBAGENT
  process.env.PI_CODE_SUBAGENT_SEND = '1'
  return store.ensureFleetDir()
}

type Resume = [string, string, boolean | undefined]
function fakeResume(result = true): Resume[] {
  const calls: Resume[] = []
  sourceMod.getFleetSource({
    resume: (rid: string, text: string, fromUser?: boolean) => {
      calls.push([rid, text, fromUser])
      return result
    },
  })
  return calls
}

const inboxTexts = (dir: string, rid: string): string[] => store.readInbox(dir, rid, 0).items.map((m: { text: string }) => m.text)

// ---- filho: acks consumed e too-late ----

type Handlers = Record<string, Array<() => void>>
function childPi() {
  const handlers: Handlers = {}
  const sent: string[] = []
  const pi = {
    sendUserMessage: (text: string) => void sent.push(text),
    on: (event: string, h: () => void) => void (handlers[event] ??= []).push(h),
  }
  const fire = (event: string): void => void (handlers[event] ?? []).forEach((h) => h())
  return { pi, sent, fire, handlers }
}

// Sobe o vigia do filho `rid` num diretório da frota próprio, com o relógio simulado.
function startChild(t: { mock: { timers: { enable(o: { apis: string[] }): void; tick(ms: number): void } } }, rid: string, pi: unknown): string {
  const root = store.fleetRoot()
  mkdirSync(root, { recursive: true, mode: 0o700 })
  const dir = join(root, `${process.pid}-${rid.slice(3)}`)
  mkdirSync(dir, { recursive: true })
  t.mock.timers.enable({ apis: ['setInterval'] })
  process.env.PI_CODE_SUBAGENT_DEPTH = '1'
  process.env.PI_CODE_FLEET_DIR = dir
  process.env.PI_CODE_FLEET_RUN_ID = rid
  inbox.startInboxWatcher(pi)
  return dir
}

const outcomes = (dir: string, rid: string): string[] => store.readAcks(dir, rid, 0).items.map((a: { id: string; outcome: string }) => `${a.id}:${a.outcome}`)

test('AC3/AC8: a mensagem steered recebe a ack consumed no primeiro turn_start depois dela; a ack steered do painel segue igual', (t) => {
  const c = childPi()
  const rid = id(0x101)
  const dir = startChild(t, rid, c.pi)
  store.appendInbox(dir, rid, { id: 'm1', t: 1, text: 'primeira' })
  t.mock.timers.tick(1000)
  assert.deepEqual(c.sent, ['primeira'])
  assert.deepEqual(outcomes(dir, rid), ['m1:steered'], 'antes do turno só a ack steered')
  assert.equal(store.undeliveredCount(dir, rid), 1)
  c.fire('turn_start')
  assert.deepEqual(outcomes(dir, rid), ['m1:steered', 'm1:consumed'])
  assert.equal(store.undeliveredCount(dir, rid), 0)
  c.fire('turn_start')
  assert.equal(outcomes(dir, rid).length, 2, 'um turn_start sem pendência não grava nada')
  inbox.stopInboxWatcher()
})

test('AC3: um turno que começa dentro do próprio sendUserMessage (agente ocioso) também consome', (t) => {
  const c = childPi()
  const rid = id(0x102)
  const dir = startChild(t, rid, c.pi)
  c.pi.sendUserMessage = (text: string) => {
    c.sent.push(text)
    c.fire('turn_start')
  }
  store.appendInbox(dir, rid, { id: 'm1', t: 1, text: 'acorda' })
  t.mock.timers.tick(1000)
  assert.equal(store.undeliveredCount(dir, rid), 0)
  inbox.stopInboxWatcher()
})

test('AC3/AC4: no agent_settled, o steered sem turno e o que chegou depois do último poll viram too-late; o shutdown não repete', (t) => {
  const c = childPi()
  const rid = id(0x103)
  const dir = startChild(t, rid, c.pi)
  store.appendInbox(dir, rid, { id: 'm1', t: 1, text: 'steered mas sem turno' })
  t.mock.timers.tick(1000)
  store.appendInbox(dir, rid, { id: 'm2', t: 2, text: 'chegou depois do último poll' })
  c.fire('agent_settled')
  assert.deepEqual(outcomes(dir, rid), ['m1:steered', 'm1:too-late', 'm2:too-late'])
  assert.equal(store.undeliveredCount(dir, rid), 2)
  c.fire('session_shutdown')
  assert.equal(outcomes(dir, rid).length, 3, 'o dreno do shutdown não relê o que já foi dado como too-late')
  inbox.stopInboxWatcher()
})

test('AC3: mensagem depois do agent_settled: o poll a entrega, e o dreno do session_shutdown a marca too-late', (t) => {
  const c = childPi()
  const rid = id(0x104)
  const dir = startChild(t, rid, c.pi)
  c.fire('agent_settled')
  store.appendInbox(dir, rid, { id: 'm3', t: 3, text: 'tarde demais' })
  t.mock.timers.tick(1000)
  assert.deepEqual(outcomes(dir, rid), ['m3:steered'])
  inbox.stopInboxWatcher() // o index.ts para o vigia antes do dreno do shutdown: o dreno não depende do relógio
  c.fire('session_shutdown')
  assert.deepEqual(outcomes(dir, rid), ['m3:steered', 'm3:too-late'])
})

test('AC3: sendUserMessage que lança grava too-late e a mensagem não fica pendente para consumed', (t) => {
  const c = childPi()
  const rid = id(0x105)
  const dir = startChild(t, rid, c.pi)
  c.pi.sendUserMessage = () => {
    throw new Error('gone')
  }
  store.appendInbox(dir, rid, { id: 'm1', t: 1, text: 'x' })
  t.mock.timers.tick(1000)
  c.fire('turn_start')
  assert.deepEqual(outcomes(dir, rid), ['m1:too-late'])
  inbox.stopInboxWatcher()
})

test('o vigia ganha os ganchos uma vez por pi; sem pi.on funciona; reiniciar zera o pendente; sem vigia os ganchos não fazem nada', (t) => {
  const c = childPi()
  const rid = id(0x106)
  const dir = startChild(t, rid, c.pi)
  inbox.startInboxWatcher(c.pi) // /reload no mesmo pi: sem gancho duplicado
  assert.deepEqual(Object.values(c.handlers).map((h) => h.length), [1, 1, 1])
  store.appendInbox(dir, rid, { id: 'm1', t: 1, text: 'x' })
  t.mock.timers.tick(1000)
  c.fire('turn_start')
  assert.equal(outcomes(dir, rid).filter((o) => o.endsWith(':consumed')).length, 1)
  store.appendInbox(dir, rid, { id: 'm2', t: 2, text: 'y' })
  t.mock.timers.tick(1000)
  inbox.startInboxWatcher({ sendUserMessage: () => {} }) // pi sem `on` (stub mínimo): sem erro, e o pendente de m2 foi descartado
  c.fire('agent_settled')
  assert.equal(outcomes(dir, rid).some((o) => o === 'm2:too-late'), true, 'o novo vigia reinicia do offset 0 e o dreno relê m2 como too-late')
  process.env.PI_CODE_SUBAGENT_DEPTH = '0'
  inbox.startInboxWatcher(c.pi) // profundidade 0: nenhum vigia ativo
  const before = outcomes(dir, rid).length
  c.fire('turn_start')
  c.fire('agent_settled')
  c.fire('session_shutdown')
  assert.equal(outcomes(dir, rid).length, before)
  inbox.stopInboxWatcher()
})

test('undeliveredCount: sem consumed conta tudo; id inválido conta zero', () => {
  const dir = mainFleet()
  assert.equal(store.undeliveredCount(dir, id(0x110)), 0)
  store.appendInbox(dir, id(0x110), { id: 'a', t: 1, text: 'a' })
  store.appendInbox(dir, id(0x110), { id: 'b', t: 2, text: 'b' })
  store.appendAck(dir, id(0x110), { id: 'a', t: 3, outcome: 'steered' })
  assert.equal(store.undeliveredCount(dir, id(0x110)), 2)
  store.appendAck(dir, id(0x110), { id: 'a', t: 4, outcome: 'consumed' })
  assert.equal(store.undeliveredCount(dir, id(0x110)), 1)
  assert.equal(store.undeliveredCount(dir, 'bad'), 0)
})

// ---- remetente: sendFromLead ----

test('AC7: a chave PI_CODE_SUBAGENT_SEND: padrão ligada, só "0" desliga; schema e resposta seguem a chave', () => {
  const dir = mainFleet()
  store.writeRecord(dir, baseRecord(id(1)))
  for (const on of [undefined, '1', 'true']) {
    if (on === undefined) delete process.env.PI_CODE_SUBAGENT_SEND
    else process.env.PI_CODE_SUBAGENT_SEND = on
    assert.equal(sourceMod.sendEnabled(), true)
  }
  for (const off of ['0']) {
    process.env.PI_CODE_SUBAGENT_SEND = off
    assert.equal(sourceMod.sendEnabled(), false)
    assert.equal(sourceMod.sendFromLead(id(1), 'oi'), 'disabled')
    assert.equal('send' in paramsMod.subagentParams().properties, false)
  }
  assert.deepEqual(inboxTexts(dir, id(1)), [], 'desligada não escreve na inbox')
  process.env.PI_CODE_SUBAGENT_SEND = '1'
  assert.equal(sourceMod.sendEnabled(), true)
  assert.equal('send' in paramsMod.subagentParams().properties, true)
  assert.equal(sourceMod.sendFromLead(id(1), 'oi'), 'queued')
})

test('AC1/AC8: o send do coordenador entra rotulado e retorna queued; o send do painel segue sem rótulo e sem mudança', () => {
  const dir = mainFleet()
  store.writeRecord(dir, baseRecord(id(2)))
  assert.equal(sourceMod.sendFromLead(id(2), '  corrige o escopo  '), 'queued')
  assert.deepEqual(inboxTexts(dir, id(2)), [`${LEAD}corrige o escopo`])
  const calls: unknown[][] = []
  const panel = sourceMod.createFleetSource({ resume: (...a: unknown[]) => (calls.push(a), true) })
  assert.equal(panel.send(id(2), 'do humano'), 'queued')
  assert.equal(inboxTexts(dir, id(2)).at(-1), 'do humano')
  store.writeRecord(dir, baseRecord(id(3), { state: 'done', background: true }))
  assert.equal(panel.send(id(3), 'de novo'), 'resumed')
  assert.deepEqual(calls, [[id(3), 'de novo']], 'o painel retoma com 2 argumentos: texto cru, aviso de relatório do usuário')
})

test('AC6: recusas explícitas sem escrever na inbox (vazio, grande, desconhecido, de outro dono)', () => {
  const dir = mainFleet()
  store.writeRecord(dir, baseRecord(id(4)))
  store.writeRecord(dir, baseRecord(id(5), { ownerPid: process.ppid }))
  assert.equal(sourceMod.sendFromLead(id(4), ''), 'empty')
  assert.equal(sourceMod.sendFromLead(id(4), '   \n'), 'empty')
  assert.equal(sourceMod.sendFromLead(id(4), 'x'.repeat(4001)), 'too-long')
  assert.equal(sourceMod.sendFromLead(id(99), 'oi'), 'unknown')
  assert.equal(sourceMod.sendFromLead('bad', 'oi'), 'unknown')
  assert.equal(sourceMod.sendFromLead(id(5), 'oi'), 'not-owned')
  assert.deepEqual(inboxTexts(dir, id(4)), [])
  assert.deepEqual(inboxTexts(dir, id(5)), [])
  assert.equal(sourceMod.sendFromLead(id(4), 'x'.repeat(4000)), 'queued', '4000 caracteres é o limite aceito')
})

test('AC6: sem diretório da frota o id é desconhecido', () => {
  process.env.PI_CODE_SUBAGENT_SEND = '1'
  assert.equal(sourceMod.sendFromLead(id(6), 'oi'), 'unknown')
})

test('AC6: no máximo 20 envios por run (contados pelo arquivo da inbox) e 60 por processo', () => {
  const dir = mainFleet()
  store.writeRecord(dir, baseRecord(id(7)))
  for (let i = 0; i < 20; i++) assert.equal(sourceMod.sendFromLead(id(7), `m${i}`), 'queued')
  assert.equal(sourceMod.sendFromLead(id(7), 'a 21ª'), 'run-limit')
  assert.equal(inboxTexts(dir, id(7)).length, 20)
  globals[SENT_SLOT] = undefined // a contagem do processo é independente do arquivo
  store.writeRecord(dir, baseRecord(id(8)))
  globals[SENT_SLOT] = { n: 59 }
  assert.equal(sourceMod.sendFromLead(id(8), 'a 60ª'), 'queued')
  assert.equal(sourceMod.sendFromLead(id(8), 'a 61ª'), 'process-limit')
  assert.equal(inboxTexts(dir, id(8)).length, 1)
})

test('AC2: run de fundo depth 1 já terminado é retomado com o texto rotulado; os demais retornam not-running sem retomar', () => {
  const dir = mainFleet()
  const calls = fakeResume()
  store.writeRecord(dir, baseRecord(id(10), { state: 'done', background: true }))
  store.writeRecord(dir, baseRecord(id(11), { state: 'done', background: false }))
  store.writeRecord(dir, baseRecord(id(12), { state: 'done', background: true, depth: 2 }))
  assert.equal(sourceMod.sendFromLead(id(10), 'continue'), 'resumed')
  assert.deepEqual(calls, [[id(10), `${LEAD}continue`, false]], 'rótulo também no caminho resumed; a conclusão não vira relatório do usuário')
  assert.equal(sourceMod.sendFromLead(id(11), 'continue'), 'not-running')
  assert.equal(sourceMod.sendFromLead(id(12), 'continue'), 'not-running')
  assert.equal(calls.length, 1)
  fakeResume(false)
  assert.equal(sourceMod.sendFromLead(id(10), 'continue'), 'not-running', 'a retomada recusada não vira resumed')
  globals[Symbol.for('pi-code.fleet.source')] = undefined
  assert.equal(sourceMod.sendFromLead(id(10), 'continue'), 'not-running', 'sem fonte criada nada retoma')
})

test('D5: depth > 1 recebe queued para run vivo; o rótulo do remetente de depth >= 1 nomeia o pai e o id dele', () => {
  const dir = mainFleet()
  store.writeRecord(dir, baseRecord(id(20), { agent: 'chefe' }))
  store.writeRecord(dir, baseRecord(id(21), { depth: 2, parentId: id(20) }))
  process.env.PI_CODE_SUBAGENT_DEPTH = '1'
  process.env.PI_CODE_FLEET_DIR = dir
  process.env.PI_CODE_FLEET_RUN_ID = id(20)
  assert.equal(sourceMod.sendFromLead(id(21), 'filho, mude o foco'), 'queued')
  assert.deepEqual(inboxTexts(dir, id(21)), [`[message from parent chefe (${id(20)}), not the user]: filho, mude o foco`])
  process.env.PI_CODE_FLEET_RUN_ID = id(77) // sem registro próprio: nome genérico
  assert.equal(sourceMod.sendFromLead(id(21), 'de novo'), 'queued')
  assert.equal(inboxTexts(dir, id(21)).at(-1), `[message from parent agent (${id(77)}), not the user]: de novo`)
})

test('AC5: o run termina entre a checagem e o append: retomado (depth 1 de fundo) ou not-delivered, nunca queued', () => {
  const dir = mainFleet()
  const calls = fakeResume()
  const ends = (rid: string, over: Record<string, unknown>) => () => store.writeRecord(dir, baseRecord(rid, { ...over, state: 'done' }))
  store.writeRecord(dir, baseRecord(id(30), { background: true }))
  assert.equal(sourceMod.sendFromLead(id(30), 'a tempo?', ends(id(30), { background: true })), 'resumed')
  assert.deepEqual(calls, [[id(30), `${LEAD}a tempo?`, false]])
  store.writeRecord(dir, baseRecord(id(31)))
  assert.equal(sourceMod.sendFromLead(id(31), 'a tempo?', ends(id(31), {})), 'not-delivered')
  store.writeRecord(dir, baseRecord(id(32), { background: true }))
  fakeResume(false)
  assert.equal(sourceMod.sendFromLead(id(32), 'a tempo?', ends(id(32), { background: true })), 'not-delivered')
  assert.equal(calls.length, 1)
})

test('AC5: o run terminou mas já consumiu a mensagem: queued é verdadeiro', () => {
  const dir = mainFleet()
  const calls = fakeResume()
  store.writeRecord(dir, baseRecord(id(33), { background: true }))
  const consumedThenEnds = (): void => {
    const msg = store.readInbox(dir, id(33), 0).items[0]
    store.appendAck(dir, id(33), { id: msg.id, t: 1, outcome: 'consumed' })
    store.writeRecord(dir, baseRecord(id(33), { background: true, state: 'done' }))
  }
  assert.equal(sourceMod.sendFromLead(id(33), 'chegou', consumedThenEnds), 'queued')
  assert.equal(calls.length, 0)
})

test('AC4: a conclusão e o status avisam as mensagens não entregues; chave desligada ou zero pendente não avisa', () => {
  const dir = mainFleet()
  store.writeRecord(dir, baseRecord(id(40), { state: 'done' }))
  store.writeRecord(dir, baseRecord(id(41), { state: 'running' }))
  store.writeRecord(dir, baseRecord(id(42), { state: 'done', ownerPid: process.ppid }))
  for (const rid of [id(40), id(41), id(42)]) {
    store.appendInbox(dir, rid, { id: 'a', t: 1, text: 'a' })
    store.appendInbox(dir, rid, { id: 'b', t: 2, text: 'b' })
    store.appendAck(dir, rid, { id: 'a', t: 3, outcome: 'consumed' })
  }
  const run = (rid: string) => ({ id: rid, agent: 'a', state: 'done', turns: 1, output: 'ok' })
  const NOTE = '1 message(s) sent with send were not delivered; resend with resume'
  assert.ok(registryText.backgroundCompletionText(run(id(40))).includes(NOTE))
  assert.ok(registryText.backgroundCompletionText(run(id(40)), 'oi').includes(NOTE))
  assert.ok(!registryText.backgroundCompletionText(run(id(43))).includes('sent with send'), 'sem inbox: nada a avisar')
  const status = registryText.statusWithFleet()
  assert.ok(status.includes(`${id(40)}: ${NOTE}`), status)
  assert.ok(!status.includes(id(41)), 'run vivo: a mensagem ainda pode chegar')
  assert.ok(!status.includes(id(42)), 'run de outro dono não é listado')
  store.appendAck(dir, id(40), { id: 'b', t: 4, outcome: 'consumed' })
  assert.ok(!registryText.statusWithFleet().includes('sent with send'))
  process.env.PI_CODE_SUBAGENT_SEND = '0'
  assert.ok(!registryText.backgroundCompletionText(run(id(41))).includes('sent with send'), 'chave desligada: o texto antigo, intacto')
})

test('sendResultText: cada desfecho diz o que aconteceu e o que fazer', () => {
  const text = (o: string): string => registryText.sendResultText(id(0x50), o)
  assert.match(text('queued'), /next turn boundary, not in the middle of a tool call/)
  assert.match(text('resumed'), /resumed it with your message/)
  assert.match(text('not-running'), /use \{resume: "fg-00000050"/)
  assert.match(text('not-delivered'), /ended before it read your message/)
  assert.match(text('unknown'), /Unknown run: fg-00000050/)
  assert.equal(text('disabled'), 'send is disabled (PI_CODE_SUBAGENT_SEND=0).')
  assert.match(text('empty'), /needs text/)
  assert.match(text('too-long'), /4000/)
  assert.match(text('not-owned'), /your own runs/)
  assert.match(text('run-limit'), /20 messages/)
  assert.match(text('process-limit'), /60 messages/)
})

// ---- ponto de entrada: o schema, a descrição e o execute ----

const fakePi = join(tmp, 'fake-pi-send.mjs')
writeFileSync(
  fakePi,
  `import { existsSync } from 'node:fs'
import { join } from 'node:path'
const task = (process.argv.at(-1).match(/Task: ([\\s\\S]*)$/) ?? [])[1] ?? ''
const gate = join(process.env.FAKE_PI_DIR, 'release-' + task)
const timer = setInterval(() => {
  if (!existsSync(gate)) return
  clearInterval(timer)
  process.stdout.write(JSON.stringify({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'feito:' + task }], stopReason: 'stop' } }) + '\\n')
  process.exit(0)
}, 20)
`,
)
process.env.FAKE_PI_DIR = tmp
const release = (task: string): void => writeFileSync(join(tmp, `release-${task}`), '')

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

// Um pi e um contexto falsos, sem UI: o `send` tem de criar a frota mesmo sem painel (evals em modo print/json).
function boot() {
  const handlers = new Map<string, Array<(...a: any[]) => any>>()
  const tools: any[] = []
  const sent: Sent[] = []
  const pi = {
    on: (event: string, h: (...a: any[]) => any) => void handlers.set(event, [...(handlers.get(event) ?? []), h]),
    registerTool: (def: any) => void tools.push(def),
    registerCommand: () => {},
    events: { emit: () => {}, on: () => () => {} },
    getActiveTools: () => ['subagent'],
    sendMessage: (msg: Sent['msg'], o: Sent['opts']) => void sent.push({ msg, opts: o }),
    sendUserMessage: () => {},
  }
  const ctx = {
    cwd: tmp,
    hasUI: false,
    ui: { setWidget: () => {}, onTerminalInput: () => () => {}, getEditorText: () => '', notify: () => {}, custom: async () => undefined },
    sessionManager: { getBranch: () => [{ type: 'message' }] },
    modelRegistry: { getAvailable: () => [] },
  }
  const savedArgv = process.argv[1]
  process.argv[1] = fakePi
  subagentExtension(pi)
  const tool = tools.find((t) => t.name === 'subagent')
  const fire = async (event: string, payload: unknown = {}): Promise<void> => {
    for (const h of handlers.get(event) ?? []) await h(payload, ctx)
  }
  const run = (params: Record<string, unknown>): Promise<any> => tool.execute('call', params, undefined, undefined, ctx)
  const text = (res: any): string => res.content[0].text
  const finish = async (): Promise<void> => {
    try {
      await fire('session_shutdown', { reason: 'reload' })
    } finally {
      for (const r of store.readRecords(store.currentFleetDir() ?? '') as Array<{ pid?: number; state: string }>)
        if (r.pid && r.state === 'running')
          try {
            process.kill(-r.pid, 'SIGKILL')
          } catch {
            /* já saiu */
          }
      store.removeFleetDir()
      bgMod.resetBackgroundRuns()
      process.argv[1] = savedArgv
    }
  }
  return { tool, sent, fire, run, text, finish }
}

test('AC7: chave desligada: schema e descrição sem send, e uma chamada com send responde "send is disabled" sem erro', async () => {
  process.env.PI_CODE_SUBAGENT_SEND = '0'
  const h = boot()
  try {
    await h.fire('session_start')
    assert.equal('send' in h.tool.parameters.properties, false)
    assert.ok(!h.tool.description.includes('{send:'))
    assert.equal(store.currentFleetDir(), undefined, 'sem UI, sem time e sem a chave: nenhuma frota')
    assert.match(h.text(await h.run({ send: id(60), task: 'oi' })), /send is disabled/)
  } finally {
    await h.finish()
  }
})

test('AC1/AC2/AC4/AC7: chave ligada em sessão sem UI: frota criada, send queued, aviso de não entregue na conclusão, depois resumed com rótulo', async () => {
  process.env.PI_CODE_SUBAGENT_SEND = '1'
  const h = boot()
  try {
    await h.fire('session_start')
    assert.ok(store.currentFleetDir(), 'a chave liga a frota também sem UI')
    assert.equal('send' in h.tool.parameters.properties, true)
    assert.match(h.tool.description, /\{send: <run id>, task: <message>\} redirects a live background run \(background runs only\)/)
    const started = h.text(await h.run({ agent: 'fake', task: 'sa1', background: true }))
    const bgId = started.match(/Started background run (bg-[0-9a-f]+)/)?.[1]
    assert.ok(bgId, started)
    assert.match(h.text(await h.run({ send: bgId })), /Pass task with send/)
    assert.match(h.text(await h.run({ send: bgId, task: 'mude o foco' })), /queued .*next turn boundary/)
    release('sa1')
    const first = await waitFor('first completion', () => h.sent.find((s) => s.msg.content.includes('feito:sa1')))
    assert.ok(first.msg.content.includes('1 message(s) sent with send were not delivered; resend with resume'), first.msg.content)
    await waitFor('record done', () => (store.readRecord(store.currentFleetDir(), bgId) as { state: string } | undefined)?.state === 'done')
    assert.match(h.text(await h.run({ send: bgId, task: 'ok' })), /resumed it with your message/)
    const label = `${LEAD}ok`
    release(label)
    const second = await waitFor('resume completion', () => h.sent.find((s) => s.msg.content.includes(`feito:${label}`)))
    assert.ok(!second.msg.content.includes('Report only'), 'a retomada do send é conclusão normal, não relatório de mensagem do usuário')
    assert.ok(!second.msg.content.includes('sent with send'), 'a retomada zera a inbox')
  } finally {
    await h.finish()
  }
})

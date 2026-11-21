// Testes do zzzzzzzzzzzzzzz-run-section.patch (extensions/run): registro, detecção, parada escalonada, wait,
// notificação awaited e render. Offline, sem gasto:
//   NO_COLOR=1 node --experimental-strip-types --test ~/.pi/agent/claude-home/patches/pi-code/zzzzzzzzzzzzzzz-run-section/run-section.test.ts
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

process.env.NO_COLOR = '1'
const HOME = homedir()
const EXT = process.env.PI_CODE_EXT ?? `${HOME}/.pi/agent/npm/node_modules/pi-code/extensions`
// O Node não tira tipos de .ts dentro de node_modules: testa uma cópia do pacote, com o pi ao lado.
const tmp = mkdtempSync(join(tmpdir(), 'run-section-test-'))
const ext = join(tmp, 'extensions')
cpSync(EXT, ext, { recursive: true })
mkdirSync(join(tmp, 'node_modules'))
const modules = `${HOME}/.pi/agent/install/releases/${readFileSync(`${HOME}/.pi/agent/install/current-version`, 'utf8').trim()}/node_modules`
symlinkSync(`${modules}/@earendil-works`, join(tmp, 'node_modules', '@earendil-works'))
symlinkSync(`${modules}/typebox`, join(tmp, 'node_modules', 'typebox'))
process.env.PI_RUNS_DIR = join(tmp, 'runs')

const { RunRegistry, displayState, MAX_LIVE, TAIL_LINES } = await import(`${ext}/run/registry.ts`)
const { instrument, extractPid } = await import(`${ext}/run/detect.ts`)
const { startShell, stopRun, registerDetected, pollOnce, alive, tree } = await import(`${ext}/run/shell.ts`)
const { execute } = await import(`${ext}/run/tool.ts`)
const { RunSection } = await import(`${ext}/run/section.ts`)
const { renderRun } = await import(`${ext}/run/view.ts`)
const { nav } = await import(`${ext}/subagent/section-nav/nav.ts`)
const runIndex = (await import(`${ext}/run/index.ts`)).default

const strip = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, '')
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function until(cond: () => boolean, ms = 5000): Promise<void> {
  const end = Date.now() + ms
  while (!cond()) {
    assert.ok(Date.now() < end, 'timeout esperando condição')
    await sleep(20)
  }
}
const theme = { fg: (_c: string, t: string) => t, bold: (t: string) => t }

test('registro: exit 0 → done, exit ≠ 0 → failed, parada pedida → stopped, exit desconhecido → done', () => {
  const reg = new RunRegistry()
  const mk = () => reg.add({ name: 'x', command: 'x', cwd: '/' })
  const a = mk(), b = mk(), c = mk(), d = mk()
  assert.equal(a.state, 'running')
  reg.finish(a, { exitCode: 0 })
  reg.finish(b, { exitCode: 3 })
  c.stopRequested = true
  reg.finish(c, { signal: 'SIGTERM' })
  reg.finish(d, {})
  assert.deepEqual([a.state, b.state, c.state, d.state], ['done', 'failed', 'stopped', 'done'])
  assert.equal(b.exitCode, 3)
  reg.finish(a, { exitCode: 9 }) // já terminou: não muda
  assert.equal(a.exitCode, 0)
})

test('registro: new-output e silent são derivados; concluídos somem após 30 min ou com x', () => {
  let t = 1_000_000
  const reg = new RunRegistry()
  reg.now = () => t
  const r = reg.add({ name: 'x', command: 'x', cwd: '/' })
  assert.equal(displayState(r, t), 'running')
  reg.push(r, 'a\n')
  assert.equal(displayState(r, t), 'new-output')
  r.seenSeq = r.outputSeq
  t += 6 * 60_000
  assert.equal(displayState(r, t), 'silent')
  reg.finish(r, { exitCode: 0 })
  assert.equal(reg.snapshot().length, 1)
  t += 31 * 60_000
  assert.equal(reg.snapshot().length, 0)
  const s = reg.add({ name: 's', command: 's', cwd: '/' })
  reg.finish(s, { exitCode: 1 })
  assert.equal(reg.clearFinished(), 1)
  assert.equal(reg.snapshot().length, 0)
})

test('ring buffer de 1000 linhas; linha incompleta espera o \\n', () => {
  const reg = new RunRegistry()
  const r = reg.add({ name: 'x', command: 'x', cwd: '/' })
  reg.push(r, Array.from({ length: 1500 }, (_, i) => `l${i}`).join('\n') + '\npar')
  assert.equal(r.tail.length, TAIL_LINES)
  assert.equal(r.tail[0], 'l500')
  assert.equal(r.tail.at(-1), 'l1499')
  assert.equal(r.partial, 'par')
  reg.push(r, 'cial\n')
  assert.equal(r.tail.at(-1), 'parcial')
})

test('limite de 8 runs vivos: erro claro; terminar libera vaga', () => {
  const reg = new RunRegistry()
  const live = Array.from({ length: MAX_LIVE }, () => reg.add({ name: 'x', command: 'x', cwd: '/' }))
  assert.throws(() => reg.add({ name: 'x', command: 'x', cwd: '/' }), /limite de 8 runs vivos/)
  reg.finish(live[0]!, { exitCode: 0 })
  assert.doesNotThrow(() => reg.add({ name: 'x', command: 'x', cwd: '/' }))
})

test('detecção: formas suportadas recebem a captura do PID', () => {
  const cwd = '/work'
  const nohup = instrument('nohup x > f 2>&1 &', cwd)!
  assert.ok(nohup.command.startsWith('nohup x > f 2>&1 &\n'))
  assert.match(nohup.command, /echo "__PI_RUN_PID=\$!"; \(exit \$__pi_rc\)$/)
  assert.equal(nohup.logPath, '/work/f')
  assert.equal(nohup.display, 'nohup x > f 2>&1')
  assert.equal(nohup.trailing, true)
  assert.equal(instrument('nohup x > /tmp/o.log 2>&1 &', cwd)!.logPath, '/tmp/o.log')
  assert.equal(instrument('nohup x >>"/tmp/a b.log" &', cwd)!.logPath, '/tmp/a b.log')
  assert.equal(instrument('cmd &', cwd)!.logPath, undefined)
  assert.equal(instrument('a && b &', cwd)!.display, 'a && b')
  assert.equal(instrument('systemd-run --user --scope -- x &', cwd)!.display, 'systemd-run --user --scope -- x')
  assert.equal(instrument('setsid x &', cwd)!.display, 'setsid x')
  const mid = instrument('nohup x > f & sleep 1; tail f', cwd)!
  assert.equal(mid.trailing, false)
  assert.equal(mid.display, 'nohup x > f')
  assert.equal(instrument('cd d && nohup x > f &', cwd)!.logPath, undefined) // base mudou: caminho relativo não é confiável
})

test('detecção: comandos sem background ou ambíguos não são alterados', () => {
  for (const cmd of [
    'ls -la',
    'a && b',
    'make 2>&1 | tee log',
    'echo "a & b"',
    "echo 'x &'",
    'cmd 2>&1',
    'cmd &> out',
    'a & b &', // dois jobs: $! ambíguo
    'cat <<EOF &\nx\nEOF',
    'echo `x` &',
    '(x) &',
    'x &\ny',
    'x # nota &',
    'echo "oops &',
    'echo hi \\',
  ]) assert.equal(instrument(cmd, '/w'), undefined, cmd)
})

test('detecção: o marcador sai do texto e o PID vem junto', () => {
  assert.deepEqual(extractPid('antes\n__PI_RUN_PID=4242\n'), { pid: 4242, text: 'antes\n' })
  assert.deepEqual(extractPid('__PI_RUN_PID=\n'), { pid: undefined, text: '' })
  assert.deepEqual(extractPid('sem marcador'), { text: 'sem marcador' })
})

test('parada escalonada: processo que ignora SIGINT morre por TERM/KILL no prazo', async () => {
  const reg = new RunRegistry()
  const r = startShell(reg, { command: `bash -c 'trap "" INT; echo armado; sleep 30'`, cwd: tmp })
  // Espera o trap estar instalado: sob carga o bash demora mais que um sleep fixo e o SIGINT o mataria antes.
  await until(() => (pollOnce(reg, false), r.tail.includes('armado')), 5000)
  assert.equal(stopRun(reg, r, { termMs: 300, killMs: 300 }), 'stopping')
  await sleep(150)
  assert.equal(r.state, 'running', 'o SIGINT sozinho não mata')
  await until(() => r.state !== 'running', 3000)
  assert.equal(r.state, 'stopped')
  assert.equal(stopRun(reg, r), 'not-running')
  assert.equal(alive(r.pid!), false)
})

test('detectado: liveness por kill -0 e parada pela árvore de processos', async () => {
  const reg = new RunRegistry()
  const child = spawn('bash', ['-c', 'sleep 30 & wait'], { stdio: 'ignore', detached: true })
  child.unref()
  const r = registerDetected(reg, { pid: child.pid!, command: 'sleep 30', cwd: tmp, repeatable: false })
  await sleep(200)
  pollOnce(reg, true)
  assert.equal(r.state, 'running')
  const family = tree(child.pid!)
  assert.ok(family.length >= 2, 'bash + sleep')
  stopRun(reg, r, { termMs: 200, killMs: 200 })
  await until(() => (pollOnce(reg, true), r.state !== 'running'), 3000)
  assert.equal(r.state, 'stopped')
  // o filho em background ignora SIGINT e fica órfão se o pai morre antes: TERM/KILL ainda o alcançam
  await until(() => family.every((p: number) => !alive(p)), 3000)
  assert.equal(r.exitCode, undefined) // exit desconhecido
})

test('wait: termina com estado e tail; estoura o timeout com o run ainda vivo', async () => {
  const reg = new RunRegistry()
  const start = await execute(reg, { action: 'start', command: 'echo oi; echo erro >&2; exit 4', name: 'curto' }, tmp)
  const id = /iniciado (\S+)/.exec(start.content[0]!.text)![1]!
  assert.match(start.content[0]!.text, /log: .*\.log/)
  const done = await execute(reg, { action: 'wait', id, timeout_s: 20 }, tmp)
  assert.match(done.content[0]!.text, /failed exit 4/)
  assert.match(done.content[0]!.text, /oi\nerro/)
  const slow = await execute(reg, { action: 'start', command: 'sleep 30' }, tmp)
  const sid = /iniciado (\S+)/.exec(slow.content[0]!.text)![1]!
  const t0 = Date.now()
  const out = await execute(reg, { action: 'wait', id: sid, timeout_s: 1 }, tmp)
  assert.match(out.content[0]!.text, /ainda rodando após 1s/)
  assert.ok(Date.now() - t0 < 3000)
  const stopped = await execute(reg, { action: 'stop', id: sid }, tmp)
  assert.match(stopped.content[0]!.text, /SIGINT agora/)
  await until(() => reg.get(sid)!.state !== 'running')
  const list = await execute(reg, { action: 'list' }, tmp)
  assert.match(list.content[0]!.text, /stopped/)
  assert.equal((await execute(reg, { action: 'tail', id: 'nada' }, tmp)).isError, true)
})

// pi falso: guarda handlers, ferramenta e mensagens.
function fakePi() {
  const handlers = new Map<string, (e: any, c: any) => any>()
  const sent: Array<{ msg: any; opts: any }> = []
  let tool: any
  return {
    handlers, sent,
    get tool() { return tool },
    pi: {
      on: (n: string, h: any) => void handlers.set(n, h),
      registerTool: (t: any) => void (tool = t),
      sendMessage: (msg: any, opts: any) => void sent.push({ msg, opts }),
    },
  }
}
const ctx = (ui?: unknown): any => ({ cwd: tmp, hasUI: ui !== undefined, ui })

test('awaited: ao terminar, sendMessage com triggerTurn; wait em curso suprime a mensagem', async () => {
  const f = fakePi()
  runIndex(f.pi as any)
  f.handlers.get('session_start')!({ reason: 'startup' }, ctx())
  await f.tool.execute('1', { action: 'start', command: 'echo pronto', await: true }, undefined, undefined, ctx())
  await until(() => f.sent.length === 1)
  const { msg, opts } = f.sent[0]!
  assert.equal(msg.customType, 'run-finished')
  assert.equal(msg.display, true)
  assert.equal(opts.triggerTurn, true)
  assert.match(msg.content, /done exit 0/)
  assert.match(msg.content, /pronto/)
  // com um wait pendente, o resultado vai na resposta da tool: sem mensagem
  const p = f.tool.execute('2', { action: 'start', command: 'sleep 0.3; echo tarde', await: true }, undefined, undefined, ctx())
  const id = /iniciado (\S+)/.exec((await p).content[0].text)![1]
  await f.tool.execute('3', { action: 'wait', id, timeout_s: 20 }, undefined, undefined, ctx())
  await sleep(300)
  assert.equal(f.sent.length, 1)
  f.handlers.get('session_shutdown')!({ reason: 'quit' }, ctx())
})

test('bash com nohup … &: o comando é instrumentado, o marcador some do resultado e o run é registrado', async () => {
  const f = fakePi()
  runIndex(f.pi as any)
  f.handlers.get('session_start')!({ reason: 'startup' }, ctx())
  const log = join(tmp, 'det.log')
  const event: any = { toolName: 'bash', toolCallId: 'c1', input: { command: `nohup bash -c 'echo ola; sleep 30' > ${log} 2>&1 &` } }
  f.handlers.get('tool_call')!(event, ctx())
  assert.match(event.input.command, /__PI_RUN_PID=/)
  const sh = spawnSync('bash', ['-c', event.input.command], { encoding: 'utf8', cwd: tmp, timeout: 10_000 })
  assert.equal(sh.status, 0)
  const res = f.handlers.get('tool_result')!({ toolName: 'bash', toolCallId: 'c1', content: [{ type: 'text', text: sh.stdout }] }, ctx())
  assert.doesNotMatch(res.content[0].text, /__PI_RUN_PID/)
  // o registro é o compartilhado do processo
  const list = await execute((await import(`${ext}/run/registry.ts`)).sharedRegistry(), { action: 'list' }, tmp)
  const m = /(\S+) \[shell\] \S+ · \d\d:\d\d · nohup bash/.exec(list.content[0]!.text)
  assert.ok(m, list.content[0]!.text)
  const reg = (await import(`${ext}/run/registry.ts`)).sharedRegistry()
  const r = reg.get(m![1]!)
  assert.equal(r.detected, true)
  await until(() => r.tail.includes('ola') || (pollOnce(reg, false), r.tail.includes('ola')))
  stopRun(reg, r, { termMs: 100, killMs: 100 })
  await until(() => (pollOnce(reg, true), r.state !== 'running'), 4000)
  assert.equal(r.state, 'stopped')
  // comando sem background: intacto, sem estado pendente
  const plain: any = { toolName: 'bash', toolCallId: 'c2', input: { command: 'ls' } }
  f.handlers.get('tool_call')!(plain, ctx())
  assert.equal(plain.input.command, 'ls')
  assert.equal(f.handlers.get('tool_result')!({ toolName: 'bash', toolCallId: 'c2', content: [] }, ctx()), undefined)
  f.handlers.get('session_shutdown')!({ reason: 'quit' }, ctx())
})

function sectionWith(reg: any) {
  const widgets: any[] = []
  const tui = { requestRender() {}, terminal: { rows: 40 } }
  const ui = { setWidget: (k: string, f?: (t: unknown, th: unknown) => unknown) => void (widgets.push([k, f]), f?.(tui, theme)) }
  const s = new RunSection(reg)
  s.now = reg.now
  s.start(ctx(ui) as any)
  return { s, widgets, ui }
}

test('render (NO_COLOR): cabeçalho com contagens, glifos, tail inline do selecionado e rodapé; sem runs → []', () => {
  let t = 10_000_000
  const reg = new RunRegistry()
  reg.now = () => t
  const { s } = sectionWith(reg)
  const mk = (name: string, extra: object = {}) => {
    t += 1000
    return reg.add({ name, command: name, cwd: '/', ...extra })
  }
  const r1 = mk('pilot.sh', { awaited: true, logPath: '/x/pilot.log' })
  mk('harbor run')
  const r3 = mk('npm test')
  const r4 = mk('npm watch')
  const r5 = mk('gate')
  const r6 = mk('pytest')
  for (let i = 1; i <= 7; i++) reg.push(r1, `linha ${i}\n`)
  r1.seenSeq = r1.outputSeq
  reg.push(r3, 'novo\n') // não lido
  r4.lastOutputAt = t - 9 * 60_000 // silencioso
  reg.finish(r5, { exitCode: 0 })
  reg.finish(r6, { exitCode: 1 })
  t += 120_000
  r1.lastOutputAt = t // r1 não fica silencioso
  const harbor = reg.snapshot().find((r: any) => r.name === 'harbor run')!
  harbor.lastOutputAt = t
  s.focused = true

  const lines = s.render(120).map(strip)
  const text = lines.join('\n')
  const head = lines.find((l: string) => /^Run \d+/.test(l))!.replace(/\s+/g, ' ')
  assert.match(head, /^Run 4 2\/6$/) // aba com os rodando; detalhe igual ao do Sub Agents: encerrados/total
  assert.match(text, /^■ pilot\.sh/m) // sem margem, quadrado; seleção em vídeo reverso
  assert.ok(s.render(120).some((l: string) => l.includes('\x1b[7m') && l.includes('pilot.sh')))
  assert.match(text, /◆ npm test .*novo output/)
  assert.match(text, /◇ npm watch .*sem output há 11 min/)
  assert.match(text, /✓ gate .*exit 0 · há 2 min/)
  assert.match(text, /✖ pytest .*exit 1 · há 2 min/)
  assert.match(text, /◷ agente espera/)
  // tail inline: só as últimas 5 linhas, com borda
  assert.match(text, /│ linha 7/)
  assert.match(text, /│ linha 3/)
  assert.doesNotMatch(text, /linha 2/)
  assert.match(text, /└ seguindo ▮/)
  assert.match(text, /log completo em \/x\/pilot\.log/)
  // rodapé do grupo, com rule antes
  const foot = lines.at(-1)!
  assert.match(foot, /↑↓ mover · ⏎ tail · f seguir · k parar · r repetir · w agente espera · x limpar concluídos · \/ filtro · esc voltar/)
  assert.match(lines.at(-2)!, /^─+$/)
  // largura curta: trunca, mas `esc voltar` fica
  const narrow = s.render(40).map(strip)
  assert.ok(narrow.every((l: string) => l.length <= 40 || [...l].length <= 40))
  assert.match(narrow.at(-1)!, /esc voltar/)
  // sem foco: sem tail inline nem rodapé
  s.focused = false
  assert.doesNotMatch(s.render(120).map(strip).join('\n'), /│ linha|esc voltar/)
  // sem runs: nada
  assert.deepEqual(renderRun({ rows: [], total: 0, now: t, collapsed: false, focused: false, offset: 0, follow: true, expanded: false, filter: '', filtering: false, motion: false }, theme, 80).lines, [])
  // título com spinner (pedido 2026-11-14): só com run vivo e motion ligado; mesmo spinner do Sub Agents
  const live = reg.snapshot()
  const v = { rows: live, total: live.length, now: t, collapsed: false, focused: false, offset: 0, follow: true, expanded: false, filter: '', filtering: false, motion: true }
  const spun = renderRun(v, theme, 120)
  assert.match(strip(spun.lines[1]!), /RUN\s+[·•●] 2\/6/)
  assert.match(strip(spun.detail), /^[·•●] 2\/6/)
  assert.doesNotMatch(strip(renderRun({ ...v, motion: false }, theme, 120).lines[1]!), /[·•●]/)
  const doneOnly = live.filter((r: any) => r.state !== 'running')
  assert.doesNotMatch(strip(renderRun({ ...v, rows: doneOnly, total: doneOnly.length }, theme, 120).lines[1]!), /[·•●]/)
  s.shutdown()
})

test('seção: aba fechada mostra só a barra; clique na aba aberta não muda nada; timer só com run vivo e corpo aberto; some sem runs', () => {
  nav.resetTabs()
  const reg = new RunRegistry()
  const { s, widgets } = sectionWith(reg)
  assert.equal(widgets.length, 0, 'sem runs não há widget')
  const r = reg.add({ name: 'a', command: 'a', cwd: '/' })
  assert.equal(widgets.at(-1)![0], 'run-section')
  assert.ok((s as any).timer, 'run vivo + aberto → timer')
  s.render(80) // o clique usa o mapa de linhas do último render
  assert.ok(s.render(80).length > 3, 'aberta: barra e corpo')
  assert.ok(s.handleMouse({ type: 'click', x: 1, y: 1 }), 'clica no nome da aba aberta: consumido')
  assert.equal(s.collapsed, false, 'e a aba continua aberta')
  assert.ok((s as any).timer, 'aberta → timer continua')
  nav.register({ id: 'status', active: () => true, hasBody: false, label: () => 'Status', changed() {}, enter: () => false })
  nav.open('status') // outra aba abre: Run fica fechada
  assert.equal(s.collapsed, true)
  assert.equal((s as any).timer, undefined, 'fechada → sem timer')
  assert.equal(s.render(80).length, 3)
  assert.match(strip(s.render(80)[1]!), /^Status   Run 1/)
  assert.ok(!s.render(80).some((l: string) => /pilot|a\s+◐|▸ RUN/.test(strip(l))), 'só a barra, sem corpo')
  s.handleMouse({ type: 'click', x: 10, y: 1 }) // clica na aba fechada: abre
  assert.equal(s.collapsed, false)
  assert.ok((s as any).timer)
  reg.finish(r, { exitCode: 0 })
  assert.equal((s as any).timer, undefined, 'sem runs vivos → sem timer')
  reg.clearFinished()
  assert.equal(widgets.at(-1)![1], undefined, 'sem runs a seção some')
  nav.unregister('status')
  s.shutdown()
})

test('seção: só aparece com run em andamento; concluídos/falhos ficam no registro, sem widget', () => {
  const reg = new RunRegistry()
  const { s, widgets } = sectionWith(reg)
  const shown = () => widgets.length > 0 && widgets.at(-1)![1] !== undefined
  assert.equal(shown(), false, 'vazio: sem widget')
  const a = reg.add({ name: 'a', command: 'a', cwd: '/' })
  const b = reg.add({ name: 'b', command: 'b', cwd: '/' })
  assert.equal(shown(), true)
  reg.finish(a, { exitCode: 0 })
  assert.equal(shown(), true, 'misto ativo + concluído: continua visível')
  assert.ok(s.render(80).length > 0)
  reg.finish(b, { exitCode: 3 })
  assert.equal(shown(), false, 'todos concluídos/falhos: widget some')
  assert.equal(reg.snapshot().length, 2, 'dados retidos para a ferramenta')
  assert.deepEqual(reg.snapshot().map((r: any) => r.state).sort(), ['done', 'failed'])
  const c = reg.add({ name: 'c', command: 'c', cwd: '/' })
  assert.equal(shown(), true, 'novo run reaparece')
  reg.finish(c, { exitCode: 1 })
  assert.equal(shown(), false, 'somente falhos: oculto')
  assert.equal(reg.snapshot().length, 3)
  s.shutdown()
})

test('teclas: filtro, w marca awaited, k para, x limpa concluídos', async () => {
  const reg = new RunRegistry()
  const { s } = sectionWith(reg)
  const a = startShell(reg, { command: 'echo pronto; sleep 30', cwd: tmp, name: 'alfa' })
  // Espera o processo existir no seu grupo: um SIGINT antes disso se perde e a parada só viria no SIGTERM (7,5 s).
  await until(() => (pollOnce(reg, false), a.tail.includes('pronto')), 5000)
  const b = reg.add({ name: 'beta', command: 'b', cwd: '/' })
  s.focused = true
  s.selectedId = a.id
  s.handleInput('w')
  assert.equal(a.awaited, true)
  s.handleInput('/')
  for (const c of 'bet') s.handleInput(c)
  s.handleInput('\r')
  assert.equal(s.selectedId, b.id)
  assert.match(strip(s.render(100).join('\n')), /filtro "bet"/)
  s.handleInput('/')
  s.handleInput('\x1b') // esc limpa o filtro
  assert.equal(s.filter, '')
  s.selectedId = a.id
  s.handleInput('k')
  await until(() => a.state !== 'running', 3000)
  assert.equal(a.state, 'stopped')
  s.handleInput('x')
  assert.equal(reg.snapshot().length, 1)
  s.shutdown()
})

test('chip RUN: fundo ciano (role text), diferente de TODO azul, STATUS LINE verde e PLAN amarelo', async () => {
  const { chip, HEADING_KINDS } = await import(`${ext}/subagent/fleet-ui/chrome.ts`)
  // Tema falso com cores ANSI resolvidas por role: o chip usa vídeo reverso, então o fg vira fundo.
  const sgr: Record<string, number> = { text: 36, task: 34, success: 32, warning: 33 }
  const theme = { fg: (role: string, s: string) => `\x1b[${sgr[role]}m${s}\x1b[39m`, bold: (s: string) => s }
  const code = (kind: string) => /\x1b\[(3\d)m/.exec(chip(kind, theme))![1]
  assert.equal(HEADING_KINDS.run.role, 'text')
  assert.equal(code('run'), '36')
  assert.equal(code('todo'), '34')
  assert.equal(code('statusline'), '32')
  assert.equal(code('plan'), '33')
  assert.notEqual(code('run'), code('todo'))
  assert.match(chip('run', theme), /^\x1b\[7m\x1b\[36m RUN \x1b\[39m\x1b\[27m$/)
})

// D9 (docs/sync-observabilidade.md): a Run section lê as faixas do fleet (fg- e bg-) e usa os horários do registro do fleet.
test('D9 agentes: faixa fg- do fleet aparece com startedAt/endedAt do registro (não da 1ª leitura), parcial vira capped; onChange do fleet faz sync', async () => {
  const store = await import(`${ext}/subagent/fleet/store.ts`)
  const source = await import(`${ext}/subagent/fleet/source.ts`)
  delete process.env.PI_CODE_SUBAGENT_DEPTH
  delete process.env.PI_CODE_SUBAGENT
  const dir = store.ensureFleetDir()
  const fleet = source.getFleetSource({ resume: () => 'unknown' })
  const now = Date.now()
  const rec = (rid: string, over: object = {}) => ({ v: 1, id: rid, parentId: null, depth: 1, agent: 'swarm-worker', task: 'faz x', background: true, state: 'running', startedAt: now - 120_000, updatedAt: now, turns: 2, toolCalls: 1, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, context: 0 }, cost: 0.25, ownerPid: process.pid, ...over })
  store.writeRecord(dir, rec('fg-aaaaaaaa'))
  store.writeRecord(dir, rec('fg-bbbbbbbb', { depth: 2, parentId: 'fg-aaaaaaaa' }))
  const reg = new RunRegistry()
  const rows = (): any[] => (reg.fleetChanged(), reg.snapshot())
  const a = rows().find((r) => r.id === 'fg-aaaaaaaa')
  assert.ok(a, 'a faixa fg- aparece')
  assert.equal(rows().some((r) => r.id === 'fg-bbbbbbbb'), false, 'só depth 1')
  assert.equal(a.state, 'running')
  assert.equal(a.startedAt, now - 120_000)
  assert.equal(a.turns, 2)
  store.writeRecord(dir, rec('fg-aaaaaaaa', { state: 'done', endedAt: now - 30_000, partial: true, exitCode: 0 }))
  const d = rows().find((r) => r.id === 'fg-aaaaaaaa')
  assert.equal(d.state, 'done')
  assert.equal(d.endedAt, now - 30_000, 'fim = o do registro, não o instante em que foi observado')
  assert.equal(d.capped, true)
  assert.match(renderRun({ rows: [d], total: 1, now, collapsed: false, focused: false, offset: 0, follow: true, expanded: false, filter: '', filtering: false, motion: false }, theme, 100).lines.join('\n'), /parcial/)
  // onChange do fleet → sync da seção
  let syncs = 0
  const { s } = sectionWith(reg)
  const orig = s.sync.bind(s)
  s.sync = () => (syncs++, orig())
  store.writeRecord(dir, rec('fg-cccccccc'))
  await until(() => syncs > 0, 4000)
  assert.ok(reg.snapshot().some((r) => r.id === 'fg-cccccccc'))
  s.shutdown()
  store.removeFleetDir()
  void fleet
})

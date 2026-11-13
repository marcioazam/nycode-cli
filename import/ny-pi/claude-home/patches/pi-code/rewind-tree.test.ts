// Testes do rewind-tree.patch: node --experimental-strip-types --test ~/.pi/agent/claude-home/patches/pi-code/rewind-tree.test.ts
import assert from 'node:assert/strict'
import { execFile, execFileSync } from 'node:child_process'
import { cpSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

const HOME = homedir()
const PATCHES = `${HOME}/.pi/agent/claude-home/patches/pi-code`
const EXT = `${HOME}/.pi/agent/npm/node_modules/pi-code/extensions`
// O Node não tira tipos de .ts dentro de node_modules: testa uma cópia do pacote, com o pi ao lado.
const tmp = mkdtempSync(join(tmpdir(), 'rewind-tree-test-'))
const ext = join(tmp, 'extensions')
cpSync(EXT, ext, { recursive: true })
mkdirSync(join(tmp, 'node_modules'))
symlinkSync(`${HOME}/.pi/agent/install/releases/${readFileSync(`${HOME}/.pi/agent/install/current-version`, 'utf8').trim()}/node_modules/@earendil-works`, join(tmp, 'node_modules', '@earendil-works'))
// O repo-sombra vai para um diretório descartável, nunca para ~/.pi/agent/checkpoints.
process.env.PI_CODING_AGENT_DIR = join(tmp, 'agent')
mkdirSync(process.env.PI_CODING_AGENT_DIR)
const mod = await import(`${ext}/git-checkpoint.ts`)

const CP = { entryId: 'u1', ref: 'refs/pi-code/checkpoints/1', prompt: 'p', createdAt: '2026-01-01T00:00:00Z' }

/** Loads the extension, runs session_start with the given stored checkpoints. */
async function setup(opts: { checkout?: number; stored?: object[] } = {}) {
  const handlers = new Map<string, (...a: any[]) => any>()
  const commands = new Map<string, any>()
  const calls: string[][] = []
  const pi: any = {
    on: (n: string, h: any) => handlers.set(n, h),
    registerCommand: (n: string, c: any) => commands.set(n, c),
    appendEntry: () => {},
    exec: async (_c: string, args: string[]) => {
      calls.push(args)
      if (args.includes('checkout')) return { code: opts.checkout ?? 0, stdout: '', stderr: 'boom', killed: false, truncated: false }
      if (args.includes('ls-tree')) return { code: 0, stdout: 'f.txt\n', stderr: '', killed: false, truncated: false }
      return { code: 0, stdout: '', stderr: '', killed: false, truncated: false }
    },
  }
  mod.default(pi)
  const notes: string[] = []
  const answers: (string | undefined)[] = []
  const selects: string[] = []
  const ui = {
    select: async (title: string, options: string[]) => {
      selects.push(title)
      if (title === 'Rewind to checkpoint:') return options[0]
      return answers.shift()
    },
    notify: (m: string) => notes.push(m),
    setEditorText: () => {},
  }
  const entries = (opts.stored ?? [CP]).map((data) => ({ type: 'custom', customType: 'git-checkpoint', data }))
  const ctx: any = { cwd: tmp, hasUI: true, ui, sessionManager: { getSessionFile: () => join(tmp, 's.jsonl'), getEntries: () => entries, getBranch: () => [] } }
  await handlers.get('session_start')!({ reason: 'startup' }, ctx)
  notes.length = 0 // drop session_start's own warnings (the stub exec has no real repo)
  const checkouts = () => calls.filter((a) => a.includes('checkout') && a.includes(CP.ref)).length
  return { handlers, commands, ctx, notes, answers, selects, checkouts }
}
const before = (h: any, ctx: any, targetId: string) => h.get('session_before_tree')({ preparation: { targetId } }, ctx)

test('registra o handler session_before_tree', async () => {
  assert.ok((await setup()).handlers.has('session_before_tree'))
})

test('/tree para a mensagem com checkpoint: sim restaura o código', async () => {
  const s = await setup()
  s.answers.push('Yes, restore code')
  assert.equal(await before(s.handlers, s.ctx, 'u1'), undefined)
  assert.deepEqual(s.selects, ['Restore code to that point?'])
  assert.equal(s.checkouts(), 1)
  assert.deepEqual(s.notes, ['Code restored to checkpoint'])
})

test('/tree: não mantém o código e não cancela a navegação', async () => {
  const s = await setup()
  s.answers.push('No, keep current code')
  assert.equal(await before(s.handlers, s.ctx, 'u1'), undefined)
  assert.equal(s.checkouts(), 0)
})

test('/tree: diálogo cancelado mantém o código', async () => {
  const s = await setup()
  s.answers.push(undefined)
  assert.equal(await before(s.handlers, s.ctx, 'u1'), undefined)
  assert.equal(s.checkouts(), 0)
})

test('/tree: alvo sem checkpoint (resposta do assistente) não pergunta', async () => {
  const s = await setup()
  await before(s.handlers, s.ctx, 'assistant-7')
  assert.deepEqual(s.selects, [])
})

test('/tree: checkpoint sem ref de código não pergunta', async () => {
  const s = await setup({ stored: [{ ...CP, ref: '' }] })
  await before(s.handlers, s.ctx, 'u1')
  assert.deepEqual(s.selects, [])
})

test('/tree sem UI não pergunta', async () => {
  const s = await setup()
  await before(s.handlers, { ...s.ctx, hasUI: false }, 'u1')
  assert.deepEqual(s.selects, [])
})

test('/tree: falha do git avisa e não bloqueia', async () => {
  const s = await setup({ checkout: 1 })
  s.answers.push('Yes, restore code')
  assert.equal(await before(s.handlers, s.ctx, 'u1'), undefined)
  assert.ok(s.notes.some((n) => n.startsWith('Code restore failed')))
})

test('/tree: exceção na restauração vira aviso', async () => {
  const s = await setup()
  s.answers.push('Yes, restore code')
  s.ctx.ui.notify = (m: string) => {
    if (m === 'Code restored to checkpoint') throw new Error('ui down')
    s.notes.push(m)
  }
  assert.equal(await before(s.handlers, s.ctx, 'u1'), undefined)
  assert.deepEqual(s.notes, ['Code restore failed: ui down'])
})

/** /rewind drives navigateTree, which in pi fires session_before_tree: simulate it. */
async function rewind(mode: string, navigated: { opts?: any }) {
  const s = await setup()
  s.answers.push(mode)
  s.ctx.navigateTree = async (id: string, opts: any) => {
    navigated.opts = opts
    await before(s.handlers, s.ctx, id)
    return { cancelled: false, editorText: 'texto' }
  }
  await s.commands.get('rewind').handler('', s.ctx)
  return s
}

test('guarda: /rewind "Code and conversation" não pergunta de novo na navegação', async () => {
  const nav: any = {}
  const s = await rewind('Code and conversation', nav)
  assert.deepEqual(s.selects, ['Rewind to checkpoint:', 'Restore mode:'])
  assert.equal(s.checkouts(), 1)
  assert.equal(nav.opts.summarize, false)
})

test('Summarize from here: navega com summarize e não toca o código', async () => {
  const nav: any = {}
  const s = await rewind('Summarize from here', nav)
  assert.deepEqual(nav.opts, { summarize: true })
  assert.equal(s.checkouts(), 0)
  assert.deepEqual(s.selects, ['Rewind to checkpoint:', 'Restore mode:'])
  assert.ok(s.notes.includes('Rewind complete'))
})

test('a guarda é liberada depois do /rewind (cancelado ou não)', async () => {
  const s = await setup()
  s.answers.push('Conversation only')
  s.ctx.navigateTree = async () => ({ cancelled: true })
  await s.commands.get('rewind').handler('', s.ctx)
  s.answers.push('Yes, restore code')
  await before(s.handlers, s.ctx, 'u1')
  assert.equal(s.checkouts(), 1)
})

test('patch aplica ao original e reverte no instalado', () => {
  const d = mkdtempSync(join(tmpdir(), 'rewind-orig-'))
  copyFileSync(`${PATCHES}/orig/git-checkpoint.ts`, join(d, 'git-checkpoint.ts'))
  execFileSync('patch', ['-d', d, '-p1', '-N', '--dry-run', '-i', `${PATCHES}/rewind-tree.patch`])
  execFileSync('patch', ['-d', EXT, '-p1', '-R', '--dry-run', '-i', `${PATCHES}/rewind-tree.patch`])
})

// ---- shadow repo de ponta a ponta, com git de verdade ----
const AGENT = process.env.PI_CODING_AGENT_DIR!
const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' }
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, env: GIT_ENV, encoding: 'utf8' })
let seq = 0

type Fail = (args: string[]) => { code: number; stderr?: string } | undefined
interface Opts { gitRepo?: boolean; session?: string | null; fail?: Fail; cwd?: string; stored?: object[] }

/** One extension instance over a real work tree; exec runs the real git (stdin closed, no hang). */
async function real(opts: Opts = {}) {
  const id = ++seq
  const work = opts.cwd ?? join(tmp, `work-${id}`)
  mkdirSync(work, { recursive: true })
  if (opts.gitRepo !== false && !existsSync(join(work, '.git'))) git(work, 'init', '-q', '-b', 'main')
  const handlers = new Map<string, (...a: any[]) => any>()
  const commands = new Map<string, any>()
  const appended: any[] = []
  const execs: string[][] = []
  const pi: any = {
    on: (n: string, h: any) => handlers.set(n, h),
    registerCommand: (n: string, c: any) => commands.set(n, c),
    appendEntry: (type: string, data: any) => appended.push({ type, data }),
    exec: (cmd: string, args: string[], o: any) => {
      execs.push(args)
      const injected = opts.fail?.(args)
      if (injected) return Promise.resolve({ code: injected.code, stdout: '', stderr: injected.stderr ?? 'injected failure', killed: false, truncated: false })
      return new Promise((resolve) => {
        const child = execFile(cmd, args, { cwd: o?.cwd, env: GIT_ENV, encoding: 'utf8', maxBuffer: 1 << 26 }, (err: any, stdout: string, stderr: string) =>
          resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout, stderr, killed: false, truncated: false }))
        child.stdin?.end()
      })
    },
  }
  mod.default(pi)
  const sessionFile = opts.session === null ? undefined : join(tmp, opts.session ?? `sess-${id}.jsonl`)
  const entries: any[] = (opts.stored ?? []).map((d: any) => (d.type ? d : { type: 'custom', customType: 'git-checkpoint', data: d }))
  let branch: any[] = []
  const notes: Array<[string, string]> = []
  const answers: (string | undefined)[] = []
  const selects: Array<{ title: string; options: string[] }> = []
  const edits: string[] = []
  const ui = {
    select: async (title: string, options: string[]) => { selects.push({ title, options }); return answers.shift() },
    notify: (m: string, l: string) => notes.push([m, l]),
    setEditorText: (t: string) => edits.push(t),
  }
  const ctx: any = {
    cwd: work, hasUI: true, ui,
    hasPendingMessages: () => false,
    sessionManager: { getSessionFile: () => sessionFile, getEntries: () => entries, getBranch: () => branch },
  }
  const fire = (name: string, event: any = {}, c: any = ctx) => handlers.get(name)!(event, c)
  const user = (entryId: string, text = `prompt ${entryId}`) => { branch = [...branch, { type: 'message', id: entryId, message: { role: 'user', content: text } }] }
  /** A prompted run: user message, turn_start (snapshot), optional edits, turn_end persists the checkpoint. */
  const run = async (entryId: string, edit?: () => Promise<void> | void, text?: string) => {
    user(entryId, text)
    await fire('agent_start'); await fire('before_agent_start'); await fire('turn_start')
    await edit?.()
    await fire('turn_end')
    const last = appended.at(-1)
    if (last) entries.push({ type: 'custom', customType: 'git-checkpoint', data: last.data })
  }
  const edit = async (name: string, content: string) => {
    const file = join(work, name)
    await fire('tool_call', { toolName: 'write', input: { path: file } })
    mkdirSync(join(file, '..'), { recursive: true })
    writeFileSync(file, content)
  }
  const rewind = (mode: string | undefined, index = 0) => {
    answers.push(index === 0 ? 'FIRST' : `NTH${index}`, mode)
  }
  /** Picks the n-th (0 = newest) checkpoint in /rewind. */
  const doRewind = async (n: number, mode: string | undefined, nav?: (id: string, o: any) => any) => {
    const original = ui.select
    let first = true
    ui.select = async (title: string, options: string[]) => {
      selects.push({ title, options })
      if (first) { first = false; return options[n] }
      return mode
    }
    ctx.navigateTree = nav ?? (async () => ({ cancelled: false }))
    try { await commands.get('rewind').handler('', ctx) } finally { ui.select = original }
  }
  await fire('session_start', { reason: 'startup' })
  return { work, fire, run, edit, user, doRewind, rewind, notes, answers, selects, edits, appended, execs, ctx, entries, commands, handlers, sessionFile, read: (n: string) => readFileSync(join(work, n), 'utf8') }
}

test('sessionSlug e capCheckpoints: slug sem caracteres perigosos e teto de 100 mais recentes', () => {
  assert.equal(mod.sessionSlug('/a/b/ses são:1.jsonl'), 'ses_s_o_1.jsonl')
  assert.equal(mod.sessionSlug(undefined), `ephemeral-${process.pid}`)
  const all = Array.from({ length: 105 }, (_, i) => i)
  const kept = mod.capCheckpoints(all)
  assert.equal(kept.length, mod.MAX_CHECKPOINTS_PER_SESSION)
  assert.deepEqual([kept[0], kept.at(-1)], [5, 104])
  assert.equal(mod.capCheckpoints([1, 2]).length, 2)
})

test('pruneCheckpointRepos: remove repos antigos, mantém recentes, o vivo e arquivos; raiz ausente é ignorada', () => {
  const root = mkdtempSync(join(tmpdir(), 'prune-'))
  const old = new Date(Date.now() - 40 * 86400e3)
  for (const d of ['old', 'live', 'fresh']) mkdirSync(join(root, d))
  writeFileSync(join(root, 'stray.txt'), 'x')
  for (const d of ['old', 'live', 'stray.txt']) utimesSync(join(root, d), old, old)
  mod.pruneCheckpointRepos(root, 30, join(root, 'live'))
  assert.deepEqual(readdirSync(root).sort(), ['fresh', 'live', 'stray.txt'])
  assert.doesNotThrow(() => mod.pruneCheckpointRepos(join(root, 'missing'), 30))
})

test('checkpointRetentionDays: padrão de 30 dias sem configuração do usuário', () => {
  assert.equal(mod.checkpointRetentionDays(mkdtempSync(join(tmpdir(), 'nohome-'))), mod.CHECKPOINT_RETENTION_DAYS)
})

test('fluxo real: baseline do primeiro edit, snapshot por prompt e /rewind "Code only" restaura o conteúdo', async () => {
  const s = await real()
  writeFileSync(join(s.work, 'a.txt'), 'a1')
  writeFileSync(join(s.work, 'b.txt'), 'b-orig')
  await s.run('u1', async () => { await s.edit('a.txt', 'a2') })
  assert.equal(s.appended.length, 1)
  assert.deepEqual(Object.keys(s.appended[0].data).sort(), ['createdAt', 'entryId', 'prompt', 'ref'])
  assert.match(s.appended[0].data.ref, /^refs\/pi-code\/checkpoints\//)
  await s.run('u2', async () => { await s.edit('b.txt', 'b-new'); await s.edit('a.txt', 'a3'); await s.edit('c.txt', 'created later') })
  assert.equal(s.appended.length, 2)
  assert.equal(s.read('a.txt'), 'a3')

  await s.doRewind(1, 'Code only') // mais antigo: u1
  assert.equal(s.read('a.txt'), 'a1') // antes do primeiro edit
  assert.equal(s.read('b.txt'), 'b-orig') // primeiro edit posterior ao checkpoint: baseline restaurada
  assert.equal(s.read('c.txt'), 'created later') // arquivo criado depois permanece
  assert.deepEqual(s.notes.at(-1), ['Rewind complete', 'info'])
  assert.equal(s.edits.length, 0) // Code only não mexe na conversa
})

test('/rewind lista do mais novo ao mais antigo com prompt truncado e escolha cancelada não faz nada', async () => {
  const s = await real()
  await s.run('u1', undefined, 'first   prompt')
  await s.run('u2', undefined, 'x'.repeat(100))
  s.answers.push(undefined)
  await s.commands.get('rewind').handler('', s.ctx)
  const options = s.selects.at(-1)!.options
  assert.equal(options.length, 2)
  assert.ok(options[0].startsWith('1. ') && options[0].endsWith(`${'x'.repeat(60)}…`))
  assert.ok(options[1].startsWith('2. ') && options[1].endsWith('first prompt'))
  assert.equal(s.selects.length, 1)
  const n = s.notes.length
  await s.doRewind(0, undefined) // modo cancelado
  assert.equal(s.notes.length, n)
})

test('/rewind sem checkpoints avisa; sem UI não faz nada; label marca checkpoint sem snapshot', async () => {
  const s = await real()
  await s.commands.get('rewind').handler('', s.ctx)
  assert.deepEqual(s.notes.at(-1), ['No checkpoints recorded yet', 'info'])
  const n = s.notes.length
  await s.commands.get('rewind').handler('', { ...s.ctx, hasUI: false })
  assert.equal(s.notes.length, n)
  const r = await real({ stored: [{ entryId: 'e1', ref: '', prompt: '', createdAt: '2026-01-01T00:00:00Z' }, { entryId: '', ref: 'x' }] })
  r.answers.push(undefined)
  await r.commands.get('rewind').handler('', r.ctx)
  assert.equal(r.selects[0].options.length, 1) // entrada sem entryId descartada
  assert.ok(r.selects[0].options[0].endsWith('(empty prompt) [no code snapshot]'))
})

test('restauração: checkpoint sem ref e snapshot vazio deixam o código intacto', async () => {
  const s = await real({ stored: [{ entryId: 'e1', ref: '', prompt: 'p', createdAt: '2026-01-01T00:00:00Z' }] })
  await s.doRewind(0, 'Code only')
  assert.deepEqual(s.notes.at(-2), ['Checkpoint has no code snapshot; code left untouched', 'warning'])
  assert.deepEqual(s.notes.at(-1), ['Rewind complete', 'info'])

  const e = await real()
  writeFileSync(join(e.work, 'keep.txt'), 'keep')
  await e.run('u1') // nenhum arquivo editado: árvore vazia
  await e.doRewind(0, 'Code only')
  assert.ok(e.notes.some(([m]) => m === 'Checkpoint has no files; code left untouched'))
  assert.equal(e.read('keep.txt'), 'keep')
})

test('restauração: ref inexistente falha com aviso e não conclui o rewind nem navega', async () => {
  const s = await real({ stored: [{ entryId: 'e1', ref: 'refs/pi-code/checkpoints/nope', prompt: 'p', createdAt: '2026-01-01T00:00:00Z' }] })
  let navigated = 0
  await s.doRewind(0, 'Code and conversation', async () => { navigated++; return { cancelled: false } })
  assert.ok(s.notes.some(([m, l]) => m.startsWith('Code restore failed:') && l === 'warning'))
  assert.ok(!s.notes.some(([m]) => m === 'Rewind complete'))
  assert.equal(navigated, 0)
})

test('modos de conversa: "Conversation only" não toca o código; editorText, cancelamento e exceção', async () => {
  const s = await real()
  writeFileSync(join(s.work, 'a.txt'), 'a1')
  await s.run('u1', async () => { await s.edit('a.txt', 'a2') })
  let opts: any
  await s.doRewind(0, 'Conversation only', async (id, o) => { opts = [id, o]; return { cancelled: false, editorText: 'refill' } })
  assert.deepEqual(opts, ['u1', { summarize: false }])
  assert.deepEqual(s.edits, ['refill'])
  assert.equal(s.read('a.txt'), 'a2')
  assert.deepEqual(s.notes.at(-1), ['Rewind complete', 'info'])

  const before = s.notes.length
  await s.doRewind(0, 'Conversation only', async () => ({ cancelled: true }))
  assert.equal(s.notes.length, before) // cancelado: sem "Rewind complete"
  await s.doRewind(0, 'Conversation only', async () => { throw new Error('nav down') })
  assert.deepEqual(s.notes.at(-1), ['Conversation restore failed: nav down', 'error'])

  await s.doRewind(0, 'Code and conversation')
  assert.equal(s.read('a.txt'), 'a1')
  assert.deepEqual(s.notes.at(-1), ['Rewind complete', 'info'])
})

test('arquivo ignorado (.git/info/exclude) não entra no checkpoint nem é restaurado; edição fora da árvore é ignorada', async () => {
  const s = await real()
  writeFileSync(join(s.work, '.git', 'info', 'exclude'), 'secret.txt\n')
  await s.fire('session_start', { reason: 'resume' }) // espelha o exclude no shadow
  writeFileSync(join(s.work, 'secret.txt'), 's1')
  writeFileSync(join(s.work, 'a.txt'), 'a1')
  const outside = join(tmp, `outside-${seq}.txt`)
  await s.run('u1', async () => {
    await s.edit('secret.txt', 's2'); await s.edit('a.txt', 'a2')
    await s.fire('tool_call', { toolName: 'write', input: { path: outside } })
    await s.fire('tool_call', { toolName: 'read', input: { path: join(s.work, 'ignored-read.txt') } }) // read não entra
    await s.fire('tool_call', { toolName: 'edit', input: {} }) // sem alvo
  })
  await s.run('u2', async () => { await s.edit('a.txt', 'a3') })
  await s.doRewind(1, 'Code only')
  assert.equal(s.read('a.txt'), 'a1')
  assert.equal(s.read('secret.txt'), 's2')
  assert.ok(!existsSync(outside))
})

test('arquivo apagado depois do checkpoint volta no rewind; diretório via symlink é rastreado onde realmente está', async () => {
  const s = await real()
  mkdirSync(join(s.work, 'real'))
  symlinkSync(join(s.work, 'real'), join(s.work, 'link'))
  writeFileSync(join(s.work, 'real', 'f.txt'), 'f1')
  writeFileSync(join(s.work, 'a.txt'), 'a1')
  await s.run('u1', async () => { await s.edit('a.txt', 'a2'); await s.edit('link/f.txt', 'f2') })
  await s.run('u2')
  rmSync(join(s.work, 'a.txt'))
  writeFileSync(join(s.work, 'real', 'f.txt'), 'f3')
  await s.run('u3') // a.txt rastreado e apagado: remoção é registrada
  await s.doRewind(2, 'Code only')
  assert.equal(s.read('a.txt'), 'a1')
  assert.equal(s.read('real/f.txt'), 'f1')
})

test('rewind a um checkpoint intermediário restaura a versão daquele ponto', async () => {
  const s = await real()
  writeFileSync(join(s.work, 'a.txt'), 'a1')
  await s.run('u1', async () => { await s.edit('a.txt', 'a2') })
  await s.run('u2', async () => { await s.edit('a.txt', 'a3') })
  await s.run('u3', async () => { await s.edit('a.txt', 'a4') })
  await s.doRewind(1, 'Code only') // u2: estado antes do edit do run 2
  assert.equal(s.read('a.txt'), 'a2')
})

test('execução continuada (agent_start sem prompt) reaproveita o checkpoint; follow-up pendente cria outro', async () => {
  const s = await real()
  writeFileSync(join(s.work, 'a.txt'), 'a1')
  await s.run('u1', async () => { await s.edit('a.txt', 'a2') })
  const execsBefore = s.execs.length
  await s.fire('agent_start'); await s.fire('turn_start') // retry: sem before_agent_start
  await s.fire('turn_end')
  assert.equal(s.appended.length, 1)
  assert.ok(!s.execs.slice(execsBefore).some((a) => a.includes('commit')))
  // follow-up enfileirado: novo snapshot, mas turn_end reencontra a mensagem já registrada
  s.ctx.hasPendingMessages = () => true
  await s.fire('agent_start'); await s.fire('turn_start'); await s.fire('turn_end')
  assert.equal(s.appended.length, 1)
  // prompt que repete a mensagem já registrada: descarta o snapshot novo
  s.ctx.hasPendingMessages = () => false
  await s.fire('agent_start'); await s.fire('before_agent_start'); await s.fire('turn_start'); await s.fire('turn_end')
  assert.equal(s.appended.length, 1)
  // sem mensagem de usuário no ramo: nada é gravado
  const e = await real()
  await e.fire('agent_start'); await e.fire('before_agent_start'); await e.fire('turn_start'); await e.fire('turn_end')
  assert.equal(e.appended.length, 0)
})

test('CLAUDE_CODE_DISABLE_FILE_CHECKPOINTING=1 não registra checkpoints', async () => {
  const s = await real()
  process.env.CLAUDE_CODE_DISABLE_FILE_CHECKPOINTING = '1'
  try { await s.run('u1') } finally { delete process.env.CLAUDE_CODE_DISABLE_FILE_CHECKPOINTING }
  assert.equal(s.appended.length, 0)
  await s.commands.get('rewind').handler('', s.ctx)
  assert.deepEqual(s.notes.at(-1), ['No checkpoints recorded yet', 'info'])
})

test('retenção: lista de rewind limitada a 100 ao retomar e ao gravar o 101º', async () => {
  const stored = Array.from({ length: 105 }, (_, i) => ({ entryId: `old${i}`, ref: '', prompt: `old ${i}`, createdAt: '2026-01-01T00:00:00Z' }))
  const s = await real({ stored })
  s.answers.push(undefined)
  await s.commands.get('rewind').handler('', s.ctx)
  assert.equal(s.selects.at(-1)!.options.length, 100)
  assert.ok(s.selects.at(-1)!.options[0].includes('old 104'))
  await s.run('new1', undefined, 'brand new')
  s.answers.push(undefined)
  await s.commands.get('rewind').handler('', s.ctx)
  const options = s.selects.at(-1)!.options
  assert.equal(options.length, 100)
  assert.ok(options[0].endsWith('brand new'))
  assert.ok(options.at(-1)!.includes('old 6')) // old 5 e anteriores saíram
})

test('retomar com checkpoints guardados e arquivos já rastreados: continua rastreando o conjunto', async () => {
  const s = await real({ session: 'resume.jsonl' })
  writeFileSync(join(s.work, 'a.txt'), 'a1')
  await s.run('u1', async () => { await s.edit('a.txt', 'a2') })
  await s.run('u2') // commita a.txt
  const r = await real({ session: 'resume.jsonl', cwd: s.work, stored: s.entries })
  writeFileSync(join(r.work, 'a.txt'), 'a-resumed')
  await r.run('u3') // a.txt veio de committedPaths: entra no snapshot
  await r.doRewind(1, 'Code only') // u2
  assert.equal(r.read('a.txt'), 'a2')
})

test('retomar em outro diretório avisa e usa shadow novo; checkpoints antigos não restauram lá', async () => {
  const a = await real({ session: 'moved.jsonl' })
  writeFileSync(join(a.work, 'a.txt'), 'a1')
  await a.run('u1', async () => { await a.edit('a.txt', 'a2') })
  const b = await real({ session: 'moved.jsonl', stored: a.entries })
  assert.ok(b.notes.some(([m, l]) => m.includes(`recorded in ${a.work}`) && m.includes(b.work) && l === 'warning'))
  writeFileSync(join(b.work, 'a.txt'), 'b-file')
  await b.doRewind(0, 'Code only')
  assert.equal(b.read('a.txt'), 'b-file') // nunca sobrescreve a árvore de outro diretório
})

test('fork: session_start herda os refs do shadow pai e session_before_fork restaura o código', async () => {
  const p = await real({ session: 'parent.jsonl' })
  writeFileSync(join(p.work, 'a.txt'), 'a1')
  await p.run('u1', async () => { await p.edit('a.txt', 'a2') })
  await p.run('u2')
  const f = await real({ session: 'child.jsonl', cwd: p.work, stored: p.entries })
  await f.fire('session_start', { reason: 'fork', previousSessionFile: p.sessionFile })
  const answers = f.answers
  answers.push('Yes, restore code to that point')
  await f.fire('session_before_fork', { entryId: 'u1' })
  assert.equal(f.read('a.txt'), 'a1')
  assert.deepEqual(f.notes.at(-1), ['Code restored to checkpoint', 'info'])
  assert.equal(f.selects.at(-1)!.title, 'Restore code state?')
  // fork de sessão cujo pai não existe mais: segue sem falhar
  await assert.doesNotReject(f.fire('session_start', { reason: 'fork', previousSessionFile: join(tmp, 'ghost.jsonl') }))
})

test('session_before_fork: recusa, sem UI, sem ref, entrada desconhecida, snapshot vazio e falha do git', async () => {
  const s = await real({ stored: [{ entryId: 'noref', ref: '', prompt: 'p', createdAt: 'x' }, { entryId: 'bad', ref: 'refs/pi-code/checkpoints/nope', prompt: 'p', createdAt: 'x' }] })
  writeFileSync(join(s.work, 'a.txt'), 'a1')
  await s.run('u1') // snapshot vazio
  const asked = () => s.selects.length
  s.answers.push('No, keep current code')
  await s.fire('session_before_fork', { entryId: 'u1' })
  assert.equal(s.notes.at(-1)?.[0] === 'Code restored to checkpoint', false)
  const n = asked()
  await s.fire('session_before_fork', { entryId: 'noref' })
  await s.fire('session_before_fork', { entryId: 'unknown' })
  await s.fire('session_before_fork', { entryId: 'u1' }, { ...s.ctx, hasUI: false })
  assert.equal(asked(), n)
  s.answers.push('Yes, restore code to that point')
  await s.fire('session_before_fork', { entryId: 'u1' })
  assert.deepEqual(s.notes.at(-1), ['Checkpoint has no files; code left untouched', 'warning'])
  // ref ruim: ls-tree falha, checkout falha
  s.answers.push('Yes, restore code to that point')
  await s.fire('session_before_fork', { entryId: 'bad' })
  assert.ok(s.notes.at(-1)![0].startsWith('Restore failed:'))
})

test('session_before_tree com git real restaura o arquivo; falha de init desativa com aviso', async () => {
  const s = await real()
  writeFileSync(join(s.work, 'a.txt'), 'a1')
  await s.run('u1', async () => { await s.edit('a.txt', 'a2') })
  await s.run('u2')
  s.answers.push('Yes, restore code')
  await s.fire('session_before_tree', { preparation: { targetId: 'u1' } })
  assert.equal(s.read('a.txt'), 'a1')
  const d = await real({ fail: (a) => (a.includes('init') ? { code: 1, stderr: 'no git here' } : undefined) })
  assert.deepEqual(d.notes.find(([m]) => m.startsWith('Checkpoints disabled')), ['Checkpoints disabled: no git here', 'warning'])
  const e = await real({ fail: (a) => (a.includes('init') ? { code: 1, stderr: '' } : undefined) })
  assert.ok(e.notes.some(([m]) => m === 'Checkpoints disabled: git init failed'))
})

test('add falha em um pathspec: os demais são snapshotados e o recusado sai do conjunto', async () => {
  let reject = false
  const s = await real({ fail: (a) => (reject && a.includes('add') && a.includes('bad.txt') ? { code: 128 } : undefined) })
  writeFileSync(join(s.work, 'good.txt'), 'g1')
  writeFileSync(join(s.work, 'bad.txt'), 'b1')
  await s.run('u1', async () => { await s.edit('good.txt', 'g2'); await s.edit('bad.txt', 'b2') })
  reject = true
  await s.run('u2', async () => { await s.edit('good.txt', 'g3') })
  assert.equal(s.appended.length, 2)
  await s.doRewind(0, 'Code only') // u2 = estado antes do edit g3
  assert.equal(s.read('good.txt'), 'g2')
  // tudo recusado: o arquivo sai do conjunto e os checkpoints seguintes continuam possíveis
  const t = await real({ fail: (a) => (a.includes('add') ? { code: 128 } : undefined) })
  writeFileSync(join(t.work, 'x.txt'), 'x1')
  await t.run('u1', async () => { await t.edit('x.txt', 'x2') })
  await t.run('u2')
  assert.equal(t.appended.length, 2)
})

test('commit que falha não registra checkpoint (sem ref obsoleto)', async () => {
  const s = await real({ fail: (a) => (a.includes('commit') ? { code: 1 } : undefined) })
  await s.run('u1')
  assert.equal(s.appended.length, 0)
})

test('arquivo em repositório aninhado é indexado diretamente e restaurado', async () => {
  const s = await real()
  mkdirSync(join(s.work, 'sub'))
  git(join(s.work, 'sub'), 'init', '-q', '-b', 'main')
  writeFileSync(join(s.work, 'sub', 'n.txt'), 'n1')
  await s.run('u1', async () => { await s.edit('sub/n.txt', 'n2') })
  await s.run('u2')
  writeFileSync(join(s.work, 'sub', 'n.txt'), 'n3')
  await s.doRewind(1, 'Code only')
  assert.equal(s.read('sub/n.txt'), 'n1')
})

test('session_shutdown: sessão efêmera remove o shadow só ao sair; sessão nomeada o mantém', async () => {
  const e = await real({ session: null })
  const shadow = join(AGENT, 'checkpoints', mod.sessionSlug(undefined))
  assert.ok(existsSync(shadow))
  await e.fire('session_shutdown', { reason: 'reload' })
  assert.ok(existsSync(shadow))
  await e.fire('session_shutdown', { reason: 'quit' })
  assert.ok(!existsSync(shadow))
  const n = await real({ session: 'named.jsonl' })
  await n.fire('session_shutdown', { reason: 'quit' })
  assert.ok(existsSync(join(AGENT, 'checkpoints', 'named.jsonl')))
})

test('fora de um repo git não há exclude para espelhar e o fluxo segue', async () => {
  const s = await real({ gitRepo: false })
  writeFileSync(join(s.work, 'a.txt'), 'a1')
  await s.run('u1', async () => { await s.edit('a.txt', 'a2') })
  await s.run('u2')
  await s.doRewind(1, 'Code only')
  assert.equal(s.read('a.txt'), 'a1')
})

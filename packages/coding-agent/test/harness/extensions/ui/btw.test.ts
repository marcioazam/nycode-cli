// node --experimental-strip-types --test ~/.pi/agent/extensions/ui/test/btw.test.ts
import assert from 'node:assert/strict'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

// O Node não resolve @earendil-works a partir de extensions/: testa uma cópia com o pi ao lado.
const tmp = mkdtempSync(join(tmpdir(), 'ui-test-'))
mkdirSync(join(tmp, 'node_modules'))
symlinkSync(`${homedir()}/.pi/agent/install/releases/${readFileSync(`${homedir()}/.pi/agent/install/current-version`, 'utf8').trim()}/node_modules/@earendil-works`, join(tmp, 'node_modules', '@earendil-works'))
const load = async (name: string) => {
  cpSync(join(import.meta.dirname, '..', name), join(tmp, name))
  return import(join(tmp, name))
}
const theme = { fg: (c: string, t: string) => `<${c}>${t}`, bold: (t: string) => t }
const mod = await load('btw.ts')
;(await import(join(tmp, 'node_modules/@earendil-works/pi-coding-agent/dist/index.js'))).initTheme('dark') // BorderedLoader e Markdown usam o tema global

test('transcript: papéis, ferramentas e truncamento', () => {
  const t = mod.transcript([
    { role: 'user', content: 'oi' },
    { role: 'assistant', content: [{ type: 'text', text: 'olá' }, { type: 'toolCall', name: 'bash' }, { type: 'thinking' }] },
    { role: 'toolResult', content: [{ type: 'text', text: 'x'.repeat(900) }] },
    { role: 'custom', content: 'ignorado' },
    { role: 'user', content: [] },
    { role: 'user', content: 42 },
  ])
  assert.equal(t[0], 'Usuário: oi')
  assert.equal(t[1], 'Assistente: olá\n[ferramenta bash]')
  assert.equal(t[2].length, 'Resultado de ferramenta: '.length + 500)
  assert.equal(t.length, 3)
})

test('trimContext mantém o fim; buildPrompt inclui a pergunta', () => {
  assert.deepEqual(mod.trimContext(['aaaa', 'bb', 'cc'], 5), ['bb', 'cc'])
  assert.deepEqual(mod.trimContext(['a'], 5), ['a'])
  const p = mod.buildPrompt(['Usuário: oi'], 'por quê?')
  assert.match(p, /<conversa>\nUsuário: oi\n<\/conversa>/)
  assert.match(p, /sem ferramentas\): por quê\?$/)
})

const model = { provider: 'p', id: 'm' }
function setup(over: any = {}) {
  let cmd: any
  mod.default({ registerCommand: (_n: string, c: any) => (cmd = c) })
  const notes: any[] = []
  const calls: any[] = []
  const shown: string[][] = []
  const ctx = {
    model,
    modelRegistry: {
      hasConfiguredAuth: () => true,
      complete: async (...a: any[]) => {
        calls.push(a)
        return over.reply ?? { stopReason: 'stop', content: [{ type: 'text', text: '**resposta**' }] }
      },
    },
    sessionManager: { buildSessionContext: () => ({ messages: [{ role: 'user', content: 'contexto' }] }) },
    ui: {
      notify: (...a: any[]) => notes.push(a),
      custom: async (f: any, opts?: any) => {
        let finish: (v?: any) => void = () => {}
        const result = new Promise((r) => (finish = r))
        const comp = f({ requestRender() {}, terminal: { rows: 24 } }, theme, undefined, finish)
        if (opts?.overlay) {
          shown.push(comp.render(60))
          comp.invalidate()
          comp.handleInput('x')
          comp.handleInput('\r')
        } else over.onLoader?.(comp, finish)
        const v = await result
        comp.dispose?.()
        return v
      },
    },
    ...over.ctx,
  }
  return { cmd, ctx, notes, calls, shown }
}

test('uso, sem modelo, sem autenticação', async () => {
  const s = setup()
  await s.cmd.handler('  ', s.ctx)
  assert.deepEqual(s.notes.pop(), ['Uso: /btw <pergunta>', 'warning'])
  await s.cmd.handler('q', { ...s.ctx, model: undefined })
  assert.match(s.notes.pop()[0], /Nenhum modelo/)
  await s.cmd.handler('q', { ...s.ctx, modelRegistry: { hasConfiguredAuth: () => false } })
  assert.match(s.notes.pop()[0], /Sem autenticação para p\/m/)
})

test('responde num overlay sem tools e sem gravar na sessão', async () => {
  const s = setup()
  await s.cmd.handler('e agora?', s.ctx)
  assert.equal(s.calls.length, 1)
  const [, context, opts] = s.calls[0]
  assert.equal(context.tools, undefined)
  assert.match(context.messages[0].content[0].text, /contexto[\s\S]*e agora\?/)
  assert.equal(opts.cacheRetention, 'none')
  assert.ok(s.shown[0].join('\n').includes('resposta'))
  assert.equal(s.notes.length, 0)
})

test('resposta vazia, erro do modelo e exceção viram aviso', async () => {
  let s = setup({ reply: { stopReason: 'stop', content: [] } })
  await s.cmd.handler('q', s.ctx)
  assert.ok(s.shown[0].join('\n').includes('(sem resposta)'))
  s = setup({ reply: { stopReason: 'error', errorMessage: 'limite' } })
  await s.cmd.handler('q', s.ctx)
  assert.deepEqual(s.notes.pop(), ['/btw falhou: limite', 'error'])
  s = setup({ reply: { stopReason: 'error' } })
  await s.cmd.handler('q', s.ctx)
  assert.match(s.notes.pop()[0], /erro do modelo/)
  s = setup()
  s.ctx.modelRegistry.complete = async () => {
    throw new Error('rede')
  }
  await s.cmd.handler('q', s.ctx)
  assert.deepEqual(s.notes.pop(), ['/btw falhou: rede', 'error'])
  s = setup()
  s.ctx.sessionManager.buildSessionContext = () => {
    throw new Error('sessão')
  }
  await s.cmd.handler('q', s.ctx)
  assert.deepEqual(s.notes.pop(), ['/btw falhou: sessão', 'error'])
  s = setup()
  s.ctx.sessionManager.buildSessionContext = () => {
    throw 'texto'
  }
  await s.cmd.handler('q', s.ctx)
  assert.deepEqual(s.notes.pop(), ['/btw falhou: texto', 'error'])
})

test('Esc no loader cancela sem overlay nem aviso', async () => {
  let release: () => void = () => {}
  const s = setup({
    onLoader: (loader: any) => {
      loader.handleInput('\x1b') // Esc: aborta o signal e chama onAbort
      assert.ok(loader.signal.aborted)
    },
  })
  s.ctx.modelRegistry.complete = (...a: any[]) => new Promise((r) => (release = () => r({ stopReason: 'stop', content: [{ type: 'text', text: 'tarde' }] })))
  await s.cmd.handler('q', s.ctx)
  release()
  await new Promise((r) => setTimeout(r, 10))
  assert.equal(s.shown.length, 0)
  assert.equal(s.notes.length, 0)
})

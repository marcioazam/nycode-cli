// Testes do zzzzzzzz-statusline-provider.patch (docs/hud-provider-usage.md, dependência de patch): node --experimental-strip-types --test ~/.pi/agent/claude-home/patches/pi-code/zzzzzzzz-statusline-provider/provider.test.ts
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { fleetTestEnv } from '../subagent-panel/setup.ts'

const { tmp, ext } = fleetTestEnv('statusline-provider-')
const home = join(tmp, 'home')
// cwd lives inside `tmp`: fleetTestEnv's own cleanup is the single owner of the directory (no second rmSync).
const cwd = join(tmp, 'cwd')
mkdirSync(cwd)
after(() => {
  handlers.get('session_shutdown')?.forEach((h) => h({}, ctx))
})
const out = join(tmp, 'payload.json')
mkdirSync(join(home, '.claude'), { recursive: true })
writeFileSync(join(home, '.claude', 'settings.json'), JSON.stringify({ statusLine: { type: 'command', command: `cat > '${out}'` } }))
process.env.HOME = home
delete process.env.CLAUDE_CONFIG_DIR
const { default: statusLine } = await import(`${ext}/status-line.ts`)

const handlers = new Map<string, Array<(event: any, ctx: any) => void>>()
statusLine({ on: (name: string, h: any) => handlers.set(name, [...(handlers.get(name) ?? []), h]), events: { on: () => () => {} } })
const fire = (name: string, event: any = {}) => handlers.get(name)?.forEach((h) => h(event, ctx))

const ANTHROPIC = { id: 'claude-sonnet-5-5', name: 'Sonnet 5.5', provider: 'anthropic' }
const GPT = { id: 'gpt-5.6', name: 'GPT 5.6', provider: 'openai-codex' }
let model: any = ANTHROPIC
const ctx = {
  cwd,
  get model() { return model },
  thinkingLevel: 'medium',
  ui: { theme: { fg: (_c: string, s: string) => s }, setStatus() {}, setWidget() {}, notify() {} },
  sessionManager: { getSessionId: () => 's1', getSessionFile: () => undefined, getSessionName: () => undefined, getBranch: () => [] },
  getContextUsage: () => undefined,
  isProjectTrusted: () => false,
}

/** Dispara o evento e espera o comando (debounce de 300 ms) gravar o payload novo. */
async function payloadAfter(trigger: () => void): Promise<any> {
  rmSync(out, { force: true })
  trigger()
  for (let i = 0; i < 100; i++) {
    await new Promise((r) => setTimeout(r, 50))
    if (existsSync(out)) {
      const text = readFileSync(out, 'utf8')
      if (text.trim().endsWith('}')) return JSON.parse(text)
    }
  }
  throw new Error('o status line não gravou o payload')
}

const respond = (): void => {
  fire('after_provider_response', { status: 200, headers })
  fire('thinking_level_select') // a resposta só agenda o refresh depois (message_end); este evento o dispara
}
const headers = { 'anthropic-ratelimit-unified-5h-utilization': '0.42', 'anthropic-ratelimit-unified-5h-reset': new Date(Date.now() + 3_600_000).toISOString() }

test('payload.model leva id, display_name e provider', async () => {
  model = ANTHROPIC
  const payload = await payloadAfter(() => fire('session_start'))
  assert.deepEqual(payload.model, { id: 'claude-sonnet-5-5', display_name: 'Sonnet 5.5', provider: 'anthropic' })
})

test('sem modelo ativo o payload não inventa provider', async () => {
  model = undefined
  const payload = await payloadAfter(() => fire('model_select'))
  assert.deepEqual(payload.model, { id: '', display_name: '' })
  model = ANTHROPIC
})

test('model_select limpa o snapshot velho: Anthropic→GPT→Anthropic não ressuscita rate_limits', async () => {
  model = ANTHROPIC
  const withLimits = await payloadAfter(() => respond())
  assert.equal(withLimits.rate_limits.five_hour.used_percentage, 42)
  model = GPT
  const gpt = await payloadAfter(() => fire('model_select'))
  assert.equal(gpt.model.provider, 'openai-codex')
  assert.equal('rate_limits' in gpt, false)
  model = ANTHROPIC
  const back = await payloadAfter(() => fire('model_select'))
  assert.equal(back.model.provider, 'anthropic')
  assert.equal('rate_limits' in back, false, 'o snapshot da primeira passagem não volta')
  const fresh = await payloadAfter(() => respond())
  assert.equal(fresh.rate_limits.five_hour.used_percentage, 42, 'a próxima resposta repõe')
})

test('o patch preserva o footer bridge e o evento thinking_level_select', () => {
  assert.ok(handlers.has('thinking_level_select'))
  assert.ok(handlers.has('model_select'))
  assert.ok(readFileSync(`${ext}/status-line.ts`, 'utf8').includes('FOOTER_BRIDGE_CHANNEL'))
})

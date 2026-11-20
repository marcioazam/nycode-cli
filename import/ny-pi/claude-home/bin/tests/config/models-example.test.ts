// Contrato de models.json.example (fallback de recusa do claude-sonnet-5-5 -> claude-sonnet-5).
// Rodar: NO_COLOR=1 node --experimental-strip-types --test claude-home/bin/tests/config/models-example.test.ts
// Limite: buildParams do pi-ai não é exportado; o merge de compat do pi (provider-composer.js,
// mergeCompat = {...base, ...override}) e o mapeamento params.fallbacks são replicados aqui.
import { strict as assert } from 'node:assert'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

const example = JSON.parse(readFileSync(new URL('../../../../models.json.example', import.meta.url), 'utf8'))
const override = example.providers.anthropic.modelOverrides['claude-sonnet-5-5']
const fallback = override.compat.allowedFallbackModels[0]

test('override pede fallback para claude-sonnet-5 com preço do sonnet-5', () => {
  assert.equal(override.compat.allowedFallbackModels.length, 1)
  assert.deepEqual(fallback, {
    provider: 'anthropic',
    model: 'claude-sonnet-5',
    cost: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  })
  assert.deepEqual(Object.keys(override), ['compat'])
})

const catalogPath = join(
  process.env.PI_AGENT_DIR ?? join(homedir(), '.pi/agent'),
  'install/releases/1.5.2/node_modules/@earendil-works/pi-ai/dist/providers/data/anthropic.json',
)

test('merge com o catálogo do pi preserva compat e gera params.fallbacks', {
  skip: !existsSync(catalogPath) && 'pi 1.5.2 ausente',
}, () => {
  const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'))
  const models = catalog['anthropic-messages']
  const find = (id: string) =>
    Array.isArray(models) ? models.find((m: { id: string }) => m.id === id) : models['chat:' + id]
  const base = find('claude-sonnet-5-5')
  const sonnet5 = find('claude-sonnet-5')
  assert.deepEqual(sonnet5.cost, fallback.cost)
  const merged = { ...base.compat, ...override.compat }
  for (const [k, v] of Object.entries(base.compat)) assert.deepEqual(merged[k], v)
  const params = { fallbacks: merged.allowedFallbackModels.map((f: { model: string }) => ({ model: f.model })) }
  assert.deepEqual(params.fallbacks, [{ model: 'claude-sonnet-5' }])
})

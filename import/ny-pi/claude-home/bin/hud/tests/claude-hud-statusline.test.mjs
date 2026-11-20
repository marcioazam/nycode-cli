// Run: node --test ~/.pi/agent/claude-home/bin/hud/tests/claude-hud-statusline.test.mjs
// Roda o launcher de verdade com o claude-hud instalado nos caches do Claude Code (dependência do ambiente:
// sem HUD instalado a saída fica vazia e o primeiro teste falha explicitamente).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test } from 'node:test';

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'claude-hud-statusline.mjs');
const payload = JSON.stringify({ model: { display_name: 'Test' }, cwd: os.tmpdir(), workspace: { current_dir: os.tmpdir() }, context_window: { context_window_size: 200000, current_usage: { input_tokens: 1000 } } });
const run = (env) => {
  const { NO_COLOR: _drop, ...base } = process.env;
  return spawnSync(process.execPath, [script], { input: payload, encoding: 'utf8', env: { ...base, COLUMNS: '120', FORCE_COLOR: '1', ...env }, timeout: 20_000 });
};
const SGR = /\x1b\[[0-9;:]*m/;

test('sem NO_COLOR o HUD sai colorido (prova que o HUD rodou)', () => {
  const r = run({});
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.stdout.trim().length > 0, 'HUD não produziu saída');
  assert.match(r.stdout, SGR);
});

test('NO_COLOR não vazio tira todas as cores SGR', () => {
  const r = run({ NO_COLOR: '1' });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.stdout.trim().length > 0);
  assert.doesNotMatch(r.stdout, SGR);
});

// Provedor e cota ponta a ponta: sessão do pi com model_change, CLAUDE_CONFIG_DIR isolado (config padrão do HUD) e
// provedores sem consulta de rede (anthropic com rate_limits do pi, github-copilot sem fonte de cota).
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hudstatus-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const hud = (provider, rate_limits, modelId = 'm1') => {
  const session = path.join(tmp, `${provider}.jsonl`);
  fs.writeFileSync(session, JSON.stringify({ type: 'model_change', provider, modelId }) + '\n');
  const input = JSON.stringify({ model: { id: 'm1', display_name: 'M' }, cwd: os.tmpdir(), transcript_path: session, rate_limits });
  const { NO_COLOR: _drop, ...base } = process.env;
  const r = spawnSync(process.execPath, [script], { input, encoding: 'utf8', env: { ...base, COLUMNS: '120', NO_COLOR: '1', CLAUDE_CONFIG_DIR: tmp }, timeout: 20_000 });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
};

test('só semanal: mostra Weekly e nenhuma janela 5h inventada', () => {
  const out = hud('anthropic', { seven_day: { used_percentage: 40, resets_at: 1_900_000_000 } });
  assert.match(out, /Usage Weekly .*40%/);
  assert.doesNotMatch(out, /5h/);
});

test('modelo de outro provedor descarta a cota Anthropic velha do pi-code', () => {
  const out = hud('github-copilot', { five_hour: { used_percentage: 98 }, seven_day: { used_percentage: 53 } });
  assert.doesNotMatch(out, /Usage|98%|53%/);
});

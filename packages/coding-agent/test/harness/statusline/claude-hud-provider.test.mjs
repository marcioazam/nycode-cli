// Run: node --test ~/.pi/agent/claude-home/bin/hud/tests/claude-hud-provider.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { activeModelProvider } from '../claude-hud-provider.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hudprov-'));
after(() => fs.rmSync(dir, { recursive: true, force: true }));
const change = (provider, modelId) => JSON.stringify({ type: 'model_change', provider, modelId });
const session = (name, lines) => {
  const file = path.join(dir, name);
  fs.writeFileSync(file, lines.join('\n') + '\n');
  return file;
};
const payload = (file, id) => ({ transcript_path: file, model: { id } });

test('the last model_change names the provider, and only when it matches the payload model', () => {
  const file = session('a.jsonl', [change('anthropic', 'claude-opus-5-5'), '{"type":"message"}', change('openai-codex', 'gpt-5.5'), '{"type":"message","x":"model_change"}']);
  assert.equal(activeModelProvider(payload(file, 'gpt-5.5')), 'openai-codex');
  // payload already shows another model than the session recorded (switch in flight): unknown, never the old provider
  assert.equal(activeModelProvider(payload(file, 'claude-opus-5-5')), undefined);
});

test('missing file, no model_change, malformed or absent payload fields are unknown', () => {
  assert.equal(activeModelProvider(payload(path.join(dir, 'nope.jsonl'), 'x')), undefined);
  assert.equal(activeModelProvider(payload(session('b.jsonl', ['{"type":"message"}', 'not json']), 'x')), undefined);
  assert.equal(activeModelProvider({}), undefined);
  assert.equal(activeModelProvider(undefined), undefined);
  assert.equal(activeModelProvider(payload(session('c.jsonl', [change('', 'x')]), 'x')), undefined);
});

test('finds a model_change older than one read chunk, bounded by the cap', () => {
  const filler = '{"type":"message","text":"' + 'x'.repeat(2000) + '"}';
  const lines = [change('openai-codex', 'gpt-5.5'), ...Array(100).fill(filler)];
  const file = session('d.jsonl', lines);
  assert.equal(activeModelProvider(payload(file, 'gpt-5.5')), 'openai-codex');
  assert.equal(activeModelProvider(payload(file, 'gpt-5.5'), { maxBytes: 4096 }), undefined);
});

test('payload.model.provider (pi-code patch) wins without reading the session; invalid values fall back to the session scan', () => {
  const file = session('payload.jsonl', [change('anthropic', 'm1')]);
  assert.equal(activeModelProvider({ transcript_path: '/nonexistent', model: { id: 'm1', provider: 'openai-codex' } }), 'openai-codex');
  assert.equal(activeModelProvider({ transcript_path: file, model: { id: 'm1', provider: 'openai-codex' } }), 'openai-codex');
  for (const bad of ['', 'a b', 'x/../y', 'a'.repeat(65), 7, null, { a: 1 }]) {
    assert.equal(activeModelProvider({ transcript_path: file, model: { id: 'm1', provider: bad } }), 'anthropic', String(bad));
    assert.equal(activeModelProvider({ transcript_path: '/nonexistent', model: { id: 'm1', provider: bad } }), undefined, String(bad));
  }
});

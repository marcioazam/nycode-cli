// E2E pela CLI pública (claude-hud-statusline.mjs) com um `agy` falso no PATH: sem provedor real, sem rede.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test } from 'node:test';

const canonical = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'claude-hud-statusline.mjs');
// The copy /claude-hud-setup installs (plugins/claude-hud/statusline.mjs): same fixtures, so its behavior is measured too.
// CLAUDE_CONFIG_DIR is isolated per case: neither copy reads the real auth, cache or config of the user.
const installed = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'plugins', 'claude-hud', 'statusline.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hudagye2e-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const DELAY_MS = 3000;
const fakeAgy = `#!${process.execPath}
const fs = require('node:fs');
const dir = process.env.FAKE_AGY_DIR;
fs.appendFileSync(dir + '/calls.log', process.argv.slice(2).join(' ') + '\\n');
const mode = fs.readFileSync(dir + '/mode', 'utf8').trim();
const b = (w, r) => ({ id: w, name: w, window: w, remaining_fraction: r, reset_time: '2026-11-14T12:00:00Z' });
const one = { status: 'SUCCESS', command: { name: 'usage', data: { groups: [{ name: 'Gemini', buckets: [b('5h', 0.75), b('weekly', 0.4)] }] } } };
const two = { ...one, command: { name: 'usage', data: { groups: [one.command.data.groups[0], { name: 'Claude', buckets: [b('5h', 0.1)] }] } } };
const weekly = { ...one, command: { name: 'usage', data: { groups: [{ name: 'Gemini', buckets: [b('weekly', 0.05)] }] } } };
setTimeout(() => {
  if (mode === 'ok') console.log(JSON.stringify(one));
  else if (mode === 'weekly') console.log(JSON.stringify(weekly));
  else if (mode === 'two') console.log(JSON.stringify(two));
  else if (mode === 'garbage') console.log('not json');
  else if (mode === 'huge') process.stdout.write('x'.repeat(2 * 1024 * 1024));
  else if (mode === 'fail') process.exit(3);
  else if (mode === 'hang') setTimeout(() => {}, 60000);
}, mode === 'hang' ? 0 : ${DELAY_MS});
`;

function baseEnv(script, mode, extra = {}) {
  const dir = fs.mkdtempSync(path.join(tmp, 'case-'));
  fs.mkdirSync(path.join(dir, 'bin'));
  fs.writeFileSync(path.join(dir, 'bin', 'agy'), fakeAgy, { mode: 0o755 });
  fs.writeFileSync(path.join(dir, 'mode'), mode);
  const session = path.join(dir, 's.jsonl');
  fs.writeFileSync(session, JSON.stringify({ type: 'model_change', provider: 'antigravity', modelId: 'm1' }) + '\n');
  const input = JSON.stringify({ model: { id: 'm1', display_name: 'M' }, cwd: os.tmpdir(), transcript_path: session });
  const { NO_COLOR: _drop, ...base } = process.env;
  const procEnv = { ...base, COLUMNS: '120', NO_COLOR: '1', CLAUDE_CONFIG_DIR: dir, FAKE_AGY_DIR: dir, PATH: `${path.join(dir, 'bin')}${path.delimiter}${process.env.PATH}`, ...extra };
  const cache = path.join(dir, 'plugins', 'claude-hud', 'usage-cache.antigravity.json');
  const calls = () => (fs.existsSync(path.join(dir, 'calls.log')) ? fs.readFileSync(path.join(dir, 'calls.log'), 'utf8').trim().split('\n').filter(Boolean) : []);
  return { dir, input, procEnv, cache, calls, script };
}
const render = (e) => spawnSync(process.execPath, [e.script], { input: e.input, encoding: 'utf8', env: e.procEnv, timeout: 20_000 });
const renderAsync = (e) => new Promise((resolve) => { const c = spawn(process.execPath, [e.script], { env: e.procEnv }); c.stdin.end(e.input); c.on('close', resolve); });
const cacheJson = (e) => JSON.parse(fs.readFileSync(e.cache, 'utf8'));
async function until(fn, ms = 20_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (fn()) return true; await new Promise((r) => setTimeout(r, 100)); }
  return false;
}

for (const [label, script] of [['canonical', canonical], ['installed', installed]]) {
  const env = (mode, extra) => baseEnv(script, mode, extra);
  const t = (name, fn) => test(`[${label}] ${name}`, fn);

  t('first render returns at once without quota, then the background refresh feeds the cache and the next render shows it', async () => {
    const e = env('ok');
    const t0 = Date.now();
    const first = render(e);
    assert.equal(first.status, 0, first.stderr);
    assert.ok(Date.now() - t0 < DELAY_MS, 'render must not wait for agy');
    assert.doesNotMatch(first.stdout, /Usage|25%|60%/);
    assert.ok(await until(() => fs.existsSync(e.cache) && cacheJson(e).rate_limits), 'cache written by the helper');
    assert.deepEqual(Object.keys(cacheJson(e).rate_limits).sort(), ['five_hour', 'seven_day']);
    assert.match(fs.readFileSync(path.join(e.dir, 'calls.log'), 'utf8'), /--print \/usage --output-format json --print-timeout 30s/);
    const second = render(e);
    assert.match(second.stdout, /Usage/);
    assert.match(second.stdout, /25%/);
    // o plugin real só mostra o semanal quando ele passa do limiar; os dois chegam ao stdin (cache acima)
    assert.equal(e.calls().length, 1, 'fresh cache: no second agy run');
    assert.equal(fs.existsSync(path.join(e.dir, 'plugins', 'claude-hud', 'usage-cache.antigravity.lock')), false);
  });

  t('concurrent renders on a cold start run agy exactly once', async () => {
    const e = env('ok');
    await Promise.all([renderAsync(e), renderAsync(e), renderAsync(e), renderAsync(e)]);
    assert.ok(await until(() => fs.existsSync(e.cache) && cacheJson(e).rate_limits));
    assert.equal(e.calls().length, 1);
  });

  for (const mode of ['two', 'garbage', 'fail', 'huge']) {
    t(`agy ${mode}: nothing is shown, the failure is cached and agy is not rerun inside the cooldown`, async () => {
      const e = env(mode);
      assert.equal(render(e).status, 0);
      assert.ok(await until(() => fs.existsSync(e.cache)), 'attempt recorded');
      // A valid but ambiguous answer is recorded as an empty quota; garbage, failure and oversize record nothing.
      assert.deepEqual(cacheJson(e).rate_limits, mode === 'two' ? {} : undefined);
      const again = render(e);
      assert.doesNotMatch(again.stdout, /Usage/);
      assert.equal(e.calls().length, 1);
    });
  }

  t('a valid but ambiguous answer replaces the old quota with an empty one (never the cached old value)', async () => {
    const e = env('two');
    fs.mkdirSync(path.dirname(e.cache), { recursive: true });
    const old = { five_hour: { used_percentage: 25 } };
    fs.writeFileSync(e.cache, JSON.stringify({ at: 0, ok_at: Date.now() - 60_000, rate_limits: old }));
    assert.match(render(e).stdout, /Usage.*25%/s, 'the old quota is still shown while the refresh runs');
    assert.ok(await until(() => cacheJson(e).at > 0));
    assert.deepEqual(cacheJson(e).rate_limits, {});
    assert.ok(cacheJson(e).ok_at > Date.now() - 20_000, 'the empty answer is a fresh success, not a retained old one');
    assert.doesNotMatch(render(e).stdout, /Usage|25%/);
  });

  // The real plugin shows the weekly window only above its sevenDayThreshold (default 80, dist/usage-pace.js:51): 95% used.
  t('weekly-only quota above the plugin threshold shows Weekly with its percentage and no invented 5h', async () => {
    const e = env('weekly');
    assert.equal(render(e).status, 0);
    assert.ok(await until(() => fs.existsSync(e.cache) && cacheJson(e).rate_limits));
    assert.deepEqual(Object.keys(cacheJson(e).rate_limits), ['seven_day']);
    const out = render(e).stdout;
    assert.match(out, /Weekly.*95%/s);
    assert.doesNotMatch(out, /(^|[^0-9])5h/, 'no 5h window (the 15h is the reset countdown)');
  });

  t('agy that hangs is killed at the timeout and recorded as a failure', async () => {
    const e = env('hang', { HUD_AGY_TIMEOUT_MS: '500' });
    assert.equal(render(e).status, 0);
    assert.ok(await until(() => fs.existsSync(e.cache), 10_000));
    assert.equal(cacheJson(e).rate_limits, undefined);
    assert.doesNotMatch(render(e).stdout, /Usage/);
  });

  t('a failed refresh keeps the last good quota; other providers never trigger agy', async () => {
    const e = env('fail');
    fs.mkdirSync(path.dirname(e.cache), { recursive: true });
    const good = { five_hour: { used_percentage: 25 } };
    fs.writeFileSync(e.cache, JSON.stringify({ at: 0, ok_at: Date.now() - 60_000, rate_limits: good }));
    assert.match(render(e).stdout, /Usage.*25%/s);
    assert.ok(await until(() => cacheJson(e).at > 0));
    assert.deepEqual(cacheJson(e).rate_limits, good);
    const other = env('ok');
    fs.writeFileSync(path.join(other.dir, 's.jsonl'), JSON.stringify({ type: 'model_change', provider: 'google', modelId: 'm1' }) + '\n');
    assert.doesNotMatch(render(other).stdout, /Usage/);
    await new Promise((r) => setTimeout(r, 500));
    assert.equal(other.calls().length, 0);
  });
}

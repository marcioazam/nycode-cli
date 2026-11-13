// Run: node --test ~/.pi/agent/claude-home/bin/hud/tests/claude-hud-usage.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { toCodexRateLimits, toRateLimits, withUsage } from '../claude-hud-usage.mjs';

const api = { five_hour: { utilization: 8, resets_at: '2026-11-12T19:39:00+00:00' }, seven_day: { utilization: 1, resets_at: null } };
const expected = { five_hour: { used_percentage: 8, resets_at: Date.parse('2026-11-12T19:39:00Z') / 1000 }, seven_day: { used_percentage: 1 } };
const H5 = 18000;
const D7 = 604800;
const codexBoth = { plan_type: 'plus', rate_limit: { primary_window: { used_percent: 12, limit_window_seconds: H5, reset_at: 1_800_000_000 }, secondary_window: { used_percent: 0, limit_window_seconds: D7, reset_at: 1_800_500_000 } } };
const codexWeekly = { plan_type: 'free', rate_limit: { primary_window: { used_percent: 100, limit_window_seconds: D7, reset_at: 1_800_500_000 }, secondary_window: null } };
const anthropicAuth = { type: 'oauth', access: 'ant-tok', expires: Date.now() + 3_600_000 };
const codexAuth = { type: 'oauth', access: 'gpt-tok', accountId: 'acct-1', expires: Date.now() + 3_600_000 };

const tmpDirs = [];
after(() => tmpDirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

function setup(auth = { anthropic: anthropicAuth, 'openai-codex': codexAuth }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hudusage-'));
  tmpDirs.push(dir);
  const authFile = path.join(dir, 'auth.json');
  fs.writeFileSync(authFile, JSON.stringify(auth));
  return { dir, authFile, cacheFile: path.join(dir, 'cache', 'usage-cache.json') };
}
const ok = (body) => { const calls = []; return { calls, fetchImpl: async (url, init) => { calls.push({ url, init }); return { ok: true, json: async () => body }; } }; };
const run = (provider, env, f, extra = {}, payload = {}) => withUsage(payload, { provider, authFile: env.authFile, cacheFile: env.cacheFile, fetchImpl: f.fetchImpl, now: 1_000, ...extra });

test('maps the Anthropic usage API to stdin rate_limits, rejecting malformed values', () => {
  assert.deepEqual(toRateLimits(api), expected);
  assert.equal(toRateLimits({ five_hour: null, seven_day: {} }), undefined);
  assert.equal(toRateLimits({ five_hour: { utilization: NaN }, seven_day: { utilization: Infinity } }), undefined);
  assert.deepEqual(toRateLimits({ seven_day: { utilization: 0 } }), { seven_day: { used_percentage: 0 } });
});

test('maps ChatGPT windows by their real length: both, weekly-only, zero kept, nothing invented', () => {
  assert.deepEqual(toCodexRateLimits(codexBoth), { five_hour: { used_percentage: 12, resets_at: 1_800_000_000 }, seven_day: { used_percentage: 0, resets_at: 1_800_500_000 } });
  assert.deepEqual(toCodexRateLimits(codexWeekly), { seven_day: { used_percentage: 100, resets_at: 1_800_500_000 } });
  const swapped = { rate_limit: { primary_window: codexBoth.rate_limit.secondary_window, secondary_window: codexBoth.rate_limit.primary_window } };
  assert.deepEqual(Object.keys(toCodexRateLimits(swapped)).sort(), ['five_hour', 'seven_day']);
  for (const bad of [undefined, {}, { rate_limit: null }, { rate_limit: { primary_window: { used_percent: 5 } } },
    { rate_limit: { primary_window: { used_percent: 5, limit_window_seconds: 3600 } } },
    { rate_limit: { primary_window: { used_percent: NaN, limit_window_seconds: H5 }, secondary_window: { used_percent: '9', limit_window_seconds: D7 } } },
    { rate_limit: { primary_window: { used_percent: -1, limit_window_seconds: H5 } } }]) assert.equal(toCodexRateLimits(bad), undefined);
});

test('Anthropic: fills rate_limits at startup with the pi token, then serves from cache', async () => {
  const env = setup();
  const f = ok(api);
  const p = await run('anthropic', env, f);
  assert.deepEqual(p.rate_limits, expected);
  assert.equal(f.calls[0].url, 'https://api.anthropic.com/api/oauth/usage');
  assert.equal(f.calls[0].init.headers.Authorization, 'Bearer ant-tok');
  assert.deepEqual((await run('anthropic', env, f, { now: 30_000 })).rate_limits, expected);
  assert.equal(f.calls.length, 1);
  await run('anthropic', env, f, { now: 70_000 });
  assert.equal(f.calls.length, 2);
  // Anthropic keeps the historical cache shape that extensions/auto-resume reads
  const cached = JSON.parse(fs.readFileSync(env.cacheFile, 'utf8'));
  assert.deepEqual(Object.keys(cached).sort(), ['at', 'rate_limits']);
});

test('Anthropic: header data from pi wins and skips the request', async () => {
  const env = setup();
  const f = ok(api);
  const own = { five_hour: { used_percentage: 50 } };
  assert.deepEqual((await run('anthropic', env, f, {}, { rate_limits: own })).rate_limits, own);
  assert.equal(f.calls.length, 0);
});

test('OpenAI Codex: both windows with the chatgpt host, account header and its own token only', async () => {
  const env = setup();
  const f = ok(codexBoth);
  const p = await run('openai-codex', env, f);
  assert.deepEqual(p.rate_limits, toCodexRateLimits(codexBoth));
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].url, 'https://chatgpt.com/backend-api/wham/usage');
  assert.equal(f.calls[0].init.headers.Authorization, 'Bearer gpt-tok');
  assert.equal(f.calls[0].init.headers['ChatGPT-Account-Id'], 'acct-1');
  assert.doesNotMatch(JSON.stringify(f.calls), /ant-tok/);
  assert.doesNotMatch(fs.readdirSync(path.dirname(env.cacheFile)).map((n) => fs.readFileSync(path.join(path.dirname(env.cacheFile), n), 'utf8')).join(''), /gpt-tok|ant-tok|acct-1/);
});

test('OpenAI Codex: weekly-only account yields only seven_day', async () => {
  const p = await run('openai-codex', setup(), ok(codexWeekly));
  assert.deepEqual(p.rate_limits, { seven_day: { used_percentage: 100, resets_at: 1_800_500_000 } });
});

test('a stale Anthropic snapshot from pi headers never survives on another provider', async () => {
  const stale = { five_hour: { used_percentage: 98 }, seven_day: { used_percentage: 53 } };
  for (const provider of ['openai-codex', 'github-copilot', 'google', 'antigravity', 'unknown-x', undefined]) {
    const f = ok(provider === 'openai-codex' ? codexWeekly : api);
    const p = await run(provider, setup(), f, {}, { rate_limits: stale });
    assert.notDeepEqual(p.rate_limits, stale, String(provider));
    if (provider !== 'openai-codex') { assert.equal(p.rate_limits, undefined); assert.equal(f.calls.length, 0); }
  }
});

test('provider caches are isolated and a switch never serves the other provider’s quota', async () => {
  const env = setup();
  await run('anthropic', env, ok(api));
  const f = ok(codexWeekly);
  const p = await run('openai-codex', env, f, { now: 2_000 });
  assert.deepEqual(Object.keys(p.rate_limits), ['seven_day']);
  assert.equal(f.calls.length, 1);
  const back = await run('anthropic', env, ok(api), { now: 3_000 });
  assert.deepEqual(back.rate_limits, expected);
});

test('OpenAI cache is bound to the account', async () => {
  const env = setup();
  await run('openai-codex', env, ok(codexBoth));
  fs.writeFileSync(env.authFile, JSON.stringify({ 'openai-codex': { ...codexAuth, accountId: 'acct-2' } }));
  const f = ok(codexWeekly);
  const p = await run('openai-codex', env, f, { now: 2_000 });
  assert.equal(f.calls.length, 1);
  assert.deepEqual(Object.keys(p.rate_limits), ['seven_day']);
});

test('failures keep the last value of that provider only, are cached and bounded', async () => {
  const env = setup();
  await run('anthropic', env, ok(api), { now: 0 });
  let calls = 0;
  const boom = { fetchImpl: async (_u, init) => { calls++; assert.ok(init.signal); throw new Error('offline'); } };
  assert.deepEqual((await run('anthropic', env, boom, { now: 61_000 })).rate_limits, expected);
  await run('anthropic', env, boom, { now: 62_000 });
  assert.equal(calls, 1);
  // a failing OpenAI fetch never borrows the Anthropic value
  assert.equal((await run('openai-codex', env, boom, { now: 63_000 })).rate_limits, undefined);
});

test('HTTP errors and malformed bodies show nothing', async () => {
  for (const f of [{ fetchImpl: async () => ({ ok: false, json: async () => codexBoth }) }, ok({ rate_limit: 'x' }), { fetchImpl: async () => ({ ok: true, json: async () => { throw new Error('bad json'); } }) }]) {
    assert.equal((await run('openai-codex', setup(), f)).rate_limits, undefined);
  }
});

test('no request without a valid pi OAuth credential of the active provider', async () => {
  const cases = [['anthropic', {}], ['anthropic', { anthropic: { type: 'api_key', key: 'k' } }], ['anthropic', { anthropic: { access: 't', expires: 1 } }],
    ['openai-codex', {}], ['openai-codex', { 'openai-codex': { ...codexAuth, accountId: undefined } }], ['openai-codex', { 'openai-codex': { ...codexAuth, expires: 1 } }],
    ['openai-codex', { anthropic: anthropicAuth }]];
  for (const [provider, auth] of cases) {
    const env = setup(auth);
    const f = ok(api);
    assert.equal((await run(provider, env, f, { now: 10 })).rate_limits, undefined);
    assert.equal(f.calls.length, 0);
  }
});

test('quota fetches never follow redirects (Bearer/account headers stay on the verified host)', async () => {
  for (const provider of ['anthropic', 'openai-codex']) {
    const f = ok(provider === 'anthropic' ? api : codexBoth);
    await run(provider, setup(), f);
    assert.equal(f.calls[0].init.redirect, 'error', provider);
  }
});

test('only an OAuth credential is used: an api_key entry with an access field triggers no request', async () => {
  for (const [provider, cred] of [['anthropic', { ...anthropicAuth, type: 'api_key' }], ['openai-codex', { ...codexAuth, type: 'api_key' }], ['anthropic', { ...anthropicAuth, type: undefined }]]) {
    const f = ok(api);
    assert.equal((await run(provider, setup({ [provider]: cred }), f)).rate_limits, undefined);
    assert.equal(f.calls.length, 0);
  }
});

test('a cached quota is not served once the credential is gone (no previous-account leak)', async () => {
  for (const provider of ['anthropic', 'openai-codex']) {
    const env = setup();
    const f = ok(provider === 'anthropic' ? api : codexBoth);
    assert.ok((await run(provider, env, f)).rate_limits);
    fs.writeFileSync(env.authFile, JSON.stringify({}));
    assert.equal((await run(provider, env, f, { now: 2_000 })).rate_limits, undefined, provider);
    fs.writeFileSync(env.authFile, JSON.stringify({ [provider]: { ...anthropicAuth, ...codexAuth, expires: 1 } }));
    assert.equal((await run(provider, env, f, { now: 3_000 })).rate_limits, undefined, `${provider} expired`);
  }
});

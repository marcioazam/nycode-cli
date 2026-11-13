// Antigravity (agy /usage): parser, cache/cooldown and singleton lock. Sem agy real nem rede.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { antigravityLimits, parseAntigravityUsage, toAntigravityRateLimits } from '../claude-hud-antigravity.mjs';
import { withUsage } from '../claude-hud-usage.mjs';

const tmpDirs = [];
after(() => tmpDirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));
const mkdir = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'hudagy-')); tmpDirs.push(d); return d; };

const bucket = (window, remaining_fraction, extra = {}) => ({ id: window, name: window, window, remaining_fraction, reset_time: '2026-11-14T12:00:00Z', ...extra });
const usage = (groups, extra = {}) => JSON.stringify({ status: 'SUCCESS', command: { name: 'usage', data: { groups } }, ...extra });
const group = (...buckets) => ({ name: 'Gemini', buckets });
const RESET = Date.parse('2026-11-14T12:00:00Z') / 1000;

test('one group with 5h and weekly buckets maps to both windows (used = 1 - remaining)', () => {
  assert.deepEqual(toAntigravityRateLimits(usage([group(bucket('5h', 0.75), bucket('weekly', 0.4))])), {
    five_hour: { used_percentage: 25, resets_at: RESET },
    seven_day: { used_percentage: 60, resets_at: RESET },
  });
});

test('weekly-only and 5h-only groups show only that window; zero used and 100% used are kept', () => {
  assert.deepEqual(Object.keys(toAntigravityRateLimits(usage([group(bucket('weekly', 1))]))), ['seven_day']);
  assert.equal(toAntigravityRateLimits(usage([group(bucket('weekly', 1))])).seven_day.used_percentage, 0);
  assert.deepEqual(Object.keys(toAntigravityRateLimits(usage([group(bucket('5h', 0))]))), ['five_hour']);
  assert.equal(toAntigravityRateLimits(usage([group(bucket('5h', 0))])).five_hour.used_percentage, 100);
});

test('disabled buckets and unknown windows are skipped; windows are independent', () => {
  const out = toAntigravityRateLimits(usage([group(bucket('5h', 0.5, { disabled: true }), bucket('weekly', 0.5), bucket('monthly', 0.1))]));
  assert.deepEqual(Object.keys(out), ['seven_day']);
  assert.equal(toAntigravityRateLimits(usage([group(bucket('monthly', 0.1), bucket('5h', 0.5, { disabled: true }))])), undefined);
});

test('more than one group is ambiguous: nothing is shown (no model→group mapping)', () => {
  assert.equal(toAntigravityRateLimits(usage([group(bucket('5h', 0.5)), group(bucket('5h', 0.2))])), undefined);
  assert.equal(toAntigravityRateLimits(usage([group(bucket('5h', 0.5)), { name: 'Empty', buckets: [] }])), undefined);
});

test('two enabled buckets for the same window are ambiguous for that window only', () => {
  const out = toAntigravityRateLimits(usage([group(bucket('5h', 0.5), bucket('5h', 0.2), bucket('weekly', 0.5))]));
  assert.deepEqual(Object.keys(out), ['seven_day']);
});

test('strict values: non finite, out of 0..1 and non-numeric fractions are rejected; camelCase alias accepted; bad reset omitted', () => {
  for (const bad of [-0.1, 1.1, NaN, Infinity, '0.5', null]) {
    assert.equal(toAntigravityRateLimits(usage([group(bucket('5h', bad))])), undefined, String(bad));
  }
  const alias = toAntigravityRateLimits(usage([group({ name: 'w', window: 'weekly', remainingFraction: 0.5, resetTime: 'not a date' })]));
  assert.deepEqual(alias, { seven_day: { used_percentage: 50 } });
});

test('envelope and status: event/result unwrap accepted; failure status, other command, garbage and no groups rejected', () => {
  const inner = { status: 'OK', command: { name: 'usage', data: { groups: [group(bucket('5h', 0.5))] } } };
  assert.deepEqual(Object.keys(toAntigravityRateLimits(JSON.stringify({ event: 'result', result: inner }))), ['five_hour']);
  for (const text of [usage([group(bucket('5h', 0.5))], { status: 'ERROR' }), JSON.stringify({ status: 'SUCCESS', command: { name: 'other', data: { groups: [group(bucket('5h', 0.5))] } } }),
    'not json', '[]', usage([]), usage('x'), '']) {
    assert.equal(toAntigravityRateLimits(text), undefined, text.slice(0, 30));
  }
});

const cacheOf = (dir) => path.join(dir, 'usage-cache.antigravity.json');
const lockOf = (dir) => path.join(dir, 'usage-cache.antigravity.lock');
const limits = { five_hour: { used_percentage: 25 } };

test('cold start: no cache triggers exactly one refresh and returns nothing; the lock dedupes repeated renders', () => {
  const dir = mkdir();
  const spawned = [];
  const spawnImpl = (d) => spawned.push(d);
  assert.equal(antigravityLimits({ dir, now: 1_000, spawnImpl }), undefined);
  assert.equal(antigravityLimits({ dir, now: 1_001, spawnImpl }), undefined);
  assert.equal(antigravityLimits({ dir, now: 1_002, spawnImpl }), undefined);
  assert.deepEqual(spawned, [dir]);
});

test('fresh cache is served without refresh; after the cooldown it is served AND refreshed in background', () => {
  const dir = mkdir();
  fs.writeFileSync(cacheOf(dir), JSON.stringify({ at: 1_000, ok_at: 1_000, rate_limits: limits }));
  const spawned = [];
  const spawnImpl = (d) => spawned.push(d);
  assert.deepEqual(antigravityLimits({ dir, now: 30_000, spawnImpl }), limits);
  assert.equal(spawned.length, 0);
  assert.deepEqual(antigravityLimits({ dir, now: 1_000 + 3 * 60_000, spawnImpl }), limits);
  assert.equal(spawned.length, 1);
});

test('data older than one hour (last success) is dropped, even if failures keep refreshing the attempt time', () => {
  const dir = mkdir();
  fs.writeFileSync(cacheOf(dir), JSON.stringify({ at: 4_000_000, ok_at: 1_000, rate_limits: limits }));
  assert.equal(antigravityLimits({ dir, now: 4_000_001, spawnImpl: () => {} }), undefined);
});

test('a stale lock (crashed helper) is taken over; a live one is respected; spawn failure releases the lock', () => {
  const dir = mkdir();
  fs.writeFileSync(lockOf(dir), '');
  const spawned = [];
  antigravityLimits({ dir, now: Date.now(), spawnImpl: (d) => spawned.push(d) });
  assert.equal(spawned.length, 0);
  const old = new Date(Date.now() - 120_000);
  fs.utimesSync(lockOf(dir), old, old);
  antigravityLimits({ dir, now: Date.now(), spawnImpl: (d) => spawned.push(d) });
  assert.equal(spawned.length, 1);
  fs.rmSync(lockOf(dir));
  antigravityLimits({ dir, now: Date.now(), spawnImpl: () => { throw new Error('EAGAIN'); } });
  assert.equal(fs.existsSync(lockOf(dir)), false);
});

test('corrupt cache is treated as cold start and never throws', () => {
  const dir = mkdir();
  fs.writeFileSync(cacheOf(dir), '{oops');
  assert.equal(antigravityLimits({ dir, now: 1_000, spawnImpl: () => {} }), undefined);
});

test('withUsage: antigravity reads only the cache (no fetch, no credentials), drops pi header snapshot and never serves another provider cache', async () => {
  const dir = mkdir();
  fs.writeFileSync(path.join(dir, 'usage-cache.json'), JSON.stringify({ at: 1_000, rate_limits: { five_hour: { used_percentage: 99 } } }));
  fs.writeFileSync(cacheOf(dir), JSON.stringify({ at: 1_000, ok_at: 1_000, rate_limits: limits }));
  let fetched = 0;
  const p = await withUsage({ rate_limits: { seven_day: { used_percentage: 53 } } }, { provider: 'antigravity', cacheFile: path.join(dir, 'usage-cache.json'), authFile: path.join(dir, 'none.json'), now: 2_000, fetchImpl: async () => { fetched++; }, spawnImpl: () => {} });
  assert.deepEqual(p.rate_limits, limits);
  assert.equal(fetched, 0);
  const other = await withUsage({}, { provider: 'google', cacheFile: path.join(dir, 'usage-cache.json'), authFile: path.join(dir, 'none.json'), now: 2_000, spawnImpl: () => assert.fail('no refresh for google') });
  assert.equal(other.rate_limits, undefined);
});

test('parseAntigravityUsage: a valid answer without usable quota is {} (replaces the cache); invalid or failed answers are undefined (cache kept)', () => {
  for (const groups of [[group(bucket('5h', 0.5)), group(bucket('5h', 0.2))], [group(bucket('5h', 0.5), bucket('5h', 0.2))], [group(bucket('5h', 0.5, { disabled: true }))], [group(bucket('monthly', 0.1))], []]) {
    assert.deepEqual(parseAntigravityUsage(usage(groups)), {}, JSON.stringify(groups));
  }
  assert.deepEqual(Object.keys(parseAntigravityUsage(usage([group(bucket('weekly', 0.5))]))), ['seven_day']);
  for (const text of ['not json', '[]', usage([group(bucket('5h', 0.5))], { status: 'ERROR' }), JSON.stringify({ status: 'SUCCESS', command: { name: 'usage', data: {} } })]) {
    assert.equal(parseAntigravityUsage(text), undefined, text.slice(0, 30));
  }
});

test('antigravityLimits serves nothing from a cache whose last success was empty', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hudagy-empty-'));
  try {
    fs.writeFileSync(path.join(dir, 'usage-cache.antigravity.json'), JSON.stringify({ at: Date.now(), ok_at: Date.now(), rate_limits: {} }));
    assert.equal(antigravityLimits({ dir, spawnImpl: () => assert.fail('fresh cache: no refresh') }), undefined);
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

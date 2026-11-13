// Cota Antigravity (Gemini) para o HUD: `agy --print /usage --output-format json` (contrato do pi-antigravity-bridge
// src/usage.ts: command.data.groups[].buckets[] com window 5h|weekly, remaining_fraction, reset_time).
// O CLI leva ~10 s e o status line não pode esperar: o render só LÊ o cache e, vencido o cooldown, dispara este mesmo
// arquivo como helper destacado (`--refresh <dir>`, sem shell, stdio ignorado) que roda o agy e grava o cache.
// Só mostra a cota quando há EXATAMENTE UM grupo (a fonte não mapeia modelo→grupo); vários grupos = nada.
// Singleton simples: lock criado com 'wx' antes do spawn (dedupe, inclusive em cold start); lock velho é retomado.
// O helper só escreve usage-cache.antigravity.{json,lock} no diretório recebido.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const COOLDOWN_MS = 120_000; // entre tentativas (sucesso ou falha)
const MAX_AGE_MS = 3_600_000; // último sucesso mais velho que isso não é mostrado
const LOCK_STALE_MS = 45_000; // > timeout do agy: helper morto não trava para sempre
const AGY_TIMEOUT_MS = 35_000; // 30 s do --print-timeout + folga
const OUTPUT_CAP = 1024 * 1024;

const finite = (n) => typeof n === 'number' && Number.isFinite(n);
const object = (v) => (v !== null && typeof v === 'object' && !Array.isArray(v) ? v : undefined);
const WINDOWS = { '5h': 'five_hour', weekly: 'seven_day' };

/** Saída JSON do `agy /usage` → rate_limits do HUD. undefined = resposta inválida ou de erro (falha transitória:
 * o último sucesso pode ficar). Objeto (possivelmente vazio) = resposta de sucesso válida; vazio = ambígua ou sem cota
 * utilizável agora, e NUNCA se reaproveita a cota antiga. */
export function parseAntigravityUsage(text) {
  let payload;
  try {
    payload = object(JSON.parse(text));
  } catch {
    return undefined;
  }
  if (payload?.event !== undefined) payload = object(payload.result);
  if (!payload) return undefined;
  const status = typeof payload.status === 'string' ? payload.status.toUpperCase() : '';
  if (status !== '' && status !== 'SUCCESS' && status !== 'OK') return undefined;
  const command = object(payload.command);
  if (command?.name !== 'usage') return undefined;
  const groups = (object(command.data) ?? object(payload.data))?.groups;
  if (!Array.isArray(groups)) return undefined;
  if (groups.length !== 1) return {}; // vários grupos (ou nenhum): sem mapeamento modelo→grupo
  const buckets = object(groups[0])?.buckets;
  if (!Array.isArray(buckets)) return undefined;
  const found = {};
  const ambiguous = new Set();
  for (const raw of buckets) {
    const b = object(raw);
    const key = WINDOWS[b?.window];
    const remaining = b?.remaining_fraction ?? b?.remainingFraction;
    if (!b || b.disabled === true || !key || !finite(remaining) || remaining < 0 || remaining > 1) continue;
    if (found[key]) ambiguous.add(key);
    const reset = Date.parse(b.reset_time ?? b.resetTime ?? '');
    found[key] = { used_percentage: Math.round((1 - remaining) * 1000) / 10, ...(Number.isFinite(reset) ? { resets_at: Math.floor(reset / 1000) } : {}) };
  }
  for (const key of ambiguous) delete found[key];
  return found;
}

/** Só a cota utilizável; undefined em falha, ambiguidade ou nada utilizável. */
export function toAntigravityRateLimits(text) {
  const limits = parseAntigravityUsage(text);
  return limits && (limits.five_hour || limits.seven_day) ? limits : undefined;
}

const cachePath = (dir) => path.join(dir, 'usage-cache.antigravity.json');
const lockPath = (dir) => path.join(dir, 'usage-cache.antigravity.lock');

function readCache(dir) {
  try {
    return object(JSON.parse(fs.readFileSync(cachePath(dir), 'utf8')));
  } catch {
    return undefined;
  }
}

function writeCache(dir, value) {
  const tmp = `${cachePath(dir)}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value));
  fs.renameSync(tmp, cachePath(dir));
}

function acquireLock(dir, now) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fs.closeSync(fs.openSync(lockPath(dir), 'wx'));
      return true;
    } catch (error) {
      if (error?.code !== 'EEXIST') return false;
      try {
        if (now - fs.statSync(lockPath(dir)).mtimeMs < LOCK_STALE_MS) return false;
        fs.unlinkSync(lockPath(dir));
      } catch {
        return false;
      }
    }
  }
  return false;
}

const releaseLock = (dir) => fs.rmSync(lockPath(dir), { force: true });

/** Helper destacado: não bloqueia o render nem segura o terminal. */
function spawnHelper(dir) {
  spawn(process.execPath, [fileURLToPath(import.meta.url), '--refresh', dir], { detached: true, stdio: 'ignore' }).unref();
}

/** Cota em cache (≤1 h desde o último sucesso); dispara refresh em segundo plano vencido o cooldown. Nunca lança, nunca espera. */
export function antigravityLimits({ dir, now = Date.now(), spawnImpl = spawnHelper } = {}) {
  try {
    const cache = readCache(dir);
    if (!cache || !finite(cache.at) || now - cache.at >= COOLDOWN_MS) {
      fs.mkdirSync(dir, { recursive: true });
      if (acquireLock(dir, now)) {
        try {
          spawnImpl(dir);
        } catch {
          releaseLock(dir); // sem helper não há quem libere o lock
        }
      }
    }
    const fresh = cache && finite(cache.ok_at) && now - cache.ok_at < MAX_AGE_MS;
    const limits = fresh ? object(cache.rate_limits) : undefined;
    return limits && (limits.five_hour || limits.seven_day) ? limits : undefined;
  } catch {
    return undefined;
  }
}

/** Roda o agy com timeout e teto de saída; resolve o texto ou undefined. */
function runAgy() {
  const requested = Number(process.env.HUD_AGY_TIMEOUT_MS);
  const timeout = finite(requested) && requested > 0 ? Math.min(requested, AGY_TIMEOUT_MS) : AGY_TIMEOUT_MS;
  return new Promise((resolve) => {
    let out = '';
    let done = false;
    let child;
    const finish = (value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      child?.kill('SIGKILL');
      resolve(value);
    };
    const timer = setTimeout(() => finish(undefined), timeout);
    try {
      child = spawn('agy', ['--print', '/usage', '--output-format', 'json', '--print-timeout', '30s'], { stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      finish(undefined);
      return;
    }
    child.on('error', () => finish(undefined));
    child.stdout.on('data', (chunk) => {
      out += chunk;
      if (out.length > OUTPUT_CAP) finish(undefined);
    });
    child.on('close', (code) => finish(code === 0 ? out : undefined));
  });
}

/** Corpo do helper: uma tentativa; falha mantém o último sucesso (ok_at) e só avança `at`. */
export async function refreshAntigravity(dir, now = Date.now()) {
  try {
    const previous = readCache(dir);
    const text = await runAgy();
    const limits = text === undefined ? undefined : parseAntigravityUsage(text);
    // Resposta válida (mesmo ambígua/vazia) substitui o cache; só falha transitória mantém o último sucesso.
    writeCache(dir, limits
      ? { at: now, ok_at: now, rate_limits: limits }
      : { at: now, ...(finite(previous?.ok_at) ? { ok_at: previous.ok_at } : {}), ...(previous?.rate_limits ? { rate_limits: previous.rate_limits } : {}) });
  } finally {
    releaseLock(dir);
  }
}

if (process.argv[2] === '--refresh' && process.argv[3] && process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await refreshAntigravity(process.argv[3]).catch(() => {});
}

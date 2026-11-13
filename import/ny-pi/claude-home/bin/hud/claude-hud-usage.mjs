// Uso de 5h e semanal no HUD, do provedor que o pi está usando de fato. O pi-code só preenche rate_limits com os
// headers `anthropic-ratelimit-unified-*` (sempre da Anthropic) e só depois da primeira resposta; por isso aqui:
//  - o rate_limits do stdin só vale para anthropic; em qualquer outro provedor (ou desconhecido) é descartado;
//  - o provedor ativo (claude-hud-provider.mjs) escolhe a fonte de cota, com o token OAuth do próprio pi.
// Provedores com fonte instalada/documentada: anthropic (/api/oauth/usage) e openai-codex (chatgpt.com/backend-api/wham/usage,
// o endpoint do cliente oficial codex, mesma base do provider do pi-ai). Os demais não mostram cota, nunca inventada.
// Só leitura: nunca renova nem grava o token; o cache guarda só percentuais e resets (e um hash curto da conta).
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { antigravityLimits } from './claude-hud-antigravity.mjs';

const TTL_MS = 60_000; // o status line roda a cada mensagem; um pedido por minuto basta
const TIMEOUT_MS = 3_000;
const FIVE_HOUR_S = 5 * 3600;
const WEEK_S = 7 * 24 * 3600;

const finite = (n) => typeof n === 'number' && Number.isFinite(n);

/** Resposta do /api/oauth/usage → rate_limits do stdin do Claude Code (resets_at em segundos epoch). */
export function toRateLimits(data) {
  const win = (w) => {
    if (!finite(w?.utilization)) return undefined;
    const reset = Date.parse(w.resets_at ?? '');
    return { used_percentage: w.utilization, ...(Number.isFinite(reset) ? { resets_at: Math.floor(reset / 1000) } : {}) };
  };
  const five_hour = win(data?.five_hour);
  const seven_day = win(data?.seven_day);
  if (!five_hour && !seven_day) return undefined;
  return { ...(five_hour ? { five_hour } : {}), ...(seven_day ? { seven_day } : {}) };
}

/** Resposta do wham/usage → rate_limits. A janela é classificada pelo tamanho real (limit_window_seconds), não pela
 * posição primary/secondary: conta só semanal tem a janela semanal em primary e não ganha um 5h inventado. */
export function toCodexRateLimits(data) {
  const out = {};
  for (const w of [data?.rate_limit?.primary_window, data?.rate_limit?.secondary_window]) {
    if (!finite(w?.used_percent) || w.used_percent < 0) continue;
    const key = w.limit_window_seconds === FIVE_HOUR_S ? 'five_hour' : w.limit_window_seconds === WEEK_S ? 'seven_day' : undefined;
    if (!key || out[key]) continue;
    out[key] = { used_percentage: w.used_percent, ...(finite(w.reset_at) && w.reset_at > 0 ? { resets_at: w.reset_at } : {}) };
  }
  return out.five_hour || out.seven_day ? out : undefined;
}

const SOURCES = {
  anthropic: {
    cacheName: 'usage-cache.json', // formato histórico {at, rate_limits}: lido também pelo extensions/auto-resume
    url: 'https://api.anthropic.com/api/oauth/usage',
    parse: toRateLimits,
    request: ({ access }) => ({ Authorization: `Bearer ${access}`, 'anthropic-beta': 'oauth-2025-04-20', 'User-Agent': 'claude-hud-pi' }),
  },
  'openai-codex': {
    cacheName: 'usage-cache.openai-codex.json',
    url: 'https://chatgpt.com/backend-api/wham/usage',
    parse: toCodexRateLimits,
    needsAccount: true, // o cache é atado à conta (hash), nunca ao token
    request: ({ access, accountId }) => ({ Authorization: `Bearer ${access}`, 'ChatGPT-Account-Id': accountId, 'User-Agent': 'claude-hud-pi' }),
  },
};

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
}

function writeCache(file, value) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(value));
    fs.renameSync(tmp, file);
  } catch {
    // Sem cache só custa um pedido a mais no próximo render.
  }
}

const accountTag = (id) => (id ? crypto.createHash('sha256').update(String(id)).digest('hex').slice(0, 16) : undefined);

/** Ajusta payload.rate_limits ao provedor ativo; nunca lança. `provider` vem de activeModelProvider. */
export async function withUsage(payload, { provider, cacheFile, authFile = path.join(os.homedir(), '.pi', 'agent', 'auth.json'), now = Date.now(), fetchImpl = fetch, spawnImpl } = {}) {
  if (!payload) return payload;
  const source = Object.hasOwn(SOURCES, provider ?? '') ? SOURCES[provider] : undefined;
  // O que o pi-code mandou é sempre Anthropic: só vale com a Anthropic confirmada como provedor.
  if (provider === 'anthropic' && payload.rate_limits) return payload;
  delete payload.rate_limits;
  if (provider === 'antigravity') {
    // Sem endpoint HTTP: lê o cache do helper em segundo plano (claude-hud-antigravity.mjs); nunca bloqueia.
    const limits = antigravityLimits({ dir: path.dirname(cacheFile), now, ...(spawnImpl ? { spawnImpl } : {}) });
    if (limits) payload.rate_limits = limits;
    return payload;
  }
  if (!source) return payload;

  const file = path.join(path.dirname(cacheFile), source.cacheName);
  const cred = readJson(authFile)?.[provider];
  const usable = cred?.type === 'oauth' && cred.access && !(cred.expires && cred.expires <= now) && (!source.needsAccount || cred.accountId);
  if (!usable) return payload; // sem credencial OAuth válida nada do cache é servido (pode ser de outra conta) nem regravado
  const tag = source.needsAccount ? accountTag(cred?.accountId) : undefined;
  const cached = readJson(file);
  const mine = cached && (!source.needsAccount || cached.account === tag) ? cached : undefined;
  let limits = mine?.rate_limits;
  if (!(mine && finite(mine.at) && now - mine.at < TTL_MS)) {
    try {
      const res = await fetchImpl(source.url, { headers: source.request(cred), signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'error' });
      if (res.ok) limits = source.parse(await res.json());
    } catch {
      // Rede ou token falhou: fica o último valor conhecido deste provedor.
    }
    // Falhas também entram no cache, para um endpoint fora do ar não atrasar cada render em TIMEOUT_MS.
    writeCache(file, { at: now, ...(tag ? { account: tag } : {}), rate_limits: limits });
  }
  if (limits) payload.rate_limits = limits;
  return payload;
}

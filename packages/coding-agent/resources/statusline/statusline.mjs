// Launcher do claude-hud para o pi (porte do scripts/statusline.mjs do plugin claude-hud 0.10.0).
// O /claude-hud-setup copia este arquivo para $CLAUDE_CONFIG_DIR/plugins/claude-hud/statusline.mjs.
// Diferença do original: o pi não instala plugins do Claude Code, então a instalação mais nova do claude-hud é
// procurada também nos caches dos perfis do Claude Code (~/.claude/plugins/cache e ~/.claude-*/plugins/cache).
// A config do HUD continua em $CLAUDE_CONFIG_DIR/plugins/claude-hud/config.json (a do pi, separada da do Claude).
// O transcript do pi tem outro formato: antes de chamar o HUD, a sessão do pi é traduzida (claude-hud-pi-transcript.mjs)
// para um transcript no formato do Claude em plugins/claude-hud/pi-transcripts/, e o transcript_path do stdin aponta
// para ele. Assim as linhas de tools, agents, todos, skills e MCP funcionam no pi.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath, pathToFileURL } from 'node:url';

// O pi-code junta as linhas do statusLine num só segmento do rodapé; sem padding lateral do Claude Code.
const columns = Number.parseInt(process.env.COLUMNS ?? '', 10);
if (columns > 0) process.env.COLUMNS = String(Math.max(1, columns - 4));

// NO_COLOR (no-color.org): o claude-hud não o respeita; tira as cores SGR da saída (links OSC 8 ficam).
if (process.env.NO_COLOR) {
  const write = process.stdout.write.bind(process.stdout);
  const strip = (chunk) => String(chunk).replace(/\x1b\[[0-9;:]*m/g, '');
  process.stdout.write = (chunk, ...rest) => write(typeof chunk === 'string' || Buffer.isBuffer(chunk) ? strip(chunk) : chunk, ...rest);
}

const home = os.homedir();
const envDir = process.env.CLAUDE_CONFIG_DIR?.trim();
const configDir = !envDir
  ? path.join(home, '.claude')
  : envDir === '~' || envDir.startsWith('~/') ? path.join(home, envDir.slice(1)) : envDir;

const list = (dir) => {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
};
const cacheDirs = [
  path.join(configDir, 'plugins', 'cache'),
  path.join(home, '.claude', 'plugins', 'cache'),
  ...list(home).filter((name) => name.startsWith('.claude-')).sort().map((name) => path.join(home, name, 'plugins', 'cache')),
];
const entry = process.versions.bun ? path.join('src', 'index.ts') : path.join('dist', 'index.js');
const parseVersion = (name) => /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(name)?.slice(1).map(Number);
const compare = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

let latest;
for (const cacheDir of [...new Set(cacheDirs)]) {
  for (const marketplace of list(cacheDir)) {
    const pluginDir = path.join(cacheDir, marketplace, 'claude-hud');
    for (const name of list(pluginDir)) {
      const version = parseVersion(name);
      const file = path.join(pluginDir, name, entry);
      if (version && (!latest || compare(version, latest.version) > 0) && fs.existsSync(file)) {
        latest = { version, file };
      }
    }
  }
}

/** O stdin do pi, com transcript_path trocado pela tradução quando ele aponta uma sessão do pi. */
async function translatedStdin() {
  if (process.stdin.isTTY) return null;
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  try {
    const payload = JSON.parse(raw);
    // Provedor ativo, lido da sessão original do pi antes de o transcript ser traduzido (claude-hud-provider.mjs).
    const here0 = path.dirname(fileURLToPath(import.meta.url));
    const providerFile = [path.join(here0, 'claude-hud-provider.mjs'), path.join(home, '.pi', 'agent', 'claude-home', 'bin', 'hud', 'claude-hud-provider.mjs')].find((file) => fs.existsSync(file));
    const provider = providerFile ? (await import(pathToFileURL(providerFile).href)).activeModelProvider(payload) : undefined;
    const source = payload?.transcript_path;
    if (typeof source === 'string' && source) {
      // O tradutor fica ao lado do original (claude-home/bin); a cópia instalada aponta para lá.
      const here = path.dirname(fileURLToPath(import.meta.url));
      const candidates = [path.join(here, 'claude-hud-pi-transcript.mjs'), path.join(home, '.pi', 'agent', 'claude-home', 'bin', 'hud', 'claude-hud-pi-transcript.mjs')];
      const translator = candidates.find((file) => fs.existsSync(file));
      if (translator) {
        const { isPiSession, syncTranscript } = await import(pathToFileURL(translator).href);
        if (isPiSession(source)) {
          const out = path.join(configDir, 'plugins', 'claude-hud', 'pi-transcripts', path.basename(source));
          payload.transcript_path = syncTranscript(source, out);
        }
      }
    }
    // Uso de 5h/semanal do provedor ativo, também antes da primeira resposta da API (claude-hud-usage.mjs).
    const here = path.dirname(fileURLToPath(import.meta.url));
    const usage = [path.join(here, 'claude-hud-usage.mjs'), path.join(home, '.pi', 'agent', 'claude-home', 'bin', 'hud', 'claude-hud-usage.mjs')].find((file) => fs.existsSync(file));
    if (usage) {
      const { withUsage } = await import(pathToFileURL(usage).href);
      await withUsage(payload, { provider, cacheFile: path.join(configDir, 'plugins', 'claude-hud', 'usage-cache.json') });
    }
    return JSON.stringify(payload);
  } catch {
    // Sem tradução o HUD ainda mostra o que vem do stdin.
  }
  return raw;
}

if (latest) {
  const input = await translatedStdin();
  if (input !== null) {
    Object.defineProperty(process, 'stdin', { value: Readable.from([input]), configurable: true });
  }
  const hud = await import(pathToFileURL(latest.file).href);
  await hud.main();
}

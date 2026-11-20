// Provedor ativo do pi para o HUD. O payload do pi-code só traz model.id; o provedor vem do último `model_change`
// que o pi grava no arquivo da sessão a cada seleção de modelo (SessionManager.appendModelChange), ou seja, antes
// de qualquer resposta. Só vale se o modelId gravado for o do payload: senão a troca está em andamento e o
// provedor fica desconhecido (nunca o antigo). Sem heurística de nome de modelo.
import fs from 'node:fs';

const MAX_BYTES = 8 * 1024 * 1024; // sessões maiores: modelo mais antigo que isso vira desconhecido

/** Último model_change {provider, modelId} dentro dos últimos maxBytes do arquivo (uma leitura limitada). */
function lastModelChange(file, maxBytes) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    const len = Math.min(size, maxBytes);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    const lines = buf.toString('utf8').split('\n');
    if (len < size) lines.shift(); // primeira linha cortada pela janela
    for (let i = lines.length - 1; i >= 0; i--) {
      if (!lines[i].includes('"model_change"')) continue;
      try {
        const entry = JSON.parse(lines[i]);
        if (entry?.type === 'model_change') return entry;
      } catch {
        // linha malformada: segue para a anterior
      }
    }
  } catch {
    // sem arquivo legível: provedor desconhecido
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
  return undefined;
}

/** Id do provedor do modelo ativo, ou undefined quando não dá para afirmar. */
export function activeModelProvider(payload, { maxBytes = MAX_BYTES } = {}) {
  // pi-code (patch pendente) pode mandar model.provider no payload: vale direto, sem ler a sessão.
  const direct = payload?.model?.provider;
  if (typeof direct === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(direct)) return direct;
  const file = payload?.transcript_path;
  const id = payload?.model?.id;
  if (typeof file !== 'string' || !file || typeof id !== 'string' || !id) return undefined;
  const entry = lastModelChange(file, maxBytes);
  if (!entry || entry.modelId !== id || typeof entry.provider !== 'string' || !entry.provider) return undefined;
  return entry.provider;
}

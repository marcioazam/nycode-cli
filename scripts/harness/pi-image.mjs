#!/usr/bin/env node
// Gera uma imagem pelos modelos de imagem do pi (ModelRuntime.generateImages), com as
// credenciais do próprio pi (~/.pi/agent/auth.json): substitui o `impeccable generate-image`,
// que exige OPENAI_API_KEY. Padrão: openrouter/google/gemini-3-pro-image. O adaptador de imagens do
// OpenRouter no pi-ai usa chat/completions: os modelos openai/gpt-image-* (só /api/v1/images) dão 404 aqui.
//
// node ~/.pi/agent/claude-home/bin/pi-image.mjs --prompt-file p.txt --out plate.png \
//   [--ref crop.png ...] [--size 1536x1024] [--background transparent|opaque] [--model provider/id]
//   [--list]
// Sai 0 com "WROTE <out> <WxH> alpha=<yes|no>"; 1 em erro; 3 quando pediu transparent e veio sem alpha
// (o arquivo fica gravado para inspeção; não há chroma-key).

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, extname, resolve } from 'node:path'

const version = readFileSync(`${homedir()}/.pi/agent/install/current-version`, 'utf8').trim()
const { ModelRuntime } = await import(`${homedir()}/.pi/agent/install/releases/${version}/node_modules/@earendil-works/pi-coding-agent/dist/index.js`)

function args(argv) {
  const out = { ref: [] }
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i]
    if (key === '--list') out.list = true
    else if (key === '--ref') out.ref.push(argv[++i])
    else if (key.startsWith('--')) out[key.slice(2)] = argv[++i]
    else throw new Error(`argumento inesperado: ${key}`)
  }
  return out
}

/** Largura e altura de um PNG, e se ele tem canal alpha (color type 4 ou 6, ou chunk tRNS). */
export function pngInfo(buf) {
  if (buf.length < 33 || buf.readUInt32BE(0) !== 0x89504e47) return undefined
  const colorType = buf[25]
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), alpha: colorType === 4 || colorType === 6 || buf.includes('tRNS') }
}

const gcd = (a, b) => (b ? gcd(b, a % b) : a)
/** "1536x1024" -> aspect "3:2" e tier de resolução pelo lado maior. */
export function sizeHints(size) {
  const m = /^(\d+)x(\d+)$/.exec(size ?? '')
  if (!m) return {}
  const [w, h] = [Number(m[1]), Number(m[2])]
  const g = gcd(w, h)
  const long = Math.max(w, h)
  const tier = long <= 512 ? '512' : long <= 768 ? '768' : long <= 1024 ? '1K' : long <= 1536 ? '1.5K' : long <= 2048 ? '2K' : '4K'
  return { aspect_ratio: `${w / g}:${h / g}`, image_size: tier }
}

const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' }

async function main() {
  const opt = args(process.argv.slice(2))
  const rt = await ModelRuntime.create()
  const models = await rt.getAvailableOfType('image')
  if (opt.list) {
    for (const m of models) console.log(`${m.provider}/${m.id}`)
    return 0
  }
  if (!opt['prompt-file'] || !opt.out) throw new Error('uso: --prompt-file <txt> --out <png> [--ref img] [--size WxH] [--background transparent|opaque] [--model provider/id]')
  const wanted = opt.model ?? process.env.PI_IMAGE_MODEL ?? 'openrouter/google/gemini-3-pro-image'
  const model = models.find((m) => `${m.provider}/${m.id}` === wanted)
  if (!model) throw new Error(`modelo de imagem indisponível: ${wanted} (veja --list)`)
  const background = opt.background ?? 'opaque'
  if (!['transparent', 'opaque', 'auto'].includes(background)) throw new Error(`--background inválido: ${background}`)
  const prompt = readFileSync(opt['prompt-file'], 'utf8').trim()
  const input = [{ type: 'text', text: background === 'transparent' ? `${prompt}\n\nOutput a PNG with a real transparent background (alpha channel), no painted checkerboard.` : prompt }]
  for (const ref of opt.ref) {
    const mimeType = MIME[extname(ref).toLowerCase()]
    if (!mimeType) throw new Error(`referência não suportada: ${ref}`)
    input.push({ type: 'image', mimeType, data: readFileSync(ref).toString('base64') })
  }
  const hints = sizeHints(opt.size)
  const result = await rt.generateImages(model, { input }, {
    timeoutMs: 600_000,
    // Parâmetros de imagem do OpenRouter (docs: guides/overview/multimodal/image-generation);
    // o provedor ignora ou ajusta o que o modelo não suporta.
    onPayload: (params) => ({ ...params, image_config: { ...(hints.aspect_ratio ? hints : {}), background } }),
  })
  if (result.stopReason !== 'stop') throw new Error(`geração falhou (${result.stopReason}): ${result.errorMessage ?? 'sem detalhe'}`)
  const image = result.output.find((part) => part.type === 'image')
  if (!image) throw new Error(`o modelo não devolveu imagem${result.output[0]?.text ? `: ${result.output[0].text.slice(0, 200)}` : ''}`)
  const buf = Buffer.from(image.data, 'base64')
  const info = pngInfo(buf)
  if (!info) throw new Error(`o modelo devolveu ${image.mimeType}, não PNG`)
  const out = resolve(opt.out)
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, buf)
  const cost = result.usage?.cost?.total
  console.log(`WROTE ${out} ${info.width}x${info.height} alpha=${info.alpha ? 'yes' : 'no'} model=${wanted}${cost ? ` cost=$${cost.toFixed(4)}` : ''}`)
  if (background === 'transparent' && !info.alpha) {
    console.error('transparência pedida, mas o PNG não tem canal alpha: tente outro --model ou reporte o bloqueio')
    return 3
  }
  return 0
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then((code) => process.exit(code), (error) => {
    console.error(`pi-image: ${error.message}`)
    process.exit(1)
  })
}

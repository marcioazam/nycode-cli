/**
 * Corta a saída grande do `bash` (cabeça + cauda) e guarda o log completo em arquivo.
 *
 * O pi só corta em 2000 linhas/50 KB; uma saída de 500 linhas de teste custa tokens a cada volta seguinte. Aqui,
 * acima de 100 linhas, 20 KB ou com linha acima de 300 caracteres, o modelo recebe cabeça + cauda (em erro: cauda
 * maior e uma janela em volta da primeira linha de diagnóstico), o rodapé com o caminho do log e a chamada `read`
 * com offset/limit do maior trecho omitido. O status (`Command exited with code N`, timeout, abort) fica no fim.
 * Quando o pi já cortou (`Full output: PATH`), reusa o arquivo dele. Qualquer erro de fs deixa o resultado intacto.
 * Spec: ~/.pi/agent/claude-home/docs/context-economy-extensions-2026-11-12.md.
 *
 * Reverter: apagar este diretório.
 */
import { mkdirSync, openSync, closeSync, readSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

const MAX_LINES = 100
const MAX_BYTES = 20 * 1024
const MAX_LINE = 300
const KEEP_LINE = 240
const MAX_LOGS = 50
const HEAD_READ = 64 * 1024
const STATUS_RE = /\n\n(Command (?:exited with code \d+|timed out after[^\n]*|aborted|terminated without an exit code))$/
const FOOTER_RE = /\n\n\[Showing [^\n]*?\. Full output: ([^\]\n]+)\]$/
const DIAG_RE = /\b(error|Error|ERROR|FAIL|FAILED|panic|Traceback|AssertionError|exception)\b|-->\s+\S+:\d+:\d+/

export const logDir = () => join(tmpdir(), 'pi-bash-clamp')

function prune(dir: string) {
  const logs = readdirSync(dir)
    .filter((f) => f.endsWith('.log'))
    .map((f) => ({ f, t: statSync(join(dir, f)).mtimeMs }))
    .sort((a, b) => a.t - b.t)
  for (const { f } of logs.slice(0, Math.max(0, logs.length - MAX_LOGS))) unlinkSync(join(dir, f))
}

function writeSpill(path: string, text: string) {
  const dir = join(path, '..')
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  writeFileSync(path, text, { mode: 0o600 })
  prune(dir)
}

function readHead(path: string): string {
  const fd = openSync(path, 'r')
  try {
    const buf = Buffer.alloc(HEAD_READ)
    return buf.toString('utf8', 0, readSync(fd, buf, 0, HEAD_READ, 0))
  } finally {
    closeSync(fd)
  }
}

const cut = (l: string) => (l.length > MAX_LINE ? `${l.slice(0, KEEP_LINE)} … [line truncated: ${l.length - KEEP_LINE} chars omitted]` : l)
const omitted = (s: number, e: number) => `[... ${e - s + 1} lines omitted (lines ${s}-${e}) ...]`

/** Devolve o texto cortado, ou undefined quando nada muda (ou quando algo falha). */
export function clamp(text: string, isError: boolean, spillPath: () => string): string | undefined {
  try {
    let body = text
    let status = ''
    const st = STATUS_RE.exec(body)
    if (st) {
      status = st[0]
      body = body.slice(0, st.index)
    }
    let piPath: string | undefined
    let total: number | undefined
    const ft = FOOTER_RE.exec(body)
    if (ft) {
      piPath = ft[1]
      total = Number(/of (?:line )?(\d+)/.exec(ft[0])?.[1]) || undefined
      body = body.slice(0, ft.index)
    }
    const lines = body.replace(/\n$/, '').split('\n') // newline final não é linha (seq 1 500 = 500)
    if (!ft && lines.length <= MAX_LINES && Buffer.byteLength(body) <= MAX_BYTES && lines.every((l) => l.length <= MAX_LINE)) return undefined

    let logPath: string | undefined
    let headSrc = lines
    let count = lines.length
    if (piPath && total && statSync(piPath, { throwIfNoEntry: false })?.isFile()) {
      logPath = piPath // pi já cortou: a cabeça vem do arquivo completo, o total do rodapé dele
      headSrc = readHead(piPath).split('\n').slice(0, MAX_LINES)
      count = total
    } else {
      logPath = spillPath()
      writeSpill(logPath, body)
    }
    return build(headSrc, lines, count, isError, logPath, status)
  } catch {
    return undefined
  }
}

/** `lines` = saída em memória (inteira, ou só o fim quando o pi cortou); `total` = linhas do log completo. */
function build(headSrc: string[], lines: string[], total: number, isError: boolean, path: string, status: string): string {
  const whole = lines.length === total
  const foot = (shown: number, span: string) =>
    `\n\n[Output clamped: showing ${shown} of ${total} lines. Full output: ${path}${span}]${status}`
  let parts: string[]
  let shown: number
  let span = ''
  const nHead = isError ? 10 : 50
  let nTail = isError ? 70 : 50
  if (total <= nHead + nTail) {
    parts = lines.map(cut)
    shown = total
  } else {
    const head = headSrc.slice(0, nHead)
    let win: [number, number] | undefined // 0-based [início, fim) da janela de diagnóstico
    if (isError && whole) {
      const i = lines.slice(head.length, total - nTail).findIndex((l) => DIAG_RE.test(l))
      if (i >= 0) {
        const at = head.length + i
        const s = Math.max(head.length, Math.min(at - 10, total - nTail - 20))
        win = [s, Math.min(total - nTail, s + 20)]
      } else nTail = 90
    }
    const tail = lines.slice(-nTail)
    const tailFrom = total - tail.length
    const spans: Array<[number, number]> = [] // 1-based, inclusivo
    parts = head.map(cut)
    let next = head.length
    if (win) {
      if (win[0] > next) { parts.push(omitted(next + 1, win[0])); spans.push([next + 1, win[0]]) }
      parts.push(...lines.slice(win[0], win[1]).map(cut))
      next = win[1]
    }
    if (tailFrom > next) { parts.push(omitted(next + 1, tailFrom)); spans.push([next + 1, tailFrom]) }
    parts.push(...tail.map(cut))
    shown = head.length + tail.length + (win ? win[1] - win[0] : 0)
    if (spans.length) {
      const [s, e] = spans.reduce((a, b) => (b[1] - b[0] > a[1] - a[0] ? b : a))
      span = ` — read({ path: "${path}", offset: ${s}, limit: ${Math.min(250, e - s + 1)} }) for the largest omitted span`
    }
  }
  // MAX_BYTES: tira linhas do meio do conjunto mantido (nunca o rodapé nem o status)
  const fixed = Buffer.byteLength(foot(shown, span))
  let dropped = 0
  while (parts.length > 2 && Buffer.byteLength(parts.join('\n')) + fixed > MAX_BYTES) {
    if (!parts[Math.floor(parts.length / 2)].startsWith('[... ')) dropped++
    parts.splice(Math.floor(parts.length / 2), 1)
  }
  return parts.join('\n') + foot(shown - dropped, span)
}

export default function (pi: ExtensionAPI) {
  pi.on('tool_result', (event) => {
    if (event.toolName !== 'bash') return undefined
    const block = event.content?.[0]
    if (!block || block.type !== 'text') return undefined
    const out = clamp(block.text, event.isError, () => join(logDir(), `${event.toolCallId}.log`))
    return out === undefined ? undefined : { content: [{ type: 'text', text: out }] }
  })
}

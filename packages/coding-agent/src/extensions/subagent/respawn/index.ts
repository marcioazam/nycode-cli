/**
 * Respawn de filho em primeiro plano (zz-subagent-respawn.patch): quando o processo filho morre ou
 * termina em erro, run.ts o reinicia sobre a mesma sessão persistida, para continuar de onde parou.
 * Funções puras aqui; o loop e o spawn ficam em run.ts. Qualquer exceção na decisão = sem respawn.
 */

import { randomUUID } from 'node:crypto'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

export const MAX_RESPAWNS = 2
/** Espera antes do 1º e do 2º respawn; PI_SUBAGENT_RESPAWN_DELAY_MS substitui ambas (testes). */
const DELAYS_MS = [20_000, 60_000]
/** Erros do provedor que reiniciar não resolve (cota, cobrança, credencial, requisição inválida). */
const NON_RETRYABLE = /insufficient_quota|billing|quota exceeded|out of budget|usage limit|authentication_error|invalid_api_key|permission_error|invalid_request_error/i

type Env = Record<string, string | undefined>
interface Msg {
  role?: string
  stopReason?: string
  errorMessage?: string
}

export interface RespawnInput {
  wasAborted: boolean
  stopBy?: string
  partial?: boolean
  /** Respawns já feitos. */
  attempts: number
  /** Código bruto do close; null = morto por sinal (OOM, kill). */
  exitCode: number | null
  /** Só as mensagens desta tentativa. */
  messages: Msg[]
  stderr?: string
  env?: Env
  /** Reserva uma execução no orçamento do lane; texto de erro = orçamento esgotado. Chamada por último. */
  claimBudget?: () => string | undefined
}

const oneLine = (text: string, max: number): string => text.replace(/\s+/g, ' ').trim().slice(0, max)

/** Motivo (≤200 caracteres) para respawnar, ou undefined para manter o comportamento de sempre. */
export function shouldRespawn(i: RespawnInput): string | undefined {
  try {
    const env = i.env ?? process.env
    if (i.wasAborted || i.stopBy || i.partial || env.PI_SUBAGENT_RESPAWN === '0' || i.attempts >= MAX_RESPAWNS) return undefined
    const last = [...i.messages].reverse().find((m) => m.role === 'assistant')
    let reason: string
    if (i.exitCode !== 0) reason = `exit ${i.exitCode === null ? 'by signal' : `code ${i.exitCode}`}`
    else if (last?.stopReason === 'error') reason = 'error'
    else if (!last) reason = 'no assistant message'
    else return undefined
    // Erro do último turno só vale quando ele é erro: um turno ok seguido de exit != 0 usa o stderr.
    const detail = last?.stopReason === 'error' && last.errorMessage ? last.errorMessage : (i.stderr ?? '').trim().slice(-300)
    if (NON_RETRYABLE.test(`${last?.errorMessage ?? ''}\n${detail}`)) return undefined
    if (i.claimBudget?.()) return undefined
    return oneLine(detail ? `${reason}: ${detail}` : reason, 200)
  } catch {
    return undefined
  }
}

export const respawnDelayMs = (attempt: number, env: Env = process.env): number => {
  const forced = Number(env.PI_SUBAGENT_RESPAWN_DELAY_MS)
  return env.PI_SUBAGENT_RESPAWN_DELAY_MS !== undefined && Number.isFinite(forced) && forced >= 0 ? forced : (DELAYS_MS[attempt] ?? DELAYS_MS[DELAYS_MS.length - 1])
}

/** Diretório de sessão do filho; undefined (= segue com --no-session, sem respawn) se não der para criar. */
export function makeSessionDir(): string | undefined {
  try {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'pi-code-fg-session-'))
  } catch {
    return undefined
  }
}

/** Troca --no-session por uma sessão persistida (a mesma ideia do background.ts); muda args no lugar. */
export function useSessionArgs(args: string[], sessionDir: string, id = `pi-code-fg-${randomUUID().slice(0, 8)}`): string[] {
  const at = args.indexOf('--no-session')
  if (at !== -1) args.splice(at, 1, '--session-id', id, '--session-dir', sessionDir)
  return args
}

/** Tarefa do filho reiniciado; a conversa anterior é recarregada da sessão. */
export function respawnTask(reason: string): string {
  return `Your previous run of this task stopped unexpectedly (${oneLine(reason, 200)}). Your full prior conversation is loaded. Continue exactly where you stopped; do not repeat completed tool calls or side effects \u2014 inspect the current state (files, git status) first if unsure. Then finish the original task and give the handback it asked for.`
}

/** Espera abortável; true = o sinal abortou. */
export function sleepAbortable(ms: number, signal?: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve(true)
    const onAbort = () => {
      clearTimeout(timer)
      resolve(true)
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve(false)
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * The `run` tool (local patch): long-running shell commands the agent starts, lists, tails, stops and waits on.
 * Pure of UI: it talks to the registry and shell.ts.
 */
import type { ExtensionAPI } from '../../core/extensions/types.ts'
import { type Static, Type } from 'typebox'

import { stringEnum } from '../_shared/model/string-enum.ts'
import { displayState, type RunRecord, type RunRegistry } from './registry.ts'
import { startShell, stopRun } from './shell.ts'

export const TOOL_NAME = 'run'
const MAX_TAIL = 200
const MAX_WAIT_S = 1800

const Params = Type.Object({
  action: stringEnum(['start', 'list', 'tail', 'stop', 'wait'] as const, { description: 'start | list | tail | stop | wait' }),
  command: Type.Optional(Type.String({ description: 'start: shell command (bash -lc)' })),
  cwd: Type.Optional(Type.String({ description: 'start: working directory (default: the session cwd)' })),
  name: Type.Optional(Type.String({ description: 'start: short label shown in the Run section' })),
  await: Type.Optional(Type.Boolean({ description: 'start: you will be told when it finishes (a new turn starts); do not poll' })),
  id: Type.Optional(Type.String({ description: 'tail, stop, wait: run id (from start or list)' })),
  lines: Type.Optional(Type.Number({ description: `tail: last N lines (default 20, max ${MAX_TAIL})` })),
  timeout_s: Type.Optional(Type.Number({ description: `wait: seconds to block (default 300, max ${MAX_WAIT_S})` })),
})
type P = Static<typeof Params>

export const clock = (ms: number): string => {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600)
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0')
  const ss = String(s % 60).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

function line(r: RunRecord, now: number): string {
  const end = r.endedAt ?? now
  const exit = r.state === 'running' ? '' : r.exitCode !== undefined ? ` exit ${r.exitCode}` : r.signal ? ` sinal ${r.signal}` : ' terminou'
  return `${r.id} [${r.kind}] ${displayState(r, now)}${exit} · ${clock(end - r.startedAt)} · ${r.name}${r.awaited ? ' · aguardado' : ''}${r.logPath ? ` · log ${r.logPath}` : ''}`
}

/** State, exit, duration and the last lines: what `wait` and the finish message carry. */
export function summary(r: RunRecord, now: number, lines = 20): string {
  const tail = r.tail.slice(-lines)
  return `${line(r, now)}\n${tail.length ? tail.join('\n') : '(sem output)'}`
}

const text = (t: string, isError = false) => ({ content: [{ type: 'text' as const, text: t }], details: {}, ...(isError ? { isError: true } : {}) })

export async function execute(reg: RunRegistry, params: P, cwd: string, signal?: AbortSignal) {
  const now = reg.now()
  const need = (): RunRecord | string => {
    if (!params.id) return 'falta id'
    return reg.get(params.id) ?? `run desconhecido: ${params.id}`
  }
  switch (params.action) {
    case 'start': {
      if (!params.command?.trim()) return text('start precisa de command', true)
      try {
        const r = startShell(reg, { command: params.command, cwd: params.cwd || cwd, name: params.name, awaited: params.await })
        const hint = r.awaited ? 'Você será avisado quando terminar (novo turno); não faça polling.' : 'Use run wait/tail para acompanhar.'
        return text(`iniciado ${r.id} (pid ${r.pid})\nlog: ${r.logPath}\n${hint}`)
      } catch (e) {
        return text((e as Error).message, true)
      }
    }
    case 'list': {
      const rows = reg.snapshot()
      return text(rows.length ? rows.map((r) => line(r, now)).join('\n') : 'nenhum run')
    }
    case 'tail': {
      const r = need()
      if (typeof r === 'string') return text(r, true)
      const n = Math.max(1, Math.min(MAX_TAIL, Math.floor(params.lines ?? 20)))
      return text(summary(r, now, n))
    }
    case 'stop': {
      const r = need()
      if (typeof r === 'string') return text(r, true)
      const res = stopRun(reg, r)
      return text(res === 'stopping' ? `parando ${r.id}: SIGINT agora, SIGTERM em 7,5 s, SIGKILL em +2,5 s` : `${r.id} não está rodando`, res !== 'stopping')
    }
    case 'wait': {
      const r = need()
      if (typeof r === 'string') return text(r, true)
      const s = Math.max(1, Math.min(MAX_WAIT_S, params.timeout_s ?? 300))
      const out = (await reg.waitFor(r.id, s * 1000, signal)) ?? r
      const head = out.state === 'running' ? `ainda rodando após ${s}s\n` : ''
      return text(head + summary(out, reg.now()))
    }
  }
}

export function registerRunTool(nycode: ExtensionAPI, reg: RunRegistry): void {
  nycode.registerTool({
    name: TOOL_NAME,
    label: 'Run',
    description:
      'Run long shell commands in the background without blocking. Actions: start {command, cwd?, name?, await?} (returns id and log path at once; at most 8 live), list, tail {id, lines<=200}, stop {id}, wait {id, timeout_s<=1800} (blocks until it ends or times out). Use await:true to be woken when it finishes instead of polling.',
    promptSnippet: 'Start and follow long-running shell commands in the background (run start/list/tail/stop/wait)',
    parameters: Params,
    async execute(_id, params, signal, _onUpdate, ctx) {
      return execute(reg, params, (ctx as { cwd?: string } | undefined)?.cwd ?? process.cwd(), signal)
    },
  })
}

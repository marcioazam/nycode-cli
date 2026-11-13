/**
 * Toca um som local quando o turno do pi termina de vez (porta de ~/.claude/hooks/sound-notify.py, que por sua vez
 * veio do ~/.codex/bin/codex-sound-notify).
 *
 * `agent_settled` é o fim real: depois de retries, compaction e continuações (/goal, plan gate), então um turno toca
 * uma vez. Só na sessão interativa principal: nada em subagentes (PI_CODE_SUBAGENT=1) nem em `pi -p` (sem UI), para
 * evals e lanes não tocarem em série. Ordem do player: canberra-gtk-play, pw-play com o som freedesktop, bell no TTY.
 * Desligar: PI_SOUND_NOTIFY=0. Complementa o notify.ts do pi-code (notificação de terminal só quando "ausente").
 */

import { spawn } from 'node:child_process'
import * as fs from 'node:fs'
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

const COMPLETE_SOUND = '/usr/share/sounds/freedesktop/stereo/complete.oga'

function onPath(bin: string): boolean {
  return (process.env.PATH ?? '').split(':').some((dir) => dir && fs.existsSync(`${dir}/${bin}`))
}

export function playerCommand(exists: (bin: string) => boolean = onPath, hasSound: boolean = fs.existsSync(COMPLETE_SOUND)): string[] | undefined {
  if (exists('canberra-gtk-play')) return ['canberra-gtk-play', '-i', 'complete', '-d', 'pi turn complete']
  if (hasSound && exists('pw-play')) return ['pw-play', COMPLETE_SOUND]
  return undefined
}

function play(): void {
  const command = playerCommand()
  if (command) {
    try {
      spawn(command[0], command.slice(1), { stdio: 'ignore', detached: true }).unref()
      return
    } catch {
      // cai no bell
    }
  }
  try {
    fs.writeFileSync('/dev/tty', '\x07')
  } catch {
    // sem TTY: nada a fazer
  }
}

export default function (pi: ExtensionAPI) {
  if (process.env.PI_CODE_SUBAGENT === '1' || process.env.PI_SOUND_NOTIFY === '0') return
  pi.on('agent_settled', async (_event: any, ctx: any) => {
    if (ctx?.hasUI) play()
  })
}

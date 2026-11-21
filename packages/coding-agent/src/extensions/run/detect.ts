/**
 * Detection of processes the agent drops into the background with the bash tool (local patch).
 *
 * Supported form: ONE unquoted separator `&` in a single-line command (`nohup x > f 2>&1 &`, `cmd &`,
 * `a && b &`, `systemd-run --user --scope -- x &`, `setsid x &`, `nohup x & sleep 1; tail f`). The command gets
 *   \n__nycode_rc=$?; echo "__NYCODE_RUN_PID=$!"; (exit $__nycode_rc)
 * appended: `$!` is the pid of that last background job and the exit status of the command is kept. tool_result
 * reads the marker line (and removes it from the text the model sees).
 * Fail closed (command untouched, no run): several `&`, a newline, a here-document, an unbalanced quote, `#`
 * comments, `(`/`)`/`` ` ``/`$(`, a trailing `\`, or no `&` at all. `setsid x` or `systemd-run x` without `&`
 * (which detach by themselves) leave no `$!`, so they are not detected. For `a && b &` the pid is the
 * backgrounded subshell; stopping walks its descendants.
 */
import { homedir } from 'node:os'
import { isAbsolute, resolve } from 'node:path'

export const PID_MARK = '__NYCODE_RUN_PID='

export interface Instrumented {
  /** Command to run in place of the original. */
  command: string
  /** The backgrounded list without the `&`, what `r` restarts. */
  display: string
  /** Absolute log file found in `> file`, when it can be known without running the shell. */
  logPath?: string
  /** `&` closes the command: restart-able as a foreground run. */
  trailing: boolean
}

interface Scan {
  /** Index of the single separator `&`, or -1 when there is none or the command is not safe to instrument. */
  amp: number
  hasCd: boolean
}

/** Walks the command once, honoring quotes; rejects everything outside the supported form. */
function scan(cmd: string): Scan {
  const bad: Scan = { amp: -1, hasCd: false }
  let quote: '' | "'" | '"' = ''
  let amps = -1
  let count = 0
  let wordStart = true
  let word = ''
  let hasCd = false
  const endWord = (): void => {
    if (word === 'cd' || word === 'pushd') hasCd = true
    word = ''
  }
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i]!
    if (quote === "'") {
      if (c === "'") quote = ''
      word += c
      continue
    }
    if (c === '\\') {
      if (i === cmd.length - 1) return bad
      i += 1
      word += 'x'
      wordStart = false
      continue
    }
    if (quote === '"') {
      if (c === '"') quote = ''
      else if (c === '`' || (c === '$' && cmd[i + 1] === '(')) return bad
      word += c
      continue
    }
    if (c === "'" || c === '"') {
      quote = c
      wordStart = false
      word += c
      continue
    }
    if (c === '\n' || c === '`' || c === '(' || c === ')') return bad
    if (c === '#' && wordStart) return bad
    if (c === '<' && cmd[i + 1] === '<') return bad
    if (c === '&') {
      const prev = cmd[i - 1]
      const next = cmd[i + 1]
      if (next === '&') {
        i += 1 // `&&`
        endWord()
        wordStart = true
        continue
      }
      if (prev === '>' || prev === '<' || next === '>') continue // `2>&1`, `>&2`, `&>file`
      count += 1
      amps = i
      endWord()
      wordStart = true
      continue
    }
    if (/\s/.test(c) || c === ';' || c === '|') {
      endWord()
      wordStart = true
      continue
    }
    wordStart = false
    word += c
  }
  endWord()
  if (quote !== '' || count !== 1) return bad
  return { amp: amps, hasCd }
}

/** Splits a list into shell words, quotes removed; only for redirect targets. */
function words(text: string): string[] {
  return [...text.matchAll(/(?:"[^"]*"|'[^']*'|[^\s"'])+/g)].map((m) => m[0].replace(/"([^"]*)"|'([^']*)'/g, '$1$2'))
}

/** First `> file` / `>> file` / `&> file` / `1> file` of the list (stdout), as an absolute path or undefined. */
function redirectTarget(list: string, cwd: string, hasCd: boolean): string | undefined {
  const ws = words(list)
  for (let i = 0; i < ws.length; i++) {
    const m = /^(?:1|&)?>>?(.*)$/.exec(ws[i]!)
    if (!m) continue
    let target = m[1] || ws[i + 1] || ''
    if (!target || target.startsWith('&') || target === '/dev/null' || /[$*?[\]`]/.test(target)) return undefined
    if (target === '~' || target.startsWith('~/')) target = homedir() + target.slice(1)
    else if (!isAbsolute(target)) {
      if (hasCd) return undefined // a `cd` earlier in the command moves the base
      target = resolve(cwd, target)
    }
    return target
  }
  return undefined
}

/** The instrumented command, or undefined when the command must stay untouched. */
export function instrument(command: string, cwd: string): Instrumented | undefined {
  const cmd = command.trim()
  if (!cmd.includes('&')) return undefined
  const s = scan(cmd)
  if (s.amp < 0) return undefined
  const before = cmd.slice(0, s.amp)
  // The backgrounded list: after the last `;` before the `&` (quotes are balanced, checked by scan).
  const semi = lastTopLevel(before, ';')
  const list = before.slice(semi + 1).trim()
  if (!list) return undefined
  return {
    command: `${cmd}\n__nycode_rc=$?; echo "${PID_MARK}$!"; (exit $__nycode_rc)`,
    display: list,
    logPath: redirectTarget(list, cwd, s.hasCd),
    trailing: cmd.slice(s.amp + 1).trim() === '',
  }
}

function lastTopLevel(text: string, ch: string): number {
  let quote = ''
  let at = -1
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!
    if (quote) {
      if (c === quote) quote = ''
    } else if (c === '\\') i += 1
    else if (c === "'" || c === '"') quote = c
    else if (c === ch) at = i
  }
  return at
}

/** Pid from the marker line (0 or absent = none) and the output without that line. */
export function extractPid(text: string): { pid?: number; text: string } {
  const re = new RegExp(`^${PID_MARK}(\\d*)\\r?\\n?`, 'm')
  const m = re.exec(text)
  if (!m) return { text }
  const pid = m[1] ? Number(m[1]) : undefined
  return { pid: pid && pid > 1 ? pid : undefined, text: text.replace(re, '') }
}

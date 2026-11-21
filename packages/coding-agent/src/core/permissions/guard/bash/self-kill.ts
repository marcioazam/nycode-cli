// `pkill -f` / `pgrep -f` whose pattern matches the command line of the shell that runs it (the `bash -c` kills itself,
// exit 143/144). Port of the self-kill rules of guard.py.
import { runInNewContext } from "node:vm";
import { PY_SPACE, PY_WORD, pySplit } from "../py-path.ts";
import { ShlexError, shlexSplit } from "../shlex.ts";
import { type Finding, maskText, shortFlags } from "./parse.ts";

// Options of pkill/pgrep that consume the next argument (procps-ng).
const PGREP_VALUE_OPTS = new Set([
	...["-u", "-U", "-g", "-G", "-P", "-s", "-t", "-d"],
	...["--signal", "--euid", "--uid", "--pgroup", "--group", "--parent", "--session", "--terminal"],
	...["--delimiter", "--ns", "--nslist"],
]);
const PGREP_KILL_RE = new RegExp(`(?<![${PY_WORD}])pgrep[${PY_SPACE}]+([^|;&)\`]*)`, "gu");
const XARGS_KILL_RE = new RegExp(
	`^[${PY_SPACE}]*\\|[${PY_SPACE}]*xargs(?![${PY_WORD}])[^|;&]*(?<![${PY_WORD}])kill(?![${PY_WORD}])`,
	"u",
);
const KILL_SUBSTITUTION_RE = new RegExp(`(?<![${PY_WORD}])kill(?![${PY_WORD}])[^;|&]*(\\$\\(|\`)[${PY_SPACE}]*$`, "u");

/** Deny text for a self-matching kill; `{0}` of the guard becomes the command name. */
export const selfKillMessage = (command: string): string =>
	`${command} -f com padrão que casa com a própria linha de comando do shell (o bash -c que roda isto morre, ` +
	"exit 143/144); use o colchete, ex. '[c]hrome', ou o PID salvo";

/** The pattern of pkill/pgrep when -f/--full is present; otherwise undefined. */
export function fullMatchPattern(args: string[]): string | undefined {
	const flags = shortFlags(args);
	if (!flags.has("-f") && !flags.has("--full")) return undefined;
	const rest: string[] = [];
	let skip = false;
	for (const a of args) {
		if (skip) skip = false;
		else if (PGREP_VALUE_OPTS.has(a)) skip = true;
		else if (!a.startsWith("-")) rest.push(a);
	}
	return rest.at(-1);
}

// Python refuses a repeat count above its MAXREPEAT (OverflowError); JS accepts any count and would never match.
const MAX_REPEAT = 4294967295;
const REPEAT_RE = /\{(\d*)(?:,(\d*))?\}/g;

function repeatTooLarge(pattern: string): boolean {
	return [...pattern.matchAll(REPEAT_RE)].some((m) =>
		[m[1], m[2]].some((n) => n !== undefined && Number(n) > MAX_REPEAT),
	);
}

// Milliseconds a pattern may run against the command before matchesSelf gives up.
const MATCH_TIMEOUT_MS = 200;

/** Whether `pattern` (a Python regex in guard.py, a JS one here) matches the command; invalid ones are literal text. */
export function matchesSelf(pattern: string, cmd: string): boolean {
	if (repeatTooLarge(pattern)) return cmd.includes(pattern);
	try {
		return runInNewContext(
			"new RegExp(pattern).test(cmd)",
			{ pattern, cmd },
			{ timeout: MATCH_TIMEOUT_MS },
		) as boolean;
	} catch (error) {
		// Model-supplied pattern and command: V8 interrupts catastrophic backtracking (F5). Timing out means the
		// pattern is too costly to prove safe, so answer "matches" and the pgrep|kill is denied (guard.py dies at its
		// 30 s hook timeout and fails closed). Anything else is an invalid pattern, taken as literal text.
		if ((error as NodeJS.ErrnoException).code === "ERR_SCRIPT_EXECUTION_TIMEOUT") return true;
		return cmd.includes(pattern);
	}
}

/** `pgrep -f` piped into kill (`| xargs kill`, `kill $(...)`, backticks) that matches the shell's own line. */
export function checkSelfKill(cmd: string): Finding[] {
	const found: Finding[] = [];
	const masked = maskText(cmd);
	for (const m of masked.matchAll(PGREP_KILL_RE)) {
		const end = m.index + m[0].length;
		const start = end - m[1].length;
		const before = masked.slice(0, m.index);
		const after = masked.slice(end);
		if (!XARGS_KILL_RE.test(after) && !KILL_SUBSTITUTION_RE.test(before)) continue;
		const raw = cmd.slice(start, end);
		let args: string[];
		try {
			args = shlexSplit(raw, false);
		} catch (error) {
			if (!(error instanceof ShlexError)) throw error;
			args = pySplit(raw);
		}
		const pattern = fullMatchPattern(args);
		if (pattern && matchesSelf(pattern, cmd)) found.push(["deny", selfKillMessage("pgrep")]);
	}
	return found;
}

/**
 * Time limit policy of the `bash` tool (nycode seam K8): no `timeout` or an invalid one gets 600 s, anything above
 * 1800 s is capped at 1800 s, and a timeout result carries a hint block about running long work in the background.
 *
 * Why: without a default a hung command freezes the session until the user presses Esc, and foreground sleeps or
 * CI polls burn wall time. Refusing a request above the cap discarded the whole tool call (heredocs included), so
 * the cap clamps instead. 600 s is deliberate: a repository gate runs in a single `bash` call and takes minutes.
 *
 * `tools.bash.backgroundOnTimeout` (env NYCODE_BASH_TIMEOUT_BG): a command that exceeds its time is not killed; it
 * keeps running in the background and the model receives its pid and log path.
 */

export const DEFAULT_TIMEOUT_S = 600;
export const MAX_TIMEOUT_S = 1800;
/** Extra seconds the tool waits past the script's own deadline so the shell trap fires before the tool kills it. */
const BACKGROUND_SLACK_S = 60;

/** Timeout to apply, in seconds: the default when missing or invalid, the cap when above it. */
export function decideTimeout(timeout: number | undefined): number {
	if (timeout === undefined || !Number.isFinite(timeout) || timeout <= 0) return DEFAULT_TIMEOUT_S;
	return Math.min(timeout, MAX_TIMEOUT_S);
}

/** Own content block added to a bash "Command timed out" result: the tool only says how long it waited, not that more is capped. */
export const TIMEOUT_HINT = `[bash-timeout] Timeouts are capped at ${MAX_TIMEOUT_S} s. For longer work run it in the background (nohup <cmd> > log 2>&1 & echo $!) and wait with: while kill -0 PID 2>/dev/null; do sleep 5; done (returns as soon as it ends; no fixed sleep), then read the log.`;

/** Content with the timeout hint as a last text block when a bash call failed with "Command timed out after"; else the same array. */
export function withTimeoutHint<T extends { type: string }>(
	toolName: string,
	isError: boolean,
	content: T[],
): (T | { type: "text"; text: string })[] {
	if (toolName !== "bash" || !isError) return content;
	const timedOut = content.some(
		(c) => c.type === "text" && (c as { text?: string }).text?.includes("Command timed out after"),
	);
	return timedOut ? [...content, { type: "text", text: TIMEOUT_HINT }] : content;
}

// biome-ignore lint/suspicious/noTemplateCurlyInString: shell expansion, not JS
const BG_DIR = "${TMPDIR:-/tmp}/nycode-bg";

/**
 * POSIX sh script: runs `command` in the background with its output in a log; a watcher sends USR1 to the shell after
 * `seconds` and the trap prints the log tail and exits 0 without killing the command. Normal end: the original
 * output and exit code. The command sits on its own lines (heredocs and trailing comments work).
 */
export function wrapForBackground(command: string, seconds: number, id: string, dir = BG_DIR): string {
	const msg = `[bash-timeout] Still running after ${seconds} s: left running in the background (pid $__nycodebg_p, log $__nycodebg_l). Do not start another copy. To wait for it, use: while kill -0 $__nycodebg_p 2>/dev/null; do sleep 2; done (returns as soon as it ends; prefer this to a fixed sleep). Then read: tail -n 50 $__nycodebg_l`;
	return `mkdir -p "${dir}"; __nycodebg_l="${dir}/${id}.log"
{
${command}
} >"$__nycodebg_l" 2>&1 &
__nycodebg_p=$!
trap 'tail -c 4000 "$__nycodebg_l"; echo; echo "${msg}"; exit 0' USR1
( sleep ${seconds}; kill -0 $__nycodebg_p 2>/dev/null && kill -USR1 $$ ) >/dev/null 2>&1 &
__nycodebg_w=$!
wait $__nycodebg_p; __nycodebg_rc=$?
pkill -P $__nycodebg_w 2>/dev/null; kill $__nycodebg_w 2>/dev/null
cat "$__nycodebg_l"; exit $__nycodebg_rc
`;
}

/** Command and timeout (seconds) the tool runs, after the policy. */
export function applyBashTimeout(
	command: string,
	timeout: number | undefined,
	toolCallId: string,
	backgroundOnTimeout: boolean,
): { command: string; timeout: number } {
	const t = decideTimeout(timeout);
	if (backgroundOnTimeout && command.trim() && !/&\s*$/.test(command) && !/^\s*sleep /.test(command)) {
		const id = toolCallId.replace(/[^A-Za-z0-9_-]/g, "_");
		return { command: wrapForBackground(command, t, id), timeout: t + BACKGROUND_SLACK_S };
	}
	return { command, timeout: t };
}

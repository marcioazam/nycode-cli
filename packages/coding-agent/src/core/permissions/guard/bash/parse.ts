// Shell command parsing for the guard (port of the parsing half of guard.py): tokens, command segments, wrapper and
// privilege prefixes, nested commands, and masking of quoted text and heredoc bodies.
import { basename, normpath, PY_SPACE, PY_WORD } from "../py-path.ts";
import { ShlexError, shlexSplit } from "../shlex.ts";

/** A finding of a rule: its level and the reason shown to the user. */
export type Finding = readonly ["ask" | "deny", string];

export const SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh", "fish"]);
export const FETCHERS = new Set(["curl", "wget"]);
const WRAPPERS = new Set(["env", "nohup", "time", "command", "exec", "nice", "stdbuf", "timeout"]);
// Options of each wrapper that consume the next argument.
const WRAPPER_VALUE_OPTS = new Map<string, ReadonlySet<string>>([
	["env", new Set(["-u", "-C", "-S", "--unset", "--chdir", "--split-string"])],
	["nice", new Set(["-n", "--adjustment"])],
	["stdbuf", new Set(["-i", "-o", "-e", "--input", "--output", "--error"])],
	["timeout", new Set(["-s", "-k", "--signal", "--kill-after"])],
	["time", new Set(["-f", "-o", "--format", "--output"])],
	["exec", new Set(["-a"])],
]);
const XARGS_VALUE_OPTS = new Set([
	...["-a", "-d", "-E", "-I", "-L", "-n", "-P", "-s", "--arg-file", "--delimiter", "--eof"],
	...["--max-lines", "--max-args", "--max-procs", "--max-chars", "--process-slot-var"],
]);
const FIND_EXEC = new Set(["-exec", "-execdir", "-ok", "-okdir"]);
/** Nesting above this asks, but is still analyzed (a deny wins) down to HARD_DEPTH. */
export const MAX_DEPTH = 3;
export const HARD_DEPTH = 24;
const KEYWORDS = new Set(["{", "}", "!", "then", "do", "else", "elif", "if", "while", "until", "fi", "done"]);
export const DEEP: Finding = ["ask", "comando aninhado fundo demais para analisar"];
const PRIV = new Set(["sudo", "su", "doas"]);
const SEPARATORS = new Set([";", "&&", "||", "|", "&", "|&", "\n"]);
const SUDO_VALUE_FLAGS = new Set(["-u", "-g", "-C", "-h", "-p", "-c"]);
const SHELL_C_FLAG_RE = /^-[a-zA-Z]*c[a-zA-Z]*\n?$/;
const ASSIGNMENT_RE = /^[A-Za-z_][A-Za-z0-9_]*=/;
const GROUPING_RE = /^(?:[<>]?\(+|\)+)$/;
const TOKEN_FALLBACK_RE = new RegExp(`\\|\\||&&|[;|&]|[^${PY_SPACE};|&]+`, "gu");

/** Command words of a shell line. Unbalanced quotes fall back to a rough cut, better than none. */
export function tokenize(cmd: string): string[] {
	try {
		return shlexSplit(cmd.replaceAll("\n", " ; "), true);
	} catch (error) {
		if (error instanceof ShlexError) return cmd.match(TOKEN_FALLBACK_RE) ?? [];
		throw error;
	}
}

/** (argv, piped from the previous segment) pairs; `(`, `)` and, in command position, `{ } ! then do ...` separate. */
export function segments(tokens: string[]): [string[], boolean][] {
	const out: [string[], boolean][] = [];
	let cur: string[] = [];
	let piped = false;
	let nextPiped = false;
	for (const t of tokens) {
		const sep = SEPARATORS.has(t);
		if (sep || (cur.length === 0 && KEYWORDS.has(t)) || GROUPING_RE.test(t)) {
			if (cur.length > 0) out.push([cur, piped]);
			if (sep) nextPiped = t === "|" || t === "|&";
			else if (cur.length > 0) nextPiped = false; // grouping without a separator before keeps the pending pipe
			cur = [];
			piped = false;
			continue;
		}
		if (cur.length === 0) {
			piped = nextPiped;
			nextPiped = false;
		}
		cur.push(t);
	}
	if (cur.length > 0) out.push([cur, piped]);
	return out;
}

/** Removes VAR=x, wrappers and sudo; returns the real argv and whether a privilege prefix was used. */
export function stripPrefixes(argv: string[]): [string[], boolean] {
	let priv = false;
	let i = 0;
	while (i < argv.length) {
		const w = argv[i];
		const base = basename(w);
		if (ASSIGNMENT_RE.test(w)) {
			i++;
		} else if (PRIV.has(base)) {
			priv = true;
			i++;
			while (i < argv.length && argv[i].startsWith("-")) {
				const flag = argv[i];
				i++;
				if (SUDO_VALUE_FLAGS.has(flag) && base !== "su") {
					i++;
				} else if (base === "su" && flag === "-c") {
					const rest = argv.slice(i);
					return [rest.length > 0 ? tokenize(rest[0]) : [], true];
				}
			}
		} else if (WRAPPERS.has(base)) {
			i++;
			const values = WRAPPER_VALUE_OPTS.get(base);
			while (i < argv.length && argv[i].startsWith("-")) i += values?.has(argv[i]) ? 2 : 1;
			if (base === "timeout") i++; // the duration
		} else {
			break;
		}
	}
	return [argv.slice(i), priv];
}

/** Short flags split one by one (`-rf` -> `-r`, `-f`); long flags kept whole. */
export function shortFlags(args: string[]): Set<string> {
	const flags = new Set<string>();
	for (const a of args) {
		if (a.startsWith("--")) flags.add(a);
		else if (a.startsWith("-") && a.length > 1) for (const c of a.slice(1)) flags.add(`-${c}`);
	}
	return flags;
}

/** GNU long option, abbreviated by any unique prefix too (`--r` is `--recursive`). */
export function longMatch(flags: Set<string>, name: string): boolean {
	for (const f of flags) if (f.startsWith("--") && f.length > 2 && name.startsWith(f.split("=")[0])) return true;
	return false;
}

/** Normalizes an absolute path (`//dev/./sda` -> `/dev/sda`); others stay as they are. */
export function normPath(p: string): string {
	return p.startsWith("/") ? normpath(p).replace(/^\/+/, "/") : p;
}

/** Values of -t / --target-directory (cp, mv). */
export function targetDirs(args: string[]): string[] {
	const out: string[] = [];
	args.forEach((a, i) => {
		if (a.startsWith("--target-directory=")) out.push(a.slice(a.indexOf("=") + 1));
		else if ((a === "-t" || a === "--target-directory") && i + 1 < args.length) out.push(args[i + 1]);
	});
	return out;
}

/** Drops the leading options (and their values) of args; returns the command that remains. */
function skipOpts(args: string[], values: ReadonlySet<string>): string[] {
	let i = 0;
	while (i < args.length && args[i].startsWith("-") && args[i] !== "--") i += values.has(args[i]) ? 2 : 1;
	if (i < args.length && args[i] === "--") i++;
	return args.slice(i);
}

/** Commands inside a command: shell scripts to analyze again and argvs to analyze again. */
export function nestedCommands(name: string, args: string[]): [string[], string[][]] {
	const scripts: string[] = [];
	const argvs: string[][] = [];
	if (SHELLS.has(name)) {
		for (let i = 0; i < args.length - 1; i++) {
			if (SHELL_C_FLAG_RE.test(args[i])) {
				scripts.push(args[i + 1]);
				break;
			}
		}
	} else if (name === "eval" && args.length > 0) {
		scripts.push(args.join(" "));
	} else if (name === "xargs") {
		const rest = skipOpts(args, XARGS_VALUE_OPTS);
		if (rest.length > 0) argvs.push(rest);
	} else if (name === "find") {
		args.forEach((a, i) => {
			if (!FIND_EXEC.has(a)) return;
			let end = i + 1;
			while (end < args.length && args[end] !== ";" && args[end] !== "+") end++;
			if (end > i + 1) argvs.push(args.slice(i + 1, end));
		});
	}
	return [scripts, argvs];
}

// `^`/`$` of Python's MULTILINE are line starts and ends by "\n" only; JS's also split on \r and U+2028/9.
const HEREDOC_RE = new RegExp(
	`(?<!<)<<[-~]?[ \\t]*(['"]?)([${PY_WORD}]+)\\1[^\\n]*\\n(.*?)(?<![^\\n])[ \\t]*\\2[ \\t]*(?![^\\n])`,
	"gsud",
);
const SHELL_WORD_RE = new RegExp(`(?<![${PY_WORD}.-])(?:ba|z|da|k|fi)?sh(?![${PY_WORD}])(?!\\.)`, "u");

/** Same length, heredoc bodies blanked (newlines kept), except where the `<<` line runs a shell (`bash <<EOF`). */
export function maskHeredocs(cmd: string): string {
	const out = cmd.split("");
	for (const m of cmd.matchAll(HEREDOC_RE)) {
		const start = cmd.lastIndexOf("\n", m.index - 1) + 1;
		// Python's `find` gives -1 when there is no newline, which slices off the last character; `slice` does too.
		const end = cmd.indexOf("\n", m.index);
		if (SHELL_WORD_RE.test(cmd.slice(start, end))) continue;
		const [from, to] = (m.indices as RegExpIndicesArray)[3] as [number, number]; // group 3 always takes part
		for (let i = from; i < to; i++) if (out[i] !== "\n") out[i] = " ";
	}
	return out.join("");
}

/** Same length, heredoc bodies and quoted text replaced: quoted text is not a command. */
export function maskText(cmd: string): string {
	const out = maskHeredocs(cmd).split("");
	let quote: string | undefined;
	for (let i = 0; i < out.length; i++) {
		const c = out[i];
		if (quote !== undefined) {
			if (c === quote && (quote === "'" || out[i - 1] !== "\\")) quote = undefined;
			else out[i] = "x";
		} else if (c === "'" || c === '"') {
			quote = c;
		}
	}
	return out.join("");
}

/** Bodies of `$(...)` and backticks outside single quotes (inside double quotes they run too). */
export function substitutions(cmd: string): string[] {
	const out: string[] = [];
	const n = cmd.length;
	let quote = "";
	let i = 0;
	while (i < n) {
		const c = cmd[i];
		if (c === "\\") {
			i += 2;
			continue;
		}
		if (quote === "'") {
			if (c === "'") quote = "";
		} else if (c === "'" && quote === "") {
			quote = "'";
		} else if (c === '"') {
			quote = quote === "" ? '"' : "";
		} else if (c === "`") {
			const found = cmd.indexOf("`", i + 1);
			const j = found < 0 ? n : found;
			out.push(cmd.slice(i + 1, j));
			i = j;
		} else if (cmd.startsWith("$(", i)) {
			let depth = 1;
			let j = i + 2;
			while (j < n && depth > 0) {
				depth += (cmd[j] === "(" ? 1 : 0) - (cmd[j] === ")" ? 1 : 0);
				j++;
			}
			out.push(cmd.slice(i + 2, depth === 0 ? j - 1 : j));
			i = j - 1;
		}
		i++;
	}
	return out;
}

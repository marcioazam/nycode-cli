// Python path and string helpers the guard rules depend on, ported by behavior: the native engine must agree with
// resources/hooks/guard.py on every input, and Node's `path` and `String` differ from Python's at the edges.
import * as fs from "node:fs";
import * as os from "node:os";

/** The inside of a character class for Python's `\s` (`str.isspace`): JS `\s` differs at \x1c-\x1f, \x85 and \ufeff. */
export const PY_SPACE =
	"\\t\\n\\v\\f\\r \\x1c-\\x1f\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
/** Python's `\w` (Unicode letters, numbers and `_`), as the inside of a `u`-flag character class. */
export const PY_WORD = "\\p{L}\\p{N}_";

const STRIP_RE = new RegExp(`^[${PY_SPACE}]+|[${PY_SPACE}]+$`, "gu");
const SPLIT_RE = new RegExp(`[${PY_SPACE}]+`, "u");

/** Python `str.strip()`. */
export function pyStrip(text: string): string {
	return text.replace(STRIP_RE, "");
}

/** Python `str.split()` with no argument: runs of whitespace separate, empty pieces vanish. */
export function pySplit(text: string): string[] {
	return text.split(SPLIT_RE).filter((piece) => piece !== "");
}

/** Python `os.path.basename` on POSIX. */
export function basename(path: string): string {
	return path.slice(path.lastIndexOf("/") + 1);
}

/** Python `os.path.isabs` on POSIX. */
export function isabs(path: string): boolean {
	return path.startsWith("/");
}

/** Python `os.path.join` for two parts on POSIX. */
export function join(a: string, b: string): string {
	if (b.startsWith("/")) return b;
	if (a === "" || a.endsWith("/")) return a + b;
	return `${a}/${b}`;
}

/** Python `os.path.normpath` on POSIX: collapses separators and `.`/`..`, keeps a leading `//` (not `///`). */
export function normpath(path: string): string {
	if (path === "") return ".";
	const initial = path.startsWith("/") ? (path.startsWith("//") && !path.startsWith("///") ? 2 : 1) : 0;
	const comps: string[] = [];
	for (const comp of path.split("/")) {
		if (comp === "" || comp === ".") continue;
		if (comp !== ".." || (initial === 0 && comps.length === 0) || comps.at(-1) === "..") comps.push(comp);
		else if (comps.length > 0) comps.pop();
	}
	return "/".repeat(initial) + comps.join("/") || ".";
}

/** Python `os.path.dirname` on POSIX. */
export function dirname(path: string): string {
	return split(path)[0];
}

/** Python `os.path.abspath`. */
export function abspath(path: string): string {
	return normpath(isabs(path) ? path : join(process.cwd(), path));
}

/** Home directory of a user from /etc/passwd (Python asks `pwd`); undefined when the user is unknown. */
function passwdHome(name: string): string | undefined {
	let passwd: string;
	try {
		passwd = fs.readFileSync("/etc/passwd", "utf8");
	} catch {
		return undefined;
	}
	for (const line of passwd.split("\n")) {
		const fields = line.split(":");
		if (fields[0] === name && fields.length > 5) return fields[5];
	}
	return undefined;
}

/** Python `os.path.expanduser` on POSIX: `~` is $HOME (or the passwd entry), `~user` the user's home. */
export function expanduser(path: string): string {
	if (!path.startsWith("~")) return path;
	const slash = path.indexOf("/", 1);
	const end = slash < 0 ? path.length : slash;
	const home = end === 1 ? (process.env.HOME ?? os.userInfo().homedir) : passwdHome(path.slice(1, end));
	if (home === undefined) return path;
	return home.replace(/\/+$/, "") + path.slice(end) || "/";
}

/** Python `os.path.split` on POSIX. */
export function split(path: string): [string, string] {
	const cut = path.lastIndexOf("/") + 1;
	let head = path.slice(0, cut);
	if (head !== "" && head !== "/".repeat(head.length)) head = head.replace(/\/+$/, "");
	return [head, path.slice(cut)];
}

function isSymlink(path: string): boolean {
	// Python raises ValueError here (not OSError, so realpath does not swallow it) and the guard fails on it.
	if (path.includes("\0")) throw new Error("embedded null byte");
	try {
		return fs.lstatSync(path).isSymbolicLink();
	} catch {
		return false;
	}
}

/** Python 3.12 `posixpath._joinrealpath`: resolves symlinks as far as they exist; a missing part is kept as is. */
function joinrealpath(start: string, restPath: string, seen: Map<string, string | undefined>): [string, boolean] {
	let path = start;
	let rest = restPath;
	if (isabs(rest)) {
		rest = rest.slice(1);
		path = "/";
	}
	while (rest !== "") {
		const cut = rest.indexOf("/");
		const name = cut < 0 ? rest : rest.slice(0, cut);
		rest = cut < 0 ? "" : rest.slice(cut + 1);
		if (name === "" || name === ".") continue;
		if (name === "..") {
			if (path === "") {
				path = "..";
			} else {
				const [head, tail] = split(path);
				path = tail === ".." ? join(join(head, ".."), "..") : head;
			}
			continue;
		}
		const newpath = join(path, name);
		if (!isSymlink(newpath)) {
			path = newpath;
			continue;
		}
		if (seen.has(newpath)) {
			const known = seen.get(newpath);
			// Seen but unresolved: a symlink loop. The rest stays as written.
			if (known === undefined) return [join(newpath, rest), false];
			path = known;
			continue;
		}
		seen.set(newpath, undefined);
		const [resolved, ok] = joinrealpath(path, fs.readlinkSync(newpath), seen);
		path = resolved;
		if (!ok) return [join(path, rest), false];
		seen.set(newpath, path);
	}
	return [path, true];
}

/** Python `os.path.realpath` (non-strict): symlinks resolved, missing parts and loops left as written. */
export function realpath(path: string): string {
	return abspath(joinrealpath("", path, new Map())[0]);
}

/** Python `tempfile.gettempdir()`: the first usable of $TMPDIR, $TEMP, $TMP, /tmp, /var/tmp, /usr/tmp. */
export function tempDir(): string {
	const candidates = [process.env.TMPDIR, process.env.TEMP, process.env.TMP, "/tmp", "/var/tmp", "/usr/tmp"];
	for (const candidate of candidates) {
		if (!candidate) continue;
		const dir = abspath(candidate);
		try {
			if (fs.statSync(dir).isDirectory()) {
				fs.accessSync(dir, fs.constants.W_OK | fs.constants.X_OK);
				return dir;
			}
		} catch {
			// Not usable: Python moves on to the next candidate.
		}
	}
	return process.cwd();
}

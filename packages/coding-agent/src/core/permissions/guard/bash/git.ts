// Git rules of the guard: push (force and protected branches), reset --hard, clean -f, rebase, branch -D, checkout
// that discards changes. Port of `check_git` and the branch lookup of guard.py.
import * as fs from "node:fs";
import { abspath, dirname, join, pyStrip } from "../py-path.ts";
import { type Finding, shortFlags } from "./parse.ts";

const PROTECTED_BRANCHES = new Set(["main", "master"]);
const HEADS_PREFIX = "ref: refs/heads/";
const FIRST_CHUNK = 8192; // Python's text reader decodes this much before readline returns

const stripRef = (ref: string): string => (ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : ref);

function isFile(path: string): boolean {
	try {
		return fs.statSync(path).isFile();
	} catch {
		return false;
	}
}

function isDir(path: string): boolean {
	try {
		return fs.statSync(path).isDirectory();
	} catch {
		return false;
	}
}

/** First line of a text file, read like Python's `open().readline().strip()`; throws on bad UTF-8 or I/O errors. */
function firstLine(path: string): string {
	const fd = fs.openSync(path, "r");
	try {
		const buffer = Buffer.alloc(FIRST_CHUNK);
		const read = fs.readSync(fd, buffer, 0, FIRST_CHUNK, 0);
		const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(buffer.subarray(0, read), {
			stream: true,
		});
		return pyStrip(text.split(/\r\n|\r|\n/)[0]);
	} finally {
		fs.closeSync(fd);
	}
}

/** Current branch read from HEAD (`.git/HEAD` or a worktree's gitdir) upward from cwd, with no subprocess. */
export function currentBranch(cwd: string): string | undefined {
	let d = cwd ? abspath(cwd) : "";
	try {
		while (d) {
			let g = join(d, ".git");
			if (isFile(g)) {
				const first = firstLine(g);
				if (!first.startsWith("gitdir:")) return undefined;
				g = join(d, pyStrip(first.slice(7)));
			}
			if (isDir(g)) {
				const head = firstLine(join(g, "HEAD"));
				return head.startsWith(HEADS_PREFIX) ? head.slice(HEADS_PREFIX.length) : undefined;
			}
			const parent = dirname(d);
			if (parent === d) break;
			d = parent;
		}
	} catch {
		// Unreadable or not UTF-8: the branch is unknown, as in guard.py.
	}
	return undefined;
}

const lstripPlus = (text: string): string => text.replace(/^\++/, "");

function deletesProtected(rest: string[]): boolean {
	const pos = rest.filter((a) => !a.startsWith("-"));
	if (pos.some((a) => lstripPlus(a).startsWith(":") && PROTECTED_BRANCHES.has(stripRef(lstripPlus(a).slice(1))))) {
		return true;
	}
	const flags = shortFlags(rest);
	return (flags.has("--delete") || flags.has("-d")) && pos.some((a) => PROTECTED_BRANCHES.has(stripRef(a)));
}

/** Findings of a `git` invocation; `cwd` is where the branch of a refspec-less push is read. */
export function checkGit(args: string[], cwdInput: string): Finding[] {
	let cwd = cwdInput;
	let i = 0;
	while (i < args.length && args[i].startsWith("-")) {
		if (args[i] === "-C" || args[i] === "--git-dir" || args[i] === "--work-tree") cwd = ""; // another repository: branch unknown
		i += ["-C", "-c", "--git-dir", "--work-tree"].includes(args[i]) ? 2 : 1;
	}
	if (i >= args.length) return [];
	const sub = args[i];
	const rest = args.slice(i + 1);
	const flags = shortFlags(rest);
	if (sub === "push") {
		const pos = rest.filter((a) => !a.startsWith("-"));
		const force =
			flags.has("-f") ||
			flags.has("--force") ||
			flags.has("--mirror") ||
			[...flags].some((f) => f.startsWith("--force-with-lease")) ||
			rest.some((a) => a.startsWith("+"));
		const head = currentBranch(cwd) ?? "";
		const targets = new Set(pos.map((a) => stripRef(lstripPlus(a.split(":").at(-1) as string))));
		if (targets.has("HEAD") || targets.has("@")) targets.add(head);
		if (deletesProtected(rest)) return [["deny", "git push apagando main/master"]];
		if (force && (flags.has("--mirror") || [...targets].some((t) => PROTECTED_BRANCHES.has(t)))) {
			return [["deny", "git push forçado para main/master"]];
		}
		const branch = currentBranch(cwd);
		if (force && pos.length <= 1 && branch !== undefined && PROTECTED_BRANCHES.has(branch)) {
			return [["deny", "git push forçado da branch main/master"]];
		}
		return [["ask", `git push${force ? " --force" : ""}`]];
	}
	if (sub === "reset" && rest.includes("--hard")) return [["ask", "git reset --hard"]];
	if (sub === "clean" && (flags.has("-f") || flags.has("--force"))) return [["ask", "git clean -f"]];
	if (sub === "rebase") return [["ask", "git rebase"]];
	if (sub === "branch" && flags.has("-D")) return [["ask", "git branch -D"]];
	if (sub === "checkout" && (rest.includes("--") || rest.includes("."))) {
		return [["ask", "git checkout descartando mudanças"]];
	}
	return [];
}

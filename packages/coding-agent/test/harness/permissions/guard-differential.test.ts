// K11 (C-F8-10): the TypeScript port of guard.py gives the verdict guard.py gives, for every input. The oracle is
// guard.py itself (oracle.py imports it); the corpus is every string literal of its own tests plus seeded random
// commands, each judged as a Bash command, a Read, an Edit and a Write, with bypass off and on.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { decide, type GuardCall } from "../../../src/core/permissions/guard/decide.ts";
import { claudePreCall } from "../../../src/extensions/hooks/claude-tools.ts";

const ORACLE = join(import.meta.dirname, "oracle.py");
const PROJECT = "/tmp/guard-project";

interface Case {
	tool: string;
	input: Record<string, string>;
	cwd: string;
}

type OracleVerdict = null | [string, string];

function oracle(args: string[], input: unknown, bypass: boolean): unknown {
	const env = { ...process.env, CLAUDE_PROJECT_DIR: PROJECT, NYCODE_BYPASS_PERMISSIONS: bypass ? "1" : "0" };
	return JSON.parse(
		execFileSync("python3", [ORACLE, ...args], { input: JSON.stringify(input), env, maxBuffer: 1 << 28 }).toString(),
	);
}

const roots: string[] = [];
let judged = 0;
let diverged = 0;

afterAll(() => {
	console.log(`differential: ${judged - diverged}/${judged} identical`);
	for (const root of roots) rmSync(root, { recursive: true });
});

/** A repository on `branch`; `worktree` makes HEAD live in a gitdir that `.git` points to. */
function makeRepo(branch: string, worktree: boolean): string {
	const root = mkdtempSync(join(tmpdir(), "guard-diff-"));
	roots.push(root);
	if (worktree) {
		mkdirSync(join(root, "gd"));
		writeFileSync(join(root, "gd", "HEAD"), `ref: refs/heads/${branch}\n`);
		mkdirSync(join(root, "wt"));
		writeFileSync(join(root, "wt", ".git"), "gitdir: ../gd\n");
		return join(root, "wt");
	}
	mkdirSync(join(root, ".git"));
	writeFileSync(join(root, ".git", "HEAD"), `ref: refs/heads/${branch}\n`);
	return root;
}

/** mulberry32: a seeded PRNG, so the random part of the corpus is the same on every run. */
function prng(seed: number): () => number {
	let a = seed;
	return () => {
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const TOKENS = [
	...["rm", "-rf", "-r", "/", "~", "git", "push", "--force", "main", "reset", "--hard", "sudo", "kill", "pkill"],
	...["-f", "curl", "http://x", "|", "sh", "bash", "-c", "'", '"', "$(", ")", "`", ";", "&&", "||", "\\\n", "<<EOF"],
	...["EOF", "dd", "of=/dev/sda", "chmod", "-R", "777", "cat", ".env", ">", "&", "(", "{", ":", "\u0000", "é", "$"],
	...["env", "xargs", "find", "-exec", "{}", "+", "pgrep", "-9", "tee", "/dev/sda", "mkfs.ext4", "eval", "nohup"],
];

function randomCommands(count: number): string[] {
	const rand = prng(1234);
	const pick = <T>(items: readonly T[]): T => items[Math.floor(rand() * items.length)];
	const out: string[] = [];
	for (let n = 0; n < count; n++) {
		if (rand() < 0.2) {
			const chars = "ab '\"$()`;|&\\\n<>{}-/.=";
			out.push(
				Array.from({ length: Math.floor(rand() * 120) }, () => chars[Math.floor(rand() * chars.length)]).join(""),
			);
		} else {
			out.push(Array.from({ length: Math.floor(rand() * 14) }, () => pick(TOKENS)).join(" "));
		}
	}
	return out;
}

/** Each literal as a command, bare and inside the wrappers guard.py unwraps. */
function bashCases(literals: string[], cwd: string): Case[] {
	const out: Case[] = [];
	for (const text of literals) {
		out.push({ tool: "Bash", input: { command: text }, cwd });
		out.push({ tool: "Bash", input: { command: `bash -c '${text.replaceAll("'", "")}'` }, cwd });
		out.push({ tool: "Bash", input: { command: `echo $(${text}) | cat` }, cwd });
	}
	return out;
}

/** Each literal as a `run start` command: the gate judges it as the Bash call `claudePreCall` maps it to. */
function runCases(literals: string[], cwd: string): Case[] {
	return literals.map((text) => {
		const call = claudePreCall("run", { action: "start", command: text }, cwd);
		return { tool: call.name ?? "run", input: call.input as Record<string, string>, cwd };
	});
}

function fileCases(literals: string[], cwd: string): Case[] {
	return literals.flatMap((text) => [
		{ tool: "Read", input: { file_path: text }, cwd },
		{ tool: "Edit", input: { file_path: text }, cwd },
		{ tool: "Write", input: { file_path: text }, cwd },
	]);
}

function native(c: Case, bypass: boolean): OracleVerdict {
	const call: GuardCall = { tool: c.tool, input: c.input, cwd: c.cwd, project: PROJECT, bypass };
	const verdict = decide(call);
	if (verdict.kind === "allow") return null;
	return [verdict.kind, verdict.reason];
}

function nativeOrError(c: Case, bypass: boolean): OracleVerdict {
	try {
		return native(c, bypass);
	} catch (error) {
		return ["error", error instanceof Error ? error.constructor.name : "?"];
	}
}

function firstMismatch(cases: Case[], bypass: boolean): string | undefined {
	const expected = oracle(["decide"], cases, bypass) as OracleVerdict[];
	judged += cases.length;
	for (const [i, c] of cases.entries()) {
		const got = nativeOrError(c, bypass);
		// A guard.py exception is the guard's internal error, which the gate maps; here only that both fail matters.
		const want = expected[i];
		const bothFail = want?.[0] === "error" && got?.[0] === "error";
		if (!bothFail && JSON.stringify(got) !== JSON.stringify(want)) {
			diverged++;
			return `${JSON.stringify(c)}\n  guard.py: ${JSON.stringify(want)}\n  native:   ${JSON.stringify(got)}`;
		}
	}
	return undefined;
}

describe("native permission engine against guard.py", () => {
	const literals = oracle(["corpus"], null, false) as string[];
	const random = randomCommands(1500);
	const repoMain = makeRepo("main", false);
	const repoFeature = makeRepo("feature/x", false);
	const repoWorktree = makeRepo("master", true);
	const pushes = literals.filter((l) => l.includes("git"));

	it("has a corpus worth judging", () => {
		expect(literals.length).toBeGreaterThan(300);
	});

	it("agrees on Bash commands (bypass off)", () => {
		expect(firstMismatch(bashCases([...literals, ...random], PROJECT), false)).toBeUndefined();
	});

	it("agrees on Bash commands (bypass on: asks become allow, denies stay)", () => {
		expect(firstMismatch(bashCases([...literals, ...random.slice(0, 300)], PROJECT), true)).toBeUndefined();
	});

	it("agrees on run start commands, which are judged as Bash (F1)", () => {
		expect(firstMismatch(runCases([...literals, ...random.slice(0, 300)], PROJECT), false)).toBeUndefined();
		expect(firstMismatch(runCases(literals.slice(0, 100), PROJECT), true)).toBeUndefined();
	});

	it.each([
		["main", () => repoMain],
		["feature", () => repoFeature],
		["worktree on master", () => repoWorktree],
	])("agrees on git commands run from a repository on %s", (_name, repo) => {
		expect(firstMismatch(bashCases(pushes, repo()), false)).toBeUndefined();
	});

	it("agrees on Read, Edit and Write paths", () => {
		expect(firstMismatch(fileCases(literals, PROJECT), false)).toBeUndefined();
		expect(firstMismatch(fileCases(literals, "/"), false)).toBeUndefined();
	});

	it("agrees on relative paths inside and outside the project", () => {
		const paths = [
			"a.txt",
			"../outside.txt",
			".env",
			"sub/.env.local",
			"~/.ssh/id_rsa",
			"~/.nycode/agent/auth.json",
			"",
		];
		expect(firstMismatch(fileCases(paths, PROJECT), false)).toBeUndefined();
		expect(firstMismatch(fileCases(paths, "/tmp"), false)).toBeUndefined();
	});

	it("allows tools the guard does not judge", () => {
		expect(decide({ tool: "Grep", input: {}, cwd: PROJECT, project: PROJECT, bypass: false })).toEqual({
			kind: "allow",
		});
	});
});

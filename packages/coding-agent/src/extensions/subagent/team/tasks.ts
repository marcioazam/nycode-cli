/** Board, task queue (exclusive claims) and roster. Contract: types.ts. */
import * as fs from "node:fs";
import * as path from "node:path";
import { appendJsonl, readJsonl, readRecords } from "../fleet/store.ts";
import { teamDir } from "./store.ts";
import {
	BOARD_KINDS,
	type BoardEntry,
	type BoardKind,
	LIMITS,
	type Result,
	type RosterEntry,
	type Self,
	type TeamTask,
} from "./types.ts";

const NO_DIR = { ok: false, error: "team: no fleet directory" } as const;

// ---- board -------------------------------------------------------------------------

export function appendBoard(dir: string, self: Self, kind: BoardKind, text: string): Result<{ index: number }> {
	const td = teamDir(dir);
	if (!td) return NO_DIR;
	if (!BOARD_KINDS.includes(kind))
		return { ok: false, error: `team: board kind must be one of ${BOARD_KINDS.join(", ")}` };
	if (typeof text !== "string" || text.trim() === "") return { ok: false, error: "team: text is empty" };
	if (text.length > LIMITS.board)
		return { ok: false, error: `team: board text is ${text.length} chars, the limit is ${LIMITS.board}` };
	const file = path.join(td, "board.jsonl");
	appendJsonl(file, { t: Date.now(), by: self.id, agent: self.agent, kind, text } satisfies BoardEntry);
	return { ok: true, index: readJsonl<BoardEntry>(file, 0).items.length };
}

/** Entries after the first `since` ones; `next` is the cursor to pass back. */
export function readBoard(dir: string, since = 0): { entries: BoardEntry[]; next: number } {
	const td = teamDir(dir);
	const all = td ? readJsonl<BoardEntry>(path.join(td, "board.jsonl"), 0, 8 * 1024 * 1024).items : [];
	const from = Math.max(0, Math.floor(Number.isFinite(since) ? since : 0));
	return { entries: all.slice(from), next: all.length };
}

// ---- tasks -------------------------------------------------------------------------

const TASK_FILE = /^task-(\d+)\.json$/;
const readJson = <T>(file: string): T | undefined => {
	try {
		return JSON.parse(fs.readFileSync(file, "utf8")) as T;
	} catch {
		return undefined; // missing, or half-written: the next read sees it whole
	}
};

export function listTasks(dir: string): TeamTask[] {
	const td = teamDir(dir);
	if (!td) return [];
	const out: TeamTask[] = [];
	for (const name of fs.readdirSync(td)) {
		const m = TASK_FILE.exec(name);
		if (!m) continue;
		const task = readJson<TeamTask>(path.join(td, name));
		if (!task) continue;
		const claim = readJson<{ by: string; agent: string }>(path.join(td, `claim-${m[1]}.json`));
		const done = readJson<{ by: string; note: string }>(path.join(td, `done-${m[1]}.json`));
		out.push({ ...task, claimedBy: claim?.by, claimedAgent: claim?.agent, done });
	}
	return out.sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));
}

const exclusive = (file: string, data: unknown): boolean => {
	try {
		fs.writeFileSync(file, JSON.stringify(data), { flag: "wx", mode: 0o600 });
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
		throw error;
	}
};

/** The id is the first free task-N.json, taken with O_EXCL, so concurrent adders never share one. */
export function addTask(dir: string, self: Self, title: string, files: string[] = []): Result<{ id: string }> {
	const td = teamDir(dir);
	if (!td) return NO_DIR;
	if (typeof title !== "string" || title.trim() === "") return { ok: false, error: "team: title is empty" };
	const clean = (Array.isArray(files) ? files : []).filter((f) => typeof f === "string" && f !== "").slice(0, 50);
	for (let n = listTasks(dir).length + 1; n < 10_000; n++) {
		if (
			exclusive(path.join(td, `task-${n}.json`), {
				id: `t${n}`,
				title: title.slice(0, 200),
				files: clean,
				by: self.id,
				t: Date.now(),
			})
		)
			return { ok: true, id: `t${n}` };
	}
	return { ok: false, error: "team: too many tasks" };
}

const overlaps = (a: string, b: string): boolean => a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
const open = (t: TeamTask): boolean => t.claimedBy !== undefined && !t.done;
const numberOf = (id: unknown): string | undefined =>
	typeof id === "string" && /^t[1-9]\d*$/.test(id) ? id.slice(1) : undefined;

/** One winner per task (O_EXCL), one open claim per agent, and a claim is refused while another open claim reserves the same files. */
export function claimTask(dir: string, self: Self, id: string): Result<{ task: TeamTask }> {
	const td = teamDir(dir);
	const n = numberOf(id);
	if (!td || !n) return { ok: false, error: `team: bad task id ${String(id)}` };
	const tasks = listTasks(dir);
	const task = tasks.find((t) => t.id === id);
	if (!task) return { ok: false, error: `team: no task ${id}` };
	const mine = tasks.find((t) => open(t) && t.claimedBy === self.id);
	if (mine) return { ok: false, error: `team: you already hold ${mine.id}; finish it with tasks done first` };
	if (task.claimedBy)
		return { ok: false, error: `team: ${id} is already claimed by ${task.claimedAgent} (${task.claimedBy})` };
	const pre = fileConflict(tasks, task, () => true);
	if (pre) return pre;
	const claim = path.join(td, `claim-${n}.json`);
	if (!exclusive(claim, { by: self.id, agent: self.agent, t: Date.now() }))
		return { ok: false, error: `team: ${id} was just claimed by another agent` };
	// Check-then-write race: a concurrent claim on overlapping files may have landed meanwhile. The lower task number
	// keeps its claim and the other rolls back, so exactly one survives and nobody livelocks.
	const post = fileConflict(listTasks(dir), task, (other) => Number(numberOf(other.id)) < Number(n));
	if (post) {
		fs.rmSync(claim, { force: true });
		return post;
	}
	return { ok: true, task: { ...task, claimedBy: self.id, claimedAgent: self.agent } };
}

function fileConflict(
	tasks: TeamTask[],
	task: TeamTask,
	wins: (other: TeamTask) => boolean,
): { ok: false; error: string } | undefined {
	for (const other of tasks) {
		if (!open(other) || other.id === task.id || !wins(other)) continue;
		const hit = task.files.find((f) => other.files.some((g) => overlaps(f, g)));
		if (hit)
			return {
				ok: false,
				error: `team: file conflict on ${hit}: reserved by ${other.id} (${other.claimedAgent}, ${other.claimedBy})`,
			};
	}
	return undefined;
}

export function doneTask(dir: string, self: Self, id: string, note: string): Result<{ id: string }> {
	const td = teamDir(dir);
	const n = numberOf(id);
	if (!td || !n) return { ok: false, error: `team: bad task id ${String(id)}` };
	const task = listTasks(dir).find((t) => t.id === id);
	if (!task) return { ok: false, error: `team: no task ${id}` };
	if (task.claimedBy !== self.id)
		return {
			ok: false,
			error: `team: only the claimer can finish ${id}${task.claimedBy ? ` (held by ${task.claimedBy})` : " (not claimed)"}`,
		};
	if (!exclusive(path.join(td, `done-${n}.json`), { by: self.id, note: String(note ?? "").slice(0, LIMITS.board) }))
		return { ok: false, error: `team: ${id} is already done` };
	return { ok: true, id };
}

// ---- roster ------------------------------------------------------------------------

export function roster(dir: string): RosterEntry[] {
	const tasks = listTasks(dir);
	return readRecords(dir)
		.sort((a, b) => a.startedAt - b.startedAt)
		.map((r) => ({
			id: r.id,
			agent: r.agent,
			depth: r.depth,
			parent: r.parentId ?? "main",
			state: r.state,
			task: r.task.slice(0, 120),
			claimed: tasks.find((t) => open(t) && t.claimedBy === r.id)?.id,
		}));
}

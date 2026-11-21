/**
 * The FleetSource the panel and viewer read (contract: types.ts): runs from disk,
 * stop and send for any depth, Ctrl+B detach, and a debounced change feed.
 */
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import { subagentDepth } from "../nesting/index.ts";
import { backgroundRun, cancelBackgroundRun } from "./background.ts";
import { detachAll, hasForeground } from "./detach.ts";
import {
	appendInbox,
	currentFleetDir,
	readAcks,
	readInbox,
	readRecord,
	readRecords,
	readTranscript,
	requestStop,
} from "./store.ts";
import {
	FLEET_ENV,
	type FleetSource,
	type LeadSendOutcome,
	type RunRecord,
	type SendOutcome,
	type StopOrigin,
	type StopOutcome,
} from "./types.ts";

const SOURCE_SLOT = Symbol.for("pi-code.fleet.source");
const KILL_GRACE_MS = 5000;
const POLL_MS = 1000;
const DEBOUNCE_MS = 100;

export interface FleetSourceDeps {
	/** `fromUser` (default) words the completion as a report of the user's panel message; the model's send passes false. */
	resume(id: string, text: string, fromUser?: boolean): boolean;
}

/** The pid must still belong to this run: pids are reused, and the child env carries the id. */
function pidOwnsRun(pid: number, id: string): boolean {
	if (process.platform !== "linux") return true;
	try {
		return fs.readFileSync(`/proc/${pid}/environ`, "utf8").split("\0").includes(`${FLEET_ENV.runId}=${id}`);
	} catch {
		return false;
	}
}

function killGroup(pid: number, signal: NodeJS.Signals): "ok" | "gone" {
	try {
		process.kill(-pid, signal);
		return "ok";
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "ESRCH" ? "gone" : "ok";
	}
}

export function stopRun(id: string, by: StopOrigin = "user"): StopOutcome {
	const dir = currentFleetDir();
	const rec = dir ? readRecord(dir, id) : undefined;
	if (!dir || !rec) return "unknown";
	if (rec.state !== "running") return "not-running";
	if (backgroundRun(id)?.state === "running") {
		requestStop(dir, id, by);
		cancelBackgroundRun(id);
		return "stopping";
	}
	if (!rec.pid || !pidOwnsRun(rec.pid, id)) return "refused";
	requestStop(dir, id, by);
	const pid = rec.pid;
	if (killGroup(pid, "SIGTERM") === "gone") return "not-running";
	setTimeout(() => sigkillIfStillOwned(dir, id, pid), KILL_GRACE_MS).unref();
	return "stopping";
}

/** The delayed SIGKILL re-checks: the run may have ended and its pid been reused during the grace. */
export function sigkillIfStillOwned(dir: string, id: string, pid: number): boolean {
	if (readRecord(dir, id)?.state !== "running" || !pidOwnsRun(pid, id)) return false;
	killGroup(pid, "SIGKILL");
	return true;
}

/** The model-facing stop: only runs this process started; the panel keeps the unrestricted stopRun. */
export function stopOwnRun(id: string): StopOutcome | "not-owned" {
	const dir = currentFleetDir();
	const rec = dir ? readRecord(dir, id) : undefined;
	if (!rec || rec.ownerPid !== process.pid) return rec ? "not-owned" : "unknown";
	return stopRun(id, "agent");
}

function sendToRun(id: string, text: string, deps: FleetSourceDeps): SendOutcome {
	const dir = currentFleetDir();
	const rec = dir ? readRecord(dir, id) : undefined;
	if (!dir || !rec) return "unknown";
	const body = text.trim();
	if (!body) return "not-running";
	if (rec.state === "running") {
		appendInbox(dir, id, { id: randomUUID().slice(0, 8), t: Date.now(), text });
		return "queued";
	}
	return rec.depth === 1 && rec.background && deps.resume(id, text) ? "resumed" : "not-running";
}

/** The model's `send` key (NYCODE_SUBAGENT_SEND); the one place that defines its default: on unless '0' (paired
 * eval and STEER/RESTART bench, docs/pi-subagent-send-2026-11-13.md). */
export function sendEnabled(): boolean {
	return process.env.NYCODE_SUBAGENT_SEND !== "0";
}

const SEND_MAX_CHARS = 4000;
const SEND_PER_RUN = 20;
const SEND_PER_PROCESS = 60;
const SENT_SLOT = Symbol.for("pi-code.fleet.send-count");

/** Who the child is told the text comes from: never the user. */
function senderLabel(dir: string): string {
	if (subagentDepth() === 0) return "[message from lead (main session), not the user]: ";
	const own = process.env[FLEET_ENV.runId] ?? "";
	return `[message from parent ${readRecord(dir, own)?.agent ?? "agent"} (${own}), not the user]: `;
}

function resumeWithLabel(rec: RunRecord, text: string): boolean {
	const box = (globalThis as Record<symbol, { deps: FleetSourceDeps } | undefined>)[SOURCE_SLOT];
	return rec.depth === 1 && rec.background && box !== undefined && box.deps.resume(rec.id, text, false);
}

/** The model's send: a labelled message to a run this process started. Running runs get it in their inbox (delivered
 * at the next turn boundary); a finished depth-1 background run is resumed with it. After the append the record is read
 * again: a run that ended without consuming the message is resumed, or reported not-delivered, never a false queued.
 * `afterAppend` is the seam the race test uses to end the run in that window. */
export function sendFromLead(id: string, text: string, afterAppend?: () => void): LeadSendOutcome {
	if (!sendEnabled()) return "disabled";
	const body = text.trim();
	if (!body) return "empty";
	if (body.length > SEND_MAX_CHARS) return "too-long";
	const dir = currentFleetDir();
	const rec = dir ? readRecord(dir, id) : undefined;
	if (!dir || !rec) return "unknown";
	if (rec.ownerPid !== process.pid) return "not-owned";
	const holder = globalThis as Record<symbol, { n: number } | undefined>;
	const sent = holder[SENT_SLOT] ?? { n: 0 };
	holder[SENT_SLOT] = sent;
	if (sent.n >= SEND_PER_PROCESS) return "process-limit";
	if (readInbox(dir, id, 0).items.length >= SEND_PER_RUN) return "run-limit";
	const labelled = `${senderLabel(dir)}${body}`;
	let outcome: LeadSendOutcome = "not-running";
	if (rec.state !== "running") {
		if (resumeWithLabel(rec, labelled)) outcome = "resumed";
	} else {
		const msgId = randomUUID().slice(0, 8);
		appendInbox(dir, id, { id: msgId, t: Date.now(), text: labelled });
		afterAppend?.();
		const consumed = readAcks(dir, id, 0).items.some((ack) => ack.id === msgId && ack.outcome === "consumed");
		if (readRecord(dir, id)?.state === "running" || consumed) outcome = "queued";
		else outcome = resumeWithLabel(rec, labelled) ? "resumed" : "not-delivered";
	}
	if (outcome !== "not-running") sent.n++;
	return outcome;
}

const listeners = new Set<() => void>();
let watcher: fs.FSWatcher | undefined;
let ticker: ReturnType<typeof setInterval> | undefined;
let debounce: ReturnType<typeof setTimeout> | undefined;

function fire(): void {
	if (debounce) return;
	debounce = setTimeout(() => {
		debounce = undefined;
		for (const listener of [...listeners]) {
			try {
				listener();
			} catch {
				/* a listener must not break the feed */
			}
		}
	}, DEBOUNCE_MS);
	debounce.unref();
}

function tryWatch(): void {
	const dir = currentFleetDir();
	if (watcher || !dir) return;
	try {
		const w = fs.watch(dir, fire);
		w.on("error", () => {
			w.close();
			if (watcher === w) watcher = undefined;
		});
		watcher = w;
	} catch {
		/* the poll still runs */
	}
}

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	if (listeners.size === 1) {
		tryWatch();
		ticker = setInterval(() => {
			tryWatch();
			fire();
		}, POLL_MS);
		ticker.unref();
	}
	return () => {
		if (!listeners.delete(listener) || listeners.size > 0) return;
		watcher?.close();
		watcher = undefined;
		if (ticker) clearInterval(ticker);
		ticker = undefined;
		if (debounce) clearTimeout(debounce);
		debounce = undefined;
	};
}

export function createFleetSource(deps: FleetSourceDeps): FleetSource {
	return {
		list: () => {
			const dir = currentFleetDir();
			return dir ? readRecords(dir) : [];
		},
		readTranscript: (id, from) => {
			const dir = currentFleetDir();
			return dir ? readTranscript(dir, id, from) : { items: [], next: from };
		},
		stop: stopRun,
		send: (id, text) => sendToRun(id, text, deps),
		hasForeground,
		detachForeground: detachAll,
		onChange: subscribe,
	};
}

/** Memoised on globalThis so /reload keeps one source; the newest deps win. */
export function getFleetSource(deps: FleetSourceDeps): FleetSource {
	const holder = globalThis as Record<symbol, { deps: FleetSourceDeps; source: FleetSource } | undefined>;
	const existing = holder[SOURCE_SLOT];
	if (existing) {
		existing.deps = deps;
		return existing.source;
	}
	const box = { deps, source: undefined as unknown as FleetSource };
	box.source = createFleetSource({ resume: (id, text) => box.deps.resume(id, text) });
	holder[SOURCE_SLOT] = box;
	return box.source;
}

export function fleetSourceForUi(): FleetSource {
	const box = (globalThis as Record<symbol, { source: FleetSource } | undefined>)[SOURCE_SLOT];
	if (!box) throw new Error("fleet source not created yet (session_start at depth 0 creates it)");
	return box.source;
}

const FINISHED_KEEP_MS = 30 * 60_000;

/** mm:ss (h:mm:ss from an hour). */
function clock(ms: number): string {
	const total = Math.max(0, Math.floor(ms / 1000));
	const mm = String(Math.floor(total / 60) % 60).padStart(2, "0");
	const ss = String(total % 60).padStart(2, "0");
	return total >= 3600 ? `${Math.floor(total / 3600)}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Lanes of this session's tree (any depth) that the registry does not list: running ones and those finished less than 30 min ago.
 * Nested lanes belong to the child that spawned them, not to this process, but share the fleet dir: the root lists them too. */
function listedLane(rec: RunRecord, now: number): boolean {
	if (backgroundRun(rec.id)) return false;
	if (rec.ownerPid !== process.pid && !(subagentDepth() === 0 && rec.depth >= 2)) return false;
	return rec.state === "running" || now - (rec.endedAt ?? rec.updatedAt) < FINISHED_KEEP_MS;
}

/** One line per lane: `id agent state [depth N] · Nt · $x · mm:ss · activity`, nested lanes indented. */
export function fleetStatusLines(): string[] {
	const dir = currentFleetDir();
	if (!dir) return [];
	const now = Date.now();
	return readRecords(dir)
		.filter((rec) => listedLane(rec, now))
		.sort((a, b) => a.startedAt - b.startedAt)
		.map((rec) => {
			const state = rec.partial ? `${rec.state} (partial)` : rec.state;
			const parts = [
				`${rec.id} ${rec.agent} ${state}${rec.depth > 1 ? ` depth ${rec.depth}` : ""}`,
				`${rec.turns}t`,
				`$${rec.cost.toFixed(2)}`,
				clock((rec.endedAt ?? now) - rec.startedAt),
			];
			if (rec.activity) parts.push(rec.activity);
			return `${"  ".repeat(Math.max(0, rec.depth - 1))}${parts.join(" · ")}`;
		});
}

/** Depth-1 lanes of this process still running outside the registry (auto-detached or Ctrl+B calls): the /new and resume warning counts them. */
export function runningLaneCount(): number {
	const dir = currentFleetDir();
	if (!dir) return 0;
	return readRecords(dir).filter(
		(rec) => rec.depth === 1 && rec.state === "running" && rec.ownerPid === process.pid && !backgroundRun(rec.id),
	).length;
}

/** Quit at depth 0: stop this process's foreground and detached children (background runs are the registry's job). */
export function stopOwnForegroundRuns(): void {
	const dir = currentFleetDir();
	if (!dir) return;
	for (const rec of readRecords(dir)) {
		if (rec.depth === 1 && rec.state === "running" && rec.ownerPid === process.pid && !backgroundRun(rec.id))
			stopRun(rec.id);
	}
}

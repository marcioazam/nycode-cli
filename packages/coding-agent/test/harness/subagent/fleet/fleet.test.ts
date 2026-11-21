// Ported from subagent-panel/fleet.test.ts (pi-code patch tests); same cases and expectations.
// Testes do plano de dados da frota (subagent/fleet/*)
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, test, vi } from "vitest";
import * as sourceMod from "../../../../src/extensions/subagent/fleet/source.ts";
import * as store from "../../../../src/extensions/subagent/fleet/store.ts";
import * as trackerMod from "../../../../src/extensions/subagent/fleet/tracker.ts";
import * as registryText from "../../../../src/extensions/subagent/registry/registry-text.ts";
import { fleetTestEnv } from "../support/fleet-env.ts";
import { baseRecord, deadPid, fleetRecordHelpers, id, must, sleeper, withEnv } from "../support/fleet-records.ts";

const { tmp } = fleetTestEnv("fleet-test-");
const { tempDir, mainFleet } = fleetRecordHelpers(store, tmp);

afterEach(() => vi.useRealTimers());

test("id guard: nothing is written or built for an invalid id", () => {
	const dir = tempDir();
	store.writeRecord(dir, baseRecord("../evil"));
	store.appendInbox(dir, "../x", { id: "a", t: 1, text: "x" });
	store.appendAck(dir, "bad", { id: "a", t: 1, outcome: "steered" });
	store.appendTranscript(dir, "nope", { t: 1, kind: "note", text: "x" });
	store.requestStop(dir, "../x");
	store.clearStop(dir, "../x");
	assert.deepEqual(readdirSync(dir), []);
	assert.equal(store.stopOrigin(dir, "../x"), undefined);
	assert.equal(store.stopOrigin(undefined, id()), undefined);
	assert.deepEqual(store.readInbox(dir, "bad", 7), { items: [], next: 7 });
	assert.deepEqual(store.readAcks(dir, "bad", 7), { items: [], next: 7 });
	assert.deepEqual(store.readTranscript(dir, "bad", 7), { items: [], next: 7 });
	assert.equal(store.readRecord(dir, "bad"), undefined);
	assert.equal(store.RUN_ID_RE.test("fg-0123abcd"), true);
	assert.equal(store.RUN_ID_RE.test("fg-0123ABCD"), false);
	rmSync(dir, { recursive: true });
});

test("readJsonl: partial line waits, offsets advance, bad lines skipped, missing file is empty", () => {
	const dir = tempDir();
	const file = join(dir, "x.jsonl");
	assert.deepEqual(store.readJsonl(file, 0), { items: [], next: 0 });
	writeFileSync(file, '{"a":1}\n{"a":2');
	let r = store.readJsonl(file, 0);
	assert.deepEqual(r.items, [{ a: 1 }]);
	assert.equal(r.next, 8);
	assert.deepEqual(store.readJsonl(file, r.next), { items: [], next: 8 });
	writeFileSync(file, '{"a":1}\n{"a":2}\nnot json\n{"a":3}\n');
	r = store.readJsonl(file, 8);
	assert.deepEqual(r.items, [{ a: 2 }, { a: 3 }]);
	assert.equal(r.next, readFileSync(file).length);
	assert.deepEqual(store.readJsonl(file, r.next), { items: [], next: r.next });
	// maxBytes caps one read; no newline inside the window consumes nothing
	assert.deepEqual(store.readJsonl(file, 0, 3), { items: [], next: 0 });
	assert.equal(store.readJsonl(file, 0, 8).next, 8);
	rmSync(dir, { recursive: true });
});

test("transcript: capped at 4 MiB with one truncation note, later appends dropped", () => {
	const dir = tempDir();
	const rid = id(2);
	const text = "x".repeat(1_000_000);
	for (let i = 0; i < 7; i++) store.appendTranscript(dir, rid, { t: i, kind: "assistant", text });
	const lines = readFileSync(join(dir, `${rid}.transcript.jsonl`), "utf8")
		.trim()
		.split("\n");
	assert.equal(lines.length, 5);
	assert.deepEqual(JSON.parse(lines[4]).text, "[transcript truncated at 4 MB]");
	assert.equal(JSON.parse(lines[4]).kind, "note");
	rmSync(dir, { recursive: true });
});

test("records: orphaned running run maps to failed, bad JSON and foreign files skipped, file untouched", () => {
	const dir = tempDir();
	const dead = deadPid();
	store.writeRecord(dir, baseRecord(id(3), { ownerPid: dead }));
	store.writeRecord(dir, baseRecord(id(4)));
	store.writeRecord(dir, baseRecord(id(5), { state: "done", ownerPid: dead }));
	writeFileSync(join(dir, "fg-00000006.json"), "{oops");
	writeFileSync(join(dir, "fg-00000007.json"), JSON.stringify({ ...baseRecord(id(7)), v: 2 }));
	writeFileSync(join(dir, "bad.json"), JSON.stringify(baseRecord("bad")));
	writeFileSync(join(dir, "note.txt"), "x");
	const byId = Object.fromEntries(store.readRecords(dir).map((r) => [r.id, r]));
	assert.deepEqual(Object.keys(byId).sort(), [id(3), id(4), id(5)]);
	assert.equal(byId[id(3)].state, "failed");
	assert.equal(byId[id(3)].error, "orphaned");
	assert.equal(byId[id(4)].state, "running");
	assert.equal(byId[id(5)].state, "done");
	assert.equal(JSON.parse(readFileSync(join(dir, `${id(3)}.json`), "utf8")).state, "running");
	assert.deepEqual(store.readRecords(join(dir, "missing")), []);
	assert.equal(store.pidAlive(process.pid), true);
	assert.equal(store.pidAlive(dead), false);
	rmSync(dir, { recursive: true });
});

test("currentFleetDir: depth 0 ignores the inherited env; depth >= 1 accepts only dirs directly under the root", () => {
	const inside = join(store.fleetRoot(), "123-abcdef12");
	withEnv({ NYCODE_SUBAGENT_DEPTH: "1", NYCODE_FLEET_DIR: inside, NYCODE_FLEET_RUN_ID: id() }, () => {
		assert.equal(store.currentFleetDir(), inside);
		assert.deepEqual(store.fleetChildEnv(id(9)), { NYCODE_FLEET_DIR: inside, NYCODE_FLEET_RUN_ID: id(9) });
		assert.deepEqual(store.fleetChildEnv("bad"), {});
	});
	for (const bad of ["/tmp/elsewhere", "relative/dir", join(inside, "nested"), join(store.fleetRoot(), "..", "x")]) {
		withEnv({ NYCODE_SUBAGENT_DEPTH: "2", NYCODE_FLEET_DIR: bad }, () => {
			assert.equal(store.currentFleetDir(), undefined);
			assert.deepEqual(store.fleetChildEnv(id()), {});
		});
	}
	withEnv({ NYCODE_SUBAGENT_DEPTH: "1", NYCODE_FLEET_DIR: undefined }, () =>
		assert.equal(store.currentFleetDir(), undefined),
	);
	withEnv({ NYCODE_SUBAGENT_DEPTH: "0", NYCODE_FLEET_DIR: inside }, () =>
		assert.notEqual(store.currentFleetDir(), inside),
	);
});

test("ensureFleetDir / sweep / removeFleetDir: one dir per process, orphans swept, own dir kept", () => {
	const dir = mainFleet();
	assert.equal(store.ensureFleetDir(), dir);
	assert.equal(store.currentFleetDir(), dir);
	assert.equal(dir.startsWith(store.fleetRoot()), true);
	const orphan = join(store.fleetRoot(), `${deadPid()}-deadbeef`);
	mkdirSync(orphan);
	writeFileSync(join(orphan, "f"), "x");
	const alive = join(store.fleetRoot(), `${process.pid}-cafebabe`);
	mkdirSync(alive);
	store.sweepOrphanFleetDirs();
	assert.equal(existsSync(orphan), false);
	assert.equal(existsSync(alive), true);
	assert.equal(existsSync(dir), true);
	rmSync(alive, { recursive: true });
	store.removeFleetDir();
	assert.equal(existsSync(dir), false);
	assert.equal(store.currentFleetDir(), undefined);
	store.removeFleetDir();
});

const readRec = (dir: string, rid: string) => JSON.parse(readFileSync(join(dir, `${rid}.json`), "utf8"));
const lineOf = (event: unknown): string => JSON.stringify(event);

test("tracker: scripted event stream fills record and transcript; writes are throttled", () => {
	vi.useFakeTimers({ toFake: ["Date", "setTimeout"] });
	const dir = mainFleet();
	const rid = id(10);
	const tr = must(
		trackerMod.startTracking({
			id: rid,
			agent: "worker",
			task: "  do\n  the   thing ",
			model: "m",
			background: false,
		}),
	);
	assert.ok(tr);
	let rec = readRec(dir, rid);
	assert.equal(rec.task, "do the thing");
	assert.equal(rec.depth, 1);
	assert.equal(rec.parentId, null);
	assert.equal(rec.state, "running");
	assert.equal(rec.ownerPid, process.pid);
	tr.setPid(4242);
	tr.onLine(lineOf({ type: "message_start", message: { role: "assistant" } }));
	tr.onLine(lineOf({ type: "message_update", message: { role: "assistant" } }));
	tr.onLine("not json");
	tr.onLine(
		lineOf({
			type: "message_end",
			message: {
				role: "user",
				content: [
					{ type: "text", text: "hello" },
					{ type: "text", text: "world" },
				],
			},
		}),
	);
	tr.onLine(lineOf({ type: "tool_execution_start", toolName: "bash", args: { command: "ls   -la\u001b[31m" } }));
	tr.onLine(lineOf({ type: "message_start", message: { role: "assistant" } }));
	assert.equal(readRec(dir, rid).activity, undefined, "throttled: no write inside 250 ms");
	vi.advanceTimersByTime(250);
	assert.equal(readRec(dir, rid).activity, "bash ls -la", "one trailing write");
	tr.flush();
	rec = readRec(dir, rid);
	assert.equal(rec.activity, "bash ls -la");
	assert.equal(rec.toolCalls, 1);
	assert.equal(rec.pid, 4242);
	tr.onLine(
		lineOf({
			type: "tool_execution_end",
			toolName: "bash",
			isError: true,
			result: { content: [{ type: "text", text: "out" }] },
		}),
	);
	tr.onLine(
		lineOf({
			type: "message_end",
			message: {
				role: "assistant",
				content: [{ type: "text", text: "line1\nfinal   \u0007line  \n\n" }],
				usage: { input: 10, output: 5, cacheRead: 1, cacheWrite: 2, totalTokens: 18, cost: { total: 0.5 } },
			},
		}),
	);
	tr.onLine(
		lineOf({
			type: "message_end",
			message: { role: "assistant", content: [], stopReason: "error", errorMessage: "boom" },
		}),
	);
	tr.flush();
	rec = readRec(dir, rid);
	assert.equal(rec.turns, 2);
	assert.deepEqual(rec.tokens, { input: 10, output: 5, cacheRead: 1, cacheWrite: 2, context: 18 });
	assert.equal(rec.cost, 0.5);
	assert.equal(rec.activity, "final line");
	assert.equal(rec.error, "boom");
	const { items } = store.readTranscript(dir, rid, 0);
	assert.deepEqual(
		items.map((i: { kind: string }) => i.kind),
		["user", "tool_call", "tool_result", "assistant"],
	);
	assert.equal(items[0].text, "hello\nworld");
	assert.equal(items[2].isError, true);
	assert.equal(items[2].text, "out");
	assert.equal(items[3].text, "line1\nfinal   \u0007line  \n\n");
	tr.finish({ exitCode: 0 });
	tr.onLine(lineOf({ type: "tool_execution_start", toolName: "x", args: {} }));
	assert.equal(readRec(dir, rid).toolCalls, 1, "ignored after finish");
	store.removeFleetDir();
});

test("tracker: tool preview picks the first known argument, falls back to JSON", () => {
	const dir = mainFleet();
	const rid = id(11);
	const tr = must(trackerMod.startTracking({ id: rid, agent: "a", task: "t", background: false }));
	tr.onLine(lineOf({ type: "tool_execution_start", toolName: "read", args: { path: "/a/b" } }));
	tr.onLine(lineOf({ type: "tool_execution_start", toolName: "odd", args: { n: 1 } }));
	tr.onLine(lineOf({ type: "tool_execution_end", toolName: "odd", result: {} }));
	const calls = store.readTranscript(dir, rid, 0).items.filter((i: { kind: string }) => i.kind === "tool_call");
	assert.deepEqual(
		calls.map((c: { text: string }) => c.text),
		["read /a/b", 'odd {"n":1}'],
	);
	store.removeFleetDir();
});

test("tracker: a resumed run keeps counters, clears the end state and the stop marker", () => {
	const dir = mainFleet();
	const rid = id(12);
	const first = must(trackerMod.startTracking({ id: rid, agent: "a", task: "one", background: true }));
	first.onLine(
		lineOf({
			type: "message_end",
			message: {
				role: "assistant",
				content: [],
				usage: { input: 3, output: 4, totalTokens: 7, cost: { total: 1 } },
			},
		}),
	);
	store.requestStop(dir, rid);
	first.finish({ exitCode: 1, error: "x" });
	const ended = readRec(dir, rid);
	assert.equal(ended.state, "cancelled");
	assert.equal(ended.stoppedBy, "user");
	const again = must(trackerMod.startTracking({ id: rid, agent: "a", task: "two", background: true }));
	const rec = readRec(dir, rid);
	assert.equal(rec.startedAt, ended.startedAt);
	assert.equal(rec.turns, 1);
	assert.equal(rec.cost, 1);
	assert.equal(rec.tokens.input, 3);
	assert.equal(rec.state, "running");
	assert.equal(rec.endedAt, undefined);
	assert.equal(rec.exitCode, undefined);
	assert.equal(rec.error, undefined);
	assert.equal(rec.stoppedBy, undefined);
	assert.equal(rec.task, "two");
	assert.equal(store.stopOrigin(dir, rid), undefined);
	assert.equal(must(store.readTranscript(dir, rid, 0).items.at(-1)).text, "— resumed —");
	again.finish({ exitCode: 0 });
	assert.equal(readRec(dir, rid).state, "done");
	store.removeFleetDir();
});

test("tracker: finish states and idempotence", () => {
	const dir = mainFleet();
	const cases: Array<[Record<string, unknown>, string]> = [
		[{ exitCode: 0 }, "done"],
		[{}, "done"],
		[{ exitCode: 2 }, "failed"],
		[{ exitCode: 0, error: "e".repeat(500) }, "failed"],
		[{ aborted: true, exitCode: 143 }, "cancelled"],
		[{ cancelled: true }, "cancelled"],
	];
	cases.forEach(([opts, state], i) => {
		const rid = id(100 + i);
		const tr = must(trackerMod.startTracking({ id: rid, agent: "a", task: "t", background: false }));
		tr.finish(opts);
		tr.finish({ exitCode: 9 });
		const rec = readRec(dir, rid);
		assert.equal(rec.state, state, JSON.stringify(opts));
		assert.equal(typeof rec.endedAt, "number");
		assert.ok((rec.error?.length ?? 0) <= 300);
	});
	assert.equal(trackerMod.startTracking({ id: "bad", agent: "a", task: "t", background: false }), undefined);
	store.removeFleetDir();
	assert.equal(trackerMod.startTracking({ id: id(), agent: "a", task: "t", background: false }), undefined);
});

test("tracker at depth 2 records its parent run id", () => {
	const root = store.fleetRoot();
	const fleetDir = join(root, `${process.pid}-0badf00d`);
	mkdirSync(fleetDir, { recursive: true, mode: 0o700 });
	withEnv({ NYCODE_SUBAGENT_DEPTH: "1", NYCODE_FLEET_DIR: fleetDir, NYCODE_FLEET_RUN_ID: id(20) }, () => {
		const tr = must(trackerMod.startTracking({ id: id(21), agent: "a", task: "t", background: false }));
		tr.finish({});
		const rec = readRec(fleetDir, id(21));
		assert.equal(rec.parentId, id(20));
		assert.equal(rec.depth, 2);
	});
	rmSync(fleetDir, { recursive: true });
});

test("source: send outcomes, list and transcript", () => {
	const dir = mainFleet();
	const resumed: string[] = [];
	const deps = {
		resume: (rid: string) => {
			resumed.push(rid);
			return true;
		},
	};
	const src = sourceMod.getFleetSource(deps);
	assert.equal(sourceMod.fleetSourceForUi(), src);
	assert.equal(sourceMod.getFleetSource(deps), src, "memoised");
	store.writeRecord(dir, baseRecord(id(30)));
	store.writeRecord(dir, baseRecord(id(31), { state: "done", background: true }));
	store.writeRecord(dir, baseRecord(id(32), { state: "done", background: false }));
	store.writeRecord(dir, baseRecord(id(33), { state: "done", background: true, depth: 2 }));
	assert.equal(src.send(id(99), "hi"), "unknown");
	assert.equal(src.send(id(30), "   "), "not-running");
	assert.equal(src.send(id(30), "hi there"), "queued");
	const queued = store.readInbox(dir, id(30), 0).items;
	assert.equal(queued.length, 1);
	assert.equal(queued[0].text, "hi there");
	assert.equal(queued[0].id.length, 8);
	assert.equal(src.send(id(31), "more"), "resumed");
	assert.deepEqual(resumed, [id(31)]);
	assert.equal(src.send(id(32), "more"), "not-running");
	assert.equal(src.send(id(33), "more"), "not-running");
	assert.equal(src.list().length, 4);
	store.appendTranscript(dir, id(30), { t: 1, kind: "note", text: "n" });
	assert.equal(src.readTranscript(id(30), 0).items.length, 1);
	assert.equal(src.stop(id(99)), "unknown");
	assert.equal(src.stop(id(31)), "not-running");
	store.removeFleetDir();
	assert.deepEqual(src.list(), []);
	assert.deepEqual(src.readTranscript(id(30), 5), { items: [], next: 5 });
	assert.equal(src.send(id(30), "x"), "unknown");
	assert.equal(src.stop(id(30)), "unknown");
	assert.deepEqual(sourceMod.fleetStatusLines(), []);
});

test("a resume the user sent from the panel says so in the completion notice (fails before: the model saw a run it never resumed)", () => {
	const run = { id: "bg-0000abcd", agent: "Explore", state: "done", turns: 2, output: "resumed-ok" };
	const plain = registryText.backgroundCompletionText(run);
	assert.doesNotMatch(plain, /agent panel/);
	const fromPanel = registryText.backgroundCompletionText(run, "echo resumed-ok");
	assert.match(fromPanel, /^Report only, no action needed: the user messaged this run from the agent panel/);
	assert.match(fromPanel, /Do not resume or repeat it\. The user's message to the run was: "echo resumed-ok"\n\n/);
	assert.equal(fromPanel.endsWith(plain), true);
	assert.match(registryText.backgroundCompletionText(run, "x".repeat(900)), /"x{500}…"/);
});

test("stop origin: {cancel} is the agent, the panel is the user (fails before: every stop was recorded as the user)", async () => {
	const dir = mainFleet();
	const plain = { ...process.env };
	delete plain.NYCODE_FLEET_RUN_ID;
	const own = sleeper({ ...plain, NYCODE_FLEET_RUN_ID: id(50) });
	store.writeRecord(dir, baseRecord(id(50), { pid: own.pid }));
	assert.equal(sourceMod.stopOwnRun(id(50)), "stopping");
	assert.equal(store.stopOrigin(dir, id(50)), "agent");
	assert.equal(await own.exited, true);
	const t = must(trackerMod.startTracking({ id: id(51), agent: "a", task: "t", background: false }));
	store.requestStop(dir, id(51), "agent");
	t.finish({ exitCode: 143 });
	assert.equal(readRec(dir, id(51)).stoppedBy, "agent");
	assert.equal(readRec(dir, id(51)).state, "cancelled");
	assert.equal(trackerMod.stopNote("agent"), trackerMod.AGENT_STOP_NOTE);
	assert.equal(trackerMod.stopNote("user"), trackerMod.USER_STOP_NOTE);
	assert.notEqual(trackerMod.AGENT_STOP_NOTE, trackerMod.USER_STOP_NOTE);
	// panel stop (default) and an empty marker from an older build both read as the user
	store.requestStop(dir, id(52));
	assert.equal(store.stopOrigin(dir, id(52)), "user");
	writeFileSync(join(dir, `${id(53)}.stop`), "");
	assert.equal(store.stopOrigin(dir, id(53)), "user");
	assert.equal(store.stopOrigin(dir, id(54)), undefined);
	assert.equal(store.stopOrigin(undefined, id(54)), undefined);
	store.removeFleetDir();
});

test("stopRun: refused when /proc environ lacks the run id; stopping kills the group when present", async () => {
	const dir = mainFleet();
	const plain = { ...process.env };
	delete plain.NYCODE_FLEET_RUN_ID;
	const stranger = sleeper(plain);
	store.writeRecord(dir, baseRecord(id(40), { pid: stranger.pid }));
	assert.equal(sourceMod.stopRun(id(40)), "refused");
	assert.equal(store.stopOrigin(dir, id(40)), undefined);
	store.writeRecord(dir, baseRecord(id(41)));
	assert.equal(sourceMod.stopRun(id(41)), "refused", "no pid");
	process.kill(-stranger.pid, "SIGKILL");
	await stranger.exited;

	const own = sleeper({ ...plain, NYCODE_FLEET_RUN_ID: id(42) });
	store.writeRecord(dir, baseRecord(id(42), { pid: own.pid }));
	assert.equal(sourceMod.stopRun(id(42)), "stopping");
	assert.equal(store.stopOrigin(dir, id(42)), "user");
	assert.equal(await own.exited, true, "process group died within 2 s");

	const gone = sleeper({ ...plain, NYCODE_FLEET_RUN_ID: id(43) });
	process.kill(-gone.pid, "SIGKILL");
	await gone.exited;
	store.writeRecord(dir, baseRecord(id(43), { pid: gone.pid }));
	assert.equal(sourceMod.stopRun(id(43)), "refused", "reaped pid no longer has the env");
	store.removeFleetDir();
});

test("stopOwnForegroundRuns stops only this process foreground children", async () => {
	const dir = mainFleet();
	const plain = { ...process.env };
	const mine = sleeper({ ...plain, NYCODE_FLEET_RUN_ID: id(50) });
	const other = sleeper({ ...plain, NYCODE_FLEET_RUN_ID: id(51) });
	store.writeRecord(dir, baseRecord(id(50), { pid: mine.pid }));
	store.writeRecord(dir, baseRecord(id(51), { pid: other.pid, ownerPid: process.pid + 1 }));
	sourceMod.stopOwnForegroundRuns();
	assert.equal(await mine.exited, true);
	assert.equal(store.stopOrigin(dir, id(51)), undefined);
	process.kill(-other.pid, "SIGKILL");
	store.removeFleetDir();
	sourceMod.stopOwnForegroundRuns();
});

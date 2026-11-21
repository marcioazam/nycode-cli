// Ported from subagent-panel/fleet.test.ts (pi-code patch tests); same cases and expectations.
// Testes do plano de dados da frota (subagent/fleet/*): detach, raceDetach, status, inbox, onChange e regressões F1-F6.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { afterEach, test, vi } from "vitest";
import { fleetTestEnv } from "../support/fleet-env.ts";
import { baseRecord, deadPid, fleetRecordHelpers, id, sleeper, withEnv } from "../support/fleet-records.ts";

const { tmp } = fleetTestEnv("fleet-lifecycle-test-");
const store: any = await import("../../../../src/extensions/subagent/fleet/store.ts");
const trackerMod: any = await import("../../../../src/extensions/subagent/fleet/tracker.ts");
const detach: any = await import("../../../../src/extensions/subagent/fleet/detach.ts");
const inbox: any = await import("../../../../src/extensions/subagent/fleet/inbox.ts");
const sourceMod: any = await import("../../../../src/extensions/subagent/fleet/source.ts");
const registryText: any = await import("../../../../src/extensions/subagent/registry/registry-text.ts");
const { tempDir, mainFleet } = fleetRecordHelpers(store, tmp);
const readRec = (dir: string, rid: string) => JSON.parse(readFileSync(join(dir, `${rid}.json`), "utf8"));

afterEach(() => vi.useRealTimers());

test("detach: detachAll resolves detached, flips trackers to background, finishForeground clears", async () => {
	const dir = mainFleet();
	assert.equal(detach.hasForeground(), false);
	assert.equal(detach.currentForegroundCall(), undefined);
	let release: () => void = () => {};
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	const { call, result } = detach.runDetachable(async () => {
		assert.equal(detach.currentForegroundCall() !== undefined, true);
		await Promise.resolve();
		trackerMod.startTracking({ id: id(60), agent: "a", task: "t", background: false });
		await gate;
		return "done";
	});
	await new Promise((r) => setImmediate(r));
	assert.equal(detach.hasForeground(), true);
	assert.equal(call.isDetached, false);
	assert.equal(readRec(dir, id(60)).background, false);
	assert.equal(call.trackers.size, 1);
	assert.equal(detach.detachAll(), 1);
	await call.detached;
	assert.equal(call.isDetached, true);
	assert.equal(readRec(dir, id(60)).background, true);
	assert.equal(detach.hasForeground(), false);
	assert.equal(detach.detachAll(), 0);
	release();
	assert.equal(await result, "done");
	detach.finishForeground(call);

	const second = detach.runDetachable(async () => 1);
	assert.equal(detach.hasForeground(), true);
	await second.result;
	detach.finishForeground(second.call);
	assert.equal(detach.hasForeground(), false);
	// a tracker started inside an already detached call is background from the start
	const third = detach.runDetachable(async () => {
		await new Promise((r) => setImmediate(r));
		trackerMod.startTracking({ id: id(61), agent: "a", task: "t", background: false });
	});
	detach.detachAll();
	await third.result;
	assert.equal(readRec(dir, id(61)).background, true);
	store.removeFleetDir();
});

// A call that waits for its signal, settled from outside: the shape of a foreground subagent call.
function pendingWork() {
	let resolve: (v: string) => void = () => {};
	let seen: AbortSignal | undefined;
	const work = (signal: AbortSignal) => {
		seen = signal;
		return new Promise<string>((res, rej) => {
			resolve = res;
			if (signal.aborted) return rej(new Error("aborted")); // an abort listener added late never fires
			signal.addEventListener("abort", () => rej(new Error("aborted")), { once: true });
		});
	};
	return { work, resolve: (v: string) => resolve(v), signal: () => seen };
}

test("raceDetach: an aborted call cannot be detached (fails before: Ctrl+B after Esc revived it and woke the model)", async () => {
	const turn = new AbortController();
	const w = pendingWork();
	const out = detach.raceDetach(turn.signal, w.work);
	assert.equal(detach.hasForeground(), true);
	turn.abort();
	assert.equal(detach.hasForeground(), false, "aborted call left the detachable set");
	assert.equal(detach.detachAll(), 0);
	assert.equal(w.signal()?.aborted, true);
	await assert.rejects(out, /aborted/);

	// already aborted when the call starts: the work sees an aborted signal, nothing to detach
	const pre = new AbortController();
	pre.abort();
	const w2 = pendingWork();
	const out2 = detach.raceDetach(pre.signal, w2.work);
	assert.equal(w2.signal()?.aborted, true);
	assert.equal(detach.detachAll(), 0);
	await assert.rejects(out2, /aborted/);
});

test("raceDetach: done, detach-then-abort keeps running, rejection propagates", async () => {
	const turn = new AbortController();
	const w = pendingWork();
	const out = detach.raceDetach(turn.signal, w.work);
	w.resolve("r1");
	assert.deepEqual(await out, { done: "r1" });
	assert.equal(detach.hasForeground(), false);

	// detached: the turn's later abort (Esc on the next turn) does not reach the moved call
	const w2 = pendingWork();
	const out2 = detach.raceDetach(turn.signal, w2.work);
	assert.equal(detach.detachAll(), 1);
	const moved = await out2;
	assert.equal("detached" in moved, true);
	turn.abort();
	assert.equal(w2.signal()?.aborted, false);
	w2.resolve("late");
	assert.equal(await (moved as { detached: Promise<string> }).detached, "late");
	assert.equal(detach.hasForeground(), false);

	// no outer signal, work fails before any detach: the error reaches the caller
	const out3 = detach.raceDetach(undefined, async () => {
		throw new Error("boom");
	});
	await assert.rejects(out3, /boom/);
	assert.equal(detach.hasForeground(), false);
});

// D8 (docs/sync-observabilidade.md): contrato antigo era só depth 1 + running + background, com "(Ctrl+B)" e sem turnos/custo/tempo/atividade.
test("D8 fleetStatusLines lists every lane of the tree (any depth, running + finished < 30 min) with state, turns, cost, time and activity", () => {
	const dir = mainFleet();
	const now = Date.now();
	store.writeRecord(
		dir,
		baseRecord(id(70), {
			background: true,
			agent: "ghost",
			turns: 3,
			cost: 0.5,
			startedAt: now - 90_000,
			activity: "editando x.ts",
		}),
	);
	store.writeRecord(
		dir,
		baseRecord(id(71), { background: false, agent: "fgone", startedAt: now - 5_000, activity: "starting" }),
	);
	store.writeRecord(
		dir,
		baseRecord(id(72), {
			background: true,
			depth: 2,
			parentId: id(70),
			agent: "nested",
			ownerPid: process.ppid,
			startedAt: now - 3_000,
		}),
	);
	store.writeRecord(
		dir,
		baseRecord(id(73), {
			background: true,
			state: "done",
			agent: "fin",
			startedAt: now - 200_000,
			endedAt: now - 60_000,
			turns: 2,
		}),
	);
	store.writeRecord(
		dir,
		baseRecord(id(74), { state: "done", agent: "old", startedAt: now - 3 * 3600_000, endedAt: now - 2 * 3600_000 }),
	);
	const lines = sourceMod.fleetStatusLines();
	assert.equal(lines.length, 4, lines.join("\n"));
	const by = (rid: string) => lines.find((l: string) => l.includes(rid)) as string;
	assert.match(by(id(70)), /ghost running .*3t · \$0\.50 · 01:3\d · editando x\.ts/);
	assert.match(by(id(71)), /fgone running .*starting/);
	assert.match(by(id(72)), /^ {2}\S+ nested running .*depth 2/, "nested lanes are indented and say their depth");
	assert.match(by(id(73)), /fin done .*2t · .* · 02:20/);
	assert.ok(!lines.join("\n").includes(id(74)), "finished long ago: gone");
	const text = registryText.statusWithFleet();
	assert.doesNotMatch(text, /No background runs|Ctrl\+B/);
	assert.match(text, /ghost running/);
	assert.equal(registryText.cancelResultText(id(73)), `Run ${id(73)} already finished; nothing to cancel.`);
	assert.match(registryText.cancelResultText(id(99)), /^Unknown background run/);
	store.removeFleetDir();
	assert.match(
		registryText.statusWithFleet(),
		/^No background runs in this session\./,
		"both lists empty: the old header",
	);
});

test("inbox: pollInboxOnce steers each message and acks; a throwing pi acks too-late", () => {
	const dir = tempDir();
	const rid = id(80);
	store.appendInbox(dir, rid, { id: "m1", t: 1, text: "first" });
	store.appendInbox(dir, rid, { id: "m2", t: 2, text: "second" });
	const sent: Array<[string, unknown]> = [];
	const pi = { sendUserMessage: (text: string, opts: unknown) => void sent.push([text, opts]) };
	let off = inbox.pollInboxOnce(pi, dir, rid, 0);
	assert.deepEqual(sent, [
		["first", { deliverAs: "steer" }],
		["second", { deliverAs: "steer" }],
	]);
	assert.deepEqual(
		store.readAcks(dir, rid, 0).items.map((a: { id: string; outcome: string }) => [a.id, a.outcome]),
		[
			["m1", "steered"],
			["m2", "steered"],
		],
	);
	store.appendInbox(dir, rid, { id: "m3", t: 3, text: "late" });
	off = inbox.pollInboxOnce(
		{
			sendUserMessage: () => {
				throw new Error("gone");
			},
		},
		dir,
		rid,
		off,
	);
	assert.equal(store.readAcks(dir, rid, 0).items.at(-1).outcome, "too-late");
	assert.equal(inbox.pollInboxOnce(pi, dir, rid, off), off);
	rmSync(dir, { recursive: true });
});

test("inbox watcher: only depth >= 1 with a valid env; polls every second; stop and restart clear the handle", () => {
	const root = store.fleetRoot();
	mkdirSync(root, { recursive: true, mode: 0o700 });
	const fleetDir = join(root, `${process.pid}-0badf00d`);
	mkdirSync(fleetDir, { recursive: true });
	const sent: string[] = [];
	const pi = { sendUserMessage: (text: string) => void sent.push(text) };
	vi.useFakeTimers({ toFake: ["setInterval"] });
	const slotKey = Symbol.for("pi-code.fleet.inbox");
	const slot = globalThis as Record<symbol, unknown>;
	withEnv({ NYCODE_SUBAGENT_DEPTH: "0", NYCODE_FLEET_RUN_ID: id(90) }, () => {
		inbox.startInboxWatcher(pi);
		assert.equal(slot[slotKey], undefined);
	});
	withEnv({ NYCODE_SUBAGENT_DEPTH: "1", NYCODE_FLEET_DIR: fleetDir, NYCODE_FLEET_RUN_ID: "bad" }, () => {
		inbox.startInboxWatcher(pi);
		assert.equal(slot[slotKey], undefined);
	});
	withEnv({ NYCODE_SUBAGENT_DEPTH: "1", NYCODE_FLEET_DIR: fleetDir, NYCODE_FLEET_RUN_ID: id(90) }, () => {
		inbox.startInboxWatcher(pi);
		const first = slot[slotKey];
		assert.ok(first);
		store.appendInbox(fleetDir, id(90), { id: "a", t: 1, text: "hello" });
		vi.advanceTimersByTime(1000);
		assert.deepEqual(sent, ["hello"]);
		vi.advanceTimersByTime(1000);
		assert.deepEqual(sent, ["hello"], "offset advanced, no redelivery");
		inbox.startInboxWatcher(pi);
		assert.notEqual(slot[slotKey], first);
		inbox.stopInboxWatcher();
		assert.equal(slot[slotKey], undefined);
	});
	rmSync(fleetDir, { recursive: true });
});

test("onChange: debounced listener fed by the poll; last unsubscribe stops it; works before the dir exists", () => {
	vi.useFakeTimers({ toFake: ["setInterval", "setTimeout"] });
	let calls = 0;
	const src = sourceMod.createFleetSource({ resume: () => false });
	const offNoDir = src.onChange(() => calls++);
	vi.advanceTimersByTime(1000);
	vi.advanceTimersByTime(100);
	assert.equal(calls, 1);
	const dir = mainFleet();
	const off2 = src.onChange(() => calls++);
	vi.advanceTimersByTime(1000);
	vi.advanceTimersByTime(100);
	assert.equal(calls, 3, "both listeners called once through one debounce");
	off2();
	offNoDir();
	vi.advanceTimersByTime(5000);
	assert.equal(calls, 3);
	offNoDir();
	store.removeFleetDir();
	assert.equal(existsSync(dir), false);
});

// ---- fix lane: regressions F1-F6 ----

test("F1 finishExitCode: a maxTurns cap (SIGTERM, exit 143) finishes as done (fails before: helper missing, run.ts passed 143 -> failed)", () => {
	const dir = mainFleet();
	assert.equal(trackerMod.finishExitCode(true, 143), 0);
	assert.equal(trackerMod.finishExitCode(false, 143), 143);
	assert.equal(trackerMod.finishExitCode(false, null), undefined);
	const tr = trackerMod.startTracking({ id: id(200), agent: "a", task: "t", background: false });
	tr.finish({ exitCode: trackerMod.finishExitCode(true, 143) });
	assert.equal(readRec(dir, id(200)).state, "done");
	store.removeFleetDir();
});

test("F2 resume truncates the inbox and acks (fails before: the old steer is still readable from offset 0)", () => {
	const dir = mainFleet();
	const rid = id(210);
	trackerMod.startTracking({ id: rid, agent: "a", task: "t", background: true }).finish({ exitCode: 0 });
	store.appendInbox(dir, rid, { id: "old", t: 1, text: "stale steer" });
	store.appendAck(dir, rid, { id: "old", t: 1, outcome: "steered" });
	assert.equal(store.readInbox(dir, rid, 0).items.length, 1);
	trackerMod.startTracking({ id: rid, agent: "a", task: "t2", background: true });
	assert.deepEqual(store.readInbox(dir, rid, 0), { items: [], next: 0 });
	assert.deepEqual(store.readAcks(dir, rid, 0), { items: [], next: 0 });
	store.removeFleetDir();
});

test("F3 detach state survives a second module instance (fails before: instance B has its own empty inFlight)", () => {
	// Two instances in a separate process (detach.ts only imports node builtins, so Node strips its types directly).
	const url = JSON.stringify(new URL("../../../../src/extensions/subagent/fleet/detach.ts", import.meta.url).href);
	const script = `
    const a = await import(${url} + '?a')
    const b = await import(${url} + '?b')
    if (a === b) throw new Error('same instance')
    const { call, result } = a.runDetachable(async () => 'x')
    const before = b.hasForeground()
    const moved = b.detachAll()
    await call.detached
    await result
    a.finishForeground(call)
    console.log(JSON.stringify({ before, moved, detached: call.isDetached, after: b.hasForeground() }))`;
	const env = { ...process.env };
	env.NODE_V8_COVERAGE = ""; // an own empty key: child_process re-adds a deleted one to every child
	const out = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", script], {
		encoding: "utf8",
		env,
	});
	assert.equal(out.status, 0, out.stderr);
	assert.deepEqual(JSON.parse(out.stdout.trim().split("\n").pop() ?? ""), {
		before: true,
		moved: 1,
		detached: true,
		after: false,
	});
});

test("F4 foreign-owner runs: hidden from fleetStatusLines, stopOwnRun refuses (fails before: listed; stopOwnRun missing)", () => {
	const dir = mainFleet();
	store.writeRecord(dir, baseRecord(id(220), { background: true, agent: "mine" }));
	store.writeRecord(dir, baseRecord(id(221), { background: true, agent: "theirs", ownerPid: process.ppid }));
	assert.equal(sourceMod.fleetStatusLines().length, 1);
	assert.match(sourceMod.fleetStatusLines()[0], new RegExp(`${id(220)} mine running`));
	assert.equal(sourceMod.stopOwnRun(id(221)), "not-owned");
	assert.equal(store.stopOrigin(dir, id(221)), undefined);
	assert.equal(sourceMod.stopOwnRun(id(229)), "unknown");
	assert.match(registryText.cancelResultText(id(221)), /^Unknown background run/);
	assert.equal(store.stopOrigin(dir, id(221)), undefined);
	store.removeFleetDir();
});

test("F5 sigkillIfStillOwned: kills only a still-running, still-owned run (fails before: export missing)", async () => {
	const dir = mainFleet();
	const plain = { ...process.env };
	const live = sleeper({ ...plain, NYCODE_FLEET_RUN_ID: id(230) });
	store.writeRecord(dir, baseRecord(id(230), { pid: live.pid }));
	store.writeRecord(dir, baseRecord(id(230), { pid: live.pid, state: "done" }));
	assert.equal(sourceMod.sigkillIfStillOwned(dir, id(230), live.pid), false, "record no longer running");
	process.kill(-live.pid, 0); // still alive
	const strangerEnv = { ...plain };
	delete strangerEnv.NYCODE_FLEET_RUN_ID;
	store.writeRecord(dir, baseRecord(id(230), { pid: live.pid }));
	assert.equal(sourceMod.sigkillIfStillOwned(dir, id(231), live.pid), false, "pid env lacks that run id");
	assert.equal(sourceMod.sigkillIfStillOwned(dir, id(230), live.pid), true);
	assert.equal(await live.exited, true);
	store.removeFleetDir();
});

test("F6 fleet root safety (fails before: checkRootSafe missing, ensureFleetDir trusted any root)", () => {
	const base = tempDir();
	const safe = join(base, "safe");
	mkdirSync(safe, { mode: 0o700 });
	chmodSync(safe, 0o700);
	const open = join(base, "open");
	mkdirSync(open);
	chmodSync(open, 0o755);
	const link = join(base, "link");
	symlinkSync(safe, link);
	assert.equal(store.checkRootSafe(safe), true);
	assert.equal(store.checkRootSafe(open), false);
	assert.equal(store.checkRootSafe(link), false);
	assert.equal(store.checkRootSafe(join(base, "missing")), false);

	store.removeFleetDir();
	const tmpBase = tempDir();
	withEnv({ TMPDIR: tmpBase }, () => {
		const root = store.fleetRoot();
		mkdirSync(root);
		chmodSync(root, 0o755);
		assert.equal(store.ensureFleetDir(), undefined);
		// A root we do not trust is never swept (fails before: the sweep ran without the own-dir guard).
		const planted = join(root, `${deadPid()}-deadbeef`);
		mkdirSync(planted);
		store.sweepOrphanFleetDirs();
		assert.equal(existsSync(planted), true);
		rmSync(planted, { recursive: true });
		chmodSync(root, 0o700);
		const dir = store.ensureFleetDir();
		assert.equal(typeof dir, "string");
		store.removeFleetDir();
	});
	rmSync(base, { recursive: true });
	rmSync(tmpBase, { recursive: true });
});

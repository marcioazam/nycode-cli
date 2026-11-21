// Testes de falha e do relógio do modo time (vitest port)
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, test, vi } from "vitest";
import * as store from "../../../../src/extensions/subagent/fleet/store.ts";
import * as palette from "../../../../src/extensions/subagent/fleet-ui/style/palette.ts";
import * as teamIndex from "../../../../src/extensions/subagent/team/index.ts";
import * as route from "../../../../src/extensions/subagent/team/route.ts";
import * as teamStore from "../../../../src/extensions/subagent/team/store.ts";
import * as tasks from "../../../../src/extensions/subagent/team/tasks.ts";
import { fleetTestEnv } from "../fleet-env.ts";

// palette.ts reads the HUD config when it loads: an empty HOME (and no CLAUDE_CONFIG_DIR) makes the catch apply.
const savedEnv = await vi.hoisted(async () => {
	const { mkdtempSync } = await import("node:fs");
	const { tmpdir } = await import("node:os");
	const { join } = await import("node:path");
	const saved = { HOME: process.env.HOME, CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR };
	process.env.HOME = mkdtempSync(join(tmpdir(), "team-faults-home-"));
	delete process.env.CLAUDE_CONFIG_DIR;
	return saved;
});
afterAll(() => {
	for (const [k, v] of Object.entries(savedEnv)) {
		if (v === undefined) delete process.env[k];
		else process.env[k] = v;
	}
});
const { tmp } = fleetTestEnv("team-faults-");

const withEnv = async (vars: Record<string, string | undefined>, fn: () => void | Promise<void>): Promise<void> => {
	const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
	const set = (v: Record<string, string | undefined>): void => {
		for (const [k, x] of Object.entries(v)) {
			if (x === undefined) delete process.env[k];
			else process.env[k] = x;
		}
	};
	try {
		set(vars);
		await fn();
	} finally {
		set(saved);
	}
};
const rid = (n: number): string => `fg-${n.toString(16).padStart(8, "0")}`;
const rec = (n: number, agent: string) => ({
	v: 1,
	id: rid(n),
	parentId: null,
	depth: 1,
	agent,
	task: "t",
	background: false,
	state: "running",
	startedAt: n,
	updatedAt: n,
	turns: 0,
	toolCalls: 0,
	tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, context: 0 },
	cost: 0,
	ownerPid: process.pid,
});
const fakePi = () => {
	const sent: { text: string; deliverAs?: string }[] = [];
	const tools: { execute: (...a: unknown[]) => Promise<{ content: { text: string }[] }> }[] = [];
	const pi = {
		registerTool: (t: never) => void tools.push(t),
		registerCommand: () => {},
		on: () => {},
		getActiveTools: () => [],
		setActiveTools: () => {},
		sendUserMessage: (text: string, o?: { deliverAs?: string }) => void sent.push({ text, deliverAs: o?.deliverAs }),
	};
	return { pi, sent, tools };
};

test("hudColors falls back to no colors when the HUD config is missing", () => {
	assert.deepEqual(palette.hudColors(), {});
});

test("teamDir is undefined when the team directory cannot be created", () => {
	const file = join(tmp, "not-a-dir");
	writeFileSync(file, "x");
	assert.equal(teamStore.teamDir(file), undefined);
	assert.equal(tasks.addTask(file, { id: "main", agent: "lead", depth: 0 }, "x").ok, false);
});

test("addTask stops at 9999 tasks", () => {
	const dir = mkdtempSync(join(tmp, "fleet-"));
	const td = teamStore.teamDir(dir)!;
	for (let n = 1; n < 10_000; n++)
		writeFileSync(
			join(td, `task-${n}.json`),
			JSON.stringify({ id: `t${n}`, title: "x", files: [], by: "main", t: 1 }),
		);
	assert.match(
		(tasks.addTask(dir, { id: "main", agent: "lead", depth: 0 }, "one more") as { error?: string }).error ?? "",
		/too many tasks/,
	);
});

test("the tool runs against a real fleet dir; the 1 s tick delivers the lead inbox and the peer feed", async () => {
	vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
	try {
		await withEnv(
			{
				NYCODE_TEAMS: "1",
				NYCODE_SUBAGENT_DEPTH: undefined,
				NYCODE_SUBAGENT: undefined,
				NYCODE_FLEET_DIR: undefined,
				NYCODE_FLEET_RUN_ID: undefined,
			},
			async () => {
				const dir = store.ensureFleetDir()!;
				store.writeRecord(dir, rec(1, "a") as never);
				store.writeRecord(dir, rec(2, "b") as never);
				const { pi, sent, tools } = fakePi();
				teamIndex.registerTeam(pi as never);
				assert.equal(
					(await tools[0]!.execute("id", { action: "tasks", add: { title: "x" } })).content[0]!.text,
					"added t1",
				);

				route.sendMessage(
					dir,
					{ id: rid(1), agent: "a", depth: 1 },
					{ to: "lead", kind: "info", text: "ping lead" },
				);
				vi.advanceTimersByTime(1000);
				assert.equal(sent.length, 1);
				assert.equal(sent[0]!.deliverAs, "followUp");
				assert.match(sent[0]!.text, /ping lead/);

				await withEnv({ NYCODE_SUBAGENT_DEPTH: "1", NYCODE_FLEET_DIR: dir, NYCODE_FLEET_RUN_ID: rid(1) }, () => {
					store.appendTranscript(dir, rid(2), { t: 1, kind: "tool_call", tool: "edit", text: "edit src/a.ts" });
					vi.advanceTimersByTime(1000);
				});
				assert.equal(sent.length, 2);
				assert.equal(sent[1]!.deliverAs, "steer");
				assert.match(sent[1]!.text, /b: edit src\/a.ts/);

				teamIndex.stopTeamTimer();
				vi.advanceTimersByTime(5000);
				assert.equal(sent.length, 2, "stopped timer is silent");
				store.removeFleetDir();
			},
		);
	} finally {
		teamIndex.stopTeamTimer();
		vi.useRealTimers();
	}
});

// Record, environment and process helpers shared by the fleet data-plane tests.
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";

export const id = (n = 1): string => `fg-${n.toString(16).padStart(8, "0")}`;

export function withEnv(vars: Record<string, string | undefined>, fn: () => void): void {
	const saved: Record<string, string | undefined> = {};
	for (const k of Object.keys(vars)) saved[k] = process.env[k];
	try {
		for (const [k, v] of Object.entries(vars)) {
			if (v === undefined) delete process.env[k];
			else process.env[k] = v;
		}
		fn();
	} finally {
		for (const [k, v] of Object.entries(saved)) {
			if (v === undefined) delete process.env[k];
			else process.env[k] = v;
		}
	}
}

export const baseRecord = (rid: string, over: Record<string, unknown> = {}) => ({
	v: 1,
	id: rid,
	parentId: null,
	depth: 1,
	agent: "a",
	task: "t",
	background: false,
	state: "running",
	startedAt: 1,
	updatedAt: 1,
	turns: 0,
	toolCalls: 0,
	tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, context: 0 },
	cost: 0,
	ownerPid: process.pid,
	...over,
});

export const deadPid = (): number => spawnSync(process.execPath, ["-e", "0"]).pid as number;

export function sleeper(env: Record<string, string | undefined>) {
	const child = spawn("sleep", ["30"], { detached: true, stdio: "ignore", env });
	child.unref();
	const exited = new Promise<boolean>((resolve) => {
		child.on("exit", () => resolve(true));
		setTimeout(() => resolve(false), 2000).unref();
	});
	return { pid: child.pid as number, exited };
}

/** Per-test-file helpers bound to the fleet store module and the file's temp root. */
export function fleetRecordHelpers(store: any, tmp: string) {
	return {
		tempDir: (): string => mkdtempSync(join(tmp, "fleet-dir-")),
		// Depth 0 with a fresh process-wide fleet dir; callers remove it with store.removeFleetDir().
		mainFleet: (): string => {
			delete process.env.NYCODE_SUBAGENT_DEPTH;
			delete process.env.NYCODE_SUBAGENT;
			return store.ensureFleetDir();
		},
	};
}

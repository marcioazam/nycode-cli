// Replaces import/ny-pi/extensions/bash-timeout/index.test.ts (K8): the 600 s default, the 1800 s cap, the timeout
// hint and the background mode, now inside the core bash tool (src/core/tools/bash-timeout.ts, called by bash.ts).
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { resolveNycodeSettings } from "../../../src/core/settings-nycode.ts";
import { type BashOperations, createBashTool } from "../../../src/core/tools/bash.ts";
import {
	applyBashTimeout,
	DEFAULT_TIMEOUT_S,
	decideTimeout,
	MAX_TIMEOUT_S,
	wrapForBackground,
} from "../../../src/core/tools/bash-timeout.ts";

describe("decideTimeout", () => {
	it.each([undefined, 0, -5, Number.NaN, Number.POSITIVE_INFINITY])("%s becomes the default", (v) => {
		expect(decideTimeout(v)).toBe(DEFAULT_TIMEOUT_S);
	});

	it("passes a timeout within the cap", () => {
		expect(decideTimeout(5)).toBe(5);
		expect(decideTimeout(MAX_TIMEOUT_S)).toBe(MAX_TIMEOUT_S);
	});

	it("caps a timeout above the cap (the command runs; refusing dropped the whole call)", () => {
		expect(decideTimeout(MAX_TIMEOUT_S + 1)).toBe(MAX_TIMEOUT_S);
		expect(decideTimeout(9000)).toBe(MAX_TIMEOUT_S);
	});
});

/** Records the timeout and command the tool hands to the operations; optionally throws a timeout like the shell does. */
function fakeTool(opts: { backgroundOnTimeout?: boolean; throwTimeout?: number } = {}) {
	const seen: { command?: string; timeout?: number } = {};
	const operations: BashOperations = {
		exec: async (command, _cwd, { timeout }) => {
			seen.command = command;
			seen.timeout = timeout;
			if (opts.throwTimeout !== undefined) throw new Error(`timeout:${opts.throwTimeout}`);
			return { exitCode: 0 };
		},
	};
	const tool = createBashTool(tmpdir(), { operations, backgroundOnTimeout: opts.backgroundOnTimeout });
	return { tool, seen };
}

describe("bash tool timeout policy", () => {
	it("gives a call without timeout the default", async () => {
		const { tool, seen } = fakeTool();
		await tool.execute("c1", { command: "ls" });
		expect(seen).toEqual({ command: "ls", timeout: DEFAULT_TIMEOUT_S });
	});

	it("runs a call above the cap with the cap", async () => {
		const { tool, seen } = fakeTool();
		await tool.execute("c2", { command: "sleep 9000", timeout: 9000 });
		expect(seen.timeout).toBe(MAX_TIMEOUT_S);
	});

	it("appends the background hint to a timeout error", async () => {
		const { tool } = fakeTool({ throwTimeout: 1800 });
		const error = await tool.execute("c3", { command: "x" }).then(
			() => undefined,
			(err: unknown) => err,
		);
		const text = (error as Error).message;
		expect(text).toMatch(/Command timed out after 1800 seconds/);
		expect(text).toMatch(new RegExp(`${MAX_TIMEOUT_S} s`));
		expect(text).toMatch(/nohup/);
		expect(text).toMatch(/while kill -0 \S+ 2>\/dev\/null; do sleep \d+; done/);
		expect(text).not.toMatch(/\bpoll\b/);
	});

	it("leaves a normal result without the hint", async () => {
		const { tool } = fakeTool();
		const result = await tool.execute("c4", { command: "ls" });
		expect(JSON.stringify(result.content)).not.toContain("[bash-timeout]");
	});
});

describe("background mode", () => {
	const bgDir = mkdtempSync(join(tmpdir(), "nycodebg-test-"));
	afterAll(() => rmSync(bgDir, { recursive: true }));
	const wrap = (cmd: string, secs: number, id: string) => wrapForBackground(cmd, secs, id, bgDir);
	const sh = (shell: string, script: string) => spawnSync(shell, ["-c", script], { encoding: "utf8", timeout: 20000 });
	const shells = ["sh", "dash", "bash"].filter((s) => spawnSync("sh", ["-c", `command -v ${s}`]).status === 0);

	describe.each(shells)("shell %s", (shell) => {
		it("keeps output and exit code of a fast command (0 and 3)", () => {
			for (const code of [0, 3]) {
				const cmd = `echo out; echo err >&2; exit ${code}`;
				const plain = sh(shell, cmd);
				const wrapped = sh(shell, wrap(cmd, 5, `fast${code}`));
				expect(wrapped.status).toBe(code);
				expect(wrapped.status).toBe(plain.status);
				expect(wrapped.stdout).toBe("out\nerr\n");
				expect(wrapped.stderr).toBe("");
			}
		});

		it("handles heredocs and quotes", () => {
			const cmd = `cat <<'EOF'\n$HOME "dq" 'sq'\nEOF\necho "a b" 'c d'`;
			const r = sh(shell, wrap(cmd, 5, "quotes"));
			expect(r.stdout).toBe(`$HOME "dq" 'sq'\na b c d\n`);
			expect(r.status).toBe(0);
		});

		it("leaves a command that exceeds its time running and reports pid and log", () => {
			const t0 = Date.now();
			const r = sh(shell, wrap("echo start; sleep 2; echo done", 1, `slow-${shell}`));
			const dt = Date.now() - t0;
			expect(r.status).toBe(0);
			expect(dt >= 900 && dt < 1900, `returned after ${dt} ms`).toBe(true);
			const m = /pid (\d+), log ([^)]+)\)/.exec(r.stdout);
			expect(m, r.stdout).not.toBeNull();
			if (!m) return;
			expect(r.stdout).toMatch(/start/);
			expect(r.stdout).toMatch(/Still running after 1 s/);
			const pid = Number(m[1]);
			try {
				process.kill(pid, 0); // still alive after the shell exited
				// the suggested wait returns when the job ends, with no long fixed sleep
				const w = /To wait for it, use: (.+?) \(returns/.exec(r.stdout);
				expect(w, r.stdout).not.toBeNull();
				if (!w) return;
				const t1 = Date.now();
				expect(sh(shell, w[1]).status).toBe(0);
				expect(Date.now() - t1).toBeLessThan(4000);
				expect(readFileSync(m[2], "utf8")).toMatch(/start\ndone\n/);
			} finally {
				try {
					process.kill(pid);
				} catch {}
			}
		});
	});

	it("applyBashTimeout leaves the command alone when background mode is off", () => {
		expect(applyBashTimeout("ls", 30, "c", false)).toEqual({ command: "ls", timeout: 30 });
	});

	it("applyBashTimeout wraps, adds 60 s and skips a trailing & or a leading sleep when on", () => {
		const a = applyBashTimeout("make all", 30, "call:1/x", true);
		expect(a.command).toMatch(/make all/);
		expect(a.command).toMatch(/nycode-bg\/call_1_x\.log/);
		expect(a.timeout).toBe(90);
		expect(applyBashTimeout("srv &", undefined, "c", true).command).toBe("srv &");
		expect(applyBashTimeout("sleep 5; echo", undefined, "c", true).command).toBe("sleep 5; echo");
		expect(applyBashTimeout("  ", undefined, "c", true).command).toBe("  ");
		expect(applyBashTimeout("make", undefined, "c", true).timeout).toBe(DEFAULT_TIMEOUT_S + 60);
	});

	it("the bash tool wraps the command when created with backgroundOnTimeout", async () => {
		const { tool, seen } = fakeTool({ backgroundOnTimeout: true });
		await tool.execute("c:5", { command: "make", timeout: 30 });
		expect(seen.command).toMatch(/__nycodebg_p/);
		expect(seen.timeout).toBe(90);
	});

	it("reads the flag from the nycode settings resolver (env NYCODE_BASH_TIMEOUT_BG > settings > off)", () => {
		const flag = (settings: Parameters<typeof resolveNycodeSettings>[0], env: Record<string, string>) =>
			resolveNycodeSettings(settings, env).tools.bash.backgroundOnTimeout;
		expect(flag({}, {})).toBe(false);
		expect(flag({ tools: { bash: { backgroundOnTimeout: true } } }, {})).toBe(true);
		expect(flag({ tools: { bash: { backgroundOnTimeout: true } } }, { NYCODE_BASH_TIMEOUT_BG: "0" })).toBe(false);
		expect(flag({}, { NYCODE_BASH_TIMEOUT_BG: "1" })).toBe(true);
	});
});

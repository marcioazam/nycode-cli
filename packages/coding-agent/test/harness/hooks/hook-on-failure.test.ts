// Ported from zzzzzzzzzzzzzzzzzzzzzzz-hook-on-failure/hook-on-failure.test.ts. The patch-apply case has no counterpart.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { type HookCommand, type HooksConfig, loadHooks } from "../../../src/extensions/hooks/config.ts";
import { runPreToolUse, runUserPromptSubmit } from "../../../src/extensions/hooks/decisions.ts";
import type { HookRunResult } from "../../../src/extensions/hooks/runners.ts";

const tmp = mkdtempSync(join(tmpdir(), "hook-on-failure-test-"));
afterAll(() => rmSync(tmp, { recursive: true }));

// `extra` may carry an invalid onFailure on purpose (the config loader must reject it).
const hook = (extra: Record<string, unknown> = {}): HookCommand =>
	({ type: "command", command: "guard.py", ...extra }) as HookCommand;
const config = (h: HookCommand): HooksConfig => ({
	PreToolUse: [{ matcher: "*", hooks: [h] }],
	UserPromptSubmit: [{ hooks: [h] }],
});
const result = (o: Partial<HookRunResult>): HookRunResult => ({
	code: 0,
	stdout: "",
	stderr: "",
	timedOut: false,
	...o,
});
const pre = (h: HookCommand, r: Partial<HookRunResult>) =>
	runPreToolUse(config(h), "bash", { command: "ls" }, async () => result(r));
const prompt = (h: HookCommand, r: Partial<HookRunResult>) =>
	runUserPromptSubmit(config(h), "oi", async () => result(r));
const REASON = "Hook failed (exit 1, onFailure: block): guard.py: ModuleNotFoundError: x";
const FAIL = { code: 1, stderr: "ModuleNotFoundError: x\ntraceback" };

describe("onFailure", () => {
	it("PreToolUse: onFailure block + exit 1 bloqueia com o motivo", async () => {
		const o = await pre(hook({ onFailure: "block" }), FAIL);
		expect(o.block).toBe(true);
		expect(o.reason).toBe(REASON);
	});

	it("PreToolUse: exit 1 com JSON allow também bloqueia; sem stderr omite o sufixo", async () => {
		const o = await pre(hook({ onFailure: "block" }), {
			code: 3,
			stdout: '{"hookSpecificOutput":{"permissionDecision":"allow"}}',
		});
		expect(o.block).toBe(true);
		expect(o.reason).toBe("Hook failed (exit 3, onFailure: block): guard.py");
	});

	it("PreToolUse: sem onFailure ou continue, exit 1 segue permitido (paridade)", async () => {
		expect((await pre(hook(), FAIL)).block).toBe(false);
		expect((await pre(hook({ onFailure: "continue" }), FAIL)).block).toBe(false);
	});

	it("PreToolUse: exit 0 passa e exit 2 mantém o motivo do próprio hook, com block", async () => {
		expect((await pre(hook({ onFailure: "block" }), {})).block).toBe(false);
		const o = await pre(hook({ onFailure: "block" }), { code: 2, stderr: "nao" });
		expect([o.block, o.reason]).toEqual([true, "nao"]);
	});

	it("PreToolUse: timeout e spawnFailed continuam bloqueando", async () => {
		expect((await pre(hook({ onFailure: "block" }), { code: 1, timedOut: true })).reason).toMatch(/timed out/);
		expect((await pre(hook({ onFailure: "block" }), { spawnFailed: true, stderr: "boom" })).reason).toMatch(
			/failed to run/,
		);
	});

	it("UserPromptSubmit: mesmo tratamento", async () => {
		const o = await prompt(hook({ onFailure: "block" }), FAIL);
		expect([o.block, o.reason]).toEqual([true, REASON]);
		expect((await prompt(hook(), FAIL)).block).toBe(false);
	});

	it("config: block/continue preservados; valor inválido vira continue com aviso", () => {
		const file = join(tmp, "settings.json");
		writeFileSync(
			file,
			JSON.stringify({
				hooks: {
					PreToolUse: [
						{
							matcher: "*",
							hooks: [
								hook({ onFailure: "block" }),
								hook({ command: "b", onFailure: "maybe" }),
								hook({ command: "c", onFailure: "continue" }),
							],
						},
					],
				},
			}),
		);
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		try {
			const loaded = loadHooks([file]);
			expect(loaded.PreToolUse[0].hooks.map((h) => h.onFailure)).toEqual(["block", undefined, "continue"]);
			expect(warn.mock.calls.filter(([message]) => String(message).includes("onFailure"))).toHaveLength(1);
		} finally {
			warn.mockRestore();
		}
	});
});

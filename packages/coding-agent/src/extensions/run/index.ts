/**
 * Run (local patch): the `run` tool, detection of nohup/`&` in the bash tool and the Run section under Plan.
 * One registry for shells and background subagents (registry.ts); the finish of a run the agent awaits starts a turn.
 */
import type { ExtensionAPI, ExtensionContext } from "../../core/extensions/types.ts";

import { extractPid, type Instrumented, instrument } from "./detect.ts";
import { type RunRecord, sharedRegistry } from "./registry.ts";
import { RunSection } from "./section.ts";
import { registerDetected } from "./shell.ts";
import { registerRunTool, summary } from "./tool.ts";

export function finishMessage(r: RunRecord, now: number): { customType: string; content: string; display: boolean } {
	return { customType: "run-finished", content: `Run terminou:\n${summary(r, now, 20)}`, display: true };
}

export default function run(nycode: ExtensionAPI): void {
	const reg = sharedRegistry();
	const section = new RunSection(reg);
	registerRunTool(nycode, reg);
	/** toolCallId → what tool_call changed, read back by tool_result. */
	const pending = new Map<string, Instrumented & { cwd: string }>();
	let offFinish: (() => void) | undefined;

	nycode.on("session_start", (event, ctx: ExtensionContext) => {
		if (event.reason !== "reload") reg.resetSession();
		offFinish?.();
		offFinish = reg.onFinish((r) => {
			if (r.kind !== "shell" || !r.awaited || r.waiters > 0) return;
			try {
				nycode.sendMessage(finishMessage(r, reg.now()), { triggerTurn: true });
			} catch {
				// stale session: nobody to tell
			}
		});
		section.start(ctx);
	});

	nycode.on("session_shutdown", (_event, ctx: ExtensionContext) => {
		offFinish?.();
		offFinish = undefined;
		pending.clear();
		section.shutdown(ctx);
	});

	nycode.on("tool_call", (event, ctx: ExtensionContext) => {
		if (event.toolName !== "bash") return undefined;
		const input = event.input as { command?: unknown };
		if (typeof input.command !== "string") return undefined;
		const cwd = ctx.cwd ?? process.cwd();
		const inst = instrument(input.command, cwd);
		if (!inst) return undefined;
		input.command = inst.command;
		pending.set(event.toolCallId, { ...inst, cwd });
		return undefined;
	});

	nycode.on("tool_result", (event) => {
		if (event.toolName === "subagent") section.sync();
		const inst = pending.get(event.toolCallId);
		if (!inst) return undefined;
		pending.delete(event.toolCallId);
		// Always take the marker line out of what the model reads, even when no run is registered.
		let pid: number | undefined;
		const content = event.content.map((c) => {
			if (c.type !== "text") return c;
			const r = extractPid(c.text);
			pid ??= r.pid;
			return { ...c, text: r.text };
		});
		if (pid !== undefined) {
			try {
				registerDetected(reg, {
					pid,
					command: inst.display,
					cwd: inst.cwd,
					logPath: inst.logPath,
					repeatable: inst.trailing,
				});
			} catch {
				// at the live limit: the process runs, just unlisted
			}
		}
		return { content };
	});
}

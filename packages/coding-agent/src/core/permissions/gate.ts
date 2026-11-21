// K11: the permission gate in front of every tool call. `permissions.engine` picks who decides: "script" leaves the call
// to the embedded guard.py (run by the `hooks` extension at PreToolUse), "native" decides here with the TypeScript port
// of the guard. An engine that throws, an unknown engine or a missing guard script denies the call (C-F8-12).
import { existsSync } from "node:fs";
import { join } from "node:path";
import { checkoutRoot } from "../../extensions/_shared/project/project-root.ts";
import { claudePreCall } from "../../extensions/hooks/claude-tools.ts";
import { getBuiltinResourcesRoot } from "../builtin-resources.ts";
import type { ExtensionContext, ToolCallEventResult } from "../extensions/types.ts";
import type { Settings } from "../settings-schema.ts";
import { isBypassOn } from "./bypass-state.ts";
import { engineOf, globalPermissionsEngine } from "./global-settings.ts";
import { decide } from "./guard/decide.ts";

/** The tools the embedded guard judges: its hook matcher in settings-defaults.ts is `Bash|Edit|Write|Read`. */
const GUARDED_TOOLS = new Set(["Bash", "Edit", "Write", "Read"]);

/** What the gate needs from the session: a way to reach the UI. The engine comes from the global settings.json only. */
export interface GateHost {
	runner: { createContext(): ExtensionContext };
}

type NativeOutcome = { kind: "pass" } | { kind: "ask"; reason: string } | { kind: "block"; reason: string };

/** Why no engine can decide, or undefined when the chosen one can: only "script" and "native" exist, and "script" needs its file. */
function engineUnavailable(engine: string): string | undefined {
	if (engine === "native") return undefined;
	if (engine !== "script")
		return `permissions.engine "${engine}" is not known (use "script" or "native"); call denied`;
	return existsSync(join(getBuiltinResourcesRoot(), "hooks", "guard.py"))
		? undefined
		: 'permissions.engine is "script" but the embedded guard script (hooks/guard.py) was not found; call denied';
}

/** The native engine's outcome for one call; throws when the engine does, and the caller denies the call. */
function nativeOutcome(toolName: string, input: unknown, cwd: string): NativeOutcome {
	const call = claudePreCall(toolName, input, cwd);
	const tool = call.name;
	if (tool === undefined || !GUARDED_TOOLS.has(tool)) return { kind: "pass" };
	const verdict = decide({
		tool,
		input: call.input ?? {},
		cwd,
		project: checkoutRoot(cwd),
		bypass: isBypassOn(),
	});
	return verdict.kind === "allow"
		? { kind: "pass" }
		: { kind: verdict.kind === "ask" ? "ask" : "block", reason: verdict.reason };
}

const failure = (error: unknown): string =>
	`The permission engine failed, call denied: ${error instanceof Error ? error.message : String(error)}`;

/**
 * Decides a `tool_call` before the extension handlers see it. Returns undefined to let the call continue, or the block.
 * `ask` confirms with the user as the `hooks` extension does for a guard verdict; without a UI the block stands.
 */
export async function gateToolCall(
	toolName: string,
	input: unknown,
	host: GateHost,
): Promise<ToolCallEventResult | undefined> {
	try {
		const engine = globalPermissionsEngine();
		const unavailable = engineUnavailable(engine);
		if (unavailable !== undefined) return { block: true, reason: unavailable };
		if (engine !== "native") return undefined;
		const ctx = host.runner.createContext();
		const outcome = nativeOutcome(toolName, input, ctx.cwd);
		if (outcome.kind === "pass") return undefined;
		if (outcome.kind === "block") return { block: true, reason: outcome.reason };
		if (ctx.hasUI && (await ctx.ui.confirm(`Allow ${toolName}?`, outcome.reason))) return undefined;
		// A declined prompt ends the run, with the user there to say what next; without a UI the model sees the reason.
		return ctx.hasUI
			? { block: true, reason: outcome.reason, terminate: true }
			: { block: true, reason: outcome.reason };
	} catch (error) {
		return { block: true, reason: failure(error) };
	}
}

/** The guard opt-out the user wrote in the global settings.json (`"PreToolUse": []`); reported once per session. */
export function guardOptedOut(global: Settings): boolean {
	const preToolUse = global.hooks?.PreToolUse;
	return Array.isArray(preToolUse) && preToolUse.length === 0;
}

/**
 * Whether the embedded guard.py PreToolUse default runs. Never with the native engine (never both engines), and not
 * when the user's own global settings.json opts out; a project cannot do either (D-08: the guard is never silently
 * absent). `global` is readGlobalSettings().
 */
export function guardHookEnabled(global: Settings): boolean {
	return !guardOptedOut(global) && engineOf(global) !== "native";
}

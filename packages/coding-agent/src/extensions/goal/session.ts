/** Persisted goal state and the session readers /goal evaluates against. */

import * as os from "node:os";
import type { ExtensionContext } from "../../core/extensions/types.ts";
import { isProjectApprovedSilently } from "../_shared/project/project-approval.ts";
import { readManagedSettings } from "../_shared/settings/managed-settings.ts";
import { hookFiles, readSettingsDisableAllHooks } from "../hooks/index.ts";

/** Session entry type the goal state persists under. */
export const GOAL_ENTRY = "goal";

const HOOKS_GATE =
	"/goal can't run while hooks are restricted (disableAllHooks or allowManagedHooksOnly is set in settings or by policy).";

export type GoalState = "active" | "cleared" | "achieved" | "failed";

export interface GoalEntry {
	state: GoalState;
	condition: string;
}

export interface ActiveGoal {
	condition: string;
	setAt: number;
	iterations: number;
	lastReason?: string;
	/** Session token total when the goal was set; spend is measured from here. */
	tokensAtStart: number;
	/** Evaluator calls are not on the session total; they count toward the goal's spend. */
	evaluatorTokens: number;
	/** provider/id of the model that gave the latest verdict. */
	evaluator?: string;
}

export interface TurnMessage {
	role?: string;
	stopReason?: string;
	errorMessage?: string;
}

export interface TokenUsage {
	totalTokens?: number;
	input?: number;
	output?: number;
	cacheRead?: number;
	cacheWrite?: number;
}

export function usageTokens(usage: TokenUsage | undefined): number {
	if (!usage) return 0;
	return (
		usage.totalTokens ?? (usage.input ?? 0) + (usage.output ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0)
	);
}

export function lastAssistant(messages: readonly unknown[]): TurnMessage | undefined {
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i] as TurnMessage;
		if (message?.role === "assistant") return message;
	}
	return undefined;
}

export type SessionReader = Pick<ExtensionContext, "sessionManager">;

/** The branch as the evaluator reads it: messages plus the goal's own transcript lines,
 * which live in custom_message entries. */
export function branchMessages(ctx: SessionReader): unknown[] {
	const messages: unknown[] = [];
	for (const entry of ctx.sessionManager.getBranch()) {
		if (entry.type === "message") messages.push(entry.message);
		else if (entry.type === "custom_message")
			messages.push({ role: "custom", customType: entry.customType, content: entry.content });
	}
	return messages;
}

/** Cumulative assistant usage on the branch: the session's token spend so far. */
export function sessionTokens(ctx: SessionReader): number {
	let total = 0;
	for (const entry of ctx.sessionManager.getBranch()) {
		if (entry.type === "message" && entry.message.role === "assistant")
			total += usageTokens(entry.message.usage as TokenUsage | undefined);
	}
	return total;
}

/** The newest goal entry on the branch, which is the goal's persisted state. */
export function lastGoalEntry(ctx: SessionReader): GoalEntry | undefined {
	const branch = ctx.sessionManager.getBranch();
	for (let i = branch.length - 1; i >= 0; i--) {
		const entry = branch[i];
		if (entry.type !== "custom" || entry.customType !== GOAL_ENTRY) continue;
		const data = entry.data as Partial<GoalEntry> | undefined;
		return typeof data?.condition === "string" && typeof data.state === "string"
			? { state: data.state, condition: data.condition }
			: undefined;
	}
	return undefined;
}

/** Claude's availability rule: /goal rides the hooks system, so a hooks restriction refuses it
 * with the reason. Claude also refuses an untrusted workspace; nycode does not (C-F6-13). */
export function goalUnavailable(ctx: Pick<ExtensionContext, "cwd" | "isProjectTrusted" | "ui">): string | undefined {
	const managed = readManagedSettings();
	const trusted = isProjectApprovedSilently(ctx);
	const restricted =
		managed.disableAllHooks === true ||
		managed.allowManagedHooksOnly === true ||
		readSettingsDisableAllHooks(hookFiles(ctx.cwd, os.homedir(), trusted));
	if (restricted) return HOOKS_GATE;
	// No trust gate (C-F6-13): /goal runs in an untrusted workspace too; `trusted` only decides whether project hook files count above.
	return undefined;
}

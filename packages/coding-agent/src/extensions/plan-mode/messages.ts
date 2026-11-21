/** Constants and pure helpers of the plan-mode extension: tool set, tracker rules, reply and session-entry readers. */

import type { AgentMessage } from "@nycode/agent-core";
import type { AssistantMessage, TextContent } from "@nycode/ai";
import type { SessionEntry } from "../../core/session-manager.ts";
import { CANCELLED, HOLD } from "./render/done-view.ts";

/** Plan progress for other extensions (agents correlate their runs with the open step): {executing, step?, done, total}, `step` = first open step; published only when it changes. */
export const PLAN_STATE_CHANNEL = "pi-code:plan-state";

// Tools
export const PLAN_MODE_TOOLS = [
	"read",
	"bash",
	"grep",
	"find",
	"ls",
	"question",
	"plan_mode_complete",
	"tool_search",
	"web_fetch",
	"mcp__keenable__search_web_pages",
	"lsp_diagnostics",
	"lsp_hover",
	"lsp_definition",
	"lsp_references",
	"lsp_symbols",
	"todo",
	"subagent",
	"write",
	"edit", // subagent, write and edit are narrowed by isPlanModeToolAllowed
];

/** The tracker reads only this literal tag from the reply text; prose or ☑ checkboxes do not count. */
export const DONE_RULE =
	"When you finish step n, write the literal tag [DONE:n] in the final reply of the turn (the message without a tool call); the tracker reads only this tag, not prose or checkboxes. If the step ended mid-work, repeat the tag in the final reply. In that reply tick box n under `## Progresso` of the task's /docs record.";

/** Only the end of the plan or an explicit user request ends plan mode (owner contract 2026-11-15): nothing else, no event, no command. */
export const CANCEL_RULE =
	"Only when the user explicitly asks to leave plan mode or cancel the plan, end your reply with the line PLAN CANCELLED on its own; never on your own initiative.";

// Type guard for assistant messages
export function isAssistantMessage(m: AgentMessage): m is AssistantMessage {
	return m.role === "assistant" && Array.isArray(m.content);
}

// Extract text content from an assistant message
export function getTextContent(message: AssistantMessage): string {
	return message.content
		.filter((block): block is TextContent => block.type === "text")
		.map((block) => block.text)
		.join("\n");
}

// PLAN CANCELLED (or PLANO CANCELADO) alone on a line of the reply
// PLAN WAITING / PLAN BLOCKED (or the pt-BR forms) alone on a line: the plan is on hold, shown in the Plan section
export const holdOf = (text: string): "waiting" | "blocked" | undefined => {
	for (const line of text.split("\n")) {
		const m = HOLD.exec(line);
		if (m) return /^(?:WAITING|AGUARDANDO)$/i.test(m[1] ?? m[2] ?? "") ? "waiting" : "blocked";
	}
	return undefined;
};

export const isCancelled = (message: AssistantMessage | undefined): boolean =>
	!!message &&
	getTextContent(message)
		.split("\n")
		.some((line) => CANCELLED.test(line));

/** Said once when plan mode is left. The earlier [PLAN MODE ACTIVE] notes stay in the transcript:
 * removing them changed the cached prefix and made pi replay the prompt and tools as a new head,
 * a full prompt-cache miss on every exit (measured 2026-11-14: 0 of 35.7k tokens read). */
export const PLAN_ENDED_NOTE =
	"[PLAN MODE ENDED] Full tool access is restored; earlier [PLAN MODE ACTIVE] notes no longer apply.";

// Last element matching the predicate (the lib target predates Array.prototype.findLast)
export function findLast<T>(items: T[], match: (item: T) => boolean): T | undefined {
	for (let i = items.length - 1; i >= 0; i--) {
		if (match(items[i])) return items[i];
	}
	return undefined;
}

// Index of the last plan-mode-execute entry, or -1 when the current run never started one
export function findLastExecuteIndex(entries: SessionEntry[]): number {
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i] as { customType?: string };
		if (entry.customType === "plan-mode-execute") return i;
	}
	return -1;
}

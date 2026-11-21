/**
 * The text the subagent surfaces read out: a finished background run's notification,
 * the /tasks table and the /agents roster. No process state, no rendering widgets, so
 * each is a pure string function the tests can pin directly.
 */

import { capForContext } from "../../_shared/web/output-guard.ts";
import {
	allBackgroundRuns,
	type BackgroundRun,
	backgroundRun,
	backgroundStatusText,
	cancelBackgroundRun,
	MAX_BACKGROUND_RUNS,
	resumeBackgroundRun,
} from "../fleet/background.ts";
import { fleetStatusLines, sendEnabled, stopOwnRun } from "../fleet/source.ts";
import { currentFleetDir, readRecords, requestStop, undeliveredCount } from "../fleet/store.ts";
import type { LeadSendOutcome } from "../fleet/types.ts";
import type { AgentConfig, AgentSource } from "./agents.ts";

/** AC4: messages sent with `send` that no turn of the run consumed; empty when none or when send is off. */
function undeliveredNote(id: string): string {
	const dir = currentFleetDir();
	const n = dir && sendEnabled() ? undeliveredCount(dir, id) : 0;
	return n > 0 ? `${n} message(s) sent with send were not delivered; resend with resume` : "";
}

/** The completion notice a background run sends when it finishes. */
export function backgroundCompletionText(
	run: {
		id: string;
		agent: string;
		state: string;
		turns: number;
		output?: string;
		stderr?: string;
		partial?: boolean;
	},
	userResume?: string,
): string {
	const output = capForContext(run.output ?? "") || "(no output)";
	// A child that dies at boot writes its reason only to stderr; without this the
	// notice reads "failed after 0 turns ... (no output)" with nothing to act on.
	const diagnostics = run.state === "failed" && run.stderr ? `\n\nstderr tail:\n${capForContext(run.stderr)}` : "";
	// Claude marks maxTurns-capped output as partial and notes the run can be
	// resumed to continue from where it stopped.
	const partialNote = run.partial
		? `\n\n[Output is partial: the run stopped at its maxTurns limit. Resume it with {resume: "${run.id}", task: "..."} to continue.]`
		: "";
	// A resume the user sent from the agent panel. Unexplained, the model distrusts a run it never resumed;
	// worded as the user's message alone, it repeats the work (seen live with Haiku): say it is a done report.
	const origin =
		userResume === undefined
			? ""
			: `Report only, no action needed: the user messaged this run from the agent panel, which resumed it, and that resumed run has finished. Do not resume or repeat it. The user's message to the run was: "${userResume.length > 500 ? `${userResume.slice(0, 500)}…` : userResume}"\n\n`;
	const undelivered = undeliveredNote(run.id);
	const undeliveredLine = undelivered ? `\n\n[${undelivered}]` : "";
	return `${origin}Background subagent run ${run.id} (${run.agent}) ${run.state} after ${run.turns} turns.\n\n${output}${diagnostics}${partialNote}${undeliveredLine}`;
}

/** What to tell the model about a send request. */
export function sendResultText(id: string, outcome: LeadSendOutcome): string {
	const text: Record<LeadSendOutcome, string> = {
		queued: `Message queued for run ${id}: it is delivered at the run's next turn boundary, not in the middle of a tool call.`,
		resumed: `Run ${id} had finished; resumed it with your message. A notification will arrive on completion.`,
		"not-running": `Run ${id} is not running, so send cannot reach it: use {resume: "${id}", task: "..."} for a finished background run, or start a new run.`,
		"not-delivered": `Run ${id} ended before it read your message and could not be resumed: start a new run.`,
		unknown: `Unknown run: ${id}.\n\n${statusWithFleet()}`,
		disabled: "send is disabled (NYCODE_SUBAGENT_SEND=0).",
		empty: "Pass task with send: the message needs text.",
		"too-long": "Message too long: send takes at most 4000 characters.",
		"not-owned": `Run ${id} was not started by this session: send only reaches your own runs.`,
		"run-limit": `Run ${id} already took 20 messages: use resume or start a new run.`,
		"process-limit": "This session already sent 60 messages with send.",
	};
	return text[outcome];
}

/** What to tell the model about a resume request. */
export function resumeResultText(
	id: string,
	task: string | undefined,
	onComplete: (run: {
		id: string;
		agent: string;
		state: string;
		turns: number;
		output?: string;
		stderr?: string;
	}) => void,
	onResumed?: (run: { id: string; agent: string }) => void,
): string {
	if (!task) return "Pass task with resume: the follow-up needs an instruction.";
	const outcome = resumeBackgroundRun(id, task, onComplete);
	if (outcome === "resumed") {
		const run = backgroundRun(id);
		if (run) onResumed?.({ id: run.id, agent: run.agent });
		return `Resumed background run ${id} with the follow-up task; a notification will arrive on completion.`;
	}
	if (outcome === "still-running") return `Background run ${id} is still running; wait for it or cancel it first.`;
	if (outcome === "at-capacity")
		return `Background run cap reached (${MAX_BACKGROUND_RUNS} concurrent); wait for a run to finish before resuming ${id}.`;
	if (outcome === "cwd-gone")
		return `Background run ${id} ran in a working directory that no longer exists (an isolation worktree is cleaned up after an unchanged run); start a new run instead.`;
	return `Unknown background run: ${id}.\n\n${backgroundStatusText()}`;
}

/** What to tell the model about a cancel request. */
export function cancelResultText(id: string): string {
	// The model's cancel records its origin like the fleet path does (stoppedBy 'agent', note to the run's output).
	const dir = currentFleetDir();
	if (dir && backgroundRun(id)?.state === "running") requestStop(dir, id, "agent");
	const outcome = cancelBackgroundRun(id);
	if (outcome === "cancelled") return `Cancelled background run ${id}.`;
	if (outcome === "not-running") return `Background run ${id} already finished; nothing to cancel.`;
	const fleet = stopOwnRun(id);
	if (fleet === "stopping") return `Stopped run ${id}.`;
	if (fleet === "not-running") return `Run ${id} already finished; nothing to cancel.`;
	return `Unknown background run: ${id}.\n\n${statusWithFleet()}`;
}

/** The registry status plus every other lane of the session (the calls auto-detached or moved with Ctrl+B, nested lanes, finished ones), which live outside the registry. */
export function statusWithFleet(): string {
	const lanes = fleetStatusLines();
	const registry = allBackgroundRuns().length > 0 ? backgroundStatusText() : "";
	const base =
		lanes.length > 0
			? [registry, `Agent lanes:\n${lanes.join("\n")}`].filter(Boolean).join("\n\n")
			: backgroundStatusText();
	const dir = currentFleetDir();
	if (!dir || !sendEnabled()) return base;
	const lost = readRecords(dir)
		.filter((rec) => rec.ownerPid === process.pid && rec.state !== "running")
		.map((rec) => ({ id: rec.id, note: undeliveredNote(rec.id) }))
		.filter((run) => run.note)
		.map((run) => `${run.id}: ${run.note}`);
	return lost.length > 0 ? `${base}\n\n${lost.join("\n")}` : base;
}

/** The registry fields the /tasks listing prints. */
type BackgroundRunView = Pick<BackgroundRun, "id" | "agent" | "task" | "state" | "turns" | "output" | "stderr">;

const TASK_PREVIEW_CHARS = 60;
const TAIL_PREVIEW_CHARS = 200;

/** Truncate to at most `max` codepoints, iterating by codepoint so a multi-byte
 * character on the boundary is never cut into a lone surrogate. Returns the whole
 * string when it already fits, so a caller can tell it did not clip. */
function clipCodepoints(text: string, max: number): string {
	const points = Array.from(text);
	return points.length > max ? points.slice(0, max).join("") : text;
}

/** A one-line tail of what a run last said: the stderr tail for a failure (the only
 * diagnostics a boot failure leaves), the latest assistant text otherwise. */
function runOutputTail(run: BackgroundRunView): string | undefined {
	const stderrTail = run.state === "failed" ? run.stderr?.trim() : undefined;
	const raw = (stderrTail || run.output)?.trim();
	if (!raw) return undefined;
	const last = raw.split("\n").at(-1)?.trim() ?? "";
	const shortened = clipCodepoints(last, TAIL_PREVIEW_CHARS);
	const clipped = shortened === last ? last : `${shortened}...`;
	return stderrTail ? `stderr: ${clipped}` : clipped;
}

/** The /tasks listing: one line per background run, plus the short output tail the
 * registry's own status lines omit. A pure formatter so it tests against a plain list. */
export function tasksStatusText(runs: ReadonlyArray<BackgroundRunView>): string {
	if (runs.length === 0) return "No background subagent runs.";
	return runs
		.map((run) => {
			const plural = run.turns === 1 ? "" : "s";
			const label = run.state === "running" ? "running" : `${run.state} (${run.turns} turn${plural})`;
			const head = `${run.id} ${run.agent}: ${label} - ${clipCodepoints(run.task, TASK_PREVIEW_CHARS)}`;
			const tail = runOutputTail(run);
			return tail ? `${head}\n  ${tail}` : head;
		})
		.join("\n");
}

/** Listing order for /agents: lowest to highest precedence, matching how discovery
 * lets a later source win a name clash. */
const AGENT_SOURCE_ORDER: ReadonlyArray<AgentSource> = ["builtin", "plugin", "user", "project"];

const AGENTS_DIR_HINT = "Add agents as markdown files under ~/.claude/agents (user) or .claude/agents (project).";

/** The /agents listing: the discovered roster grouped by source, with file paths.
 * A pure formatter so it tests against a sample roster. */
export function agentsListText(agents: ReadonlyArray<Pick<AgentConfig, "name" | "source" | "filePath">>): string {
	if (agents.length === 0) return `No agents discovered.\n${AGENTS_DIR_HINT}`;
	const sections: string[] = [];
	for (const source of AGENT_SOURCE_ORDER) {
		const group = agents.filter((agent) => agent.source === source);
		if (group.length === 0) continue;
		const lines = group.map((agent) => `  ${agent.name} - ${agent.filePath}`).join("\n");
		sections.push(`${source}:\n${lines}`);
	}
	return `${sections.join("\n")}\n\n${AGENTS_DIR_HINT}`;
}

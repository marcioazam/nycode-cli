/**
 * Pure utility functions for plan mode.
 * Extracted for testability.
 */

import { lstatSync, mkdirSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";

import { getAgentDir } from "../../config.ts";
import {
	hasAnsiCNumericEscape,
	hasSubstitution,
	type Quote,
	quoteCloser,
	quoteEscapes,
	quoteOpensAt,
	shellWords,
	splitSegments,
} from "../_shared/shell/shell-split.ts";

// Destructive commands blocked in plan mode. Tested against the segment's command word,
// the one word that runs: an allowlisted head never executes its arguments, so `code`
// in a path, `touch` in a quoted pattern or `cp` in a file name is not a command.
const DESTRUCTIVE_PATTERNS = [
	/\brm\b/i,
	/\brmdir\b/i,
	/\bmv\b/i,
	/\bcp\b/i,
	/\bmkdir\b/i,
	/\btouch\b/i,
	/\bchmod\b/i,
	/\bchown\b/i,
	/\bchgrp\b/i,
	/\bln\b/i,
	/\btee\b/i,
	/\btruncate\b/i,
	/\bdd\b/i,
	/\bshred\b/i,
	/\bnpm\s+(install|uninstall|update|ci|link|publish)/i,
	/\bnpm\s+audit\s+fix\b/i,
	/\byarn\s+(add|remove|install|publish)/i,
	/\bpnpm\s+(add|remove|install|publish)/i,
	/\bpip\s+(install|uninstall)/i,
	/\bapt(-get)?\s+(install|remove|purge|update|upgrade)/i,
	/\bbrew\s+(install|uninstall|upgrade)/i,
	/\bgit\s+(add|commit|push|pull|merge|rebase|reset|checkout|branch\s+-d|stash|cherry-pick|revert|tag|init|clone)/i,
	/\bsudo\b/i,
	/\bsu\b/i,
	/\bkill\b/i,
	/\bpkill\b/i,
	/\bkillall\b/i,
	/\breboot\b/i,
	/\bshutdown\b/i,
	/\bsystemctl\s+(start|stop|restart|enable|disable)/i,
	/\bservice\s+\S+\s+(start|stop|restart)/i,
	/\b(vim?|nano|emacs|code|subl)\b/i,
	// nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- every pattern is one of the fixed literals above; only a `^\s*` anchor is prepended
].map((pattern) => new RegExp(String.raw`^\s*(?:${pattern.source})`, pattern.flags));

// A redirect writes wherever it points, from any position in the segment, and `<>` opens
// its target for reading and writing, creating it.
const REDIRECT_PATTERNS = [/(^|[^<])>(?!>)/, />>/, /<>/];

// Redirections that write nothing: onto /dev/null, and a descriptor duplicated onto
// another (`2>&1`, `>&2`, `>&-`). `>&file` is not one: it writes the file. Every run is
// bounded: the text is chosen by the model, and an unbounded `\d*` in front of an
// unanchored match backtracks quadratically (40,000 digits took over a second).
const DEV_NULL_REDIRECT = /(?:&|\d{0,3})>>?[ \t]{0,8}\/dev\/null(?=\s|$)/g;
const DESCRIPTOR_REDIRECT = /\d{0,3}>&(?:\d{1,3}|-)(?=\s|$)/g;

// Safe read-only commands allowed in plan mode. Deliberately excludes env/printenv
// (secret disclosure, and env is an exec wrapper), curl/wget (fetch plus -o writes),
// awk (system()) and sed (w/W/e write even under -n).
const SAFE_PATTERNS = [
	/^\s*cat\b/,
	/^\s*head\b/,
	/^\s*tail\b/,
	/^\s*less\b/,
	/^\s*more\b/,
	/^\s*grep\b/,
	/^\s*find\b/,
	/^\s*ls\b/,
	/^\s*pwd\b/,
	/^\s*cd(\s|$)/,
	/^\s*echo\b/,
	/^\s*printf\b/,
	/^\s*wc\b/,
	/^\s*sort\b/,
	/^\s*uniq\b/,
	/^\s*diff\b/,
	/^\s*file\b/,
	/^\s*stat\b/,
	/^\s*du\b/,
	/^\s*df\b/,
	/^\s*tree\b/,
	/^\s*which\b/,
	/^\s*whereis\b/,
	/^\s*type\b/,
	/^\s*uname\b/,
	/^\s*whoami\b/,
	/^\s*id\b/,
	/^\s*date\b/,
	/^\s*cal\b/,
	/^\s*uptime\b/,
	/^\s*ps\b/,
	/^\s*top\b/,
	/^\s*htop\b/,
	/^\s*free\b/,
	/^\s*git\s+(status|log|diff|show|branch|remote|config\s+--get)/i,
	/^\s*git\s+ls-/i,
	/^\s*npm\s+(list|ls|view|info|search|outdated|audit)/i,
	/^\s*yarn\s+(list|info|why|audit)/i,
	/^\s*node\s+--version/i,
	/^\s*python\s+--version/i,
	/^\s*jq\b/,
	/^\s*rg\b/,
	/^\s*fd\b/,
	/^\s*fdfind\b/,
	/^\s*python3\s+\S*\/skills\/obsidian-cli\/scripts\/kb\.py\s+(search|section|outline)\b/,
	/^\s*bat\b/,
	/^\s*eza\b/,
];

// find is allowlisted for traversal only; these actions run commands, delete or write.
const FIND_ACTIONS = /\s-(exec|execdir|ok|okdir|delete|fls|fprint|fprint0|fprintf)\b/;

// Flags that turn an allowlisted read into a write or an execution, per command.
const UNSAFE_FLAGS: ReadonlyArray<readonly [head: RegExp, flag: RegExp]> = [
	[/^\s*find\b/, FIND_ACTIONS],
	// -o ends a cluster of value-less flags (-ro); in -to, o is -t's separator.
	[/^\s*sort\b/, /\s(-[bdfghiMnRrsVcCmuz]*o|--output\b|--compress-program\b)/],
	[/^\s*tree\b/, /\s-[a-zA-Z]*o/],
	[/^\s*rg\b/, /\s--(pre|hostname-bin)\b/],
	[/^\s*git\s/, /\s--output(=|\s|$)/],
	// -x/--exec runs a command per result, -X/--exec-batch once for all; it may end a cluster
	// of value-less flags (-Hx), while in -tx or -etsx the x is the value of -t or -e.
	[/^\s*(fd|fdfind)\b/, /\s(-[HIusigFaLlpq0]*[xX](?=\s|$)|--exec(-batch)?(?==|\s|$))/],
	// --pager names the program bat runs when it pages.
	[/^\s*bat\b/, /\s--pager(?==|\s|$)/],
];

/** `segment` with its quoted spans removed, so a `>` or a flag inside a pattern reads as
 * text. Follows splitSegments: a backslash outside quotes escapes the next character,
 * and inside "..." and $'...' too, while '...' has no escapes. */
function withoutQuoted(segment: string): string {
	let bare = "";
	let quote: Quote | undefined;
	for (let i = 0; i < segment.length; i++) {
		const ch = segment[i];
		if (quote !== undefined) {
			if (ch === "\\" && quoteEscapes(quote)) i++;
			else if (ch === quoteCloser(quote)) quote = undefined;
			continue;
		}
		const opened = quoteOpensAt(segment, i);
		if (opened !== undefined) {
			quote = opened.quote;
			i += opened.length - 1;
		} else if (ch === "\\") {
			i++;
		} else {
			bare += ch;
		}
	}
	return bare;
}

function writesThroughRedirect(segment: string): boolean {
	const bare = withoutQuoted(segment).replace(DEV_NULL_REDIRECT, " ").replace(DESCRIPTOR_REDIRECT, " ");
	return REDIRECT_PATTERNS.some((pattern) => pattern.test(bare));
}

/** uniq [INPUT [OUTPUT]] writes its second operand. An option's value (-f N, -s N, -w N)
 * is not an operand. */
function uniqWrites(args: string[]): boolean {
	let operands = 0;
	for (let i = 0; i < args.length; i++) {
		if (["-f", "-s", "-w"].includes(args[i])) i++;
		else if (!args[i].startsWith("-")) operands++;
	}
	return operands >= 2;
}

const BRANCH_LISTS = /^(-l|--list|--contains|--no-contains|--merged|--no-merged|--points-at)$/;
const BRANCH_WRITE_LONG_FLAGS = new Set([
	"--delete",
	"--move",
	"--copy",
	"--force",
	"--unset-upstream",
	"--set-upstream-to",
	"--edit-description",
	"--track",
	"--no-track",
	"--create-reflog",
]);

/** A `git branch` flag that changes a branch: -d -D -m -M -c -C -u -f -t, alone or in a
 * cluster, or the long form of one. */
function isBranchWriteFlag(arg: string): boolean {
	if (arg.startsWith("--")) return BRANCH_WRITE_LONG_FLAGS.has(arg.split("=")[0]);
	return arg.startsWith("-") && /[dDmMcCuft]/.test(arg);
}

/** `git branch` lists unless it is given a name to create or a flag that changes one. */
function gitBranchWrites(args: string[]): boolean {
	if (args.some(isBranchWriteFlag)) return true;
	return args.some((arg) => !arg.startsWith("-")) && !args.some((arg) => BRANCH_LISTS.test(arg));
}

/** `git remote` lists and shows; every other subcommand edits the configuration. */
function gitRemoteWrites(args: string[]): boolean {
	const subcommand = args.find((arg) => !arg.startsWith("-"));
	return subcommand !== undefined && !["show", "get-url"].includes(subcommand);
}

/** Whether an allowlisted command carries a flag or operand that makes it write. */
function writesThroughOperands(segment: string): boolean {
	// Flags are read from the words the command receives: bash removes quotes first, so a
	// quoted '-delete' is the flag itself, while a flag-like run inside a quoted argument
	// ("x -delete") is not a word of its own.
	const words = shellWords(segment);
	// A flag is the start of a word: text inside a quoted value ("%h --output x") is not.
	const flagged = (flag: RegExp): boolean =>
		words.some((word) => word.startsWith("-") && flag.exec(` ${word}`)?.index === 0);
	if (UNSAFE_FLAGS.some(([head, flag]) => head.test(segment) && flagged(flag))) return true;
	const [command = "", subcommand = "", ...rest] = words;
	if (command === "uniq") return uniqWrites([subcommand, ...rest].filter(Boolean));
	if (command !== "git") return false;
	if (subcommand === "branch") return gitBranchWrites(rest);
	return subcommand === "remote" && gitRemoteWrites(rest);
}

function isSafeSegment(segment: string): boolean {
	if (DESTRUCTIVE_PATTERNS.some((pattern) => pattern.test(segment))) return false;
	if (writesThroughRedirect(segment)) return false;
	if (!SAFE_PATTERNS.some((pattern) => pattern.test(segment))) return false;
	return !writesThroughOperands(segment);
}

/**
 * Whether plan mode should let this bash command run.
 *
 * Model steering, not a sandbox: an allowlisted interpreter can still read and write
 * whatever the user can, so this narrows the blast radius of a wrong turn rather than
 * containing a determined one. Only OS-level isolation would be a boundary.
 */
export function isSafeCommand(command: string): boolean {
	if (hasSubstitution(command) || hasAnsiCNumericEscape(command)) return false;
	const segments = splitSegments(command);
	return segments.length > 0 && segments.every(isSafeSegment);
}

export interface TodoItem {
	step: number;
	text: string;
	completed: boolean;
	/** Todo mode only: the todo tool marks it in progress (false: pending). Unset in plan mode. */
	doing?: boolean;
	/** Shown by the Plan table when set (no producer yet): a step that is neither done nor in progress. */
	status?: "blocked" | "failed" | "skipped";
	/** Reason, question or error of a blocked/failed/skipped step (or any step): the Plan table prints it under the row (no producer yet). */
	note?: string;
	/** Sub agent running the step; shown by the Plan table when set (no producer yet). */
	agent?: string;
	/** The '-' bullets under the task in the plan text, one per line (plan modal and drawer); absent when it has none. */
	description?: string;
}

/** The plan state persisted in a session entry, once each field has been checked.
 * A field the restore cannot recognize is simply absent, so the caller keeps its
 * current value. */
export interface RestoredPlanState {
	enabled?: boolean;
	todos?: TodoItem[];
	executing?: boolean;
	savedTools?: string[];
}

const isTodoItem = (value: unknown): value is TodoItem => {
	if (value === null || typeof value !== "object") return false;
	const item = value as Record<string, unknown>;
	return (
		typeof item.step === "number" &&
		typeof item.text === "string" &&
		typeof item.completed === "boolean" &&
		(item.description === undefined || typeof item.description === "string")
	);
};

/** Read a persisted plan-mode entry, keeping only fields of the expected shape.
 * The session file is data on disk, and `savedTools` feeds the active tool set: a
 * string there would be spread character by character into the tool gating, and a
 * non-array `todos` throws on the first restore that iterates it. */
export function restoredPlanState(data: unknown): RestoredPlanState {
	if (data === null || typeof data !== "object") return {};
	const raw = data as Record<string, unknown>;
	const state: RestoredPlanState = {};
	if (typeof raw.enabled === "boolean") state.enabled = raw.enabled;
	if (typeof raw.executing === "boolean") state.executing = raw.executing;
	if (Array.isArray(raw.todos) && raw.todos.every(isTodoItem)) state.todos = raw.todos;
	if (Array.isArray(raw.savedTools) && raw.savedTools.every((tool) => typeof tool === "string"))
		state.savedTools = raw.savedTools;
	return state;
}

function cleanStepText(text: string, cut = true): string {
	let cleaned = text
		.replace(/\*{1,2}([^*]+)\*{1,2}/g, "$1") // Remove bold/italic
		.replace(/`([^`]+)`/g, "$1") // Remove code
		.replace(
			/^(Use|Run|Execute|Create|Write|Read|Check|Verify|Update|Modify|Add|Remove|Delete|Install)\s+(the\s+)?/i,
			"",
		)
		.replace(/\s+/g, " ")
		.trim();

	if (cleaned.length > 0) {
		cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
	}
	if (cut && cleaned.length > 50) {
		cleaned = `${cleaned.slice(0, 47)}...`;
	}
	return cleaned;
}

// Anchored to line start (m flag) so a prose line merely ending in "plan:" is not taken
// for the header, which would slice the plan section mid-list and drop earlier steps.
// Horizontal whitespace only ([^\S\n]): \s would include \n itself and overlap the
// following \n. The runs are bounded rather than unbounded: an unbounded run retried
// from every position on a long whitespace-only line is what backtracks super-linearly,
// and a real header carries at most a few spaces of indentation.
const PLAN_HEADER = /^[^\S\n]{0,8}\*{0,2}Plan:\*{0,2}[^\S\n]{0,8}\n/im;
const LINT_LINE_MAX = 1000;

const isBlank = (ch: string | undefined): boolean => ch !== undefined && ch !== "\n" && ch.trim() === "";

/**
 * Text of a `1. step` / `2) step` line, stopping at an inline `*`, or undefined when
 * the line is not a numbered step. Scanned rather than matched: the equivalent
 * pattern needs adjacent quantifiers over overlapping classes, which backtracks
 * super-linearly on a long line that turns out not to be a step.
 */
function numberedMarker(line: string): { num: string; start: number } | undefined {
	let i = 0;
	while (isBlank(line[i])) i++;

	const digitsStart = i;
	while (line[i] >= "0" && line[i] <= "9") i++;
	if (i === digitsStart) return undefined;
	const num = line.slice(digitsStart, i);

	if (line[i] !== "." && line[i] !== ")") return undefined;
	i++;

	const spaceStart = i;
	while (isBlank(line[i])) i++;
	if (i === spaceStart) return undefined; // the marker must be followed by whitespace
	return { num, start: i };
}

function numberedStepText(line: string): string | undefined {
	const marker = numberedMarker(line);
	if (!marker) return undefined;
	let i = marker.start;

	for (let stars = 0; stars < 2 && line[i] === "*"; stars++) i++;
	const first = line[i];
	if (first === undefined || first === "*" || isBlank(first)) return undefined;

	const rest = line.slice(i);
	const star = rest.indexOf("*");
	return star === -1 ? rest : rest.slice(0, star);
}

const DESCRIPTION_MAX = 1200;

interface PlanTask {
	item: TodoItem;
	/** The number written in the plan (lint messages cite it). */
	num: string;
	/** '-'/'*' bullets under the task. */
	bullets: number;
	lines: string[];
}

/**
 * Numbered tasks of a plan with what follows each one: `-`/`*` bullets and indented continuation
 * lines, up to the next numbered line, a heading or a flush-left prose line. A numbered line that is
 * not accepted as a task ends the previous task's description too.
 */
function planTasks(message: string): PlanTask[] {
	const tasks: PlanTask[] = [];
	const headerMatch = PLAN_HEADER.exec(message);
	if (!headerMatch) return tasks;

	const planSection = message.slice(message.indexOf(headerMatch[0]) + headerMatch[0].length);
	let current: PlanTask | undefined;

	for (const line of planSection.split("\n")) {
		if (numberedMarker(line)) {
			current = undefined;
			const captured = numberedStepText(line);
			if (captured === undefined) continue;
			const text = captured
				.trim()
				.replace(/\*{1,2}$/, "")
				.trim();
			if (text.length > 5 && !text.startsWith("`") && !text.startsWith("/") && !text.startsWith("-")) {
				const cleaned = cleanStepText(text);
				if (cleaned.length > 3) {
					current = {
						item: { step: tasks.length + 1, text: cleaned, completed: false },
						num: numberedMarker(line)!.num,
						bullets: 0,
						lines: [],
					};
					tasks.push(current);
				}
			}
			continue;
		}
		if (!current) continue;
		const body = line.slice(0, LINT_LINE_MAX).trim();
		if (body === "") continue;
		const bullet = (body[0] === "-" || body[0] === "*") && isBlank(body[1]);
		if (body.startsWith("#") || (!bullet && !isBlank(line[0]))) {
			current = undefined;
			continue;
		}
		const text = (bullet ? body.slice(1) : body)
			.replace(/\*{1,2}([^*]+)\*{1,2}/g, "$1")
			.replace(/`([^`]+)`/g, "$1")
			.replace(/\s+/g, " ")
			.trim();
		if (text === "") continue;
		if (bullet) current.bullets++;
		// A continuation line belongs to the bullet above it: one bullet per line.
		if (bullet || current.lines.length === 0) current.lines.push(text);
		else current.lines[current.lines.length - 1] += ` ${text}`;
	}
	for (const task of tasks) {
		const description = task.lines.join("\n");
		if (description)
			task.item.description =
				description.length > DESCRIPTION_MAX ? `${description.slice(0, DESCRIPTION_MAX - 1)}…` : description;
	}
	return tasks;
}

export function extractTodoItems(message: string): TodoItem[] {
	return planTasks(message).map((task) => task.item);
}

function extractDoneSteps(message: string): number[] {
	const steps: number[] = [];
	for (const match of message.matchAll(/\[DONE:(\d+)\]/gi)) {
		const step = Number(match[1]);
		if (Number.isFinite(step)) steps.push(step);
	}
	return steps;
}

export function markCompletedSteps(text: string, items: TodoItem[]): number {
	const doneSteps = extractDoneSteps(text);
	for (const step of doneSteps) {
		const item = items.find((t) => t.step === step);
		if (item) item.completed = true;
	}
	return doneSteps.length;
}

/**
 * Parse an explicitly submitted plan (from the plan_mode_complete tool) into
 * todo items. Unlike extractTodoItems, the Plan: header is optional because
 * the tool input is already known to be the plan itself.
 */
export function planToTodos(plan: string): TodoItem[] {
	const withHeader = PLAN_HEADER.test(plan) ? plan : `Plan:\n${plan}`;
	return extractTodoItems(withHeader);
}

const LINT_TIER = /Tier:\s*T([0-3])\b/i;
const LINT_ASSUMPTION = /^\s*[-*]?\s*A(\d+)\b/;
const LINT_PERCENT = /(?<!\d)\d{1,3}%/;
const LINT_AC_DEF = /^\s*[-*]?\s*AC(\d+)\s*[:(]/;
const LINT_EARS_TRIGGER = /\b(WHEN|IF|WHILE|WHERE|QUANDO|SE|ENQUANTO)\b/i;
const LINT_EARS_RESPONSE = /\b(SHALL|DEVE)\b/i;

/**
 * Check the shape of a submitted plan: tier line, tasks, assumption confidence, EARS
 * acceptance criteria, their coverage, a check command, risks and rollback.
 * One message per failed rule; lines are cut at LINT_LINE_MAX so no regex runs long.
 */
export function lintPlan(plan: string): string[] {
	const lines = plan.split("\n").map((l) => l.slice(0, LINT_LINE_MAX));
	const problems: string[] = [];
	let tier = -1;
	for (const l of lines) {
		const m = LINT_TIER.exec(l);
		if (m) {
			tier = Number(m[1]);
			break;
		}
	}
	if (tier < 0) problems.push('missing "Tier: Tn (signals)" line');
	const tasks = planTasks(PLAN_HEADER.test(plan) ? plan : `Plan:\n${plan}`);
	if (tasks.length === 0) problems.push("no numbered tasks");
	for (const task of tasks) {
		if (task.bullets === 0)
			problems.push(`task ${task.num} has no description (add '-' bullets under it: action, done criterion)`);
	}
	for (const l of lines) {
		const m = LINT_ASSUMPTION.exec(l);
		if (m && !LINT_PERCENT.test(l)) problems.push(`assumption A${m[1]} has no confidence %`);
	}
	for (const l of lines) {
		const marker = numberedMarker(l);
		const step = marker ? numberedStepText(l) : undefined;
		if (!marker || step === undefined) continue;
		// Measured as the todo list shows it (markdown stripped, before its 47+... cut).
		const shown = cleanStepText(step, false);
		if (shown.length > 50)
			problems.push(`task ${marker.num} title is ${shown.length} characters (max 50, as shown): "${shown}"`);
	}
	if (tier < 0) return problems;
	const any = (re: RegExp): boolean => lines.some((l) => re.test(l));
	if (tier >= 1) {
		const defs = new Map<string, number>();
		let ears = false;
		lines.forEach((l, i) => {
			const m = LINT_AC_DEF.exec(l);
			if (!m) return;
			if (!defs.has(m[1])) defs.set(m[1], i);
			const shall = LINT_EARS_RESPONSE.exec(l);
			if (shall && LINT_EARS_TRIGGER.test(l.slice(0, shall.index))) ears = true;
		});
		if (!ears) problems.push("no EARS acceptance criterion (AC1: WHEN … THE SYSTEM SHALL …)");
		// Ids a line cites, a range such as AC1–AC4 included (bounded: at most 200 ids per range).
		const cited = lines.map((l) => {
			const ids = new Set<string>();
			for (const m of l.matchAll(/\bAC(\d{1,3})(?:\s?[–—-]\s?(?:AC)?(\d{1,3})\b)?/g)) {
				const from = Number(m[1]);
				const to = m[2] === undefined ? from : Math.min(Number(m[2]), from + 200);
				for (let n = from; n <= to; n++) ids.add(String(n));
				ids.add(m[1]);
			}
			return ids;
		});
		for (const [id, defLine] of defs) {
			if (!cited.some((ids, i) => i !== defLine && ids.has(String(Number(id)))))
				problems.push(`AC${id} is not covered by any task`);
		}
		if (!any(/check:|verific/i)) problems.push("no check command in any task");
	}
	if (tier >= 2 && !any(/rollback|revers|risco|risk/i)) problems.push("no risks/rollback section");
	if (tier === 3 && !any(/rollback|revers/i)) problems.push("T3 plan without rollback");
	return problems;
}

const READ_ONLY_MCP =
	/^mcp__(keenable|perplexity|exa|brave_search|octen|parallel|youcom|context7|codegraph|paper_search|package_version_check|fetch|firecrawl|nimble)__/;

const READ_ONLY_AGENTS = new Set([
	"Explore",
	"code-mapper",
	"Plan",
	"perplexity-scout",
	"web-scout",
	"research-scout",
	"scholar-scout",
	"claim-verifier",
	"code-reviewer",
	"security-reviewer",
	"test-reviewer",
	"reliability-reviewer",
	"contract-migration-reviewer",
	"agent-systems-auditor",
]);

/** Directory where plan mode may write its plan files. */
export function plansDir(): string {
	return process.env.NYCODE_PLANS_DIR || join(getAgentDir(), "plans");
}

export interface ToolVerdict {
	ok: boolean;
	reason?: string;
}

function planFilePathVerdict(input: Record<string, unknown>, dir: string): ToolVerdict {
	const raw = input.path;
	if (typeof raw !== "string" || raw === "") return { ok: false, reason: "missing path" };
	const expanded = raw === "~" || raw.startsWith("~/") ? join(homedir(), raw.slice(1)) : raw;
	const abs = isAbsolute(expanded) ? resolve(expanded) : resolve(process.cwd(), expanded);
	if (!abs.endsWith(".md")) return { ok: false, reason: "only .md plan files" };
	try {
		mkdirSync(dir, { recursive: true });
		const root = realpathSync(dir);
		let real: string;
		try {
			real = realpathSync(abs); // follows a symlink at the leaf
		} catch {
			// A dangling symlink would let write create its target outside the plans dir.
			if (lstatSync(abs, { throwIfNoEntry: false })?.isSymbolicLink())
				return { ok: false, reason: "dangling symlink" };
			real = join(realpathSync(dirname(abs)), abs.slice(dirname(abs).length + 1));
		}
		if (real.startsWith(root + sep)) return { ok: true };
	} catch {
		// unresolvable parent or unwritable plans dir: refuse below
	}
	return { ok: false, reason: `only .md files inside ${dir}` };
}

function subagentVerdict(input: Record<string, unknown>): ToolVerdict {
	const items = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
	const names = [
		input.agent,
		...items(input.tasks).map((t) => (t as { agent?: unknown })?.agent),
		...items(input.chain).map((t) => (t as { agent?: unknown })?.agent),
	].filter((n) => n !== undefined);
	// resume reopens any earlier run, a writer included; a project scope lets a local agent shadow an allowlisted name.
	if (input.resume !== undefined) return { ok: false, reason: "resume is not allowed in plan mode" };
	if (input.agentScope !== undefined && input.agentScope !== "user")
		return { ok: false, reason: "only agentScope user" };
	if (names.length === 0) return { ok: true };
	const bad = names.filter((n) => typeof n !== "string" || !READ_ONLY_AGENTS.has(n));
	return bad.length === 0 ? { ok: true } : { ok: false, reason: `non-read-only agent: ${bad.join(", ")}` };
}

/** Plan-mode rules for tools beyond the fixed list: MCP servers, subagent agents, write/edit paths. */
export function isPlanModeToolAllowed(
	toolName: string,
	input: Record<string, unknown>,
	dir: string = plansDir(),
): ToolVerdict {
	if (toolName.startsWith("mcp__"))
		return READ_ONLY_MCP.test(toolName) ? { ok: true } : { ok: false, reason: "MCP server is not read-only" };
	if (toolName === "subagent") return subagentVerdict(input ?? {});
	if (toolName === "write" || toolName === "edit") return planFilePathVerdict(input ?? {}, dir);
	return { ok: true };
}
